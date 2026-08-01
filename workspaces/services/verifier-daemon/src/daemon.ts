/**
 * Verifier daemon alpha — quorum evaluate + evidence emission loop.
 *
 * Consumes assignments ({task -> wasm spec + input}), re-executes each inside
 * DeterministicSandbox, compares output hashes across the quorum, and emits:
 *   - vote payloads on match          → settlement fast path
 *   - dispute.open evidence packages  → when recomputes diverge
 *
 * Median recompute budget ≤ 500ms wall per task (monitored, logged).
 */

import { DeterministicSandbox, canonicalize, outputHashOf } from "./runtime";

/* ------------------------------ envelopes --------------------------------- */

export interface Assignment {
  taskId: string;
  wasmUrl: string; // resolved by the registry: content-addressed spec bytes
  wasm?: Uint8Array; // may be inlined in dev fixtures
  inputJson: unknown;
  reportedHash: string;
  buyer: string;
  worker: string;
  amount: string;
}

export interface Vote {
  verifier: string;
  recomputed: string;
  ok: boolean;
  ms: number;
}

export interface EvidencePackage {
  type: "evidence.recompute";
  taskId: string;
  reported: string;
  digests: Record<string, string>; // verifierId → outputHash
  votes: Vote[];
  quorum: string; // e.g. "2/3"
  at: number; // injected deterministic clock-adjacent wall (audit trail)
  canonical: string;
  sig: string; // dev signer: outputHashOf(canonical) — swap to ed25519 via voteSigner
}

export interface VotePacket {
  type: "vote";
  taskId: string;
  verifier: string;
  recomputed: string;
  ms: number;
  sig: string;
}

/* ------------------------------- daemon ----------------------------------- */

export interface DaemonConfig {
  verifierId: string;
  quorumVoices: string[]; // all daemon instances in the simulated quorum
  evidenceSink?: (pkg: EvidencePackage) => Promise<void> | void;
  voteSink?: (vote: VotePacket) => Promise<void> | void;
  fetchSpec?: (url: string) => Promise<Uint8Array>;
  voteSigner?: (canonical: string) => string;
}

export class VerifierDaemon {
  private sandbox = new DeterministicSandbox();

  constructor(private cfg: DaemonConfig) {}

  /** Run one assignment end-to-end and return the quorum outcome. */
  async process(a: Assignment): Promise<{ settled: boolean; votes: Vote[]; evidence?: EvidencePackage }> {
    const wasm = a.wasm ?? (await this.load(a.wasmUrl));

    // every seeded quorum member recomputes — same sandbox, same bytes
    const votes: Vote[] = [];
    for (const id of this.cfg.quorumVoices) {
      const r = await this.sandbox.run({
        wasm,
        taskId: a.taskId,
        inputJson: a.inputJson,
        wallBudgetMs: 500,
      });

      if (r.ok) {
        votes.push({ verifier: id, recomputed: r.outputHash!, ok: r.outputHash === a.reportedHash, ms: r.ms });
      } else {
        // sandbox failure counts as abstain, logged for the ledger
        votes.push({ verifier: id, recomputed: "ERROR", ok: false, ms: r.ms });
      }

      const canonical = canonicalize({ taskId: a.taskId, verifier: id, recomputed: votes.at(-1)!.recomputed });
      await this.cfg.voteSink?.({
        type: "vote",
        taskId: a.taskId,
        verifier: id,
        recomputed: votes.at(-1)!.recomputed,
        ms: r.ms,
        sig: this.sign(canonical),
      });
    }

    const matched = votes.filter((v) => v.ok).length;
    const mismatched = votes.length - matched;
    const settles = mismatched === 0; // unanimity required to settle cleanly

    if (settles) return { settled: true, votes };

    if (mismatched >= Math.ceil((votes.length * 2) / 3)) {
      const canonical = canonicalize({
        type: "evidence.recompute",
        taskId: a.taskId,
        reported: a.reportedHash,
        digests: Object.fromEntries(votes.map((v) => [v.verifier, v.recomputed])),
        quorum: `${mismatched}/${votes.length}`,
      });
      const evidence: EvidencePackage = {
        type: "evidence.recompute",
        taskId: a.taskId,
        reported: a.reportedHash,
        digests: Object.fromEntries(votes.map((v) => [v.verifier, v.recomputed])),
        votes,
        quorum: `${mismatched}/${votes.length}`,
        at: Date.now(),
        canonical,
        sig: this.sign(canonical),
      };
      await this.cfg.evidenceSink?.(evidence);
      return { settled: false, votes, evidence };
    }

    return { settled: false, votes }; // minority dissent: window stays open
  }

  private sign(canonical: string): string {
    return this.cfg.voteSigner ? this.cfg.voteSigner(canonical) : outputHashOf(canonical);
  }

  private async load(url: string): Promise<Uint8Array> {
    if (this.cfg.fetchSpec) return this.cfg.fetchSpec(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`spec fetch failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/* ----------------------- dev fixture + entrypoint -------------------------- */

const FIXTURE: Assignment = {
  taskId: "mrc_demo_fixtur",
  wasmUrl: "https://registry.machinarc.dev/specs/render.sequence.4k.wasm",
  inputJson: { frames: 240, seed: 88421 },
  reportedHash: outputHashOf(canonicalize({ frames: 240, seed: 88421 })),
  buyer: "agent:atlas-01",
  worker: "agent:vector-7",
  amount: "42.80",
};

async function main(): Promise<void> {
  const daemon = new VerifierDaemon({
    verifierId: "vrf:alpha-1",
    quorumVoices: ["vrf:gamma-1", "vrf:delta-4", "vrf:sigma-2"],
    evidenceSink: async (pkg) => {
      // dev: print the exact envelope the indexer expects to consume
      console.log("[evidence]", JSON.stringify(pkg, null, 2));
    },
    voteSink: async (v) => {
      console.log("[vote]", v.taskId, v.verifier, v.ok ? "MATCH" : "MISMATCH", `${v.ms}ms`);
    },
  });

  console.log("verifier-daemon alpha — fixture pass");
  console.log("");
  const out = await daemon.process(FIXTURE);
  console.log("");
  console.log(`result: ${out.settled ? "SETTLED-ELIGIBLE" : out.evidence ? "DISPUTE EVIDENCE EMITTED" : "MINORITY DISSENT"}`);
}

// index-canonical entrypoint
const isEntry = process.argv[1]?.endsWith("daemon.ts") || process.argv[1]?.endsWith("daemon.js");
if (isEntry) void main();

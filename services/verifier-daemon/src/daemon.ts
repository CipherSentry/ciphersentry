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

import { DeterministicSandbox, canonicalize, outputHashOf, pureRecompute } from "./runtime.ts";

/* ------------------------------ envelopes --------------------------------- */

export interface Assignment {
  taskId: string;
  wasmUrl?: string; // resolved by the registry: content-addressed spec bytes
  wasm?: Uint8Array; // may be inlined in dev fixtures
  /** pure (default) | wasm — pure is the B1 path for tasks without a WASM spec */
  mode?: "pure" | "wasm";
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
  ok: boolean;
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
  private cfg: DaemonConfig;

  constructor(cfg: DaemonConfig) {
    this.cfg = cfg;
  }

  /** Run one assignment end-to-end and return the quorum outcome. */
  async process(a: Assignment): Promise<{ settled: boolean; votes: Vote[]; evidence?: EvidencePackage; mode: "pure" | "wasm" }> {
    const mode: "pure" | "wasm" = a.mode ?? (a.wasm && a.wasm.byteLength > 0 ? "wasm" : "pure");
    let wasm: Uint8Array | undefined;
    if (mode === "wasm") {
      wasm = a.wasm ?? (a.wasmUrl ? await this.load(a.wasmUrl) : undefined);
      if (!wasm || wasm.byteLength === 0) {
        throw new Error("wasm mode requires wasm bytes or wasmUrl");
      }
    }

    // every seeded quorum member recomputes — same sandbox, same bytes
    const votes: Vote[] = [];
    for (const id of this.cfg.quorumVoices) {
      const r = await this.sandbox.run({
        wasm,
        mode,
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

      const last = votes.at(-1)!;
      const canonical = canonicalize({ taskId: a.taskId, verifier: id, recomputed: last.recomputed });
      await this.cfg.voteSink?.({
        type: "vote",
        taskId: a.taskId,
        verifier: id,
        recomputed: last.recomputed,
        ok: last.ok,
        ms: r.ms,
        sig: this.sign(canonical),
      });
    }

    const matched = votes.filter((v) => v.ok).length;
    const mismatched = votes.length - matched;
    const settles = mismatched === 0; // unanimity required to settle cleanly

    if (settles) return { settled: true, votes, mode };

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
      return { settled: false, votes, evidence, mode };
    }

    return { settled: false, votes, mode }; // minority dissent: window stays open
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

/* ----------------------- foundation ids + helpers -------------------------- */

/** Three foundation-run verifiers for B1 alpha. */
export const FOUNDATION_QUORUM = ["vrf:gamma-1", "vrf:delta-4", "vrf:sigma-2"] as const;

/** Expected honest hash for a pure-mode assignment. */
export function expectedPureHash(taskId: string, inputJson: unknown): string {
  return pureRecompute(inputJson, taskId).outputHash;
}

/* ----------------------- dev fixture + entrypoint -------------------------- */

const FIXTURE: Assignment = {
  taskId: "cent_demo_fixtur",
  mode: "pure",
  inputJson: { frames: 240, seed: 88421 },
  reportedHash: expectedPureHash("cent_demo_fixtur", { frames: 240, seed: 88421 }),
  buyer: "agent:atlas-01",
  worker: "agent:vector-7",
  amount: "42.80",
};

async function main(): Promise<void> {
  const daemon = new VerifierDaemon({
    verifierId: "vrf:alpha-1",
    quorumVoices: [...FOUNDATION_QUORUM],
    evidenceSink: async (pkg) => {
      console.log("[evidence]", JSON.stringify(pkg, null, 2));
    },
    voteSink: async (v) => {
      console.log("[vote]", v.taskId, v.verifier, v.ok ? "MATCH" : "MISMATCH", `${v.ms}ms`);
    },
  });

  console.log("verifier-daemon alpha — pure fixture pass");
  console.log("");
  const out = await daemon.process(FIXTURE);
  console.log("");
  console.log(
    `result: ${out.settled ? "SETTLED-ELIGIBLE" : out.evidence ? "DISPUTE EVIDENCE EMITTED" : "MINORITY DISSENT"} (${out.mode})`,
  );
  if (!out.settled) process.exitCode = 1;
}

// index-canonical entrypoint
const isEntry = process.argv[1]?.endsWith("daemon.ts") || process.argv[1]?.endsWith("daemon.js");
if (isEntry) void main();

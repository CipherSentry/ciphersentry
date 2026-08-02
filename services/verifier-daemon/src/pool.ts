/**
 * Verifier pool — B2 network + B3 CENT accrual.
 *
 * Elects a 3-seat quorum, re-executes assignments, real bond slashes on
 * mismatch, accuracy oracle updates, and accuracy² fee accrual on settle.
 */

import {
  FOUNDATION_QUORUM,
  VerifierDaemon,
  type Assignment,
  type EvidencePackage,
  type Vote,
  type VotePacket,
} from "./daemon.ts";
import { AccrualLedger, type AccrualEntry } from "./accrual.ts";
import { AccuracyOracle } from "./accuracy.ts";
import { EpochElection, type ElectionResult } from "./election.ts";
import { BondRegistry } from "./registry.ts";
import { SlashDryRunLedger, type SlashDryRun } from "./slash-dryrun.ts";

export interface PoolConfig {
  /** @deprecated Prefer registry + election; kept for B1 callers. */
  quorumVoices?: string[];
  epoch?: number;
  defaultBond?: number;
  registry?: BondRegistry;
  election?: EpochElection;
  accrual?: AccrualLedger;
  onVote?: (v: VotePacket) => void;
  onEvidence?: (pkg: EvidencePackage) => void;
  onSlashDryRun?: (rows: SlashDryRun[]) => void;
  onSlash?: (rows: SlashApplyRow[]) => void;
  onAccrual?: (entry: AccrualEntry) => void;
}

export interface SlashApplyRow {
  target: string;
  cut: number;
  remaining: number;
  jailed: boolean;
  severity: "FalseVote" | "Collusion";
  taskId: string;
}

export interface VerifyOutcome {
  settled: boolean;
  votes: Vote[];
  evidence?: EvidencePackage;
  slashDryRuns: SlashDryRun[];
  slashes: SlashApplyRow[];
  accrual?: AccrualEntry;
  mode: "pure" | "wasm";
  ms: number;
  quorum: string;
  verifiers: string[];
  epoch: number;
  election?: ElectionResult;
}

export class VerifierPool {
  readonly registry: BondRegistry;
  readonly election: EpochElection;
  readonly slash: SlashDryRunLedger;
  readonly accrual: AccrualLedger;
  readonly accuracy: AccuracyOracle;
  private epoch: number;
  private votes: VotePacket[] = [];
  private onVote?: (v: VotePacket) => void;
  private onEvidence?: (pkg: EvidencePackage) => void;
  private onSlashDryRun?: (rows: SlashDryRun[]) => void;
  private onSlash?: (rows: SlashApplyRow[]) => void;
  private onAccrual?: (entry: AccrualEntry) => void;

  constructor(cfg: PoolConfig = {}) {
    this.registry = cfg.registry ?? new BondRegistry(true);
    this.election = cfg.election ?? new EpochElection();
    this.epoch = cfg.epoch ?? 0;
    this.slash = new SlashDryRunLedger({
      epoch: this.epoch,
      defaultBond: cfg.defaultBond,
    });
    this.accrual = cfg.accrual ?? new AccrualLedger();
    this.accuracy = new AccuracyOracle(this.registry);

    for (const s of this.registry.all()) this.slash.setBond(s.id, s.bond);

    this.onVote = cfg.onVote;
    this.onEvidence = cfg.onEvidence;
    this.onSlashDryRun = cfg.onSlashDryRun;
    this.onSlash = cfg.onSlash;
    this.onAccrual = cfg.onAccrual;

    if (cfg.quorumVoices?.length) {
      for (const id of cfg.quorumVoices) {
        if (!this.registry.get(id)) {
          this.registry.stake(id, cfg.defaultBond ?? 25_000);
        }
      }
    }
  }

  get voices(): string[] {
    return this.ensureElection().members;
  }

  get currentEpoch(): number {
    return this.epoch;
  }

  setEpoch(epoch: number): ElectionResult {
    this.epoch = epoch;
    return this.elect(epoch);
  }

  ensureElection(epoch = this.epoch): ElectionResult {
    const existing = this.election.of(epoch);
    if (existing?.finalized) return existing;
    return this.elect(epoch);
  }

  elect(epoch = this.epoch): ElectionResult {
    const result = this.election.elect(epoch, this.registry);
    this.epoch = epoch;
    return result;
  }

  recentVotes(n = 32): VotePacket[] {
    return this.votes.slice(-n);
  }

  async verify(a: Assignment): Promise<VerifyOutcome> {
    const t0 = Date.now();
    const el = this.ensureElection();
    const voices = el.members.length >= 3 ? el.members : [...FOUNDATION_QUORUM];

    const daemon = new VerifierDaemon({
      verifierId: voices[0]!,
      quorumVoices: voices,
      voteSink: (v) => {
        this.votes.push(v);
        this.onVote?.(v);
      },
      evidenceSink: (pkg) => this.onEvidence?.(pkg),
    });

    const out = await daemon.process(a);
    let slashDryRuns: SlashDryRun[] = [];
    let slashes: SlashApplyRow[] = [];
    let accrual: AccrualEntry | undefined;

    // always feed accuracy oracle from votes
    this.accuracy.observe(
      out.votes.map((v) => ({ verifier: v.verifier, ok: v.ok })),
      a.taskId,
    );

    if (out.evidence) {
      slashDryRuns = this.slash.applyEvidence(out.evidence, "FalseVote");
      this.onSlashDryRun?.(slashDryRuns);
      slashes = this.applyRealSlashes(out.evidence, "FalseVote");
      this.onSlash?.(slashes);
    }

    if (out.settled) {
      accrual = this.accrual.accrue({
        taskId: a.taskId,
        epoch: this.epoch,
        escrowUsdc: a.amount,
        voters: out.votes.map((v) => ({ id: v.verifier, ok: v.ok })),
        registry: this.registry,
      });
      this.onAccrual?.(accrual);
    }

    return {
      settled: out.settled,
      votes: out.votes,
      evidence: out.evidence,
      slashDryRuns,
      slashes,
      accrual,
      mode: out.mode,
      ms: Date.now() - t0,
      quorum: `${out.votes.filter((v) => v.ok).length}/${out.votes.length}`,
      verifiers: voices,
      epoch: this.epoch,
      election: el,
    };
  }

  private applyRealSlashes(
    pkg: EvidencePackage,
    severity: "FalseVote" | "Collusion",
  ): SlashApplyRow[] {
    const bps = severity === "Collusion" ? 10_000 : 1_000;
    const rows: SlashApplyRow[] = [];
    for (const v of pkg.votes) {
      if (v.ok) continue;
      const bond = this.registry.bondOf(v.verifier);
      if (bond <= 0) continue;
      const cut = Math.floor((bond * bps) / 10_000);
      const r = this.registry.slash(v.verifier, cut);
      rows.push({
        target: v.verifier,
        cut: r.cut,
        remaining: r.remaining,
        jailed: r.jailed,
        severity,
        taskId: pkg.taskId,
      });
      this.slash.setBond(v.verifier, r.remaining);
    }
    return rows;
  }
}

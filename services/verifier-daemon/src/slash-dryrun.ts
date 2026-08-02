/**
 * Slash dry-run ledger — B1.
 *
 * Mirrors SlashExecutor.sol severity cuts without touching chain:
 *   FalseVote  → 10% of bond
 *   Collusion  → 100% of bond
 * Proceeds split (DOC-07 §06): 50% burn / 25% challenger / 25% treasury.
 *
 * Real slash txs land in B2 once audits clear. Until then every evidence
 * package that would slash is recorded here and emitted as `slash.dryrun`.
 */

import { outputHashOf, canonicalize } from "./runtime.ts";
import type { EvidencePackage } from "./daemon.ts";

export type SlashSeverity = "FalseVote" | "Collusion";

export interface SlashDryRun {
  id: string;
  taskId: string;
  target: string; // verifier address or id losing bond
  challenger: string;
  severity: SlashSeverity;
  bond: number;
  cut: number;
  burned: number;
  bounty: number;
  treasury: number;
  evidenceHash: string;
  epoch: number;
  at: number;
  mode: "dry-run";
}

export interface SlashDryRunConfig {
  /** Default bonded CENT for foundation verifiers when not registered. */
  defaultBond?: number;
  epoch?: number;
  /** Who receives the bounty share on dry-run (protocol treasury ops). */
  defaultChallenger?: string;
}

const FALSE_VOTE_BPS = 1_000; // 10%
const COLLUISION_BPS = 10_000; // 100%
const BPS = 10_000;

export class SlashDryRunLedger {
  private rows: SlashDryRun[] = [];
  private bonds = new Map<string, number>();
  private readonly defaultBond: number;
  private readonly epoch: number;
  private readonly defaultChallenger: string;
  private seq = 0;

  constructor(cfg: SlashDryRunConfig = {}) {
    this.defaultBond = cfg.defaultBond ?? 25_000;
    this.epoch = cfg.epoch ?? 0;
    this.defaultChallenger = cfg.defaultChallenger ?? "agent:foundation-challenger";
  }

  setBond(verifier: string, amount: number): void {
    this.bonds.set(verifier, amount);
  }

  bondOf(verifier: string): number {
    return this.bonds.get(verifier) ?? this.defaultBond;
  }

  all(): SlashDryRun[] {
    return [...this.rows];
  }

  byTask(taskId: string): SlashDryRun[] {
    return this.rows.filter((r) => r.taskId === taskId);
  }

  /**
   * From a recompute evidence package, dry-slash every mismatched verifier.
   * Honest votes are left alone. Returns one dry-run row per guilty vote.
   */
  applyEvidence(pkg: EvidencePackage, severity: SlashSeverity = "FalseVote"): SlashDryRun[] {
    const out: SlashDryRun[] = [];
    const evidenceHash = outputHashOf(pkg.canonical || canonicalize(pkg));
    for (const v of pkg.votes) {
      if (v.ok) continue;
      out.push(this.record({
        taskId: pkg.taskId,
        target: v.verifier,
        challenger: this.defaultChallenger,
        severity,
        evidenceHash,
      }));
    }
    return out;
  }

  record(params: {
    taskId: string;
    target: string;
    challenger?: string;
    severity: SlashSeverity;
    evidenceHash?: string;
  }): SlashDryRun {
    const bond = this.bondOf(params.target);
    const bps = params.severity === "Collusion" ? COLLUISION_BPS : FALSE_VOTE_BPS;
    const cut = Math.floor((bond * bps) / BPS);
    const burned = Math.floor(cut / 2);
    const bounty = Math.floor(cut / 4);
    const treasury = cut - burned - bounty;
    const row: SlashDryRun = {
      id: `slash_dry_${++this.seq}`,
      taskId: params.taskId,
      target: params.target,
      challenger: params.challenger ?? this.defaultChallenger,
      severity: params.severity,
      bond,
      cut,
      burned,
      bounty,
      treasury,
      evidenceHash: params.evidenceHash ?? outputHashOf(canonicalize(params)),
      epoch: this.epoch,
      at: Date.now(),
      mode: "dry-run",
    };
    this.rows.push(row);
    // reduce bond so subsequent dry-runs see progressive pain
    this.bonds.set(params.target, Math.max(0, bond - cut));
    return row;
  }
}

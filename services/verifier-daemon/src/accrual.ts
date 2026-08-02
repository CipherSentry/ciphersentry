/**
 * Accrual ledger — B3 CENT-ready.
 *
 * Protocol fee: 0.35% of escrow USDC (FEE_BPS = 35).
 * Split: 85% voting verifiers / 15% treasury (DOC-05 / whitepaper).
 * Verifier share is accuracy²-weighted across the elected quorum that
 * voted ok — computed off-chain with explicit variance bounds so anyone
 * can re-prove the split.
 */

import { canonicalize, outputHashOf } from "./runtime.ts";
import type { BondRegistry } from "./registry.ts";

export const FEE_BPS = 35; // 0.35%
export const VERIFIER_SHARE_BPS = 8_500; // 85% of fee
export const TREASURY_SHARE_BPS = 1_500; // 15% of fee
export const BPS = 10_000;
/** Floor fee in USDC micros (6 decimals) — 0.01 USDC, matches audit pack. */
export const FLOOR_FEE_USDC = 0.01;

export interface AccrualLine {
  verifier: string;
  amount: number; // USDC
  weight: number; // accuracy² weight used
  shareBps: number; // of verifier pool
}

export interface AccrualEntry {
  id: string;
  taskId: string;
  epoch: number;
  escrowUsdc: number;
  feeUsdc: number;
  treasuryUsdc: number;
  verifierPoolUsdc: number;
  lines: AccrualLine[];
  /** Proof digest: recompute from (taskId, epoch, lines, weights). */
  proof: string;
  weightSum: number;
  weightVariance: number;
  at: number;
}

export interface AccrualClaim {
  verifier: string;
  amount: number;
  at: number;
  entryIds: string[];
}

export class AccrualLedger {
  private entries: AccrualEntry[] = [];
  private balances = new Map<string, number>(); // verifier → unclaimed USDC
  private claimed = new Map<string, number>();
  private treasury = 0;
  private seq = 0;

  get treasuryBalance(): number {
    return this.treasury;
  }

  all(): AccrualEntry[] {
    return [...this.entries];
  }

  byEpoch(epoch: number): AccrualEntry[] {
    return this.entries.filter((e) => e.epoch === epoch);
  }

  balanceOf(verifier: string): number {
    return this.balances.get(verifier) ?? 0;
  }

  claimedOf(verifier: string): number {
    return this.claimed.get(verifier) ?? 0;
  }

  /** Fee on escrow amount (USDC). Floor 0.01 USDC when escrow ≥ floor. */
  static feeOf(escrowUsdc: number): number {
    if (!Number.isFinite(escrowUsdc) || escrowUsdc <= 0) return 0;
    const raw = (escrowUsdc * FEE_BPS) / BPS;
    if (escrowUsdc >= FLOOR_FEE_USDC && raw < FLOOR_FEE_USDC) return FLOOR_FEE_USDC;
    return raw;
  }

  /**
   * Record settlement fees and credit accuracy²-weighted shares.
   * Only verifiers with ok votes receive weight; weight_i = accBps_i².
   */
  accrue(params: {
    taskId: string;
    epoch: number;
    escrowUsdc: number | string;
    voters: { id: string; ok: boolean }[];
    registry: BondRegistry;
  }): AccrualEntry {
    const escrow = typeof params.escrowUsdc === "string" ? parseFloat(params.escrowUsdc) : params.escrowUsdc;
    let fee = AccrualLedger.feeOf(escrow);
    // tiny dust tasks: if fee would exceed escrow, take all (shouldn't happen at 0.35%)
    if (fee > escrow) fee = escrow;

    const treasuryUsdc = (fee * TREASURY_SHARE_BPS) / BPS;
    const verifierPoolUsdc = fee - treasuryUsdc;

    const okVoters = params.voters.filter((v) => v.ok);
    const weights = okVoters.map((v) => {
      const seat = params.registry.get(v.id);
      const acc = seat?.accuracyBps ?? 0;
      return { id: v.id, weight: acc * acc };
    });
    const weightSum = weights.reduce((s, w) => s + w.weight, 0);

    const lines: AccrualLine[] = [];
    if (weightSum > 0 && verifierPoolUsdc > 0) {
      let allocated = 0;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i]!;
        const isLast = i === weights.length - 1;
        const amount = isLast
          ? verifierPoolUsdc - allocated
          : (verifierPoolUsdc * w.weight) / weightSum;
        allocated += amount;
        const shareBps = Math.floor((w.weight * BPS) / weightSum);
        lines.push({ verifier: w.id, amount, weight: w.weight, shareBps });
        this.balances.set(w.id, (this.balances.get(w.id) ?? 0) + amount);
      }
    }

    const mean = weightSum / Math.max(weights.length, 1);
    const weightVariance =
      weights.length === 0
        ? 0
        : weights.reduce((s, w) => s + (w.weight - mean) ** 2, 0) / weights.length;

    this.treasury += treasuryUsdc;

    const proof = outputHashOf(
      canonicalize({
        taskId: params.taskId,
        epoch: params.epoch,
        fee,
        treasuryUsdc,
        lines: lines.map((l) => ({ v: l.verifier, a: l.amount, w: l.weight })),
      }),
    );

    const entry: AccrualEntry = {
      id: `acc_${++this.seq}`,
      taskId: params.taskId,
      epoch: params.epoch,
      escrowUsdc: escrow,
      feeUsdc: fee,
      treasuryUsdc,
      verifierPoolUsdc,
      lines,
      proof,
      weightSum,
      weightVariance,
      at: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Withdraw unclaimed balance (off-chain claim record). */
  claim(verifier: string): AccrualClaim {
    const amount = this.balances.get(verifier) ?? 0;
    if (amount <= 0) {
      return { verifier, amount: 0, at: Date.now(), entryIds: [] };
    }
    this.balances.set(verifier, 0);
    this.claimed.set(verifier, (this.claimed.get(verifier) ?? 0) + amount);
    const entryIds = this.entries.filter((e) => e.lines.some((l) => l.verifier === verifier)).map((e) => e.id);
    return { verifier, amount, at: Date.now(), entryIds };
  }

  summary() {
    return {
      entries: this.entries.length,
      treasury: this.treasury,
      outstanding: [...this.balances.entries()].reduce((s, [, v]) => s + v, 0),
      claimed: [...this.claimed.entries()].reduce((s, [, v]) => s + v, 0),
    };
  }
}

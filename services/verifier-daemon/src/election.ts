/**
 * Epoch election — B2.
 *
 * Off-chain mirror of QuorumElection.sol (DOC-07 §05):
 *   seed     = keccak-style digest of (epoch, salt)
 *   score(i) = bond × (acc/10k)² × (u/10k)   with u ∈ [0.75, 1.25)
 *   quorum   = top-3 eligible seats
 *   whale    = any seat weight ≤ 67% of quorum weight
 *
 * Same epoch + same candidate order ⇒ identical seats (I-E1).
 */

import { canonicalize, outputHashOf } from "./runtime.ts";
import type { BondRegistry, VerifierSeat } from "./registry.ts";

export const EPOCH_BLOCKS = 64;
export const TOP_SEATS = 3;
export const WHALE_CAP_BPS = 6_700;
export const MAX_BPS = 10_000;
export const JITTER_MIN = 7_500;
export const JITTER_SPAN = 5_000;

export interface ElectionResult {
  epoch: number;
  seed: string;
  members: string[];
  scores: number[];
  candidates: number;
  finalized: boolean;
  electedAt: number;
}

export class EpochElection {
  private byEpoch = new Map<number, ElectionResult>();
  private lastEpoch: number | null = null;
  private salt: string;

  constructor(opts?: { salt?: string }) {
    this.salt = opts?.salt ?? "ciphersentry-offchain";
  }

  get lastElectedEpoch(): number | null {
    return this.lastEpoch;
  }

  seedFor(epoch: number): string {
    // Off-chain stand-in for keccak(blockhash(epoch_start − 2)).
    return outputHashOf(canonicalize({ epoch, salt: this.salt, op: "election.seed" }));
  }

  /** u ∈ [7500, 12500) — same bounds as the contract's JITTER_MIN/SPAN. */
  jitterFor(seed: string, index: number): number {
    const h = outputHashOf(canonicalize({ seed, index }));
    // take low 32 bits of hash hex
    const n = parseInt(h.slice(2, 10), 16) >>> 0;
    return JITTER_MIN + (n % JITTER_SPAN);
  }

  scoreOf(seat: VerifierSeat, seed: string, index: number): number {
    if (seat.bond <= 0 || seat.accuracyBps <= 0) return 0;
    const u = this.jitterFor(seed, index);
    // bond × (acc/MAX)² × (u/MAX) — staged like the Solidity version
    const acc = seat.accuracyBps;
    return Math.floor((((seat.bond * acc) / MAX_BPS) * acc * u) / (MAX_BPS * MAX_BPS));
  }

  of(epoch: number): ElectionResult | undefined {
    return this.byEpoch.get(epoch);
  }

  /**
   * Elect top-3 from eligible candidates. Throws on whale capture / empty.
   * Idempotent: re-electing a finalized epoch returns the stored result.
   */
  elect(epoch: number, registry: BondRegistry, candidateIds?: string[]): ElectionResult {
    const existing = this.byEpoch.get(epoch);
    if (existing?.finalized) return existing;

    const eligible = registry.eligible();
    const pool = candidateIds
      ? candidateIds
          .map((id) => registry.get(id))
          .filter((s): s is VerifierSeat => !!s && s.status === "Bonded" && s.bond >= 25_000)
      : eligible;

    if (pool.length < TOP_SEATS) {
      throw new Error(`need ≥ ${TOP_SEATS} eligible verifiers, have ${pool.length}`);
    }
    if (pool.length > 64) throw new Error(`too many candidates: ${pool.length}`);

    const seed = this.seedFor(epoch);
    const scored = pool.map((seat, i) => ({
      id: seat.id,
      score: this.scoreOf(seat, seed, i),
    }));

    // top-3 argmax, stable on ties by candidate order (first max wins — matches contract ≥)
    const chosen = new Set<number>();
    const members: string[] = [];
    const scores: number[] = [];
    for (let seat = 0; seat < TOP_SEATS; seat++) {
      let best = -1;
      let bestIdx = -1;
      for (let i = 0; i < scored.length; i++) {
        if (chosen.has(i)) continue;
        const sc = scored[i]!.score;
        if (sc >= best && sc > 0) {
          best = sc;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) throw new Error("empty score ledger");
      chosen.add(bestIdx);
      members.push(scored[bestIdx]!.id);
      scores.push(best);
    }

    const quorumWeight = scores[0]! + scores[1]! + scores[2]!;
    if (scores[0]! * MAX_BPS > quorumWeight * WHALE_CAP_BPS) {
      throw new Error(`whale capture: seat0=${scores[0]} quorum=${quorumWeight}`);
    }

    const result: ElectionResult = {
      epoch,
      seed,
      members,
      scores,
      candidates: pool.length,
      finalized: true,
      electedAt: Date.now(),
    };
    this.byEpoch.set(epoch, result);
    this.lastEpoch = epoch;
    return result;
  }

  isMember(epoch: number, id: string): boolean {
    const e = this.byEpoch.get(epoch);
    return !!e && e.members.includes(id);
  }
}

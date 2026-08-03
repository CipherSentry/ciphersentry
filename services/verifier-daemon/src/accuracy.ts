/**
 * Accuracy oracle — B3.
 *
 * Tracks per-verifier vote outcomes and writes accuracyBps into BondRegistry
 * (mirrors VerifierRegistry.setAccuracy). New identities start at DEFAULT and
 * decay toward observed rate with EMA so sybil grinding is expensive.
 */

import { BondRegistry, DEFAULT_ACCURACY_BPS } from "./registry.ts";

export interface AccuracySample {
  verifier: string;
  ok: boolean;
  taskId: string;
  at: number;
}

export interface AccuracySnapshot {
  verifier: string;
  correct: number;
  total: number;
  accuracyBps: number;
  emaBps: number;
}

/** EMA alpha — recent votes weight more (DOC-style decay). */
const EMA_ALPHA = 0.15;

export class AccuracyOracle {
  private correct = new Map<string, number>();
  private total = new Map<string, number>();
  private ema = new Map<string, number>();
  private samples: AccuracySample[] = [];
  private registry: BondRegistry;

  constructor(registry: BondRegistry) {
    this.registry = registry;
    for (const s of registry.all()) {
      this.ema.set(s.id, s.accuracyBps);
      this.correct.set(s.id, 0);
      this.total.set(s.id, 0);
    }
  }

  of(verifier: string): AccuracySnapshot {
    const total = this.total.get(verifier) ?? 0;
    const correct = this.correct.get(verifier) ?? 0;
    const raw = total === 0 ? DEFAULT_ACCURACY_BPS : Math.floor((correct * 10_000) / total);
    const emaBps = this.ema.get(verifier) ?? DEFAULT_ACCURACY_BPS;
    return { verifier, correct, total, accuracyBps: raw, emaBps };
  }

  all(): AccuracySnapshot[] {
    const ids = new Set([...this.total.keys(), ...this.registry.all().map((s) => s.id)]);
    return [...ids].map((id) => this.of(id));
  }

  /** Record quorum votes after a verify. Writes EMA accuracy into the registry. */
  observe(votes: { verifier: string; ok: boolean }[], taskId: string): AccuracySnapshot[] {
    const out: AccuracySnapshot[] = [];
    const at = Date.now();
    for (const v of votes) {
      this.samples.push({ verifier: v.verifier, ok: v.ok, taskId, at });
      this.total.set(v.verifier, (this.total.get(v.verifier) ?? 0) + 1);
      if (v.ok) this.correct.set(v.verifier, (this.correct.get(v.verifier) ?? 0) + 1);

      const prev = this.ema.get(v.verifier) ?? DEFAULT_ACCURACY_BPS;
      const obs = v.ok ? 10_000 : 0;
      const next = Math.round(prev * (1 - EMA_ALPHA) + obs * EMA_ALPHA);
      this.ema.set(v.verifier, Math.max(0, Math.min(10_000, next)));

      // push into registry for next election / fee weights
      if (this.registry.get(v.verifier)) {
        this.registry.setAccuracy(v.verifier, this.ema.get(v.verifier)!);
      }
      out.push(this.of(v.verifier));
    }
    return out;
  }

  recent(n = 64): AccuracySample[] {
    return this.samples.slice(-n);
  }
}

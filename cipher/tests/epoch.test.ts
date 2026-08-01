import { describe, expect, it, vi } from "vitest";
import {
  BOND_FLOOR,
  elect,
  epochEmission,
  rollEpoch,
  seedEpoch,
  seedVerifiers,
  weeklyEmission,
  weight,
} from "../src/network/verifiers";

const T0 = 1_700_000_000_000;

describe("emissions schedule", () => {
  it("decays with the tokenomics exponent", () => {
    expect(weeklyEmission(3)).toBeGreaterThan(0);
    expect(weeklyEmission(4)).toBeLessThan(weeklyEmission(3));
    const ratio = weeklyEmission(4) / weeklyEmission(3);
    expect(ratio).toBeCloseTo(Math.pow(0.75, 1 / 52), 6);
  });

  it("scales weekly rate into console epochs", () => {
    expect(epochEmission(3)).toBe(Math.round(weeklyEmission(3) / 10_080));
  });
});

describe("seed pool", () => {
  it("seeds nine bond-compliant verifiers", () => {
    const pool = seedVerifiers();
    expect(pool).toHaveLength(9);
    for (const v of pool) {
      expect(v.bond).toBeGreaterThanOrEqual(BOND_FLOOR);
      expect(v.accuracy).toBeGreaterThan(0.9);
      expect(v.accuracy).toBeLessThanOrEqual(1);
      expect(weight(v)).toBeCloseTo(v.bond * v.accuracy * v.accuracy, 6);
    }
  });
});

describe("election", () => {
  it("is deterministic for the same epoch seed", () => {
    const pool = seedVerifiers();
    const a = elect(pool, 8842);
    const b = elect(seedVerifiers(), 8842);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
  });

  it("excludes unbonding and under-floor nodes", () => {
    const pool = seedVerifiers().map((v) => ({
      ...v,
      status: "UNBONDING" as const,
    }));
    expect(elect(pool, 8842)).toHaveLength(0);

    const broke = seedVerifiers().map((v) => ({ ...v, bond: 100 }));
    expect(elect(broke, 8842)).toHaveLength(0);
  });
});

describe("epoch roll", () => {
  it("advances, distributes the full fund, and records votes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no slashes, deterministic votes
    const e0 = seedEpoch(T0);
    const r = rollEpoch(seedVerifiers(), e0, T0 + 30_000, 3);

    expect(r.epoch.n).toBe(e0.n + 1);
    expect(r.epoch.elected).toHaveLength(3);

    // fund splits across non-slashed electees, within integer rounding
    const fund = epochEmission(3);
    const distributed = r.distribution.reduce((s, x) => s + x.marc, 0);
    expect(Math.abs(distributed - fund)).toBeLessThanOrEqual(3);
    expect(r.emitted).toBe(fund);

    // correct voters earned accuracy and lifetime MARC
    for (const d of r.distribution) {
      const v = r.pool.find((x) => x.id === d.id)!;
      expect(v.accruedMarc).toBeGreaterThan(0);
      expect(d.usdc).toBeGreaterThan(0);
    }
    expect(r.slashes).toHaveLength(0);
  });

  it("slashes a false vote: -10% bond, ejection from distribution, log entry", () => {
    // sequence: votes=high, falseVote triggers on 2nd call of first electee
    const draws = [0.9, 0.01];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => (i < draws.length ? draws[i++] : 0.99));

    const e0 = seedEpoch(T0);
    const pool = seedVerifiers();
    const victimId = e0.elected[0];
    const before = pool.find((v) => v.id === victimId)!;

    const r = rollEpoch(pool, e0, T0 + 30_000, 3);

    expect(r.slashes).toHaveLength(1);
    expect(r.slashes[0].verifier).toBe(victimId);
    expect(r.slashes[0].amount).toBe(Math.round(before.bond * 0.1));

    const victim = r.pool.find((v) => v.id === victimId)!;
    expect(victim.bond).toBe(before.bond - Math.round(before.bond * 0.1));
    expect(victim.status).toBe("SLASHED");
    expect(victim.accuracy).toBeLessThan(before.accuracy);
    expect(r.distribution.find((d) => d.id === victimId)).toBeUndefined();
  });
});

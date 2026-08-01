/**
 * V0.2 Verifier Network — epoch engine (simulation binding).
 * Bonds (CENT), deterministic quorum elections, accuracy² weighting,
 * slash executor, and the pre-TGE accrual ledger.
 */

export interface Verifier {
  id: string;
  bond: number; // CENT
  accuracy: number; // 0..1, decayed
  votesEpoch: number;
  correctEpoch: number;
  earnedUsdc: number; // lifetime task-fee share
  accruedCent: number; // lifetime emissions
  status: "BONDED" | "SLASHED" | "UNBONDING";
}

export interface SlashEvent {
  id: string;
  at: number;
  verifier: string;
  reason: string;
  amount: number;
  epoch: number;
}

export interface EpochInfo {
  n: number;
  startedAt: number;
  durMs: number;
  elected: string[];
}

export const EPOCH_MS = 26_000;
export const BOND_FLOOR = 25_000;

/* tokenomics: R(w) = 350M · 0.0824 · 0.75^(w/52) — per weekly epoch */
export function weeklyEmission(week: number): number {
  return 350_000_000 * 0.0824 * Math.pow(0.75, week / 52);
}
/** console epochs are minute-scaled: week → 10,080 console-minutes */
export function epochEmission(week: number): number {
  return Math.round(weeklyEmission(week) / 10_080);
}

export function weight(v: Verifier): number {
  return v.bond * v.accuracy * v.accuracy;
}

export function seedVerifiers(): Verifier[] {
  const rows: [string, number, number][] = [
    ["vrf:gamma-1", 420_000, 0.997],
    ["vrf:delta-4", 310_000, 0.994],
    ["vrf:sigma-2", 260_000, 0.991],
    ["vrf:kappa-8", 180_000, 0.988],
    ["vrf:lambda-3", 150_000, 0.984],
    ["vrf:rho-5", 120_000, 0.979],
    ["vrf:tau-9", 95_000, 0.972],
    ["vrf:xi-7", 60_000, 0.965],
    ["vrf:omega-0", BOND_FLOOR, 0.952],
  ];
  return rows.map(([id, bond, accuracy]) => ({
    id,
    bond,
    accuracy,
    votesEpoch: 0,
    correctEpoch: 0,
    earnedUsdc: Math.round(bond * 0.02 * accuracy * 100) / 100,
    accruedCent: Math.round(bond * 0.018 * accuracy),
    status: "BONDED",
  }));
}

export function seedEpoch(now: number): EpochInfo {
  return { n: 8842, startedAt: now, durMs: EPOCH_MS, elected: elect(seedVerifiers(), 8842) };
}

/** deterministic-ish election: score = bond · accuracy² · jitter */
export function elect(pool: Verifier[], epochN: number): string[] {
  let s = epochN * 2654435761;
  const rand = () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
    return (s % 10000) / 10000;
  };
  return [...pool]
    .filter((v) => v.bond >= BOND_FLOOR && v.status !== "UNBONDING")
    .map((v) => ({ id: v.id, score: weight(v) * (0.75 + rand() * 0.5) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.id);
}

export interface RollResult {
  epoch: EpochInfo;
  pool: Verifier[];
  slashes: SlashEvent[];
  emitted: number;
  distribution: { id: string; cent: number; usdc: number }[];
}

/** advance one epoch: votes, accuracy drift, slash executor, emission distribution */
export function rollEpoch(pool: Verifier[], prev: EpochInfo, now: number, week = 3): RollResult {
  const fund = epochEmission(week);
  const slashes: SlashEvent[] = [];

  // votes from the outgoing elected set
  let poolNext = pool.map((v) => {
    if (!prev.elected.includes(v.id)) {
      return { ...v, votesEpoch: 0, correctEpoch: 0, status: v.status === "SLASHED" ? "BONDED" : v.status } as Verifier;
    }
    const votes = 14 + Math.floor(Math.random() * 30);
    const falseVote = Math.random() < 0.07;
    if (falseVote) {
      const amount = Math.round(v.bond * 0.1);
      slashes.push({
        id: `slash_${prev.n}_${v.id.slice(4)}`,
        at: now,
        verifier: v.id,
        reason: "FALSE VOTE — AGAINST PROVEN MAJORITY",
        amount,
        epoch: prev.n,
      });
      return {
        ...v,
        bond: Math.max(v.bond - amount, 0),
        accuracy: Math.max(0.9, v.accuracy - 0.015),
        votesEpoch: votes,
        correctEpoch: votes - 1,
        status: "SLASHED",
      } as Verifier;
    }
    const correct = Math.round(votes * Math.min(1, v.accuracy * (0.975 + Math.random() * 0.028)));
    return { ...v, votesEpoch: votes, correctEpoch: correct, status: v.status === "SLASHED" ? "BONDED" : v.status } as Verifier;
  });

  // distribute: fund ∝ weight across correct electees
  const electees = poolNext.filter((v) => prev.elected.includes(v.id) && v.status !== "SLASHED");
  const wSum = electees.reduce((s, v) => s + weight(v), 0) || 1;
  const distribution = electees.map((v) => {
    const share = weight(v) / wSum;
    return {
      id: v.id,
      cent: Math.round(fund * share),
      usdc: Math.round(fund * 0.0012 * share * 100) / 100,
    };
  });
  poolNext = poolNext.map((v) => {
    const d = distribution.find((x) => x.id === v.id);
    if (!d) return v;
    return {
      ...v,
      accruedCent: v.accruedCent + d.cent,
      earnedUsdc: v.earnedUsdc + d.usdc,
      accuracy: Math.min(0.999, v.accuracy + 0.0004),
    };
  });

  const epoch: EpochInfo = { n: prev.n + 1, startedAt: now, durMs: EPOCH_MS, elected: elect(poolNext, prev.n + 1) };
  return { epoch, pool: poolNext, slashes, emitted: fund, distribution };
}

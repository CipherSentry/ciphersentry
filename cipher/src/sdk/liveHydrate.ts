/**
 * Live console hydration — map gateway/indexer payloads into app seed shapes.
 * Used by desktop + mobile when ?net=rpc.
 */

import type { Agent, Batch, TaskEvent } from "../app/data";
import type { EpochInfo, Verifier } from "../network/verifiers";

export interface WalletSnap {
  avail: number;
  escrow: number;
  earned: number;
  spent: number;
  stake: number;
}

export interface EpochSnap {
  epoch: number;
  members: string[];
  seed?: string;
  eligible?: number;
}

export interface NodeSnap {
  epoch?: number;
  ledger_tasks?: number;
  batcher?: { pending?: number; mode?: string };
  accrual?: { total?: number; treasury?: number };
}

/** Derive wallet from live task feed (USDC string amounts). */
export function walletFromFeed(events: TaskEvent[], baseStake = 0): WalletSnap {
  let earned = 0;
  let spent = 0;
  let escrow = 0;
  for (const e of events) {
    const amt = parseFloat(e.amount) || 0;
    if (e.state === "SETTLED") {
      if (e.role === "work") earned += amt;
      else spent += amt;
    } else if (e.state === "RUNNING" || e.state === "VERIFYING" || e.state === "DISPUTED") {
      if (e.role === "buy") escrow += amt;
    }
  }
  return {
    earned: round2(earned),
    spent: round2(spent),
    escrow: round2(escrow),
    avail: round2(Math.max(0, earned - spent)),
    stake: baseStake,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map registry.query rows onto seeded Agent shells. */
export function mergeRegistryAgents(
  seed: Agent[],
  rows: Array<{ id: string; tier?: string; trust?: number; success?: number; rate?: number; stake?: number }>,
): Agent[] {
  if (!rows.length) return seed;
  const byName = new Map(seed.map((a) => [a.name, a]));
  return rows.map((r, i) => {
    const base = byName.get(r.id) ?? seed[i % seed.length] ?? seed[0]!;
    return {
      ...base,
      name: r.id,
      tier: (r.tier as Agent["tier"]) ?? base.tier,
      trust: r.trust ?? base.trust,
      success: r.success ?? base.success,
      rate: r.rate ?? base.rate,
      stake: r.stake ?? base.stake,
      status: "ONLINE" as const,
    };
  });
}

/** batch.pending / batch.info → Batch[] for console. */
export function batchesFromPending(
  pending: { count?: number; leaves?: Array<{ task_id?: string; amount?: string; at?: number }> },
  info?: { last_batch_id?: number | string; pending?: number },
): Batch[] {
  const leaves = pending.leaves ?? [];
  if (!leaves.length && !(pending.count || info?.pending)) {
    return [];
  }
  const total = leaves.reduce((s, l) => s + (parseFloat(String(l.amount ?? 0)) || 0), 0);
  const at = leaves.reduce((m, l) => Math.max(m, Number(l.at ?? 0)), Date.now());
  const id =
    info?.last_batch_id != null
      ? `batch_pending_${info.last_batch_id}`
      : `batch_pending_${pending.count ?? leaves.length}`;
  return [
    {
      id,
      count: pending.count ?? leaves.length,
      total: total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      at: at || Date.now(),
      state: "SETTLING",
    },
  ];
}

/** ledger ExBatch → app Batch */
export function batchesFromLedger(
  rows: Array<{ id: string; count: number; total: string; at: number; state: string }>,
): Batch[] {
  return rows.slice(0, 12).map((b) => ({
    id: b.id,
    count: b.count,
    total: b.total,
    at: b.at,
    state: b.state === "SETTLED" ? "SETTLED" : "SETTLING",
  }));
}

export function epochFromRpc(info: EpochSnap, now: number, prev?: EpochInfo): EpochInfo {
  const durMs = prev?.durMs ?? 64_000;
  return {
    n: info.epoch,
    startedAt: prev?.n === info.epoch ? prev.startedAt : now,
    durMs,
    elected: info.members?.length ? info.members : (prev?.elected ?? []),
  };
}

/** Prefer elected members first; append remaining pool seats. */
export function mergeEpochVerifiers(pool: Verifier[], members: string[]): Verifier[] {
  if (!members?.length) return pool;
  const byId = new Map(pool.map((v) => [v.id, v]));
  const out: Verifier[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const hit = byId.get(m);
    if (hit) {
      out.push(hit);
      seen.add(m);
    } else {
      out.push({
        id: m,
        bond: 25_000,
        accuracy: 0.99,
        votesEpoch: 0,
        correctEpoch: 0,
        earnedUsdc: 0,
        accruedMarc: 0,
        status: "BONDED",
      });
      seen.add(m);
    }
  }
  for (const v of pool) {
    if (!seen.has(v.id)) out.push(v);
  }
  return out;
}

export function stakeFromRegistry(
  rows: Array<{ id?: string; stake?: number }>,
  agentId = "agent:atlas-01",
): number {
  const hit = rows.find((r) => r.id === agentId || r.id?.includes("atlas"));
  return hit?.stake ?? rows[0]?.stake ?? 0;
}

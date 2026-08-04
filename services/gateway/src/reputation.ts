/**
 * V0.3 reputation client — live T_i from indexer receipt graph.
 * Falls back to seed REGISTRY when indexer is cold.
 */

export const TRUST_FORMULA =
  "T_i = clamp(0, 100, 50·log2(1 + s_i) + 40·q_i + 10·(1 − e^(−n_i/500)))";

export interface LiveAgentScore {
  id: string;
  tier: string;
  trust: number;
  stake: number;
  success: number;
  status?: string;
  rate?: number;
  /** Portable whitepaper score (alias of trust). */
  T_i: number;
  s_i: number;
  q_i: number;
  live: boolean;
}

interface Cache {
  at: number;
  byId: Map<string, LiveAgentScore>;
  rank: LiveAgentScore[];
}

const TTL_MS = 5_000;

function indexerBase(): string {
  const raw =
    process.env.INDEXER_URL ||
    process.env.INDEXER_UPSTREAM ||
    process.env.REPUTATION_URL ||
    "";
  return raw.replace(/\/$/, "");
}

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function mapRow(r: Record<string, unknown>, seedRate?: number): LiveAgentScore {
  const id = String(r.agent_id ?? r.id ?? "");
  const trust = num(r.trust ?? r.T_i ?? r.score, 50);
  const stake = num(r.stake ?? r.s_i, 0);
  const success = num(r.success ?? r.q_i, 1);
  // success stored as 0..1 or 0..100
  const q = success > 1.5 ? success / 100 : success;
  return {
    id,
    tier: String(r.tier ?? "T1"),
    trust,
    stake,
    success: q > 1 ? q / 100 : q,
    status: r.status != null ? String(r.status) : undefined,
    rate: seedRate,
    T_i: trust,
    s_i: stake,
    q_i: q > 1 ? q / 100 : q,
    live: true,
  };
}

let cache: Cache | null = null;

export async function refreshReputation(): Promise<Cache | null> {
  const base = indexerBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/agents?limit=100`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown>[] };
    const rows = body.data ?? [];
    const byId = new Map<string, LiveAgentScore>();
    const rank: LiveAgentScore[] = [];
    for (const r of rows) {
      const a = mapRow(r);
      if (!a.id) continue;
      byId.set(a.id, a);
      rank.push(a);
    }
    rank.sort((a, b) => b.trust - a.trust || b.stake - a.stake);
    cache = { at: Date.now(), byId, rank };
    return cache;
  } catch {
    return null;
  }
}

export async function getReputationCache(): Promise<Cache | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  return refreshReputation();
}

export async function liveScore(agentId: string): Promise<LiveAgentScore | null> {
  const c = await getReputationCache();
  if (c?.byId.has(agentId)) return c.byId.get(agentId)!;
  const base = indexerBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/agents/${encodeURIComponent(agentId)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, unknown> };
    if (!body.data) return null;
    return mapRow(body.data);
  } catch {
    return null;
  }
}

export async function liveRank(opts?: {
  minTrust?: number;
  limit?: number;
}): Promise<LiveAgentScore[] | null> {
  const c = await getReputationCache();
  if (!c) return null;
  const min = opts?.minTrust ?? 0;
  const limit = opts?.limit ?? 10;
  return c.rank.filter((a) => a.trust >= min).slice(0, limit);
}

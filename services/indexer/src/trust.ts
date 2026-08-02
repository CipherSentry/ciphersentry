/**
 * Trust series writer — materialize whitepaper §5 score into ClickHouse.
 *
 *   T_i = clamp(0, 100, 50·log2(1 + s_i) + 40·q_i + 10·(1 − e^(−n_i/500)))
 *
 * Triggered after each settled batch (and resolved fraud). Updates Postgres
 * `agents.trust` / `success` and appends `trust_series` rows for the batch epoch.
 */

import type { Querier } from "./db.ts";
import type { ChInserter } from "./ledger.ts";
import type { ReceiptRow } from "./ledger.ts";
import { seedStake } from "./stakes.ts";

export interface AgentStats {
  agent_id: string;
  stake: number;
  /** Honest completion rate in [0,1] (worker receipts where reported === recomputed). */
  success: number;
  settled_count: number;
}

export interface TrustPoint {
  agent_id: string;
  epoch: number;
  stake: number;
  success: number;
  settled_count: number;
  trust_score: number;
  computed_at: number;
}

/** Whitepaper §5 trust score. success in [0,1]. */
export function trustScore(stake: number, success: number, settledCount: number): number {
  const s = Math.max(0, Number(stake) || 0);
  const q = Math.min(1, Math.max(0, Number(success) || 0));
  const n = Math.max(0, Number(settledCount) || 0);
  const t = 50 * Math.log2(1 + s) + 40 * q + 10 * (1 - Math.exp(-n / 500));
  return Math.min(100, Math.max(0, t));
}

/** Marker query used by MemoryStore + PG for agent participation stats. */
export const AGENT_STATS_SQL = `
SELECT
  COUNT(*)::int AS total,
  COALESCE(SUM(CASE WHEN r.reported = r.recomputed THEN 1 ELSE 0 END), 0)::int AS ok,
  COALESCE(SUM(CASE WHEN r.reported = r.recomputed THEN 1 ELSE 0 END), 0)::int AS settled
FROM receipts r
JOIN tasks t ON t.task_id = r.task_id
WHERE t.worker = $1 OR t.buyer = $1
`.replace(/\s+/g, " ").trim();

export const AGENT_GET_SQL = `SELECT agent_id, stake, success, trust FROM agents WHERE agent_id = $1`;

export class TrustSeriesWriter {
  constructor(
    private pg: Querier,
    private ch: ChInserter,
  ) {}

  /**
   * Recompute stats for every agent in the batch receipts, update agents SoR,
   * and insert trust_series rows for `epoch`.
   */
  async writeForBatch(epoch: number, receipts: ReceiptRow[]): Promise<TrustPoint[]> {
    const ids = new Set<string>();
    for (const r of receipts) {
      if (r.buyer) ids.add(r.buyer);
      if (r.worker) ids.add(r.worker);
    }
    if (!ids.size) return [];

    const points: TrustPoint[] = [];
    for (const agent_id of ids) {
      const stats = await this.statsOf(agent_id);
      const score = trustScore(stats.stake, stats.success, stats.settled_count);
      await this.upsertAgent(agent_id, score, stats);
      points.push({
        agent_id,
        epoch,
        stake: stats.stake,
        success: stats.success,
        settled_count: stats.settled_count,
        trust_score: score,
        computed_at: Date.now(),
      });
    }

    try {
      await this.ch.insert(
        "trust_series",
        points.map((p) => ({
          agent_id: p.agent_id,
          epoch: p.epoch,
          stake: p.stake,
          success: Number(p.success.toFixed(4)),
          settled_count: p.settled_count,
          trust_score: Number(p.trust_score.toFixed(4)),
          computed_at: p.computed_at,
        })),
      );
    } catch (e) {
      console.warn(`[ch] trust_series insert skipped: ${e instanceof Error ? e.message : e}`);
    }
    return points;
  }

  async statsOf(agent_id: string): Promise<AgentStats> {
    let stake = 0;
    try {
      const rows = await this.pg.exec<{ stake?: string | number }>(AGENT_GET_SQL, [agent_id]);
      if (rows[0]?.stake != null) stake = Number(rows[0].stake) || 0;
    } catch {
      /* agent row may not exist yet */
    }
    // s#0: wire registry/bond stake when SoR row is still zero
    if (stake <= 0) stake = seedStake(agent_id);

    let total = 0;
    let ok = 0;
    try {
      const rows = await this.pg.exec<{ total: number; ok: number; settled: number }>(AGENT_STATS_SQL, [
        agent_id,
      ]);
      if (rows[0]) {
        total = Number(rows[0].total) || 0;
        ok = Number(rows[0].ok) || 0;
      }
    } catch {
      /* memory/pg may not implement yet — fall through */
    }

    const success = total > 0 ? ok / total : 1;
    return {
      agent_id,
      stake,
      success,
      settled_count: ok,
    };
  }

  private async upsertAgent(agent_id: string, score: number, stats: AgentStats): Promise<void> {
    try {
      // 6 bind params — matches MemoryStore INSERT agents layout
      await this.pg.exec(
        `INSERT INTO agents (agent_id, tier, trust, stake, success, status)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (agent_id) DO UPDATE
         SET trust = EXCLUDED.trust,
             success = EXCLUDED.success,
             stake = GREATEST(agents.stake, EXCLUDED.stake),
             updated_at = now()`,
        [
          agent_id,
          "SEAT",
          Number(score.toFixed(2)),
          stats.stake,
          Number(stats.success.toFixed(4)),
          "ONLINE",
        ],
      );
    } catch (e) {
      console.warn(`[pg] agents trust update skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
}

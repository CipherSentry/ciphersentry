/**
 * In-memory Querier — unit tests and offline smoke without Postgres.
 */

import type { Querier } from "./db.ts";

type Row = Record<string, unknown>;

export class MemoryStore implements Querier {
  tasks = new Map<string, Row>();
  receipts = new Map<string, Row>();
  batches = new Map<string, Row>();
  agents = new Map<string, Row>();
  fraud = new Map<string, Row>();
  /** key = agent_id::epoch */
  trustSeries = new Map<string, Row>();
  votes: Row[] = [];

  async exec<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = text.replace(/\s+/g, " ").trim();
    const p = params as unknown[];

    // trust_series upsert (durable dual-write)
    if (/^INSERT INTO trust_series/i.test(sql)) {
      const [agent_id, epoch, stake, success, settled_count, trust_score, computed_at] = p as unknown[];
      const key = `${agent_id}::${epoch}`;
      this.trustSeries.set(key, {
        agent_id: String(agent_id),
        epoch: Number(epoch),
        stake: Number(stake) || 0,
        success: Number(success) || 0,
        settled_count: Number(settled_count) || 0,
        trust_score: Number(trust_score) || 0,
        computed_at:
          typeof computed_at === "number"
            ? new Date(computed_at).toISOString()
            : computed_at ?? new Date().toISOString(),
      });
      return [] as T[];
    }

    if (/FROM trust_series WHERE agent_id = \$1/i.test(sql)) {
      const agent = String(p[0]);
      return [...this.trustSeries.values()]
        .filter((r) => String(r.agent_id) === agent)
        .sort((a, b) => Number(b.epoch) - Number(a.epoch))
        .slice(0, 32) as T[];
    }

    // fraud_cases upsert
    if (/^INSERT INTO fraud_cases/i.test(sql)) {
      const [
        task_id,
        status,
        reported,
        recomputed,
        buyer,
        worker,
        amount,
        ruling,
        reason,
        open_at,
        open_block,
        window_blocks,
        resolved_at,
        original_votes,
        challenge_votes,
        chain_mode,
        chain_tx,
      ] = p as unknown[];
      this.fraud.set(String(task_id), {
        task_id,
        status,
        reported,
        recomputed,
        buyer,
        worker,
        amount,
        ruling,
        reason,
        open_at,
        open_block,
        window_blocks,
        resolved_at,
        original_votes:
          typeof original_votes === "string" ? JSON.parse(original_votes) : original_votes,
        challenge_votes:
          typeof challenge_votes === "string" ? JSON.parse(challenge_votes) : challenge_votes,
        chain_mode,
        chain_tx,
        updated_at: new Date().toISOString(),
      });
      return [] as T[];
    }

    if (/FROM fraud_cases WHERE task_id/i.test(sql)) {
      const f = this.fraud.get(String(p[0]));
      return (f ? [f] : []) as T[];
    }

    if (/FROM fraud_cases/i.test(sql) && /ORDER BY/i.test(sql)) {
      return [...this.fraud.values()]
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(0, 50) as T[];
    }

    // INSERT agents (create or upsert trust/success)
    if (/^INSERT INTO agents/i.test(sql)) {
      const [agent_id, tier, trust, stake, success, status] = p as (string | number)[];
      const id = String(agent_id);
      const prev = this.agents.get(id);
      if (!prev) {
        this.agents.set(id, {
          agent_id: id,
          tier: tier ?? "SEAT",
          trust: trust ?? 50,
          stake: stake ?? 0,
          success: success ?? 1,
          status: status ?? "ONLINE",
          updated_at: new Date().toISOString(),
        });
      } else if (/ON CONFLICT/i.test(sql)) {
        const nextStake = Number(stake ?? 0);
        const prevStake = Number(prev.stake ?? 0);
        // GREATEST path for normal upsert; plain EXCLUDED.stake for fraud slash
        const stakeOut = /GREATEST/i.test(sql)
          ? Math.max(prevStake, nextStake || prevStake)
          : nextStake;
        this.agents.set(id, {
          ...prev,
          trust: trust ?? prev.trust,
          success: success ?? prev.success,
          stake: stakeOut,
          updated_at: new Date().toISOString(),
        });
      }
      return [] as T[];
    }

    // fraud slash: UPDATE agents SET stake = $2, trust = $3
    if (/UPDATE agents SET stake/i.test(sql)) {
      const id = String(p[0]);
      const a = this.agents.get(id);
      if (a) {
        this.agents.set(id, {
          ...a,
          stake: Number(p[1]) || 0,
          trust: p[2] ?? a.trust,
          updated_at: new Date().toISOString(),
        });
      }
      return [] as T[];
    }

    // agent stake/trust lookup
    if (/SELECT agent_id, stake, success, trust FROM agents WHERE agent_id/i.test(sql)) {
      const a = this.agents.get(String(p[0]));
      return (a ? [a] : []) as T[];
    }

    // V0.3 ranked agents list
    if (
      /FROM agents WHERE trust >= \$1 ORDER BY trust DESC/i.test(sql) ||
      (/SELECT agent_id, tier, trust, stake, success, status/i.test(sql) &&
        /FROM agents/i.test(sql) &&
        /ORDER BY trust DESC/i.test(sql))
    ) {
      const minTrust = p[0] != null && sql.includes("trust >=") ? Number(p[0]) : 0;
      const limit = Number(p[p.length - 1] ?? 50) || 50;
      return [...this.agents.values()]
        .filter((a) => Number(a.trust) >= minTrust)
        .sort((a, b) => Number(b.trust) - Number(a.trust) || Number(b.stake) - Number(a.stake))
        .slice(0, limit) as T[];
    }

    // SELECT * FROM agents WHERE agent_id
    if (/SELECT \* FROM agents WHERE agent_id/i.test(sql)) {
      const a = this.agents.get(String(p[0]));
      return (a ? [a] : []) as T[];
    }

    // V0.3 graph edges from settled tasks
    if (/SELECT buyer AS source, worker AS target/i.test(sql) || /GROUP BY buyer, worker/i.test(sql)) {
      const limit = Number(p[0] ?? 200) || 200;
      const acc = new Map<string, { source: string; target: string; weight: number; volume: number }>();
      for (const t of this.tasks.values()) {
        if (String(t.state) !== "SETTLED") continue;
        const source = String(t.buyer ?? "");
        const target = String(t.worker ?? "");
        if (!source || !target || source === target) continue;
        const key = `${source}->${target}`;
        const prev = acc.get(key) ?? { source, target, weight: 0, volume: 0 };
        prev.weight += 1;
        prev.volume += Number(t.amount) || 0;
        acc.set(key, prev);
      }
      return [...acc.values()]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit) as T[];
    }

    // participation stats for trust series
    if (/FROM receipts r\s+JOIN tasks t ON t\.task_id = r\.task_id/i.test(sql) ||
        (/FROM receipts r JOIN tasks t/i.test(sql) && /worker = \$1 OR t\.buyer = \$1/i.test(sql))) {
      const agent = String(p[0]);
      let total = 0;
      let ok = 0;
      for (const r of this.receipts.values()) {
        const t = this.tasks.get(String(r.task_id));
        if (!t) continue;
        if (t.worker !== agent && t.buyer !== agent) continue;
        total++;
        if (String(r.reported) === String(r.recomputed)) ok++;
      }
      return [{ total, ok, settled: ok }] as T[];
    }

    // INSERT tasks
    if (/^INSERT INTO tasks/i.test(sql)) {
      const [
        task_id,
        buyer,
        worker,
        spec,
        amount,
        bond,
        state,
        reported_hash,
        state_at_block,
      ] = p as (string | number | null)[];
      const prev = this.tasks.get(String(task_id));
      const block = Number(state_at_block ?? 0);
      if (prev && Number(prev.state_at_block) > block && sql.includes("WHERE tasks.state_at_block")) {
        return [] as T[];
      }
      this.tasks.set(String(task_id), {
        task_id,
        buyer,
        worker,
        spec,
        amount,
        bond,
        state,
        reported_hash: reported_hash ?? prev?.reported_hash ?? null,
        state_at_block: block,
        state_at_ts: new Date().toISOString(),
        created_at: prev?.created_at ?? new Date().toISOString(),
      });
      return [] as T[];
    }

    // INSERT batches (upsert root — offline batcher reuses batch_0 across restarts)
    if (/^INSERT INTO batches/i.test(sql)) {
      const [batch_id, epoch, root, count, total] = p as (string | number)[];
      const prev = this.batches.get(String(batch_id));
      this.batches.set(String(batch_id), {
        batch_id,
        epoch,
        root,
        count,
        total,
        state: "SETTLING",
        at: new Date().toISOString(),
        anchored_block: prev?.anchored_block ?? null,
        anchored_tx: prev?.anchored_tx ?? null,
      });
      return [] as T[];
    }

    // UPDATE batches anchor
    if (/^UPDATE batches SET/i.test(sql)) {
      const id = String(p[p.length - 1]);
      const b = this.batches.get(id);
      if (b) {
        if (sql.includes("anchored_tx")) {
          b.anchored_tx = p[0];
          b.anchored_block = p[1] ?? b.anchored_block;
        }
        if (sql.includes("state")) b.state = p.find((x) => x === "SETTLED" || x === "SETTLING") ?? b.state;
        this.batches.set(id, b);
      }
      return [] as T[];
    }

    // DELETE stale receipts for a batch rewrite
    if (/^DELETE FROM receipts WHERE batch_id/i.test(sql)) {
      const batchId = String(p[0]);
      const keep = p[1] as string[] | undefined;
      for (const [id, row] of [...this.receipts.entries()]) {
        if (String(row.batch_id) !== batchId) continue;
        if (Array.isArray(keep) && keep.includes(String(row.receipt_id))) continue;
        this.receipts.delete(id);
      }
      return [] as T[];
    }

    // INSERT receipts (upsert path/leaf/batch on conflict)
    if (/^INSERT INTO receipts/i.test(sql)) {
      const [
        receipt_id,
        task_id,
        reported,
        recomputed,
        votes,
        ms,
        epoch,
        batch_id,
        leaf,
        path,
      ] = p as unknown[];
      const id = String(receipt_id);
      const prev = this.receipts.get(id);
      const row = {
        receipt_id: id,
        task_id,
        reported,
        recomputed,
        votes: typeof votes === "string" ? JSON.parse(votes as string) : votes,
        ms,
        epoch,
        batch_id,
        leaf,
        path: typeof path === "string" ? JSON.parse(path as string) : path,
        settled_at: prev?.settled_at ?? new Date().toISOString(),
      };
      if (!prev || /ON CONFLICT/i.test(sql)) {
        this.receipts.set(id, row);
      }
      return [] as T[];
    }

    // SELECT batches list
    if (/SELECT batch_id, epoch, root, count, total, state, at/.test(sql) && /FROM batches/i.test(sql)) {
      return [...this.batches.values()]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 50) as T[];
    }

    if (/SELECT \* FROM batches WHERE batch_id/i.test(sql)) {
      const b = this.batches.get(String(p[0]));
      return (b ? [b] : []) as T[];
    }

    if (/SELECT receipt_id, task_id, reported, recomputed, ms, epoch, leaf, path FROM receipts WHERE batch_id/i.test(sql) ||
        /FROM receipts WHERE batch_id/i.test(sql)) {
      return [...this.receipts.values()].filter((r) => r.batch_id === p[0]) as T[];
    }

    if (/SELECT \* FROM receipts WHERE receipt_id/i.test(sql)) {
      const id = String(p[0]);
      const r = this.receipts.get(id) ?? [...this.receipts.values()].find((x) => x.task_id === id);
      return (r ? [r] : []) as T[];
    }

    // proof / batch proofs — any column subset on batches by id
    if (/FROM batches WHERE batch_id/i.test(sql) && /SELECT/i.test(sql)) {
      const b = this.batches.get(String(p[0]));
      if (!b) return [] as T[];
      // return full row so SELECT root… or SELECT batch_id, root… both work
      return [b] as T[];
    }

    if (/SELECT \* FROM agents WHERE agent_id/i.test(sql)) {
      const a = this.agents.get(String(p[0]));
      return (a ? [a] : []) as T[];
    }

    if (/FROM receipts r JOIN tasks/i.test(sql)) {
      const agent = String(p[0]);
      const out: Row[] = [];
      for (const r of this.receipts.values()) {
        const t = this.tasks.get(String(r.task_id));
        if (t && (t.worker === agent || t.buyer === agent)) {
          out.push({
            receipt_id: r.receipt_id,
            task_id: r.task_id,
            ms: r.ms,
            epoch: r.epoch,
            batch_id: r.batch_id,
            spec: t.spec,
            amount: t.amount,
            worker: t.worker,
            buyer: t.buyer,
          });
        }
      }
      return out.slice(0, 25) as T[];
    }

    // exact task by id
    if (/FROM tasks WHERE task_id = \$1/i.test(sql) && !/ILIKE/i.test(sql)) {
      const t = this.tasks.get(String(p[0]));
      return (t ? [t] : []) as T[];
    }

    if (/ILIKE/i.test(sql)) {
      const q = String(p[0]).replace(/%/g, "").toLowerCase();
      if (/FROM fraud_cases/i.test(sql)) {
        return [...this.fraud.values()]
          .filter(
            (f) =>
              String(f.task_id).toLowerCase().includes(q) ||
              String(f.worker).toLowerCase().includes(q) ||
              String(f.buyer).toLowerCase().includes(q),
          )
          .slice(0, 5)
          .map((f) => ({ task_id: f.task_id, status: f.status, ruling: f.ruling })) as T[];
      }
      if (/FROM tasks/i.test(sql)) {
        return [...this.tasks.values()]
          .filter((t) => String(t.task_id).toLowerCase().includes(q))
          .slice(0, 10)
          .map((t) => ({
            task_id: t.task_id,
            state: t.state,
            worker: t.worker,
            buyer: t.buyer,
            amount: t.amount,
          })) as T[];
      }
      if (/FROM receipts/i.test(sql)) {
        return [...this.receipts.values()]
          .filter(
            (r) =>
              String(r.receipt_id).toLowerCase().includes(q) ||
              String(r.task_id).toLowerCase().includes(q) ||
              String(r.leaf).toLowerCase().includes(q),
          )
          .slice(0, 10)
          .map((r) => ({ receipt_id: r.receipt_id, batch_id: r.batch_id })) as T[];
      }
      if (/FROM batches/i.test(sql)) {
        return [...this.batches.values()]
          .filter(
            (b) =>
              String(b.batch_id).toLowerCase().includes(q) ||
              String(b.root).toLowerCase().includes(q),
          )
          .slice(0, 5)
          .map((b) => ({ batch_id: b.batch_id, epoch: b.epoch })) as T[];
      }
      if (/FROM agents/i.test(sql)) {
        return [...this.agents.values()]
          .filter((a) => String(a.agent_id).toLowerCase().includes(q))
          .slice(0, 5)
          .map((a) => ({ agent_id: a.agent_id, tier: a.tier, trust: a.trust })) as T[];
      }
    }

    // default empty — keep tests from exploding on unknown SQL
    return [] as T[];
  }

  async close(): Promise<void> {
    /* noop */
  }
}

/** ClickHouse stub that records inserts. */
export class MemoryClickHouse {
  tables = new Map<string, Row[]>();

  async exec<T = unknown>(text: string): Promise<T[]> {
    // /trust/:agent path — SELECT … FROM trust_series WHERE agent_id = '…'
    if (/FROM trust_series/i.test(text)) {
      const m = text.match(/agent_id\s*=\s*'([^']+)'/i);
      const agent = m?.[1];
      const rows = (this.tables.get("trust_series") ?? [])
        .filter((r) => !agent || String(r.agent_id) === agent)
        .sort((a, b) => Number(b.epoch) - Number(a.epoch))
        .slice(0, 32)
        .map((r) => ({
          agent_id: r.agent_id,
          epoch: r.epoch,
          trust_score: r.trust_score,
          stake: r.stake,
          success: r.success,
          settled_count: r.settled_count,
        }));
      return rows as T[];
    }
    return [] as T[];
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const cur = this.tables.get(table) ?? [];
    cur.push(...rows);
    this.tables.set(table, cur);
  }

  async close(): Promise<void> {
    /* noop */
  }
}

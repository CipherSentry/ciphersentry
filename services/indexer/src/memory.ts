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
  votes: Row[] = [];

  async exec<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    const sql = text.replace(/\s+/g, " ").trim();
    const p = params as unknown[];

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
        this.agents.set(id, {
          ...prev,
          trust: trust ?? prev.trust,
          success: success ?? prev.success,
          stake: stake ?? prev.stake,
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

    // INSERT receipts
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
      if (!this.receipts.has(String(receipt_id))) {
        this.receipts.set(String(receipt_id), {
          receipt_id,
          task_id,
          reported,
          recomputed,
          votes: typeof votes === "string" ? JSON.parse(votes) : votes,
          ms,
          epoch,
          batch_id,
          leaf,
          path: typeof path === "string" ? JSON.parse(path) : path,
          settled_at: new Date().toISOString(),
        });
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

    if (/SELECT root, anchored_block, anchored_tx FROM batches WHERE batch_id/i.test(sql)) {
      const b = this.batches.get(String(p[0]));
      return (b
        ? [{ root: b.root, anchored_block: b.anchored_block, anchored_tx: b.anchored_tx }]
        : []) as T[];
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

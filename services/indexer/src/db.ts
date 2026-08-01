/**
 * Storage adapters.
 *
 * Postgres is the system of record for task lifecycle — transitions are
 * events, never silent mutations (architecture.md §3). ClickHouse holds the
 * analytics surface. Two different personalities, one executor interface.
 *
 * pg: thin adapter around the `pg` package (dynamic import so the schema CLI
 * and dev fixtures run without a live database).
 * ClickHouse: plain HTTP — the official protocol. No driver dependency.
 */

export interface Querier {
  exec<T = unknown>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/* ------------------------------- postgres --------------------------------- */

interface PgClientLike {
  connect(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export async function createPgQuerier(dsn: string): Promise<Querier> {
  const mod = await import("pg").catch(() => {
    throw new Error('indexer needs the "pg" package for Postgres — run `npm install` in services/indexer');
  });
  const { Client } = mod as unknown as { Client: new (cfg: { connectionString: string }) => PgClientLike };
  const client = new Client({ connectionString: dsn });
  await client.connect();
  return {
    exec: async <T = unknown,>(text: string, params?: unknown[]) => (await client.query(text, params)).rows as T[],
    close: () => client.end(),
  };
}

/* ------------------------------ clickhouse -------------------------------- */

export class ClickHouseHttp implements Querier {
  constructor(
    private baseUrl: string,
    private database: string,
    private user = "default",
    private password = "",
  ) {}

  async exec<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
    void params; // CH HTTP substitutes nothing unsafe — DDL + prepared JSONEachRow only
    const url = new URL(this.baseUrl);
    url.searchParams.set("database", this.database);
    url.searchParams.set("query", text);
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(this.user, this.password),
    });
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.text();
    return body ? (JSON.parse(body).data as T[]) : [];
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) return;
    const url = new URL(this.baseUrl);
    url.searchParams.set("database", this.database);
    url.searchParams.set("query", `INSERT INTO ${table} FORMAT JSONEachRow`);
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(this.user, this.password),
      body: rows.map((r) => JSON.stringify(r)).join("\n"),
    });
    if (!res.ok) throw new Error(`ClickHouse insert ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  async close(): Promise<void> {
    /* stateless over HTTP */
  }
}

function authHeaders(user: string, password: string): Record<string, string> {
  const h: Record<string, string> = { "x-clickhouse-user": user };
  if (password) h["x-clickhouse-key"] = password;
  return h;
}

/* ------------------------- schema application ------------------------------ */

export const CH_DDL_STATEMENTS: string[] = [
  "CREATE DATABASE IF NOT EXISTS machinarc",
  `CREATE TABLE IF NOT EXISTS machinarc.receipts (
    receipt_id String, task_id String, buyer String, worker String,
    spec String, amount Decimal(20,6), state String,
    reported String, recomputed String,
    votes Array(Tuple(String, UInt8)),
    ms UInt32, epoch UInt64, batch_id String, leaf String,
    path Array(String), settled_at DateTime64(3)
  ) ENGINE = MergeTree() ORDER BY (epoch, batch_id, receipt_id)`,
  `CREATE TABLE IF NOT EXISTS machinarc.trust_series (
    agent_id String, epoch UInt64,
    stake Decimal(20,6), success Decimal(5,2), settled_count UInt32,
    trust_score Decimal(6,4), computed_at DateTime64(3)
  ) ENGINE = MergeTree() ORDER BY (agent_id, epoch)`,
  `CREATE TABLE IF NOT EXISTS machinarc.batch_stats (
    batch_id String, epoch UInt64, count UInt32, total Decimal(20,6),
    settled_at DateTime64(3)
  ) ENGINE = MergeTree() ORDER BY epoch`,
];

export async function applyChSchema(ch: ClickHouseHttp): Promise<void> {
  for (const stmt of CH_DDL_STATEMENTS) await ch.exec(stmt);
  console.log("clickhouse schema applied — receipts / trust_series / batch_stats");
}

// CLI entry: node src/db.ts --apply-ch-schema
if (process.argv.includes("--apply-ch-schema")) {
  const ch = new ClickHouseHttp(
    process.env.CH_URL ?? "http://127.0.0.1:8123",
    process.env.CH_DB ?? "machinarc",
    process.env.CH_USER ?? "default",
    process.env.CH_PASSWORD ?? "",
  );
  void applyChSchema(ch);
}

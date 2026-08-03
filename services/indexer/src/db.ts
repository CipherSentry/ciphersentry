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
  "CREATE DATABASE IF NOT EXISTS ciphersentry",
  `CREATE TABLE IF NOT EXISTS ciphersentry.receipts (
    receipt_id String, task_id String, buyer String, worker String,
    spec String, amount Decimal(20,6), state String,
    reported String, recomputed String,
    votes Array(Tuple(String, UInt8)),
    ms UInt32, epoch UInt64, batch_id String, leaf String,
    path Array(String), settled_at DateTime64(3)
  ) ENGINE = MergeTree() ORDER BY (epoch, batch_id, receipt_id)`,
  `CREATE TABLE IF NOT EXISTS ciphersentry.trust_series (
    agent_id String, epoch UInt64,
    stake Decimal(20,6), success Decimal(6,4), settled_count UInt32,
    trust_score Decimal(7,4), computed_at DateTime64(3)
  ) ENGINE = MergeTree() ORDER BY (agent_id, epoch)`,
  `CREATE TABLE IF NOT EXISTS ciphersentry.batch_stats (
    batch_id String, epoch UInt64, count UInt32, total Decimal(20,6),
    settled_at DateTime64(3)
  ) ENGINE = MergeTree() ORDER BY epoch`,
  `CREATE TABLE IF NOT EXISTS ciphersentry.fraud_cases (
    task_id String, status String, reported String, recomputed String,
    buyer String, worker String, amount Decimal(20,6),
    ruling String, reason String,
    open_at DateTime64(3), resolved_at DateTime64(3),
    chain_mode String
  ) ENGINE = MergeTree() ORDER BY (status, task_id)`,
];

export async function applyChSchema(ch: ClickHouseHttp): Promise<void> {
  for (const stmt of CH_DDL_STATEMENTS) await ch.exec(stmt);
  console.log("clickhouse schema applied — receipts / trust_series / batch_stats / fraud_cases");
}

/** Postgres DDL — mirrors sql/schema.sql (idempotent). */
export const PG_DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS tasks (
    task_id        TEXT PRIMARY KEY,
    buyer          TEXT NOT NULL,
    worker         TEXT NOT NULL,
    spec           TEXT NOT NULL,
    amount         NUMERIC(20,6) NOT NULL,
    bond           NUMERIC(20,6),
    state          TEXT NOT NULL CHECK (state IN ('COMMITTED','EXECUTING','VERIFYING','SETTLED','DISPUTED','FAILED')),
    reported_hash  TEXT,
    state_at_block BIGINT NOT NULL,
    state_at_ts    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_state  ON tasks(state)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(worker)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_buyer  ON tasks(buyer)`,
  `CREATE TABLE IF NOT EXISTS votes (
    task_id   TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    verifier  TEXT NOT NULL,
    matched   BOOLEAN NOT NULL,
    block     BIGINT NOT NULL,
    at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, verifier)
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
    receipt_id   TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    reported     TEXT NOT NULL,
    recomputed   TEXT NOT NULL,
    votes        JSONB NOT NULL,
    ms           INTEGER NOT NULL,
    epoch        BIGINT NOT NULL,
    batch_id     TEXT,
    leaf         TEXT NOT NULL,
    path         JSONB NOT NULL,
    settled_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_batch ON receipts(batch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_epoch ON receipts(epoch)`,
  `CREATE TABLE IF NOT EXISTS batches (
    batch_id   TEXT PRIMARY KEY,
    epoch      BIGINT NOT NULL,
    root       TEXT NOT NULL,
    count      INTEGER NOT NULL,
    total      NUMERIC(20,6) NOT NULL,
    anchored_block BIGINT,
    anchored_tx    TEXT,
    state      TEXT NOT NULL DEFAULT 'SETTLING' CHECK (state IN ('SETTLING','SETTLED')),
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    agent_id   TEXT PRIMARY KEY,
    tier       TEXT NOT NULL,
    trust      NUMERIC(5,2) NOT NULL,
    stake      NUMERIC(20,6) NOT NULL DEFAULT 0,
    success    NUMERIC(5,2) NOT NULL,
    status     TEXT NOT NULL DEFAULT 'ONLINE',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS fraud_cases (
    task_id         TEXT PRIMARY KEY,
    status          TEXT NOT NULL,
    reported        TEXT NOT NULL,
    recomputed      TEXT,
    buyer           TEXT NOT NULL,
    worker          TEXT NOT NULL,
    amount          NUMERIC(20,6) NOT NULL,
    ruling          TEXT,
    reason          TEXT,
    open_at         TIMESTAMPTZ NOT NULL,
    open_block      BIGINT NOT NULL DEFAULT 0,
    window_blocks   INTEGER NOT NULL DEFAULT 64,
    resolved_at     TIMESTAMPTZ,
    original_votes  JSONB NOT NULL DEFAULT '[]',
    challenge_votes JSONB NOT NULL DEFAULT '[]',
    chain_mode      TEXT,
    chain_tx        TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_cases(status)`,
  `CREATE INDEX IF NOT EXISTS idx_fraud_worker ON fraud_cases(worker)`,
];

export async function applyPgSchema(pg: Querier): Promise<void> {
  for (const stmt of PG_DDL_STATEMENTS) await pg.exec(stmt);
  console.log("postgres schema applied — tasks / receipts / batches / agents / fraud_cases");
}

// CLI entry: node src/db.ts --apply-ch-schema | --apply-pg-schema
if (process.argv.includes("--apply-ch-schema")) {
  const ch = new ClickHouseHttp(
    process.env.CH_URL ?? "http://127.0.0.1:8123",
    process.env.CH_DB ?? "ciphersentry",
    process.env.CH_USER ?? "cent",
    process.env.CH_PASSWORD ?? "cent",
  );
  void applyChSchema(ch);
}
if (process.argv.includes("--apply-pg-schema")) {
  void (async () => {
    const pg = await createPgQuerier(process.env.PG_DSN ?? "postgres://cent:cent@127.0.0.1:5432/ciphersentry");
    await applyPgSchema(pg);
    await pg.close();
  })();
}

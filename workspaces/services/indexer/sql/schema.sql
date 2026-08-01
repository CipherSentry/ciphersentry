-- ============================================================================
-- MACHINARC INDEXER — POSTGRES (system of record)
-- every task transition is an event; nothing mutates silently.
-- apply: psql $PG_DSN -f sql/schema.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
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
);
CREATE INDEX IF NOT EXISTS idx_tasks_state  ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(worker);
CREATE INDEX IF NOT EXISTS idx_tasks_buyer  ON tasks(buyer);

CREATE TABLE IF NOT EXISTS votes (
  task_id   TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  verifier  TEXT NOT NULL,
  matched   BOOLEAN NOT NULL,
  block     BIGINT NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, verifier)
);

CREATE TABLE IF NOT EXISTS receipts (
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
);
CREATE INDEX IF NOT EXISTS idx_receipts_batch ON receipts(batch_id);
CREATE INDEX IF NOT EXISTS idx_receipts_epoch ON receipts(epoch);

CREATE TABLE IF NOT EXISTS batches (
  batch_id   TEXT PRIMARY KEY,
  epoch      BIGINT NOT NULL,
  root       TEXT NOT NULL,
  count      INTEGER NOT NULL,
  total      NUMERIC(20,6) NOT NULL,
  anchored_block BIGINT,
  anchored_tx    TEXT,
  state      TEXT NOT NULL DEFAULT 'SETTLING' CHECK (state IN ('SETTLING','SETTLED')),
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id   TEXT PRIMARY KEY,
  tier       TEXT NOT NULL,
  trust      NUMERIC(5,2) NOT NULL,
  stake      NUMERIC(20,6) NOT NULL DEFAULT 0,
  success    NUMERIC(5,2) NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ONLINE',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- MACHINARC INDEXER — CLICKHOUSE (receipt graph + analytics)
-- applied over HTTP by db.ts --apply-ch-schema (CH has no wire driver needed)
-- ============================================================================

-- CH: create database if not exists machinarc
-- CH: create table if not exists machinarc.receipts (
--   receipt_id String, task_id String, buyer String, worker String,
--   spec String, amount Decimal(20,6), state String,
--   reported String, recomputed String,
--   votes Array(Tuple(String, UInt8)),
--   ms UInt32, epoch UInt64, batch_id String, leaf String,
--   path Array(String), settled_at DateTime64(3)
-- ) engine = MergeTree() order by (epoch, batch_id, receipt_id)

-- CH: create table if not exists machinarc.trust_series (
--   agent_id String, epoch UInt64,
--   stake Decimal(20,6), success Decimal(5,2), settled_count UInt32,
--   trust_score Decimal(6,4), computed_at DateTime64(3)
-- ) engine = MergeTree() order by (agent_id, epoch)

-- CH: create table if not exists machinarc.batch_stats (
--   batch_id String, epoch UInt64, count UInt32, total Decimal(20,6),
--   settled_at DateTime64(3)
-- ) engine = MergeTree() order by epoch

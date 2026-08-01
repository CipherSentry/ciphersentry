# Machinarc Services — Backend

Two services from `docs/architecture.md`, packaged independently of the web
app. Neither touches the frontend bundle; each has its own `package.json`.

```
services/
├── verifier-daemon/   # V0.2 alpha: WASM sandbox for deterministic re-execution
└── indexer/           # receipt graph: Postgres state + ClickHouse analytics
```

## verifier-daemon

Re-executes task specs inside a deterministic WASM sandbox and votes on the
output hash. Determinism is enforced the same way at every link of the chain:

| Knob | Mechanism |
| --- | --- |
| Wall clock | Injected `mrc_now()` — derived from the task id, never wall time |
| Randomness | Seeded PCG32 inside `mrc_rng_next()` — seed from the task input hash |
| Memory | Hard cap (64 pages); imported memory must declare limits |
| Syscalls | Frozen import table — hash-versioned allowlist only |
| Fuel | Cooperative `mrc_budget_checkpoint`; full instruction fueling swaps in via `wasm-instrumentation` (see daemon README notes in `src/runtime.ts`) |

Run:

```bash
cd services/verifier-daemon
npm install
npm run daemon            # consumes fixture assignments, prints votes/evidence
npm test                  # if added later — the runtime is headless
```

## indexer

Postgres is the system of record for task state transitions (events, never
silent mutations). ClickHouse holds the receipt graph — receipts, merkle
paths, trust time-series, batch stats — everything the public explorer and
the whitepaper's trust formula query.

```bash
cd services/indexer
npm install               # pg for Postgres; ClickHouse via HTTP (no dep)
export PG_DSN=postgres://mrc:mrc@localhost:5432/machinarc
export CH_URL=http://localhost:8123 CH_DB=machinarc
psql $PG_DSN -f sql/schema.sql
npm run schema:ch         # apply ClickHouse DDL over HTTP
npm run indexer           # listener + API on :8081
```

Event frames match the dame frame format as `src/sdk/rpc.ts` (WRITE-POINT #1):

```json
{ "jsonrpc": "2.0", "method": "task.event",   "params": { "topic": "tasks",   "data": { } } }
{ "jsonrpc": "2.0", "method": "batch.event",  "params": { "topic": "batches", "data": { } } }
```

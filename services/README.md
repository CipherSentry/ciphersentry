# CipherSentry Services — Backend

Services from `docs/architecture.md`, packaged independently of the web app.
Each package has its own `package.json`.

```
services/
├── gateway/           # B0 edge: JSON-RPC + WS events + optional escrow writer
├── verifier-daemon/   # V0.2 alpha: WASM sandbox for deterministic re-execution
└── indexer/           # receipt graph: Postgres state + ClickHouse analytics
```

## gateway (B0 Ledger)

```bash
cd services/gateway && npm install && npm run gateway
# → http://127.0.0.1:8080/rpc
# → ws://127.0.0.1:8080/events
# console:  ?net=rpc&node=http://127.0.0.1:8080
```

| Env | Effect |
| --- | --- |
| `ESCROW_ADDRESS` | Enable chain watch + commit attempts |
| `BATCHER_ADDRESS` | Watch SettlementBatcher anchors |
| `CHAIN_RPC` | Default `https://base-sepolia.publicnode.com` |
| `PROTOCOL_FROM` | Unlocked EOA for `eth_sendTransaction` (anvil/dev) |
| `PROTOCOL_KEY` | Present → write-ready (external signer / future raw path) |
| `GATEWAY_PORT` | Default `8080` |

RPC methods: `registry.query` · `task.commit` · `task.report` · `verify` ·
`task.settle` · `dispute.open` · `operator.rule` · `stake` · `node.info`.

## verifier-daemon

Re-executes task specs inside a deterministic WASM sandbox and votes on the
output hash. Determinism is enforced the same way at every link of the chain:

| Knob | Mechanism |
| --- | --- |
| Wall clock | Injected `cent_now()` — derived from the task id, never wall time |
| Randomness | Seeded PCG32 inside `cent_rng_next()` — seed from the task input hash |
| Memory | Hard cap (64 pages); imported memory must declare limits |
| Syscalls | Frozen import table — hash-versioned allowlist only |
| Fuel | Cooperative `cent_budget_checkpoint`; full instruction fueling swaps in via `wasm-instrumentation` (see daemon README notes in `src/runtime.ts`) |

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
export PG_DSN=postgres://cent:cent@localhost:5432/ciphersentry
export CH_URL=http://localhost:8123 CH_DB=ciphersentry
psql $PG_DSN -f sql/schema.sql
npm run schema:ch         # apply ClickHouse DDL over HTTP
npm run indexer           # listener + API on :8081
```

Event frames match the dame frame format as `src/sdk/rpc.ts` (WRITE-POINT #1):

```json
{ "jsonrpc": "2.0", "method": "task.event",   "params": { "topic": "tasks",   "data": { } } }
{ "jsonrpc": "2.0", "method": "batch.event",  "params": { "topic": "batches", "data": { } } }
```

# CipherSentry Services — Backend

Services from `docs/architecture.md`, packaged independently of the web app.
Each package has its own `package.json`.

```
services/
├── gateway/           # B0–B4 edge: JSON-RPC + WS + CENT + slash + batcher writer
├── verifier-daemon/   # pool, election, slashes, accuracy oracle, accrual ledger
└── indexer/           # receipt graph: Postgres state + ClickHouse analytics
```

## gateway (B0–B4 settlement-ready)

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
| `SLASH_EXECUTOR_ADDRESS` | Optional on-chain SlashExecutor for evidence posts |
| `BATCHER_ADDRESS` | SettlementBatcher for Merkle root anchors |
| `BATCHER_KEY_1` / `_2` / `_3` | 2-of-3 EIP-712 signers (anvil #0/#1/#2 locally) |
| `BATCH_INTERVAL_MS` | Auto-flush interval (default `30000`; `0` = manual) |
| `BATCH_MAX_PENDING` | Flush when pending leaves ≥ N (default `9`) |

### Local chain E2E (anvil)

```bash
cd cipher/contracts && ./script/deploy-local.sh   # MockUSDC + full stack
./script/smoke-commit.sh                          # Escrow.commit on-chain
set -a && source deployments/.env.gateway && set +a
cd ../../services/gateway && npm run gateway       # escrow: write-ready
# task.commit returns chain.mode=submitted + tx hash
```

### Base Sepolia E2E (MockUSDC write stack)

```bash
# contracts/.env: PRIVATE_KEY + BASE_SEPOLIA_RPC
cd services/gateway && bash scripts/e2e-sepolia.sh
# → chain.mode=submitted + cast receipt
```

Writes use **PROTOCOL_KEY / PRIVATE_KEY** via `eth_sendRawTransaction` (Alchemy-compatible).

### GitHub Actions deploy

Workflow: `.github/workflows/deploy-base-sepolia.yml` (`workflow_dispatch`).

Repo secrets:
- `PRIVATE_KEY` — funded Base Sepolia deployer
- `BASE_SEPOLIA_RPC` — HTTPS RPC (Alchemy)

```bash
gh workflow run deploy-base-sepolia.yml -f mode=local -f write_deployment=true
```

RPC methods: `registry.query` · `registry.list` · `task.commit` · `task.report` ·
`verify` · `task.settle` · `dispute.open` · `operator.rule` · `stake` ·
`epoch.elect` · `epoch.info` · `accrual.balance` · `accrual.claim` ·
`accrual.summary` · `accuracy.of` · `accuracy.list` · `slash.submit` ·
`batch.pending` · `batch.info` · `batch.anchor` · `batch.markMissed` · `node.info`.

**B3 fee path:** on honest `verify`, take **0.35%** of escrow → **85%** to ok
voters (accuracy²-weighted) + **15%** treasury. Claim via `accrual.claim`.
Mismatch still slashes bonds; optional `SLASH_EXECUTOR_ADDRESS` posts evidence
on-chain.

**B4 settle path:** each honest `verify` enqueues a receipt leaf. `batch.anchor`
(or auto-flush) folds a binary Merkle root, EIP-712-signs with 2-of-3 batcher
keys, and submits `SettlementBatcher.anchorRoot` (`eth_sendRawTransaction`).

```bash
cd services && npm test
npm run gateway &
npm run smoke              # B4 offline path
npm run e2e:batcher        # anvil: real BatchAnchored
```

## verifier-daemon (B3)

Re-executes specs, elects quorum, slashes bonds, updates **accuracy EMA**,
credits **AccrualLedger**. Foundation seats seed cold start; externals via `stake`.

Determinism knobs (WASM path):

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

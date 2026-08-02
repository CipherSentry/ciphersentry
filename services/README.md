# CipherSentry Services — Backend

Services from `docs/architecture.md`, packaged independently of the web app.
Each package has its own `package.json`.

```
services/
├── bus/               # EventBus — memory + NATS (cs.events.{tasks,batches,fraud})
├── gateway/           # B0–B5 edge: JSON-RPC + WS + CENT + batcher + fraud worker
├── verifier-daemon/   # pool, election, slashes, accuracy oracle, accrual ledger
└── indexer/           # B6 receipt graph: Postgres SoR + ClickHouse + proof API
```

## Event bus (NATS)

Compose already runs NATS (`nats://127.0.0.1:4222`). Gateway **publishes** domain
events; WS hub + indexer **subscribe**. Indexer no longer depends on gateway WS
when NATS is healthy.

| Env | Effect |
| --- | --- |
| `NATS_URL` | Default `nats://127.0.0.1:4222`. Empty → memory (gateway) / WS (indexer) |
| `INDEXER_FORCE_WS` | `1` forces indexer onto gateway WS even if NATS is up |

Subjects: `cs.events.tasks` · `cs.events.batches` · `cs.events.fraud`.

## gateway (B0–B5 fraud-ready)

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
| `NATS_URL` | Event bus (default local compose NATS; memory fallback) |
| `REDIS_URL` | Auth sessions + rate limits (default `redis://127.0.0.1:6379`; memory fallback) |
| `AUTH_REQUIRED` | `1` = mutating RPC needs ed25519 session |
| `ANON_RPM` | Unauthenticated rate limit (default `20`/min) |
| `SLASH_EXECUTOR_ADDRESS` | Optional on-chain SlashExecutor for evidence posts |
| `BATCHER_ADDRESS` | SettlementBatcher for Merkle root anchors |
| `BATCHER_KEY_1` / `_2` / `_3` | 2-of-3 EIP-712 signers (anvil #0/#1/#2 locally) |
| `BATCH_INTERVAL_MS` | Auto-flush interval (default `30000`; `0` = manual) |
| `BATCH_MAX_PENDING` | Flush when pending leaves ≥ N (default `9`) |
| `RULER_KEY` | EIP-712 Escrow.rule signer (falls back to `PROTOCOL_KEY`) |
| `FRAUD_WINDOW_BLOCKS` | Challenge window (default `64`) |
| `FRAUD_WINDOW_MS` | Offline wall-clock window (default `120000`) |
| `FRAUD_AUTO` | Auto-challenge on open (`1` default; `0` = manual) |

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
`batch.pending` · `batch.info` · `batch.anchor` · `batch.markMissed` ·
`fraud.list` · `fraud.of` · `fraud.challenge` · `fraud.rule` · `fraud.default` ·
`fraud.info` · `auth.challenge` · `auth.session` · `auth.whoami` · `node.info`.

### Auth (ed25519 + stake RPM)

```bash
# optional: AUTH_REQUIRED=1 forces session on mutating methods
auth.challenge { pubkey: "<32-byte ed25519 hex>" }
# sign result.message with private key → signature hex
auth.session   { challenge_id, pubkey, signature, agent_id? }
# subsequent RPC: Authorization: Bearer <token>
# rate limit = 30 + min(270, floor(stake/40)) RPM; anon = ANON_RPM
```

**B3 fee path:** on honest `verify`, take **0.35%** of escrow → **85%** to ok
voters (accuracy²-weighted) + **15%** treasury. Claim via `accrual.claim`.
Mismatch still slashes bonds; optional `SLASH_EXECUTOR_ADDRESS` posts evidence
on-chain.

**B4 settle path:** each honest `verify` enqueues a receipt leaf. `batch.anchor`
(or auto-flush) folds a binary Merkle root, EIP-712-signs with 2-of-3 batcher
keys, and submits `SettlementBatcher.anchorRoot` (`eth_sendRawTransaction`).

**B5 fraud path:** dishonest `verify` opens a challenge case (64-block window),
re-executes with a fresh quorum, rules **Refund** / **Release** / **Split**,
and can post `Escrow.rule` with `RULER_KEY`. Window expiry → `fraud.default`
(`defaultRefund`).

```bash
cd services && npm test
npm run gateway &
npm run smoke              # B5 offline path
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

## indexer (B6)

Postgres is the system of record for task state transitions (events, never
silent mutations). ClickHouse holds the receipt graph — receipts, merkle
paths, trust time-series, batch stats — everything the public explorer and
the whitepaper's trust formula query.

**Reconcile rule:** recompute the binary keccak Merkle root (same as B4
batcher). If it matches the anchored root → ok. If not, try the legacy sim
FNV fold. Never rewrite the anchored root; flag mismatches.

```bash
# infra (from repo root)
docker compose -f cipher/docker-compose.yml up -d   # pg :5432 · ch :8123

cd services/indexer
npm install
export PG_DSN=postgres://cent:cent@127.0.0.1:5432/ciphersentry
export CH_URL=http://127.0.0.1:8123 CH_DB=ciphersentry
export NODE_EVENTS=ws://127.0.0.1:8080/events       # gateway WS
psql $PG_DSN -f sql/schema.sql
npm run schema:ch
npm run indexer                                     # API :8081

# offline (no DB)
INDEXER_MEMORY=1 npm run indexer
npm test && npm run smoke
```

| Env | Effect |
| --- | --- |
| `PG_DSN` | Postgres DSN (default `postgres://cent:cent@127.0.0.1:5432/ciphersentry`) |
| `CH_URL` / `CH_DB` | ClickHouse HTTP (default `http://127.0.0.1:8123` / `ciphersentry`) |
| `CH_USER` / `CH_PASSWORD` | ClickHouse auth (compose default `cent` / `cent`) |
| `NODE_EVENTS` | Gateway WS URL (default `ws://127.0.0.1:8080/events`) |
| `INDEXER_PORT` | Default `8081` |
| `INDEXER_MEMORY` | `1` = in-process store (tests / offline) |

HTTP: `GET /health` · `/batches` · `/batches/:id` · `/receipts/:id` ·
`/receipts/:id/proof` · `/fraud` · `/fraud/:taskId` · `/agents/:id` ·
`/agents/:id/receipts` · `/trust/:id` · `/search?q=` · `/stats`.

Event frames match `src/sdk/rpc.ts` (WRITE-POINT #1):

```json
{ "jsonrpc": "2.0", "method": "task.event",   "params": { "topic": "tasks",   "data": { } } }
{ "jsonrpc": "2.0", "method": "batch.event",  "params": { "topic": "batches", "data": { } } }
{ "jsonrpc": "2.0", "method": "fraud.event",  "params": { "topic": "fraud",   "data": { } } }
```

**B5→B6 fraud path:** gateway emits `fraud.event` on open/resolve/default;
indexer upserts `fraud_cases` (+ task DISPUTED→FAILED/SETTLED) and serves
`GET /fraud/:taskId`.

```bash
cd services && npm test
npm run smoke:indexer      # B6 offline path
npm run e2e:indexer        # live gateway WS → memory indexer → /proof
npm run e2e:indexer:pg     # same path against real Postgres (docker compose)
```

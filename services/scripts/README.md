# Demo & e2e scripts

Public host + DNS: **[HOSTING.md](./HOSTING.md)** (S1.3).  
Key ceremony: **[CEREMONY.md](./CEREMONY.md)**.

## One-command demo (S1.2)

### Zero keys — local anvil (default for contributors)

```bash
# from repo root
cd services && npm ci   # once
DEMO_LOCAL=1 DEMO_HOLD=0 bash scripts/demo-sepolia.sh
```

Requires: Node 22+, Foundry (`forge`/`cast`/`anvil`), Python 3.

Exit 0 only when:

1. `task.commit` → `report` → `verify` (SETTLED)
2. `batch.anchor` (when write-ready)
3. Indexer `GET /receipts/:taskId/proof` returns `"valid": true`

Prints:

```
GATEWAY    http://127.0.0.1:<port>
INDEXER    http://127.0.0.1:<port>
CONSOLE    http://127.0.0.1:5173/#/app?net=rpc&auth=1&node=…
EXPLORER   http://127.0.0.1:5173/#/explorer?q=<task_id>&indexer=…
TX_COMMIT / TX_SETTLE / TX_ANCHOR
```

Hold processes for interactive UI:

```bash
DEMO_LOCAL=1 bash scripts/demo-sepolia.sh
# then: cd cipher && npm run dev  → open CONSOLE URL
```

Trust chart (pg + clickhouse + nats):

```bash
DEMO_LOCAL=1 WITH_COMPOSE=1 DEMO_HOLD=0 bash scripts/demo-sepolia.sh
```

### Base Sepolia (mock USDC write stack)

```bash
cp scripts/demo-kit.env.example scripts/demo-kit.env
# set PRIVATE_KEY + CHAIN_RPC
set -a && source scripts/demo-kit.env && set +a
bash scripts/demo-sepolia.sh
```

Or: `npm run demo:sepolia` from `services/`.

### Env knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `DEMO_LOCAL` | `0` | `1` = anvil + `deploy-local.sh` |
| `DEMO_HOLD` | `1` | `0` = exit after proof (CI/scripts) |
| `WITH_COMPOSE` | `0` | `1` = docker pg+ch+nats for `/trust` |
| `CIPHER_URL` | `http://127.0.0.1:5173` | frontend origin for deep links |
| `AUTH_REQUIRED` | `0` | gateway session gate |
| `PROOF_WAIT_TRIES` | `50` | indexer proof poll (×0.4s) |
| `GATEWAY_PORT` / `INDEXER_PORT` | random | fixed ports if set |

Full kit fields: `demo-kit.env.example`.

## Other scripts

| Script | Use |
|--------|-----|
| `e2e-compose.sh` | AUTH + settle → trust → fraud (CI) |
| `e2e-full.sh` | compose + pg + ch + nats full stack |
| `e2e-rails.sh` | anvil escrow/batcher rails |
| `e2e-sepolia-full.sh` | Base Sepolia commit→slash→trust (needs keys) |
| `e2e-sepolia-circle.sh` | Circle USDC path |
| `b7-host.sh` | hosted B7 ops |

Sepolia cast sends retry on underpriced nonces (`SEND_MAX_ATTEMPTS`, default 5).

# Fly.io public node (fast path → NODE LIVE)

**Public B7 (default `fly.toml` + `start-public-b7.sh`):** single machine embeds
Redis + NATS + gateway + memory indexer. `/health` → `phase=B7 bus=nats kv=redis`.

Not full hosted compose B7 (no PG/CH sidecars). Enough for:
- `GET /health` → badge **NODE LIVE** + B7 session/bus surface
- `?net=rpc` console + Sepolia mock writes (with secrets)
- Explorer path proxy (`/search`, `/tasks`, …) via embedded memory indexer

## Windows (PowerShell)

```powershell
# install flyctl
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

# login (browser)
fly auth login

# from REPO ROOT
cd path\to\workspaces-ciphersentry

# create app (once)
fly apps create ciphersentry-node --org personal

# secrets — use publicnode (not Alchemy) for writes if EOA is EIP-7702 delegated
fly secrets set -a ciphersentry-node `
  CHAIN_RPC=https://base-sepolia.publicnode.com `
  CHAIN_ID=84532 `
  ESCROW_ADDRESS=0xB41EC9A2E9fD7b9226E53a93daef0E1655729890 `
  BATCHER_ADDRESS=0x66855FBa76034B04053E6C419c0af1FE55867669 `
  USDC_ADDRESS=0x4fa4890F31143C5158eD0Aa95d80815bFd3580D0 `
  SLASH_EXECUTOR_ADDRESS=0x39b0D1E0fED8e22775631974402bc5f6CFa9865b `
  PROTOCOL_FROM=0x96a438924ACE133D5909bd3BAF3263845B760eF4 `
  PROTOCOL_KEY=0xYOUR_KEY `
  BATCHER_KEY_1=0xYOUR_KEY `
  BATCHER_KEY_2=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d `
  BATCHER_KEY_3=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a `
  RULER_KEY=0xYOUR_KEY

# deploy (build context MUST be services/)
cd services
fly deploy -a ciphersentry-node `
  --config fly/fly.gateway.toml `
  --dockerfile fly/Dockerfile `
  --remote-only

# smoke
curl https://ciphersentry-node.fly.dev/health
```

**Do not** paste private keys into chat/git. Set only via `fly secrets set`.

## Linux / macOS

```bash
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"
fly auth login
# same fly apps create / secrets / deploy as above
```

## Point the website at Fly

**Option A — rebuild frontend** (no custom DNS):

```bash
cd cipher
VITE_PUBLIC_NODE=https://ciphersentry-node.fly.dev \
VITE_PUBLIC_INDEXER=https://ciphersentry-indexer.fly.dev \
npm run build
# deploy dist/ to GitHub Pages
```

**Option B — CNAME** (after you own DNS):

```
node.base-sepolia.ciphersentry.xyz  CNAME  ciphersentry-node.fly.dev
```

Then in Fly:

```bash
fly certs add node.base-sepolia.ciphersentry.xyz -a ciphersentry-node
```

## Durable indexer (2nd app — Postgres SoR)

Creates `ciphersentry-db` (Fly Postgres) + `ciphersentry-indexer` with
`INDEXER_MEMORY=0` and `INDEXER_CH_MODE=memory` (analytics ephemeral; tasks /
receipts / batches durable in PG). Events fan-in over gateway WS.

```bash
bash services/fly/deploy-indexer.sh
# override: GATEWAY_URL=https://ciphersentry.fly.dev FLY_INDEXER_APP=ciphersentry-indexer FLY_PG_APP=ciphersentry-db

curl -sf https://ciphersentry-indexer.fly.dev/health
# → durable=true storage=pg ch=memory

# Point public gateway path-proxy at the durable app (private DNS):
fly secrets set -a ciphersentry \
  INDEXER_UPSTREAM=http://ciphersentry-indexer.internal:8080
fly deploy -a ciphersentry --config fly.toml --remote-only
```

Frontend: same-origin `/search` after proxy switch, or
`VITE_PUBLIC_INDEXER=https://ciphersentry-indexer.fly.dev`.

## `fly launch` vs these files

**Skip bare `fly launch`** (wrong Dockerfile / ports). Use the configs above:

```powershell
cd services
fly deploy -a ciphersentry-node -c fly/fly.gateway.toml --dockerfile fly/Dockerfile --remote-only
```

## Verify NODE LIVE

```bash
curl -sS https://ciphersentry-node.fly.dev/health
# browser: https://ciphersentry.xyz/#/app?net=rpc&auth=1&node=https://ciphersentry-node.fly.dev
```

Badge on landing polls default public DNS; until that CNAME exists, use `?node=` or `VITE_PUBLIC_NODE`.

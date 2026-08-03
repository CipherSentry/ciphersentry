# S1.3–S1.4 Hosting — public demo node + indexer

**Fastest path (Fly.io):** see [`../fly/README.md`](../fly/README.md).

Code defaults (frontend) on product hosts:

| Service | Default (no DNS) | Custom DNS (optional) |
|---------|------------------|------------------------|
| Gateway | `https://ciphersentry.fly.dev` | `https://node.base-sepolia.ciphersentry.xyz` |
| Indexer | `https://ciphersentry.fly.dev` (path proxy) | `https://indexer.base-sepolia.ciphersentry.xyz` |

Localhost / `127.0.0.1` still use `:8080` / `:8081`.

`#/demo` always uses the live gateway (RPC), not the old setTimeout fixture.

Build overrides:

```bash
VITE_PUBLIC_NODE=https://your-gw.example \
VITE_PUBLIC_INDEXER=https://your-ix.example \
npm run build
```

## Indexer on Fly (embedded path mode)

Public deploy runs gateway + memory indexer in one machine (`fly/start-public.sh`).
Indexer HTTP is proxied on the same origin (`/batches`, `/fraud`, `/indexer/health`).

```bash
curl -sf https://ciphersentry.fly.dev/health
curl -sf https://ciphersentry.fly.dev/indexer/health
curl -sf https://ciphersentry.fly.dev/batches
```

Optional 2nd app: `bash services/fly/deploy-indexer.sh` (needs app-create token).

## Deploy (one box + Docker)

```bash
# on the host
git clone <repo> && cd <repo>
mkdir -p services/secrets && chmod 700 services/secrets
# write hex keys (see b7-host.sh init) — never commit
bash services/scripts/b7-host.sh init
# edit services/prod.env:
#   CHAIN_RPC=https://base-sepolia.publicnode.com   # avoid Alchemy 7702 in-flight limit
#   ESCROW_ADDRESS / BATCHER_ADDRESS / … from deployments/base-sepolia-mockusdc.json
#   PROTOCOL_FROM=<funded EOA>
docker compose -f services/docker-compose.b7.yml --env-file services/prod.env up -d
curl -sS http://127.0.0.1:8080/health
```

## TLS + DNS

1. A/AAAA `node.base-sepolia.ciphersentry.xyz` → host
2. A/AAAA `indexer.base-sepolia.ciphersentry.xyz` → same host
3. Reverse proxy (Caddy example):

```caddy
node.base-sepolia.ciphersentry.xyz {
  reverse_proxy 127.0.0.1:8080
}
indexer.base-sepolia.ciphersentry.xyz {
  reverse_proxy 127.0.0.1:8090
}
```

WS upgrade required on gateway (`/events`).

## Security

- **Mock USDC stack only** for public demo — never Circle production key
- `AUTH_REQUIRED=1` in B7 / `prod.env`
- Rate limits: stake RPM (gateway auth)
- Rotate any key that was pasted in chat
- Prefer `*_FILE` mounts under `services/secrets/`

## Smoke after DNS

```bash
curl -sf https://node.base-sepolia.ciphersentry.xyz/health
curl -sf https://indexer.base-sepolia.ciphersentry.xyz/health
# browser
# https://ciphersentry.xyz/#/app?net=rpc&auth=1
# expect: RPC NODE · LIVE
```

## Until DNS is live

Health badge uses Fly default `https://ciphersentry.fly.dev`. Local demo still works:

```bash
DEMO_LOCAL=1 DEMO_HOLD=0 bash services/scripts/demo-sepolia.sh
# or Sepolia mock with demo-kit.env
```

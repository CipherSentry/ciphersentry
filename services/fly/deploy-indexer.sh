#!/usr/bin/env bash
# Deploy durable public indexer to Fly (2nd app) + attach Postgres.
# Prereq: fly auth login; gateway at https://ciphersentry.fly.dev
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${FLY_INDEXER_APP:-ciphersentry-indexer}"
PG_APP="${FLY_PG_APP:-ciphersentry-db}"
GW="${GATEWAY_URL:-https://ciphersentry.fly.dev}"
GW="${GW%/}"
ORG="${FLY_ORG:-personal}"
REGION="${FLY_REGION:-iad}"

cd "$ROOT"
export PATH="${HOME}/.fly/bin:${PATH}"

if ! command -v fly >/dev/null 2>&1; then
  echo "install flyctl: https://fly.io/docs/hands-on/install-flyctl/" >&2
  exit 1
fi

if ! fly apps list 2>/dev/null | grep -qE "\\b${APP}\\b"; then
  echo "→ creating app ${APP}"
  fly apps create "$APP" --org "$ORG" || true
fi

# Postgres cluster (unmanaged flex) — create once
if ! fly apps list 2>/dev/null | grep -qE "\\b${PG_APP}\\b"; then
  echo "→ creating postgres ${PG_APP} (region=${REGION})"
  fly postgres create \
    --name "$PG_APP" \
    --org "$ORG" \
    --region "$REGION" \
    --vm-size shared-cpu-1x \
    --volume-size 1 \
    --initial-cluster-size 1 \
    --password "${FLY_PG_PASSWORD:-$(openssl rand -hex 16)}"
fi

echo "→ attach ${PG_APP} → ${APP} (sets DATABASE_URL)"
fly postgres attach "$PG_APP" -a "$APP" --yes 2>/dev/null \
  || fly postgres attach "$PG_APP" -a "$APP" || true

# Map DATABASE_URL → PG_DSN for indexer boot
echo "→ secrets NODE_EVENTS / GATEWAY_URL / INDEXER_*"
fly secrets set -a "$APP" \
  "NODE_EVENTS=wss://${GW#https://}/events" \
  "GATEWAY_URL=${GW}" \
  "NATS_URL=" \
  "INDEXER_MEMORY=0" \
  "INDEXER_CH_MODE=memory" \
  "INDEXER_FORCE_WS=1" \
  "INDEXER_HOST=0.0.0.0" \
  --stage 2>/dev/null || \
fly secrets set -a "$APP" \
  "NODE_EVENTS=wss://${GW#https://}/events" \
  "GATEWAY_URL=${GW}" \
  "NATS_URL=" \
  "INDEXER_MEMORY=0" \
  "INDEXER_CH_MODE=memory" \
  "INDEXER_FORCE_WS=1" \
  "INDEXER_HOST=0.0.0.0"

echo "→ deploy ${APP}"
fly deploy -a "$APP" \
  -c fly/fly.indexer.toml \
  --dockerfile fly/Dockerfile \
  --remote-only \
  --command "bash -lc 'export PG_DSN=\"\${PG_DSN:-\$DATABASE_URL}\"; exec npm run indexer -w indexer'"

echo "→ smoke"
curl -sf "https://${APP}.fly.dev/health" | head -c 600
echo
echo "OK  durable indexer https://${APP}.fly.dev"
echo "    set gateway INDEXER_UPSTREAM=http://${APP}.internal:8080 (or https://${APP}.fly.dev)"

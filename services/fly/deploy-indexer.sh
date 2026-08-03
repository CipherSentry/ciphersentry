#!/usr/bin/env bash
# Deploy public memory indexer to Fly (2nd app).
# Prereq: fly auth login; gateway already at https://ciphersentry.fly.dev
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${FLY_INDEXER_APP:-ciphersentry-indexer}"
GW="${GATEWAY_URL:-https://ciphersentry.fly.dev}"
GW="${GW%/}"

cd "$ROOT"
export PATH="${HOME}/.fly/bin:${PATH}"

if ! command -v fly >/dev/null 2>&1; then
  echo "install flyctl: https://fly.io/docs/hands-on/install-flyctl/" >&2
  exit 1
fi

if ! fly apps list 2>/dev/null | grep -qE "\\b${APP}\\b"; then
  echo "→ creating app ${APP}"
  fly apps create "$APP" --org "${FLY_ORG:-personal}" || true
fi

echo "→ secrets NODE_EVENTS / GATEWAY_URL → ${GW}"
fly secrets set -a "$APP" \
  "NODE_EVENTS=wss://${GW#https://}/events" \
  "GATEWAY_URL=${GW}" \
  "NATS_URL=" \
  --stage 2>/dev/null || \
fly secrets set -a "$APP" \
  "NODE_EVENTS=wss://${GW#https://}/events" \
  "GATEWAY_URL=${GW}" \
  "NATS_URL="

echo "→ deploy ${APP}"
fly deploy -a "$APP" \
  -c fly/fly.indexer.toml \
  --dockerfile fly/Dockerfile \
  --remote-only \
  --command "npm run indexer -w indexer"

echo "→ smoke"
curl -sf "https://${APP}.fly.dev/health" | head -c 400
echo
echo "OK  VITE_PUBLIC_INDEXER=https://${APP}.fly.dev"

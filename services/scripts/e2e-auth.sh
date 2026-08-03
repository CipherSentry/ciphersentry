#!/usr/bin/env bash
# AUTH_REQUIRED abuse e2e — boots gateway, enforces session + denial path.
#
#   bash services/scripts/e2e-auth.sh
#   npm run e2e:auth -w @ciphersentry/services
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/services"

GPORT="${GPORT:-$((19000 + RANDOM % 500))}"
GBASE="http://127.0.0.1:${GPORT}"
GLOG="${TMPDIR:-/tmp}/cs-e2e-auth-$$.log"
# Keep high enough for challenge/session handshake; e2e still burns past the cap.
ANON_RPM="${ANON_RPM:-12}"
EVENT_SEED="${EVENT_SIGNING_SEED:-$(python3 -c 'print("cd"*32)')}"

cleanup() {
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${GPORT}/tcp" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== gateway :${GPORT} AUTH_REQUIRED=1 ANON_RPM=${ANON_RPM} =="
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export AUTH_REQUIRED=1 ANON_RPM
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000
export EVENT_SIGNING_SEED="$EVENT_SEED"
# memory bus + kv (no redis/nats dependency)
export NATS_URL="" REDIS_URL=""
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!

for _ in $(seq 1 60); do
  if curl -sf "$GBASE/health" | grep -q '"ok":true'; then break; fi
  sleep 0.25
done
curl -sf "$GBASE/health" | grep -q '"ok":true' || {
  echo "gateway failed"
  tail -40 "$GLOG"
  exit 1
}

AUTH=$(curl -sf "$GBASE/health" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("auth_required"))')
[[ "$AUTH" == "True" ]] || {
  echo "expected auth_required=true got $AUTH"
  tail -20 "$GLOG"
  exit 1
}
echo "  health auth_required=true"

echo "== smoke:auth (strict) =="
export GATEWAY_URL="$GBASE" AUTH_STRICT=1 ANON_RPM
npm run smoke:auth -w gateway

echo "AUTH e2e OK (port ${GPORT})"

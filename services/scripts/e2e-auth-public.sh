#!/usr/bin/env bash
# Live public-node AUTH e2e — expects AUTH_REQUIRED=1 on GATEWAY_URL.
#
#   GATEWAY_URL=https://ciphersentry.fly.dev bash services/scripts/e2e-auth-public.sh
#   npm run e2e:auth:public -w @ciphersentry/services
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/services"

GATEWAY_URL="${GATEWAY_URL:-https://ciphersentry.fly.dev}"
GATEWAY_URL="${GATEWAY_URL%/}"
export GATEWAY_URL AUTH_STRICT=1

echo "== public AUTH e2e → ${GATEWAY_URL} =="
H=$(curl -sf --max-time 20 "${GATEWAY_URL}/health") || {
  echo "health unreachable"
  exit 1
}
echo "$H" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d.get("ok") is True;assert d.get("auth_required") is True, d;print("  auth_required=true")'

# public methods still open
curl -sf --max-time 15 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"node.info","params":{}}' \
  "${GATEWAY_URL}/rpc" | grep -q '"result"' || {
  echo "public node.info failed"
  exit 1
}
echo "  public node.info OK"

# mutating without session → 401
CODE=$(curl -sS --max-time 15 -o /tmp/cs-auth-anon.json -w '%{http_code}' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"task.commit","params":{"spec":"x","worker":"w","buyer":"b","escrow":{"amount":"1.00","asset":"USDC"}}}' \
  "${GATEWAY_URL}/rpc")
[[ "$CODE" == "401" ]] || {
  echo "expected 401 anon mutate, got $CODE body=$(cat /tmp/cs-auth-anon.json)"
  exit 1
}
echo "  anon mutate → 401 OK"

# full session + authed commit (reuse smoke-auth)
npm run smoke:auth -w gateway

echo "PUBLIC AUTH e2e OK (${GATEWAY_URL})"

#!/usr/bin/env bash
# B0 chain E2E: load deployments/.env.gateway → start gateway → RPC smoke with chain fields
set -euo pipefail
GW="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$GW/../.." && pwd)"
ENV_FILE="${1:-$REPO/cipher/contracts/deployments/.env.gateway}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — run cipher/contracts/script/deploy-local.sh first" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"
export PATH="${HOME}/.foundry/bin:${PATH}"

cd "$GW"
# free port if needed
if command -v fuser >/dev/null; then fuser -k "${GATEWAY_PORT}/tcp" 2>/dev/null || true; fi

node --experimental-transform-types src/index.ts >/tmp/gateway-chain.log 2>&1 &
GPID=$!
trap 'kill $GPID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  if curl -sf "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health" >/dev/null; then break; fi
  sleep 0.2
done

echo "=== health ==="
curl -sS "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health"
echo
echo "=== task.commit (chain path) ==="
curl -sS -X POST "http://${GATEWAY_HOST}:${GATEWAY_PORT}/rpc" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"task.commit","params":{"spec":"render.sequence.4k","worker":"0x70997970C51812dc3A010C7d01b50e0d17dc79C8","escrow":{"amount":"10.00"},"buyer":"agent:atlas-01"}}'
echo
echo "=== log tail ==="
tail -20 /tmp/gateway-chain.log

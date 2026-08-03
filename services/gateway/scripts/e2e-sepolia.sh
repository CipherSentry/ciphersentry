#!/usr/bin/env bash
# End-to-end: gateway + Base Sepolia mock stack task.commit → on-chain tx
set -euo pipefail
GW="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$GW/../.." && pwd)"
DEPLOY_JSON="${DEPLOY_JSON:-$ROOT/cipher/contracts/deployments/base-sepolia-mockusdc.json}"
CONTRACTS="$ROOT/cipher/contracts"

export PATH="${HOME}/.foundry/bin:${PATH}"

if [[ -f "$CONTRACTS/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$CONTRACTS/.env"
  set +a
fi

: "${BASE_SEPOLIA_RPC:=${CHAIN_RPC:-}}"
: "${BASE_SEPOLIA_RPC:?set BASE_SEPOLIA_RPC or CHAIN_RPC}"
: "${PRIVATE_KEY:?set PRIVATE_KEY for raw-tx signing}"

test -f "$DEPLOY_JSON"

ESCROW=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['escrow'])")
BATCHER=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['batcher'])")
USDC=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['usdc'])")
SLASH=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON')).get('slashExecutor',''))")
FROM=$(cast wallet address --private-key "$PRIVATE_KEY")

echo "deployer=$FROM escrow=$ESCROW slash=$SLASH"

export CHAIN_RPC="$BASE_SEPOLIA_RPC"
export BASE_SEPOLIA_RPC
export CHAIN_ID=84532
export ESCROW_ADDRESS="$ESCROW"
export BATCHER_ADDRESS="$BATCHER"
export SLASH_EXECUTOR_ADDRESS="$SLASH"
export PROTOCOL_FROM="$FROM"
export PROTOCOL_KEY="$PRIVATE_KEY"
export PRIVATE_KEY
export USDC_ADDRESS="$USDC"
export GATEWAY_HOST=127.0.0.1
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"

# free port
if command -v fuser >/dev/null; then fuser -k "${GATEWAY_PORT}/tcp" 2>/dev/null || true; fi

cd "$GW"
node --experimental-transform-types src/index.ts >/tmp/gateway-sepolia.log 2>&1 &
GPID=$!
trap 'kill $GPID 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -sf "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health" >/dev/null && break
  sleep 0.25
done

echo "=== health ==="
curl -sS "http://${GATEWAY_HOST}:${GATEWAY_PORT}/health"
echo

WORKER="${WORKER:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
echo "=== task.commit ==="
RESP=$(curl -sS -X POST "http://${GATEWAY_HOST}:${GATEWAY_PORT}/rpc" \
  -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"task.commit\",\"params\":{\"spec\":\"render.sequence.4k\",\"worker\":\"$WORKER\",\"escrow\":{\"amount\":\"10.00\"},\"buyer\":\"agent:atlas-01\"}}")
echo "$RESP"
MODE=$(python3 -c "import json,sys; print(json.load(sys.stdin)['result']['chain']['mode'])" <<<"$RESP")
TX=$(python3 -c "import json,sys; print(json.load(sys.stdin)['result']['chain'].get('tx') or '')" <<<"$RESP")

if [[ "$MODE" != "submitted" || -z "$TX" || "$TX" == "None" ]]; then
  echo "FAIL: expected chain.mode=submitted with tx hash" >&2
  tail -40 /tmp/gateway-sepolia.log >&2 || true
  exit 1
fi

echo "=== receipt ==="
cast receipt "$TX" --rpc-url "$CHAIN_RPC" | head -25

echo "E2E sepolia OK  tx=$TX"

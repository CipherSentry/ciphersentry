#!/usr/bin/env bash
# Full local deploy on anvil. Writes deployments/local.json + .env.gateway
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.foundry/bin:${PATH}"

ANVIL_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
RPC="${CHAIN_RPC:-http://127.0.0.1:8545}"
ANVIL_PID=""

cleanup() {
  if [[ -n "${ANVIL_PID}" ]] && kill -0 "${ANVIL_PID}" 2>/dev/null; then
    kill "${ANVIL_PID}" 2>/dev/null || true
  fi
}

# Start anvil if nothing listens on 8545
if ! curl -sf -X POST "$RPC" -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  echo "starting anvil on :8545"
  anvil --host 127.0.0.1 --port 8545 --chain-id 31337 >/tmp/anvil-ciphersentry.log 2>&1 &
  ANVIL_PID=$!
  for i in $(seq 1 40); do
    if curl -sf -X POST "$RPC" -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

mkdir -p deployments
PRIVATE_KEY="$ANVIL_KEY" LOCAL=true forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC" \
  --broadcast \
  -vv

test -f deployments/local.json
ESCROW=$(python3 -c 'import json;print(json.load(open("deployments/local.json"))["escrow"])')
BATCHER=$(python3 -c 'import json;print(json.load(open("deployments/local.json"))["batcher"])')
USDC=$(python3 -c 'import json;print(json.load(open("deployments/local.json"))["usdc"])')
DEPLOYER=$(python3 -c 'import json;print(json.load(open("deployments/local.json"))["deployer"])')
SLASH=$(python3 -c 'import json;print(json.load(open("deployments/local.json")).get("slashExecutor",""))')

# Anvil #0/#1/#2 — match Deploy.s.sol LOCAL batcher signers
ANVIL_KEY1="${BATCHER_KEY_2:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"
ANVIL_KEY2="${BATCHER_KEY_3:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}"

cat > deployments/.env.gateway <<EOF
CHAIN_RPC=$RPC
CHAIN_ID=31337
ESCROW_ADDRESS=$ESCROW
BATCHER_ADDRESS=$BATCHER
USDC_ADDRESS=$USDC
SLASH_EXECUTOR_ADDRESS=$SLASH
PROTOCOL_FROM=$DEPLOYER
PROTOCOL_KEY=$ANVIL_KEY
BATCHER_KEY_1=$ANVIL_KEY
BATCHER_KEY_2=$ANVIL_KEY1
BATCHER_KEY_3=$ANVIL_KEY2
BATCH_INTERVAL_MS=0
BATCH_MAX_PENDING=9
EOF

echo ""
echo "deploy OK → deployments/local.json"
echo "gateway:   set -a && source deployments/.env.gateway && set +a"
echo "anvil log: /tmp/anvil-ciphersentry.log (if we started it)"
# leave anvil running when we started it
if [[ -n "${ANVIL_PID}" ]]; then
  echo "anvil pid: $ANVIL_PID"
  disown "$ANVIL_PID" 2>/dev/null || true
fi

#!/usr/bin/env bash
# Circle USDC production stack commit (Base Sepolia) — NOT mock.
#
#   set -a && source services/scripts/demo-kit.env && set +a
#   bash services/scripts/e2e-sepolia-circle.sh
#
# Needs PROTOCOL_KEY (or CIRCLE_KEY) with Circle USDC balance + ETH gas.
# Faucet: https://faucet.circle.com  ·  CDP: portal.cdp.coinbase.com/products/faucet
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"

ENV_FILE="${DEMO_KIT_ENV:-$ROOT/services/scripts/demo-kit.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${CHAIN_RPC:=${BASE_SEPOLIA_RPC:?set CHAIN_RPC}}"
export CHAIN_RPC CHAIN_ID="${CHAIN_ID:-84532}"

DEPLOY_JSON="${DEPLOY_JSON:-$ROOT/cipher/contracts/deployments/base-sepolia.json}"
test -f "$DEPLOY_JSON"

# Prefer CIRCLE_KEY (wallet that holds real USDC); fall back to PROTOCOL_KEY/PRIVATE_KEY
KEY="${CIRCLE_KEY:-${PROTOCOL_KEY:-${PRIVATE_KEY:?set CIRCLE_KEY or PROTOCOL_KEY}}}"
[[ "$KEY" == 0x* ]] || KEY="0x$KEY"
FROM=$(cast wallet address --private-key "$KEY")

ESCROW=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['escrow'])")
BATCHER=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['batcher'])")
USDC=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['usdc'])")
SLASH=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['slashExecutor'])")
CENT=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['cent'])")

# expected Circle canonical token
CANON=0x036CbD53842c5426634e7929541eC2318f3dCF7e
python3 -c "import sys; u='$USDC'.lower(); c='$CANON'.lower(); sys.exit(0 if u==c else 1)" \
  || { echo "FATAL: deployment USDC $USDC != Circle $CANON (use base-sepolia.json not mock)"; exit 1; }

on_usdc=$(cast call "$USDC" "balanceOf(address)(uint256)" "$FROM" --rpc-url "$CHAIN_RPC" | awk '{print $1}')
eth=$(cast balance "$FROM" --rpc-url "$CHAIN_RPC" | awk '{print $1}')
echo "== Circle USDC e2e =="
echo "  from=$FROM"
echo "  escrow=$ESCROW"
echo "  usdc_balance=$on_usdc  eth=$eth"
# need ≥ 0.06 USDC (0.05 amount + 0.01 MIN_BOND) = 60000 units
NEED=60000
python3 -c "import sys; sys.exit(0 if int('$on_usdc')>=$NEED else 1)" || {
  echo "FATAL: need ≥0.06 Circle USDC on $FROM (have $on_usdc raw units)"
  echo "  faucet → https://faucet.circle.com  (Base Sepolia USDC)"
  echo "  or CDP → https://portal.cdp.coinbase.com/products/faucet"
  exit 1
}
python3 -c "import sys; sys.exit(0 if int('$eth')>=10**15 else 1)" || {
  echo "FATAL: need ≥0.001 ETH gas on $FROM"; exit 1
}

GAS_PRICE="${GAS_PRICE:-12gwei}"
PRIORITY_GAS="${PRIORITY_GAS:-3gwei}"
send() {
  cast send "$@" --rpc-url "$CHAIN_RPC" \
    --priority-gas-price "$PRIORITY_GAS" --gas-price "$GAS_PRICE" >/dev/null
  sleep 1.5
}

echo "== approve escrow =="
MAX=0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
allow=$(cast call "$USDC" "allowance(address,address)(uint256)" "$FROM" "$ESCROW" --rpc-url "$CHAIN_RPC" | awk '{print $1}')
if python3 -c "import sys; sys.exit(0 if int('$allow')>=$NEED else 1)"; then
  echo "  allowance ok"
else
  send "$USDC" "approve(address,uint256)" "$ESCROW" "$MAX" --private-key "$KEY"
  echo "  approved"
fi

GPORT="${GPORT:-$((19000 + RANDOM % 300))}"
GBASE="http://127.0.0.1:${GPORT}"
GLOG="${TMPDIR:-/tmp}/cs-circle-gw-$$.log"
cleanup() {
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  command -v fuser >/dev/null && fuser -k "${GPORT}/tcp" 2>/dev/null || true
}
trap cleanup EXIT

export ESCROW_ADDRESS="$ESCROW" BATCHER_ADDRESS="$BATCHER" USDC_ADDRESS="$USDC"
export SLASH_EXECUTOR_ADDRESS="$SLASH" CENT_ADDRESS="$CENT"
export PROTOCOL_KEY="$KEY" PROTOCOL_FROM="$FROM" RULER_KEY="$KEY"
# batcher keys for on-chain anchor (2-of-3) — must exist before gateway boot
export BATCHER_KEY_1="${BATCHER_KEY_1:-$KEY}"
export BATCHER_KEY_2="${BATCHER_KEY_2:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"
export BATCHER_KEY_3="${BATCHER_KEY_3:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}"
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export AUTH_REQUIRED=0 REDIS_URL="${REDIS_URL:-}" NATS_URL="${NATS_URL:-}"
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000

cd "$ROOT/services"
echo "== gateway :$GPORT (Circle stack) =="
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" >/tmp/cs-circle-h.json 2>/dev/null && grep -q '"ok":true' /tmp/cs-circle-h.json && break
  sleep 0.25
done
python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-circle-h.json"))
assert "write" in str(h.get("escrow","")).lower(), h
print("  health escrow=%s batcher=%s" % (h.get("escrow"), h.get("batcher")))
PY

RPC="$ROOT/services/gateway/scripts/rpc-call.mjs"
rpc() {
  local method=$1 params=${2:-'{}'}
  node "$RPC" "$GBASE/rpc" "$method" "$params"
}

AMT="${CIRCLE_AMOUNT:-0.05}"
FULL="${CIRCLE_FULL:-1}"   # 1 = commit+settle+anchor; 0 = commit only

echo "== task.commit amount=$AMT USDC (Circle) =="
C=$(rpc task.commit \
  "{\"spec\":\"circle.usdc.commit\",\"worker\":\"agent:vector-7\",\"buyer\":\"agent:atlas-01\",\"escrow\":{\"amount\":\"$AMT\",\"asset\":\"USDC\"}}")
echo "$C" | tee /tmp/cs-circle-commit.json >/dev/null
python3 - <<'PY'
import json
c=json.load(open("/tmp/cs-circle-commit.json"))
ch=c.get("chain") or {}
assert ch.get("mode")=="submitted" and ch.get("tx"), c
open("/tmp/cs-circle-tx.txt","w").write(ch["tx"])
print("  task", c["task_id"], "tx", ch["tx"])
PY
TX=$(cat /tmp/cs-circle-tx.txt)
TID=$(python3 -c 'import json;print(json.load(open("/tmp/cs-circle-commit.json"))["task_id"])')
HASH=$(python3 -c 'import json;print(json.load(open("/tmp/cs-circle-commit.json"))["expected_hash"])')
cast receipt "$TX" --rpc-url "$CHAIN_RPC" >/dev/null
# RPC lag — poll until USDC drops
after="$on_usdc"
for _ in $(seq 1 15); do
  after=$(cast call "$USDC" "balanceOf(address)(uint256)" "$FROM" --rpc-url "$CHAIN_RPC" | awk '{print $1}')
  python3 -c "import sys; sys.exit(0 if int('$after')<int('$on_usdc') else 1)" && break
  sleep 1
done
python3 -c "b,a=int('$on_usdc'),int('$after'); assert a<b, (b,a); print(f'  usdc {b} → {a}')"

ANCHOR_TX=""
if [[ "$FULL" == "1" ]]; then
  echo "== settle (report + verify) =="
  rpc task.report "{\"task_id\":\"$TID\",\"hash\":\"$HASH\"}" >/dev/null
  V=$(rpc verify "{\"task_id\":\"$TID\"}")
  echo "$V" | grep -q SETTLED || { echo "verify fail $V"; exit 1; }
  echo "  settled $TID"

  echo "== batch.anchor =="
  # wait nonce quiet
  for _ in $(seq 1 20); do
    L=$(cast nonce "$FROM" --rpc-url "$CHAIN_RPC")
    P=$(cast nonce "$FROM" --rpc-url "$CHAIN_RPC" --block pending)
    [[ "$L" == "$P" ]] && break
    sleep 2
  done
  sleep 2
  A=$(rpc batch.anchor '{}')
  echo "$A" | tee /tmp/cs-circle-anchor.json >/dev/null
  python3 - <<'PY'
import json
a=json.load(open("/tmp/cs-circle-anchor.json"))
assert a.get("mode") in ("submitted","simulated"), a
if a.get("txHash"):
  open("/tmp/cs-circle-anchor-tx.txt","w").write(a["txHash"])
print("  anchor mode=%s root=%s tx=%s" % (a.get("mode"), (a.get("root") or "")[:18], (a.get("txHash") or "-")[:18]))
PY
  if [[ -f /tmp/cs-circle-anchor-tx.txt ]]; then
    ANCHOR_TX=$(cat /tmp/cs-circle-anchor-tx.txt)
    cast receipt "$ANCHOR_TX" --rpc-url "$CHAIN_RPC" >/dev/null
    echo "  anchor receipt ok"
  fi
fi

echo ""
echo "CIRCLE USDC e2e OK${FULL:+ (full settle)}"
echo "  commit=$TX"
[[ -n "$ANCHOR_TX" ]] && echo "  anchor=$ANCHOR_TX"
echo "  task=$TID"
echo "  explorer https://sepolia.basescan.org/tx/$TX"
echo "  escrow https://sepolia.basescan.org/address/$ESCROW"

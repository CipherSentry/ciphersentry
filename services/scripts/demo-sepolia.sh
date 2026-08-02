#!/usr/bin/env bash
# External Sepolia demo kit (NOT CI).
# Settle → open explorer agent trust panel.
#
#   cp services/scripts/demo-kit.env.example services/scripts/demo-kit.env
#   # edit PRIVATE_KEY + CHAIN_RPC
#   bash services/scripts/demo-sepolia.sh
#
# Optional: DEMO_KIT_ENV=/path/to.env bash services/scripts/demo-sepolia.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"

ENV_FILE="${DEMO_KIT_ENV:-$ROOT/services/scripts/demo-kit.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "  env ← $ENV_FILE"
elif [[ -f "$ROOT/services/scripts/demo-kit.env.example" ]]; then
  echo "  tip: copy demo-kit.env.example → demo-kit.env and set PRIVATE_KEY + CHAIN_RPC"
fi

: "${CHAIN_RPC:=${BASE_SEPOLIA_RPC:-https://base-sepolia.publicnode.com}}"
: "${CHAIN_ID:=84532}"
: "${GATEWAY_PORT:=8080}"
: "${INDEXER_PORT:=8081}"
: "${AUTH_REQUIRED:=0}"
: "${WITH_COMPOSE:=0}"
: "${CIPHER_URL:=http://127.0.0.1:5173}"
: "${WORKER:=agent:vector-7}"
: "${BUYER:=agent:atlas-01}"

export CHAIN_RPC CHAIN_ID BASE_SEPOLIA_RPC="$CHAIN_RPC"
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT
export AUTH_REQUIRED
export BATCH_INTERVAL_MS="${BATCH_INTERVAL_MS:-0}"
export BATCH_MAX_PENDING="${BATCH_MAX_PENDING:-99}"
export TICK_MS="${TICK_MS:-60000}"
export NATS_URL="${NATS_URL:-}"
export REDIS_URL="${REDIS_URL:-}"

# load mock stack addresses if unset
DEPLOY_JSON="${DEPLOY_JSON:-$ROOT/cipher/contracts/deployments/base-sepolia-mockusdc.json}"
if [[ -z "${ESCROW_ADDRESS:-}" && -f "$DEPLOY_JSON" ]]; then
  ESCROW_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['escrow'])")
  BATCHER_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['batcher'])")
  USDC_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['usdc'])")
  SLASH_EXECUTOR_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON')).get('slashExecutor',''))")
  PROTOCOL_FROM=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['deployer'])")
fi
export ESCROW_ADDRESS BATCHER_ADDRESS USDC_ADDRESS SLASH_EXECUTOR_ADDRESS PROTOCOL_FROM

if [[ -n "${PRIVATE_KEY:-}" ]]; then
  export PROTOCOL_KEY="${PROTOCOL_KEY:-$PRIVATE_KEY}"
  export PRIVATE_KEY
  if [[ -z "${PROTOCOL_FROM:-}" ]] && command -v cast >/dev/null; then
    PROTOCOL_FROM=$(cast wallet address --private-key "$PRIVATE_KEY")
    export PROTOCOL_FROM
  fi
fi

# batcher keys — reuse protocol for demo if not set (2-of-3 may need distinct in prod)
export BATCHER_KEY_1="${BATCHER_KEY_1:-${PROTOCOL_KEY:-}}"
export BATCHER_KEY_2="${BATCHER_KEY_2:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"
export BATCHER_KEY_3="${BATCHER_KEY_3:-0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a}"
export RULER_KEY="${RULER_KEY:-${PROTOCOL_KEY:-}}"

GBASE="http://127.0.0.1:${GATEWAY_PORT}"
IBASE="http://127.0.0.1:${INDEXER_PORT}"
GLOG="${TMPDIR:-/tmp}/cs-demo-gw-$$.log"
ILOG="${TMPDIR:-/tmp}/cs-demo-ix-$$.log"
STARTED_COMPOSE=0
GPID="" IPID=""

cleanup() {
  [[ -n "${IPID:-}" ]] && kill "$IPID" 2>/dev/null || true
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
}
trap cleanup EXIT

echo "== Sepolia demo kit =="
echo "  rpc=$CHAIN_RPC"
echo "  escrow=${ESCROW_ADDRESS:-unset}"
echo "  slash=${SLASH_EXECUTOR_ADDRESS:-unset}"
echo "  protocol_from=${PROTOCOL_FROM:-unset}"

if [[ "$WITH_COMPOSE" == "1" ]]; then
  if ! command -v docker >/dev/null; then
    echo "docker required for WITH_COMPOSE=1" >&2
    exit 1
  fi
  echo "== compose pg+ch+nats =="
  docker compose -f "$ROOT/cipher/docker-compose.yml" up -d postgres clickhouse nats
  STARTED_COMPOSE=1
  export PG_DSN="${PG_DSN:-postgres://cent:cent@127.0.0.1:5432/ciphersentry}"
  export CH_URL="${CH_URL:-http://127.0.0.1:8123}"
  export CH_DB="${CH_DB:-ciphersentry}"
  export CH_USER="${CH_USER:-cent}"
  export CH_PASSWORD="${CH_PASSWORD:-cent}"
  export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"
  for _ in $(seq 1 40); do
    curl -sf http://127.0.0.1:8123/ping >/dev/null 2>&1 && break
    sleep 0.5
  done
  if command -v psql >/dev/null; then
    psql "$PG_DSN" -f "$ROOT/services/indexer/sql/schema.sql" >/dev/null 2>&1 || true
  else
    docker compose -f "$ROOT/cipher/docker-compose.yml" exec -T postgres \
      psql -U cent -d ciphersentry < "$ROOT/services/indexer/sql/schema.sql" >/dev/null 2>&1 || true
  fi
fi

cd "$ROOT/services"

echo "== gateway :${GATEWAY_PORT} =="
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" >/tmp/cs-demo-h.json 2>/dev/null && grep -q '"ok":true' /tmp/cs-demo-h.json && break
  sleep 0.25
done
curl -sf "$GBASE/health" >/tmp/cs-demo-h.json || { echo "gateway down"; tail -40 "$GLOG"; exit 1; }
python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-demo-h.json"))
print("  health escrow=%s batcher=%s slash=%s bus=%s" % (
  h.get("escrow"), h.get("batcher"), h.get("slash_executor"), h.get("bus")))
PY

# indexer: memory if no compose, else pg+ch
echo "== indexer :${INDEXER_PORT} =="
export INDEXER_PORT PORT=$INDEXER_PORT
export GATEWAY_URL="$GBASE"
export NODE_EVENTS="ws://127.0.0.1:${GATEWAY_PORT}/events"
if [[ "$WITH_COMPOSE" == "1" ]]; then
  unset INDEXER_MEMORY
  export INDEXER_FORCE_WS="${INDEXER_FORCE_WS:-0}"
else
  export INDEXER_MEMORY=1
  export INDEXER_FORCE_WS=1
fi
npm run indexer -w indexer >"$ILOG" 2>&1 &
IPID=$!
for _ in $(seq 1 80); do
  curl -sf "$IBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$IBASE/health" | grep -q '"ok":true' || { echo "indexer down"; tail -40 "$ILOG"; exit 1; }
echo "  indexer up"

RPC_HELPER="$ROOT/services/gateway/scripts/rpc-call.mjs"
rpc() {
  local method=$1 params=${2:-'{}'}
  node "$RPC_HELPER" "${GBASE}/rpc" "$method" "$params"
}

echo "== settle $WORKER =="
COMMIT=$(rpc task.commit "{\"spec\":\"render.sequence.4k\",\"worker\":\"$WORKER\",\"buyer\":\"$BUYER\",\"escrow\":{\"amount\":\"10.00\",\"asset\":\"USDC\"}}")
echo "$COMMIT" | tee /tmp/cs-demo-commit.json >/dev/null
TASK=$(python3 -c 'import json;print(json.load(open("/tmp/cs-demo-commit.json"))["task_id"])')
HASH=$(python3 -c 'import json;print(json.load(open("/tmp/cs-demo-commit.json"))["expected_hash"])')
[[ -n "$TASK" && -n "$HASH" ]] || { echo "commit failed: $COMMIT"; tail -30 "$GLOG"; exit 1; }
rpc task.report "{\"task_id\":\"$TASK\",\"hash\":\"$HASH\"}" >/dev/null
VERIFY=$(rpc verify "{\"task_id\":\"$TASK\"}")
echo "$VERIFY" | grep -q 'SETTLED' || { echo "verify: $VERIFY"; exit 1; }
echo "  settled $TASK"

# optional anchor when batcher write-ready
set +e
ANCHOR=$(rpc batch.anchor '{}')
set -e
echo "  anchor: $(echo "$ANCHOR" | head -c 120)"

# wait trust series when CH present
if [[ "$WITH_COMPOSE" == "1" ]]; then
  echo "== wait /trust/$WORKER =="
  for _ in $(seq 1 40); do
    TRUST=$(curl -sf "$IBASE/trust/$WORKER" || echo '{}')
    echo "$TRUST" | grep -q trust_score && break
    sleep 0.4
  done
  echo "  $TRUST"
fi

AGENT_Q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$WORKER''', safe=''))")
EXPLORER="${CIPHER_URL}/#/explorer?q=${AGENT_Q}&indexer=${IBASE}&node=${GBASE}"
CONSOLE="${CIPHER_URL}/?net=rpc&node=${GBASE}&indexer=${IBASE}"

echo ""
echo "DEMO OK"
echo "  task=$TASK worker=$WORKER"
echo "  health=$GBASE/health"
echo "  trust=$IBASE/trust/$WORKER"
echo "  explorer (agent panel + chart):"
echo "    $EXPLORER"
echo "  console:"
echo "    $CONSOLE"
echo ""
echo "Press Ctrl+C to stop gateway/indexer (compose left up if WITH_COMPOSE=1)."
# hold processes for interactive demo
while kill -0 "$GPID" 2>/dev/null; do sleep 3600; done

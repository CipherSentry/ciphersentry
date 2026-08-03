#!/usr/bin/env bash
# CipherSentry demo kit — one-command settle loop (S1.2).
#
# Zero keys (recommended first run):
#   DEMO_LOCAL=1 DEMO_HOLD=0 bash services/scripts/demo-sepolia.sh
#
# Base Sepolia mock stack:
#   cp services/scripts/demo-kit.env.example services/scripts/demo-kit.env
#   # edit PRIVATE_KEY + CHAIN_RPC
#   bash services/scripts/demo-sepolia.sh
#
# Docs: services/scripts/README.md
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
  echo "  tip: DEMO_LOCAL=1 for zero-key, or copy demo-kit.env.example → demo-kit.env"
fi

: "${GATEWAY_PORT:=$((18080 + RANDOM % 400))}"
: "${INDEXER_PORT:=$((18500 + RANDOM % 400))}"
: "${AUTH_REQUIRED:=0}"
: "${WITH_COMPOSE:=0}"
: "${CIPHER_URL:=http://127.0.0.1:5173}"
: "${WORKER:=agent:vector-7}"
: "${BUYER:=agent:atlas-01}"
: "${PROOF_WAIT_TRIES:=50}"

# DEMO_LOCAL=1 → anvil rails (no Alchemy / PRIVATE_KEY). Default for contributors.
if [[ "${DEMO_LOCAL:-0}" == "1" ]]; then
  echo "== local anvil demo (DEMO_LOCAL=1) =="
  cd "$ROOT/cipher/contracts"
  ./script/deploy-local.sh
  set -a
  # shellcheck disable=SC1091
  source deployments/.env.gateway
  set +a
  export RULER_KEY="${RULER_KEY:-$PROTOCOL_KEY}"
  cd "$ROOT"
else
  : "${CHAIN_RPC:=${BASE_SEPOLIA_RPC:-https://base-sepolia.publicnode.com}}"
  : "${CHAIN_ID:=84532}"
fi

export CHAIN_RPC CHAIN_ID BASE_SEPOLIA_RPC="${BASE_SEPOLIA_RPC:-$CHAIN_RPC}"
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT
export AUTH_REQUIRED
export BATCH_INTERVAL_MS="${BATCH_INTERVAL_MS:-0}"
export BATCH_MAX_PENDING="${BATCH_MAX_PENDING:-99}"
export TICK_MS="${TICK_MS:-60000}"
export NATS_URL="${NATS_URL:-}"
export REDIS_URL="${REDIS_URL:-}"

# load mock stack addresses if unset (sepolia path)
DEPLOY_JSON="${DEPLOY_JSON:-$ROOT/cipher/contracts/deployments/base-sepolia-mockusdc.json}"
if [[ -z "${ESCROW_ADDRESS:-}" && -f "$DEPLOY_JSON" ]]; then
  ESCROW_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['escrow'])")
  BATCHER_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['batcher'])")
  USDC_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['usdc'])")
  SLASH_EXECUTOR_ADDRESS=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON')).get('slashExecutor',''))")
  PROTOCOL_FROM=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['deployer'])")
fi
export ESCROW_ADDRESS BATCHER_ADDRESS USDC_ADDRESS SLASH_EXECUTOR_ADDRESS PROTOCOL_FROM
export CENT_ADDRESS="${CENT_ADDRESS:-}" REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"

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
export PROTOCOL_KEY

GBASE="http://127.0.0.1:${GATEWAY_PORT}"
IBASE="http://127.0.0.1:${INDEXER_PORT}"
GLOG="${TMPDIR:-/tmp}/cs-demo-gw-$$.log"
ILOG="${TMPDIR:-/tmp}/cs-demo-ix-$$.log"
STARTED_COMPOSE=0
GPID="" IPID=""

cleanup() {
  [[ -n "${IPID:-}" ]] && kill "$IPID" 2>/dev/null || true
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${GATEWAY_PORT}/tcp" 2>/dev/null || true
    fuser -k "${INDEXER_PORT}/tcp" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== Sepolia demo kit =="
echo "  rpc=$CHAIN_RPC"
echo "  escrow=${ESCROW_ADDRESS:-unset}"
echo "  slash=${SLASH_EXECUTOR_ADDRESS:-unset}"
echo "  protocol_key=${PROTOCOL_KEY:+set}"
echo "  protocol_from=${PROTOCOL_FROM:-unset}"
echo "  ports gw=$GATEWAY_PORT ix=$INDEXER_PORT"
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
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${GATEWAY_PORT}/tcp" 2>/dev/null || true
  fuser -k "${INDEXER_PORT}/tcp" 2>/dev/null || true
fi

echo "== gateway :${GATEWAY_PORT} =="
# explicit env for chain write path
env \
  CHAIN_RPC="$CHAIN_RPC" CHAIN_ID="$CHAIN_ID" \
  ESCROW_ADDRESS="$ESCROW_ADDRESS" BATCHER_ADDRESS="$BATCHER_ADDRESS" \
  USDC_ADDRESS="${USDC_ADDRESS:-}" SLASH_EXECUTOR_ADDRESS="${SLASH_EXECUTOR_ADDRESS:-}" \
  PROTOCOL_KEY="${PROTOCOL_KEY:-}" PROTOCOL_FROM="${PROTOCOL_FROM:-}" \
  RULER_KEY="${RULER_KEY:-}" \
  BATCHER_KEY_1="${BATCHER_KEY_1:-}" BATCHER_KEY_2="${BATCHER_KEY_2:-}" BATCHER_KEY_3="${BATCHER_KEY_3:-}" \
  GATEWAY_HOST=127.0.0.1 GATEWAY_PORT="$GATEWAY_PORT" \
  AUTH_REQUIRED="$AUTH_REQUIRED" BATCH_INTERVAL_MS="$BATCH_INTERVAL_MS" \
  BATCH_MAX_PENDING="$BATCH_MAX_PENDING" TICK_MS="$TICK_MS" \
  NATS_URL="${NATS_URL:-}" REDIS_URL="${REDIS_URL:-}" \
  npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" >/tmp/cs-demo-h.json 2>/dev/null && grep -q '"ok":true' /tmp/cs-demo-h.json && break
  sleep 0.25
done
curl -sf "$GBASE/health" >/tmp/cs-demo-h.json || { echo "gateway down"; tail -40 "$GLOG"; exit 1; }
python3 - <<PY
import json, sys
h=json.load(open("/tmp/cs-demo-h.json"))
print("  health escrow=%s batcher=%s slash=%s bus=%s" % (
  h.get("escrow"), h.get("batcher"), h.get("slash_executor"), h.get("bus")))
# local/write demos should be write-ready when PROTOCOL_KEY + addresses set
if "${DEMO_LOCAL:-0}" == "1":
    for k in ("escrow", "batcher", "slash_executor"):
        m = str(h.get(k, "")).lower()
        if "write" not in m and m not in ("write-ready",):
            print(f"FATAL: {k}={h.get(k)} on DEMO_LOCAL (want write-ready)", file=sys.stderr)
            sys.exit(1)
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
TASK=$(python3 -c 'import json;print(json.load(open("/tmp/cs-demo-commit.json")).get("task_id",""))')
HASH=$(python3 -c 'import json;print(json.load(open("/tmp/cs-demo-commit.json")).get("expected_hash",""))')
TX_COMMIT=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/cs-demo-commit.json"))
# chain: { tx, mode, ... } or flat tx
c=d.get("chain") or {}
print(c.get("tx") or c.get("txHash") or d.get("tx") or "")
PY
)
[[ -n "$TASK" && -n "$HASH" ]] || { echo "commit failed: $COMMIT"; tail -30 "$GLOG"; exit 1; }
echo "  task=$TASK"
echo "  tx_commit=${TX_COMMIT:-n/a}"

# Serialize L2 writes — EIP-7702 delegated EOAs hit Alchemy in-flight limits
sleep "${CHAIN_TX_GAP_SEC:-3}"

rpc task.report "{\"task_id\":\"$TASK\",\"hash\":\"$HASH\"}" >/dev/null
VERIFY=$(rpc verify "{\"task_id\":\"$TASK\"}")
echo "$VERIFY" | tee /tmp/cs-demo-verify.json >/dev/null
echo "$VERIFY" | grep -q 'SETTLED' || { echo "verify: $VERIFY"; exit 1; }
TX_SETTLE=$(python3 - <<'PY'
import json
d=json.load(open("/tmp/cs-demo-verify.json"))
print(d.get("tx") or (d.get("chain") or {}).get("tx") or "")
PY
)
echo "  settled $TASK  tx_settle=${TX_SETTLE:-n/a}"

sleep "${CHAIN_TX_GAP_SEC:-3}"

# anchor when batcher write-ready (required for merkle proofs)
set +e
ANCHOR=$(rpc batch.anchor '{}')
set -e
echo "$ANCHOR" | tee /tmp/cs-demo-anchor.json >/dev/null
echo "  anchor: $(echo "$ANCHOR" | head -c 160)"
TX_ANCHOR=$(python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/cs-demo-anchor.json"))
except Exception:
  d={}
print(
  d.get("txHash")
  or d.get("tx")
  or (d.get("chain") or {}).get("txHash")
  or (d.get("chain") or {}).get("tx")
  or ""
)
PY
)
ROOT=$(python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/cs-demo-anchor.json"))
except Exception:
  d={}
print(d.get("root") or "")
PY
)

# wait indexer ingest + proof.valid
echo "== wait proof /receipts/$TASK/proof =="
PROOF_OK=0
PROOF_JSON="{}"
for _ in $(seq 1 "$PROOF_WAIT_TRIES"); do
  PROOF_JSON=$(curl -sf "$IBASE/receipts/$TASK/proof" 2>/dev/null || echo '{}')
  if echo "$PROOF_JSON" | grep -q '"valid"[[:space:]]*:[[:space:]]*true'; then
    PROOF_OK=1
    break
  fi
  # also accept nested valid
  if python3 -c "import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d.get('valid') is True or (d.get('proof') or {}).get('valid') is True else 1)" "$PROOF_JSON" 2>/dev/null; then
    PROOF_OK=1
    break
  fi
  sleep 0.4
done
if [[ "$PROOF_OK" != "1" ]]; then
  echo "FATAL: proof not valid for task=$TASK" >&2
  echo "  proof=$PROOF_JSON" >&2
  echo "  batches=$(curl -sf "$IBASE/batches" 2>/dev/null | head -c 300)" >&2
  echo "  stats=$(curl -sf "$IBASE/stats" 2>/dev/null)" >&2
  exit 1
fi
echo "  proof valid"

# wait trust series when CH present
TRUST="{}"
if [[ "$WITH_COMPOSE" == "1" ]]; then
  echo "== wait /trust/$WORKER =="
  for _ in $(seq 1 40); do
    TRUST=$(curl -sf "$IBASE/trust/$WORKER" || echo '{}')
    echo "$TRUST" | grep -q trust_score && break
    sleep 0.4
  done
  echo "  $TRUST"
fi

# deep links — hash-router form (S1.1 livePath)
eval "$(python3 - <<PY
from urllib.parse import urlencode, quote
cipher = """$CIPHER_URL""".rstrip("/")
g = """$GBASE"""
i = """$IBASE"""
task = """$TASK"""
worker = """$WORKER"""
console = f"{cipher}/#/app?" + urlencode({"net": "rpc", "auth": "1", "node": g, "indexer": i})
explorer = f"{cipher}/#/explorer?" + urlencode({"q": task, "indexer": i, "node": g})
explorer_agent = f"{cipher}/#/explorer?" + urlencode({"q": worker, "indexer": i, "node": g})
print(f"CONSOLE={console!r}")
print(f"EXPLORER={explorer!r}")
print(f"EXPLORER_AGENT={explorer_agent!r}")
PY
)"

echo ""
echo "========================================"
echo " DEMO OK"
echo "========================================"
echo "  TASK       $TASK"
echo "  WORKER     $WORKER"
echo "  ROOT       ${ROOT:-n/a}"
echo "  TX_COMMIT  ${TX_COMMIT:-n/a}"
echo "  TX_SETTLE  ${TX_SETTLE:-n/a}"
echo "  TX_ANCHOR  ${TX_ANCHOR:-n/a}"
echo ""
echo "  GATEWAY    $GBASE"
echo "  INDEXER    $IBASE"
echo "  CONSOLE    $CONSOLE"
echo "  EXPLORER   $EXPLORER"
echo "  EXPLORER   $EXPLORER_AGENT   # agent trust"
echo "========================================"
echo ""
if [[ "${DEMO_HOLD:-1}" == "0" ]]; then
  echo "DEMO_HOLD=0 — exiting (gateway/indexer stopped)."
  exit 0
fi
echo "Press Ctrl+C to stop gateway/indexer (compose left up if WITH_COMPOSE=1)."
# hold processes for interactive demo
while kill -0 "$GPID" 2>/dev/null; do sleep 3600; done

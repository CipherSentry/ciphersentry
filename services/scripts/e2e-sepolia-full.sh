#!/usr/bin/env bash
# Base Sepolia full write path (NOT CI) — requires demo-kit.env
#   commit → settle → batch.anchor → slash.submit → processNext → CH trust
#
#   set -a && source services/scripts/demo-kit.env && set +a
#   bash services/scripts/e2e-sepolia-full.sh
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

: "${PRIVATE_KEY:?set PRIVATE_KEY (deployer)}"
: "${CHAIN_RPC:=${BASE_SEPOLIA_RPC:?set CHAIN_RPC}}"
export BASE_SEPOLIA_RPC="${BASE_SEPOLIA_RPC:-$CHAIN_RPC}"
export CHAIN_RPC CHAIN_ID="${CHAIN_ID:-84532}"

DEPLOY_JSON="${DEPLOY_JSON:-$ROOT/cipher/contracts/deployments/base-sepolia-mockusdc.json}"
test -f "$DEPLOY_JSON"

ESCROW=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['escrow'])")
BATCHER=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['batcher'])")
USDC=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['usdc'])")
CENT=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['cent'])")
REGISTRY=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['registry'])")
SLASH=$(python3 -c "import json;print(json.load(open('$DEPLOY_JSON'))['slashExecutor'])")
FROM=$(cast wallet address --private-key "$PRIVATE_KEY")

# anvil #1 — batcher signer + bonded slash target
KEY1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
KEY2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
ADDR1=$(cast wallet address --private-key "$KEY1")

export ESCROW_ADDRESS="$ESCROW" BATCHER_ADDRESS="$BATCHER" USDC_ADDRESS="$USDC"
export SLASH_EXECUTOR_ADDRESS="$SLASH" CENT_ADDRESS="$CENT" REGISTRY_ADDRESS="$REGISTRY"
export PROTOCOL_KEY="$PRIVATE_KEY" PROTOCOL_FROM="$FROM" RULER_KEY="$PRIVATE_KEY"
export BATCHER_KEY_1="$PRIVATE_KEY" BATCHER_KEY_2="$KEY1" BATCHER_KEY_3="$KEY2"
export PRIVATE_KEY

u256() { awk '{print $1}'; }

# serialize L2 sends — Alchemy rejects underpriced replacements on same nonce
send() {
  cast send "$@" --rpc-url "$CHAIN_RPC" \
    --priority-gas-price "${PRIORITY_GAS:-2gwei}" \
    --gas-price "${GAS_PRICE:-10gwei}" >/dev/null
  sleep 1.5
}

echo "== Sepolia full e2e =="
echo "  from=$FROM"
echo "  slash_target=$ADDR1"
echo "  eth=$(cast balance "$FROM" --rpc-url "$CHAIN_RPC")"
# wait for quiet nonce
for _ in $(seq 1 20); do
  L=$(cast nonce "$FROM" --rpc-url "$CHAIN_RPC")
  P=$(cast nonce "$FROM" --rpc-url "$CHAIN_RPC" --block pending)
  [[ "$L" == "$P" ]] && break
  sleep 2
done

echo "== fund: mint USDC + approve escrow =="
send "$USDC" "mint(address,uint256)" "$FROM" 10000000000 --private-key "$PRIVATE_KEY"
send "$USDC" "approve(address,uint256)" "$ESCROW" \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$PRIVATE_KEY"

echo "== B3: CENT approve slash + bond target (anvil#1) =="
MAX=0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
BOND=25000000000000000000000   # 25k CENT
SEED=30000000000000000000000   # 30k CENT
# watcher (deployer) approve challenge bond
send "$CENT" "approve(address,uint256)" "$SLASH" "$MAX" --private-key "$PRIVATE_KEY"
# gas for target
BAL1=$(cast balance "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
if [[ "${BAL1:-0}" -lt 1000000000000000 ]]; then
  send "$ADDR1" --value 0.005ether --private-key "$PRIVATE_KEY"
fi
# seed + stake target if under floor (jailed seats cannot stake/topUp)
# uint256 bonds exceed bash int — compare in python
CUR=$(cast call "$REGISTRY" "bondOf(address)(uint256)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
ST=$(cast call "$REGISTRY" "statusOf(address)(uint8)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
# Status: None=0 Bonded=1 Unbonding=2 Jailed=3
NEED_STAKE=$(python3 -c "print(1 if int('${ST:-0}')!=3 and int('${CUR:-0}')<int('$BOND') else 0)")
if [[ "$ST" == "3" ]]; then
  HAS_BOND=$(python3 -c "print(1 if int('${CUR:-0}')>0 else 0)")
  if [[ "$HAS_BOND" == "1" ]]; then
    echo "  target jailed with residual bond=$CUR — reusing for slash"
  else
    KEY1="$KEY2"
    ADDR1=$(cast wallet address --private-key "$KEY1")
    echo "  target rotated to $ADDR1 (prior jailed empty)"
    CUR=$(cast call "$REGISTRY" "bondOf(address)(uint256)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
    ST=$(cast call "$REGISTRY" "statusOf(address)(uint8)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
    NEED_STAKE=$(python3 -c "print(1 if int('${ST:-0}')!=3 and int('${CUR:-0}')<int('$BOND') else 0)")
  fi
fi
if [[ "$NEED_STAKE" == "1" ]]; then
  # gas for target
  BAL1=$(cast balance "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
  NEED_ETH=$(python3 -c "print(1 if int('${BAL1:-0}')<10**15 else 0)")
  if [[ "$NEED_ETH" == "1" ]]; then
    send "$ADDR1" --value 0.005ether --private-key "$PRIVATE_KEY"
  fi
  send "$CENT" "transfer(address,uint256)" "$ADDR1" "$SEED" --private-key "$PRIVATE_KEY"
  send "$CENT" "approve(address,uint256)" "$REGISTRY" "$MAX" --private-key "$KEY1"
  send "$REGISTRY" "stake(uint256)" "$BOND" --private-key "$KEY1"
fi
echo "  target bond=$(cast call "$REGISTRY" "bondOf(address)(uint256)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)"

# optional compose for trust
WITH_COMPOSE="${WITH_COMPOSE:-1}"
GPORT="${GPORT:-$((19000 + RANDOM % 300))}"
IPORT="${IPORT:-$((19300 + RANDOM % 300))}"
GBASE="http://127.0.0.1:${GPORT}"
IBASE="http://127.0.0.1:${IPORT}"
GLOG="${TMPDIR:-/tmp}/cs-sep-full-gw-$$.log"
ILOG="${TMPDIR:-/tmp}/cs-sep-full-ix-$$.log"
GPID="" IPID=""

cleanup() {
  [[ -n "${IPID:-}" ]] && kill "$IPID" 2>/dev/null || true
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  command -v fuser >/dev/null && fuser -k "${GPORT}/tcp" 2>/dev/null || true
  command -v fuser >/dev/null && fuser -k "${IPORT}/tcp" 2>/dev/null || true
}
trap cleanup EXIT

if [[ "$WITH_COMPOSE" == "1" ]] && command -v docker >/dev/null; then
  echo "== compose pg+ch+nats =="
  docker compose -f "$ROOT/cipher/docker-compose.yml" up -d postgres clickhouse nats >/dev/null
  export PG_DSN="${PG_DSN:-postgres://cent:cent@127.0.0.1:5432/ciphersentry}"
  export CH_URL="${CH_URL:-http://127.0.0.1:8123}" CH_DB="${CH_DB:-ciphersentry}"
  export CH_USER="${CH_USER:-cent}" CH_PASSWORD="${CH_PASSWORD:-cent}"
  export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"
  for _ in $(seq 1 40); do curl -sf http://127.0.0.1:8123/ping >/dev/null && break; sleep 0.3; done
  if command -v psql >/dev/null; then
    psql "$PG_DSN" -f "$ROOT/services/indexer/sql/schema.sql" >/dev/null 2>&1 || true
  else
    docker compose -f "$ROOT/cipher/docker-compose.yml" exec -T postgres \
      psql -U cent -d ciphersentry < "$ROOT/services/indexer/sql/schema.sql" >/dev/null 2>&1 || true
  fi
else
  export NATS_URL="${NATS_URL:-}"
  WITH_COMPOSE=0
fi

cd "$ROOT/services"
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000 AUTH_REQUIRED=0 REDIS_URL=

echo "== gateway :$GPORT =="
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" >/tmp/cs-sep-h.json 2>/dev/null && grep -q '"ok":true' /tmp/cs-sep-h.json && break
  sleep 0.25
done
python3 - <<'PY'
import json,sys
h=json.load(open("/tmp/cs-sep-h.json"))
print("  health", {k:h.get(k) for k in ("escrow","batcher","slash_executor","bus")})
for k in ("escrow","batcher","slash_executor"):
  assert "write" in str(h.get(k,"")).lower(), h
PY

RPC_HELPER="$ROOT/services/gateway/scripts/rpc-call.mjs"
rpc() {
  local method=$1
  local params=${2:-'{}'}
  node "$RPC_HELPER" "${GBASE}/rpc" "$method" "$params"
}

if [[ "$WITH_COMPOSE" == "1" ]]; then
  echo "== indexer :$IPORT =="
  export INDEXER_PORT=$IPORT PORT=$IPORT GATEWAY_URL="$GBASE"
  export NODE_EVENTS="ws://127.0.0.1:${GPORT}/events"
  unset INDEXER_MEMORY
  export INDEXER_FORCE_WS=0 INDEXER_REQUIRE_NATS="${INDEXER_REQUIRE_NATS:-0}"
  npm run indexer -w indexer >"$ILOG" 2>&1 &
  IPID=$!
  for _ in $(seq 1 80); do curl -sf "$IBASE/health" | grep -q '"ok":true' && break; sleep 0.25; done
  echo "  indexer up"
fi

echo "== settle + on-chain commit =="
# wait nonce quiet
sleep 2
C=$(rpc task.commit '{"spec":"render.sequence.4k","worker":"agent:vector-7","buyer":"agent:atlas-01","escrow":{"amount":"2.00","asset":"USDC"}}')
echo "$C" | tee /tmp/cs-sep-commit.json >/dev/null
python3 - <<'PY'
import json
c=json.load(open("/tmp/cs-sep-commit.json"))
ch=c.get("chain") or {}
assert ch.get("mode")=="submitted" and ch.get("tx"), c
open("/tmp/cs-sep-commit-tx.txt","w").write(ch["tx"])
print("  commit", ch["tx"][:18], "task", c["task_id"])
PY
TID=$(python3 -c 'import json;print(json.load(open("/tmp/cs-sep-commit.json"))["task_id"])')
HASH=$(python3 -c 'import json;print(json.load(open("/tmp/cs-sep-commit.json"))["expected_hash"])')
cast receipt "$(cat /tmp/cs-sep-commit-tx.txt)" --rpc-url "$CHAIN_RPC" >/dev/null
rpc task.report "{\"task_id\":\"$TID\",\"hash\":\"$HASH\"}" >/dev/null
V=$(rpc verify "{\"task_id\":\"$TID\"}")
echo "$V" | grep -q SETTLED || { echo "verify fail $V"; exit 1; }
echo "  settled $TID"

echo "== batch.anchor =="
sleep 2
A=$(rpc batch.anchor '{}')
echo "$A" | tee /tmp/cs-sep-anchor.json >/dev/null
python3 - <<'PY'
import json
a=json.load(open("/tmp/cs-sep-anchor.json"))
assert a.get("mode")=="submitted", a
assert a.get("txHash"), a
open("/tmp/cs-sep-anchor-tx.txt","w").write(a["txHash"])
print("  anchor", a["txHash"][:18], "root", a["root"][:18])
PY
cast receipt "$(cat /tmp/cs-sep-anchor-tx.txt)" --rpc-url "$CHAIN_RPC" >/dev/null

echo "== slash.submit + processNext =="
# wait gateway/chain nonce to settle (avoids underpriced replacement)
for _ in $(seq 1 25); do
  L=$(cast nonce "$FROM" --rpc-url "$CHAIN_RPC")
  P=$(cast nonce "$FROM" --rpc-url "$CHAIN_RPC" --block pending)
  [[ "$L" == "$P" ]] && break
  sleep 2
done
sleep 2
BEFORE=$(cast call "$REGISTRY" "bondOf(address)(uint256)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
EVID=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
# cast path — explicit gas, more reliable than viem under mempool pressure
# submitEvidence(bytes32,address,uint8)
STX=$(cast send "$SLASH" "submitEvidence(bytes32,address,uint8)" \
  "0x${EVID}" "$ADDR1" 0 \
  --rpc-url "$CHAIN_RPC" --private-key "$PRIVATE_KEY" \
  --priority-gas-price "${PRIORITY_GAS:-2gwei}" --gas-price "${GAS_PRICE:-6gwei}" \
  --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')
echo "$STX" | tee /tmp/cs-sep-slash-tx.txt >/dev/null
cast receipt "$STX" --rpc-url "$CHAIN_RPC" >/dev/null
echo "  slash $STX"
# drain queue + poll bond cut (L2/RPC lag; EpochCapExceeded retries next loop)
AFTER="$BEFORE"
for i in $(seq 1 10); do
  Q=$(cast call "$SLASH" "challengeCount()(uint256)" --rpc-url "$CHAIN_RPC" | u256)
  AFTER=$(cast call "$REGISTRY" "bondOf(address)(uint256)" "$ADDR1" --rpc-url "$CHAIN_RPC" | u256)
  CUT=$(python3 -c "print(1 if int('${AFTER:-0}')<int('${BEFORE:-0}') else 0)")
  [[ "$CUT" == "1" ]] && break
  if [[ "${Q:-0}" != "0" ]]; then
    echo "  processNext try=$i queue=$Q"
    cast send "$SLASH" "processNext()" \
      --rpc-url "$CHAIN_RPC" --private-key "$PRIVATE_KEY" \
      --priority-gas-price "${PRIORITY_GAS:-2gwei}" --gas-price "${GAS_PRICE:-10gwei}" >/dev/null \
      || echo "  processNext revert (epoch cap?) — retry"
    sleep 2
  else
    # receipt lag: count may lag; wait and re-check
    echo "  wait bond/queue try=$i bond=$AFTER"
    sleep 2
  fi
done
python3 - <<PY
b,a=int("$BEFORE"),int("$AFTER")
assert b>0 and a<b, (b,a)
print(f"  bond cut {b} → {a}")
PY

if [[ "$WITH_COMPOSE" == "1" ]]; then
  echo "== trust /trust/agent:vector-7 =="
  TRUST=""
  for _ in $(seq 1 40); do
    TRUST=$(curl -sf "$IBASE/trust/agent:vector-7" || echo '{}')
    echo "$TRUST" | grep -q trust_score && break
    sleep 0.4
  done
  echo "  $TRUST"
  echo "$TRUST" | grep -q trust_score || { echo "trust miss"; tail -30 "$ILOG"; exit 1; }
  EXPLORER="http://127.0.0.1:5173/#/explorer?q=agent%3Avector-7&indexer=${IBASE}&node=${GBASE}"
  echo "  explorer $EXPLORER"
fi

echo ""
echo "SEPOLIA full e2e OK"
echo "  commit=$(cat /tmp/cs-sep-commit-tx.txt)"
echo "  anchor=$(cat /tmp/cs-sep-anchor-tx.txt)"
echo "  slash=$(cat /tmp/cs-sep-slash-tx.txt)"
echo "  task=$TID"

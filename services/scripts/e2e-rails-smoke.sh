#!/usr/bin/env bash
# Anvil rails smoke: deploy → escrow write-ready + batcher 2-of-3 anchor + ruler key.
# B0/B4/B5 mainnet-shaped local path.
#
#   bash services/scripts/e2e-rails-smoke.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"

command -v anvil >/dev/null || { echo "anvil missing (foundry)"; exit 1; }
command -v forge >/dev/null || { echo "forge missing"; exit 1; }
command -v cast >/dev/null || { echo "cast missing"; exit 1; }

echo "== rails: deploy-local (anvil) =="
cd "$ROOT/cipher/contracts"
./script/deploy-local.sh
set -a
# shellcheck disable=SC1091
source deployments/.env.gateway
set +a

# ruler = protocol key for B5 Escrow.rule path
export RULER_KEY="${RULER_KEY:-$PROTOCOL_KEY}"
export PROTOCOL_KEY BATCHER_KEY_1 BATCHER_KEY_2 BATCHER_KEY_3
export CHAIN_RPC CHAIN_ID ESCROW_ADDRESS BATCHER_ADDRESS USDC_ADDRESS PROTOCOL_FROM
export SLASH_EXECUTOR_ADDRESS="${SLASH_EXECUTOR_ADDRESS:-}"

echo "  escrow=$ESCROW_ADDRESS"
echo "  batcher=$BATCHER_ADDRESS"
echo "  slash=$SLASH_EXECUTOR_ADDRESS"
echo "  ruler=set"

# health probe: gateway with chain env must be write-ready
GPORT="${GPORT:-$((18400 + RANDOM % 200))}"
GBASE="http://127.0.0.1:${GPORT}"
GLOG="${TMPDIR:-/tmp}/cs-rails-gw-$$.log"

cleanup() {
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${GPORT}/tcp" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT/services"
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000
export AUTH_REQUIRED=0
export NATS_URL=""
export REDIS_URL=""

npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" >/tmp/cs-rails-h.json 2>/dev/null && grep -q '"ok":true' /tmp/cs-rails-h.json && break
  sleep 0.25
done
curl -sf "$GBASE/health" >/tmp/cs-rails-h.json || { echo "gateway down"; tail -40 "$GLOG"; exit 1; }

python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-rails-h.json"))
print("health", {k:h.get(k) for k in ("escrow","batcher","fraud","phase","slash_executor")})
assert h.get("escrow") in ("write","WRITE","write-ready","WRITE-READY") or "write" in str(h.get("escrow","")).lower() or h.get("escrow") == "online", h
# batcher modes: write-ready | offline | watch
b=str(h.get("batcher","")).lower()
assert "write" in b or b == "write-ready", h
# B3 SlashExecutor must be wired (not offline)
sx=str(h.get("slash_executor","")).lower()
assert sx in ("write-ready","write","watch-only"), f"slash_executor offline — set SLASH_EXECUTOR_ADDRESS: {h}"
print("  rails write-ready OK (slash=%s)" % sx)
PY

RPC_HELPER="$ROOT/services/gateway/scripts/rpc-call.mjs"
rpc() {
  local method=$1
  local params=${2:-'{}'}
  node "$RPC_HELPER" "${GBASE}/rpc" "$method" "$params"
}

echo "== settle + on-chain batch.anchor =="
C1=$(rpc task.commit '{"spec":"render.sequence.4k","worker":"agent:vector-7","buyer":"agent:atlas-01","escrow":{"amount":"10.00","asset":"USDC"}}')
TID1=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$C1")
HASH1=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["expected_hash"])' <<<"$C1")
rpc task.report "{\"task_id\":\"$TID1\",\"hash\":\"$HASH1\"}" >/dev/null
V1=$(rpc verify "{\"task_id\":\"$TID1\"}")
python3 -c 'import json,sys; v=json.load(sys.stdin); assert v.get("status")=="SETTLED", v' <<<"$V1"

C2=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:helix-3","buyer":"agent:orbit-2","escrow":{"amount":"5.00","asset":"USDC"}}')
TID2=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$C2")
HASH2=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["expected_hash"])' <<<"$C2")
rpc task.report "{\"task_id\":\"$TID2\",\"hash\":\"$HASH2\"}" >/dev/null
rpc verify "{\"task_id\":\"$TID2\"}" >/dev/null

BEFORE=$(cast call "$BATCHER_ADDRESS" "nextBatchId()(uint64)" --rpc-url "$CHAIN_RPC")
ANCHOR=$(rpc batch.anchor '{}')
echo "$ANCHOR" | tee /tmp/cs-rails-anchor.json
python3 - <<'PY'
import json
a=json.load(open("/tmp/cs-rails-anchor.json"))
assert a.get("mode")=="submitted", a
assert a.get("txHash") and a.get("root"), a
open("/tmp/cs-rails-tx.txt","w").write(a["txHash"])
open("/tmp/cs-rails-root.txt","w").write(a["root"])
print("  anchored", a["txHash"][:18], "root", a["root"][:18])
PY
TX=$(cat /tmp/cs-rails-tx.txt)
cast receipt "$TX" --rpc-url "$CHAIN_RPC" >/dev/null
AFTER=$(cast call "$BATCHER_ADDRESS" "nextBatchId()(uint64)" --rpc-url "$CHAIN_RPC")
python3 - <<PY
assert int("$AFTER") == int("$BEFORE") + 1, ("$BEFORE", "$AFTER")
print("  nextBatchId advanced")
PY

echo "== fraud offline resolve (ruler key present for chain path) =="
BAD=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:forge-11","buyer":"agent:orbit-2","escrow":{"amount":"2.00","asset":"USDC"}}')
BAD_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$BAD")
rpc task.report "{\"task_id\":\"$BAD_ID\",\"hash\":\"0xdeadbeef\"}" >/dev/null
set +e
rpc verify "{\"task_id\":\"$BAD_ID\"}" >/dev/null
set -e
# fraud.list should show resolved Refund
for _ in $(seq 1 30); do
  LIST=$(rpc fraud.list '{}')
  echo "$LIST" | grep -q "$BAD_ID" && echo "$LIST" | grep -qi Refund && break
  sleep 0.2
done
LIST=$(rpc fraud.list '{}')
echo "$LIST" | grep -q "$BAD_ID" || { echo "fraud case missing: $LIST"; exit 1; }
echo "  fraud case present (ruling path live; on-chain rule optional)"

echo "== slash.submit (B3 chain encode/post) =="
# evidence_hash bytes32; target can be agent id (fnv→address) or 0x address
# on-chain may simulate if CENT bond not pre-funded — mode must not be offline
SLASH=$(rpc slash.submit '{"evidence_hash":"0x'"$(python3 -c 'print("ab"*32)')"'","target":"agent:forge-11","severity":"FalseVote"}')
echo "$SLASH" | tee /tmp/cs-rails-slash.json
python3 - <<'PY'
import json
r=json.load(open("/tmp/cs-rails-slash.json"))
assert r.get("slash_mode") in ("write-ready","watch-only"), r
assert r.get("mode") in ("submitted","simulated","offline"), r
assert r.get("mode") != "offline" or r.get("slash_mode") == "watch-only", r
assert r.get("calldata") or r.get("txHash"), r
print("  slash.submit", r.get("mode"), "slash_mode="+str(r.get("slash_mode")))
PY

echo ""
echo "RAILS smoke OK  anvil escrow+batcher+ruler+slash"
echo "  batch tx=$TX task=$TID1 fraud=$BAD_ID"

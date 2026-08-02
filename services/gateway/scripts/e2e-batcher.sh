#!/usr/bin/env bash
# B4 end-to-end: anvil deploy → gateway write-ready batcher → settle → anchorRoot on-chain
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEY1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
KEY2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
GPORT=18080
BASE="http://127.0.0.1:${GPORT}"

echo "== deploy local stack =="
cd "$ROOT/cipher/contracts"
./script/deploy-local.sh
set -a
# shellcheck disable=SC1091
source deployments/.env.gateway
set +a

BATCHER="$BATCHER_ADDRESS"
echo "batcher=$BATCHER"

echo "== start gateway =="
cd "$ROOT/services"
export GATEWAY_PORT=$GPORT GATEWAY_HOST=127.0.0.1
export BATCHER_KEY_1=$KEY0 BATCHER_KEY_2=$KEY1 BATCHER_KEY_3=$KEY2
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99
# chain env from deploy
export CHAIN_RPC CHAIN_ID ESCROW_ADDRESS BATCHER_ADDRESS USDC_ADDRESS PROTOCOL_FROM PROTOCOL_KEY

npm run gateway -w gateway >/tmp/gateway-b4.log 2>&1 &
GWPID=$!
cleanup() {
  kill "$GWPID" 2>/dev/null || true
}
trap cleanup EXIT

for i in $(seq 1 60); do
  if curl -s "$BASE/health" | grep -q '"ok":true'; then break; fi
  if ! kill -0 "$GWPID" 2>/dev/null; then
    echo "gateway died"; cat /tmp/gateway-b4.log; exit 1
  fi
  sleep 0.25
done
curl -s "$BASE/health" | tee /tmp/b4-health.json
echo
python3 - <<'PY'
import json
h=json.load(open("/tmp/b4-health.json"))
assert h.get("phase")=="B4", h
assert h.get("batcher")=="write-ready", h
print("health OK", h["batcher"], h["escrow"])
PY

RPC_HELPER="$ROOT/services/gateway/scripts/rpc-call.mjs"
rpc() {
  # usage: rpc method [json-params]
  local method=$1
  local params=${2:-'{}'}
  node "$RPC_HELPER" "${BASE}/rpc" "$method" "$params"
}

echo "== settle two tasks =="
C1=$(rpc task.commit '{"spec":"render.sequence.4k","worker":"agent:vector-7","buyer":"agent:atlas-01","escrow":{"amount":"10.00","asset":"USDC"}}')
echo "$C1" | tee /tmp/b4-c1.json
TID1=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$C1")
HASH1=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["expected_hash"])' <<<"$C1")
rpc task.report "{\"task_id\":\"$TID1\",\"hash\":\"$HASH1\"}" >/dev/null
V1=$(rpc verify "{\"task_id\":\"$TID1\"}")
echo "$V1" | tee /tmp/b4-v1.json
python3 - <<'PY'
import json
v=json.load(open("/tmp/b4-v1.json"))
assert v.get("status")=="SETTLED", v
assert v.get("batch",{}).get("leaf"), v
print("verify1 leaf", v["batch"]["leaf"][:18], "pending", v["batch"]["pending"])
PY

C2=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:helix-3","buyer":"agent:orbit-2","escrow":{"amount":"5.00","asset":"USDC"}}')
TID2=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$C2")
HASH2=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["expected_hash"])' <<<"$C2")
rpc task.report "{\"task_id\":\"$TID2\",\"hash\":\"$HASH2\"}" >/dev/null
rpc verify "{\"task_id\":\"$TID2\"}" >/dev/null

PENDING=$(rpc batch.pending '{}')
echo "$PENDING" | tee /tmp/b4-pending.json
python3 - <<'PY'
import json
p=json.load(open("/tmp/b4-pending.json"))
assert p["count"] >= 2, p
print("pending OK", p["count"])
PY

BEFORE=$(cast call "$BATCHER" "nextBatchId()(uint64)" --rpc-url "$CHAIN_RPC")
echo "nextBatchId before=$BEFORE"

echo "== batch.anchor =="
ANCHOR=$(rpc batch.anchor '{}')
echo "$ANCHOR" | tee /tmp/b4-anchor.json
python3 - <<'PY'
import json,sys
a=json.load(open("/tmp/b4-anchor.json"))
print("anchor", a)
assert a.get("mode")=="submitted", a
assert a.get("txHash"), a
assert a.get("root"), a
open("/tmp/b4-tx.txt","w").write(a["txHash"])
open("/tmp/b4-root.txt","w").write(a["root"])
print("submitted OK")
PY

TX=$(cat /tmp/b4-tx.txt)
ROOT=$(cat /tmp/b4-root.txt)
echo "tx=$TX root=$ROOT"
cast receipt "$TX" --rpc-url "$CHAIN_RPC" | head -25

AFTER=$(cast call "$BATCHER" "nextBatchId()(uint64)" --rpc-url "$CHAIN_RPC")
echo "nextBatchId after=$AFTER"
python3 - <<PY
before=int("$BEFORE")
after=int("$AFTER")
assert after == before + 1, (before, after)
print("batch id advanced OK")
PY

# on-chain storage check
STORED=$(cast call "$BATCHER" "batches(uint64)(bytes32,uint32,uint64,address,bool)" "$BEFORE" --rpc-url "$CHAIN_RPC")
echo "batches($BEFORE)=$STORED"
python3 - <<PY
stored = """$STORED""".strip().split()
root = open("/tmp/b4-root.txt").read().strip().lower()
# cast prints multi-line fields
flat = " ".join("""$STORED""".split()).lower()
assert root in flat, (root, flat)
print("on-chain root matches")
PY

cast logs --from-block 0 --to-block latest \
  --address "$BATCHER" \
  "BatchAnchored(uint64,bytes32,uint32,address,bool)" \
  --rpc-url "$CHAIN_RPC" | tee /tmp/b4-logs.txt
test -s /tmp/b4-logs.txt

echo ""
echo "B4 anvil E2E OK — root $ROOT anchored in $TX"

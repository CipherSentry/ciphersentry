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
export CENT_ADDRESS="${CENT_ADDRESS:-}"
export REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"
export SLASH_TARGET="${SLASH_TARGET:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
export ESCROW_WORKER_KEY="${ESCROW_WORKER_KEY:-}"
export ESCROW_VERIFIER_KEY_1="${ESCROW_VERIFIER_KEY_1:-}"
export ESCROW_VERIFIER_KEY_2="${ESCROW_VERIFIER_KEY_2:-}"
export FRAUD_AUTO_RULE="${FRAUD_AUTO_RULE:-1}"

echo "  escrow=$ESCROW_ADDRESS"
echo "  batcher=$BATCHER_ADDRESS"
echo "  slash=$SLASH_EXECUTOR_ADDRESS"
echo "  slash_target=$SLASH_TARGET"
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

echo "== fraud on-chain resolve (dispute drive + Escrow.rule) =="
BAD=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:forge-11","buyer":"agent:orbit-2","escrow":{"amount":"2.00","asset":"USDC"}}')
echo "$BAD" | tee /tmp/cs-rails-bad-commit.json
BAD_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$BAD")
python3 - <<'PY'
import json
c=json.load(open("/tmp/cs-rails-bad-commit.json"))
ch=c.get("chain") or {}
assert ch.get("mode")=="submitted", c
assert ch.get("chain_task_id"), f"missing chain_task_id: {c}"
open("/tmp/cs-rails-chain-tid.txt","w").write(ch["chain_task_id"])
print("  chain_task_id", ch["chain_task_id"][:18])
PY
rpc task.report "{\"task_id\":\"$BAD_ID\",\"hash\":\"0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\"}" >/dev/null
set +e
VERIFY_ERR=$(rpc verify "{\"task_id\":\"$BAD_ID\"}" 2>&1 || true)
set -e
echo "$VERIFY_ERR" | tee /tmp/cs-rails-verify-err.json
# fraud.list should show resolved Refund
for _ in $(seq 1 40); do
  LIST=$(rpc fraud.list '{}')
  echo "$LIST" | grep -q "$BAD_ID" && echo "$LIST" | grep -qi Refund && break
  sleep 0.25
done
LIST=$(rpc fraud.list '{}')
echo "$LIST" | grep -q "$BAD_ID" || { echo "fraud case missing: $LIST"; exit 1; }
echo "  fraud case present (ruling path live)"
# auto-rule may already have submitted
python3 - <<'PY'
import json,re
raw=open("/tmp/cs-rails-verify-err.json").read()
# may be JSON-RPC error envelope
try:
    e=json.loads(raw)
    msg=(e.get("error") or {}).get("message","")
    print("  verify:", msg[:80])
    if "rule:submitted" in msg:
        print("  auto-rule submitted on verify")
except Exception:
    print("  verify raw", raw[:120])
PY

# On-chain Escrow.rule must submit (dispute drive + real chain_task_id)
echo "== fraud.rule on-chain (require submitted) =="
RULE=$(rpc fraud.rule "{\"task_id\":\"$BAD_ID\"}" || true)
echo "$RULE" | tee /tmp/cs-rails-fraud-rule.json
python3 - <<'PY'
import json
r=json.load(open("/tmp/cs-rails-fraud-rule.json"))
mode = r.get("mode")
tx = r.get("txHash")
if not mode and isinstance(r.get("chain"), dict):
    mode = r["chain"].get("mode")
    tx = tx or r["chain"].get("txHash")
assert mode == "submitted", f"expected Escrow.rule mode=submitted, got {json.dumps(r)[:500]}"
assert tx, r
print("  fraud.rule submitted", str(tx)[:18])
print("  fraud.rule path OK")
PY
CHAIN_TID=$(cat /tmp/cs-rails-chain-tid.txt 2>/dev/null || true)
if [[ -z "$CHAIN_TID" ]]; then
  CHAIN_TID=$(python3 -c 'import json;print(json.load(open("/tmp/cs-rails-fraud-rule.json")).get("chain_task_id") or "")')
fi
if [[ "$CHAIN_TID" == 0x* && ${#CHAIN_TID} -eq 66 ]]; then
  # state is 7th return of tasks() — cast prints multi-line
  ST=$(cast call "$ESCROW_ADDRESS" \
    "tasks(bytes32)(address,address,uint96,uint96,bytes32,bytes32,uint8,uint32,uint64,uint8,uint8,uint64)" \
    "$CHAIN_TID" --rpc-url "$CHAIN_RPC" | sed -n '7p' | awk '{print $1}')
  echo "  on-chain state=$ST (4=Settled)"
  python3 -c "assert int('$ST')==4, 'expected Settled(4), got $ST'"
fi

# cast uint256 often prints "123 [1.23e2]" — keep first token only
u256() { awk '{print $1}'; }

echo "== slash.submit (B3 on-chain write) =="
# deploy-local funds watcher CENT approve + bonded SLASH_TARGET (anvil #1)
# require mode=submitted (not simulated/offline)
EVID=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
BEFORE_BOND=$(cast call "$REGISTRY_ADDRESS" "bondOf(address)(uint256)" "$SLASH_TARGET" --rpc-url "$CHAIN_RPC" | u256)
BEFORE_Q=$(cast call "$SLASH_EXECUTOR_ADDRESS" "challengeCount()(uint256)" --rpc-url "$CHAIN_RPC" | u256)
SLASH=$(rpc slash.submit "{\"evidence_hash\":\"0x${EVID}\",\"target\":\"${SLASH_TARGET}\",\"severity\":\"FalseVote\"}")
echo "$SLASH" | tee /tmp/cs-rails-slash.json
python3 - <<'PY'
import json
r=json.load(open("/tmp/cs-rails-slash.json"))
assert r.get("slash_mode") == "write-ready", r
assert r.get("mode") == "submitted", f"expected on-chain submitted (fund CENT+approve): {r}"
assert r.get("txHash"), r
open("/tmp/cs-rails-slash-tx.txt","w").write(r["txHash"])
print("  slash.submit submitted", r["txHash"][:18])
PY
SLASH_TX=$(cat /tmp/cs-rails-slash-tx.txt)
cast receipt "$SLASH_TX" --rpc-url "$CHAIN_RPC" >/dev/null
AFTER_Q=$(cast call "$SLASH_EXECUTOR_ADDRESS" "challengeCount()(uint256)" --rpc-url "$CHAIN_RPC" | u256)
python3 - <<PY
assert int("$AFTER_Q") == int("$BEFORE_Q") + 1, ("queue", "$BEFORE_Q", "$AFTER_Q")
print("  challenge queued count=$AFTER_Q")
PY

echo "== processNext (FIFO slash cut) =="
# process all queued challenges (fraud path may have enqueued too)
while true; do
  Q=$(cast call "$SLASH_EXECUTOR_ADDRESS" "challengeCount()(uint256)" --rpc-url "$CHAIN_RPC" | u256)
  [[ "$Q" == "0" ]] && break
  cast send "$SLASH_EXECUTOR_ADDRESS" "processNext()" \
    --rpc-url "$CHAIN_RPC" --private-key "$PROTOCOL_KEY" >/dev/null
done
AFTER_BOND=$(cast call "$REGISTRY_ADDRESS" "bondOf(address)(uint256)" "$SLASH_TARGET" --rpc-url "$CHAIN_RPC" | u256)
python3 - <<PY
before=int("$BEFORE_BOND")
after=int("$AFTER_BOND")
assert before > 0, "target had no bond — deploy-local stake failed"
assert after < before, f"bond not cut: {before} → {after}"
print(f"  bond cut {before} → {after}")
PY
echo ""
echo "RAILS smoke OK  anvil escrow+batcher+ruler+slash-write"
echo "  batch tx=$TX task=$TID1 fraud=$BAD_ID slash=$SLASH_TX"

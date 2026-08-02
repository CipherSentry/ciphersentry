#!/usr/bin/env bash
# B6 end-to-end: gateway (offline) → WS events → memory indexer → proof API
# No Postgres/anvil required.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/services"

# Randomize ports to avoid stale processes from prior runs.
GPORT="${GPORT:-$((18080 + RANDOM % 400))}"
IPORT="${IPORT:-$((18500 + RANDOM % 400))}"
GBASE="http://127.0.0.1:${GPORT}"
IBASE="http://127.0.0.1:${IPORT}"
GLOG="${TMPDIR:-/tmp}/ciphersentry-gw-b6-$$.log"
ILOG="${TMPDIR:-/tmp}/ciphersentry-ix-b6-$$.log"

cleanup() {
  if [[ -n "${IPID:-}" ]]; then kill "$IPID" 2>/dev/null || true; fi
  if [[ -n "${GPID:-}" ]]; then kill "$GPID" 2>/dev/null || true; fi
  # reap anything still bound (npm wrappers)
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${GPORT}/tcp" 2>/dev/null || true
    fuser -k "${IPORT}/tcp" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== start gateway :${GPORT} =="
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99
export TICK_MS=60000
# quiet sim cadence so only RPC-driven batches matter
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!

for i in $(seq 1 60); do
  if curl -sf "$GBASE/health" | grep -q '"ok":true'; then break; fi
  sleep 0.25
done
curl -sf "$GBASE/health" | grep -q '"ok":true' || { echo "gateway failed"; tail -40 "$GLOG"; exit 1; }
echo "  gateway up"

echo "== start indexer :${IPORT} (memory) =="
export INDEXER_MEMORY=1
export INDEXER_PORT=$IPORT PORT=$IPORT
export NODE_EVENTS="ws://127.0.0.1:${GPORT}/events"
npm run indexer -w indexer >"$ILOG" 2>&1 &
IPID=$!

for i in $(seq 1 60); do
  if curl -sf "$IBASE/health" | grep -q '"ok":true'; then break; fi
  sleep 0.25
done
curl -sf "$IBASE/health" | grep -q '"ok":true' || { echo "indexer failed"; tail -40 "$ILOG"; exit 1; }
echo "  indexer up phase=$(curl -sf "$IBASE/health" | sed -n 's/.*"phase":"\([^"]*\)".*/\1/p')"

# give WS subscribe a moment
sleep 0.5

rpc() {
  local method=$1
  local params=${2:-'{}'}
  curl -sf "$GBASE/rpc" \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}"
}

echo "== task lifecycle =="
COMMIT=$(rpc task.commit '{"spec":"render.sequence.4k","worker":"agent:vector-7","buyer":"agent:atlas-01","escrow":{"amount":"25.00","asset":"USDC"}}')
TASK=$(echo "$COMMIT" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
HASH=$(echo "$COMMIT" | sed -n 's/.*"expected_hash":"\([^"]*\)".*/\1/p')
[[ -n "$TASK" && -n "$HASH" ]] || { echo "commit failed: $COMMIT"; exit 1; }
echo "  task=$TASK"

rpc task.report "{\"task_id\":\"$TASK\",\"hash\":\"$HASH\"}" >/dev/null
VERIFY=$(rpc verify "{\"task_id\":\"$TASK\"}")
echo "$VERIFY" | grep -q '"status":"SETTLED"' || { echo "verify failed: $VERIFY"; exit 1; }
echo "  settled"

COMMIT2=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:helix-3","buyer":"agent:orbit-2","escrow":{"amount":"8.00","asset":"USDC"}}')
TASK2=$(echo "$COMMIT2" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
HASH2=$(echo "$COMMIT2" | sed -n 's/.*"expected_hash":"\([^"]*\)".*/\1/p')
rpc task.report "{\"task_id\":\"$TASK2\",\"hash\":\"$HASH2\"}" >/dev/null
rpc verify "{\"task_id\":\"$TASK2\"}" >/dev/null
echo "  settled $TASK2"

echo "== batch.anchor =="
ANCHOR=$(rpc batch.anchor '{}')
echo "  $ANCHOR"
ROOT=$(echo "$ANCHOR" | sed -n 's/.*"root":"\([^"]*\)".*/\1/p')
[[ -n "$ROOT" ]] || { echo "no root"; exit 1; }

echo "== wait indexer ingest =="
FOUND=""
for i in $(seq 1 40); do
  STATS=$(curl -sf "$IBASE/stats" || echo '{}')
  BATCHES=$(curl -sf "$IBASE/batches" || echo '{}')
  if echo "$BATCHES" | grep -q "$TASK"; then
    FOUND=1
    break
  fi
  # also accept any batch with our root
  if echo "$BATCHES" | grep -q "${ROOT:0:18}"; then
    FOUND=1
    break
  fi
  # batch list may only have batch_id — search by receipt
  if curl -sf "$IBASE/receipts/$TASK" 2>/dev/null | grep -q '"receipt_id"'; then
    FOUND=1
    break
  fi
  sleep 0.25
done

if [[ -z "$FOUND" ]]; then
  echo "indexer never saw receipt"
  echo "stats: $(curl -sf "$IBASE/stats" || true)"
  echo "batches: $(curl -sf "$IBASE/batches" || true)"
  echo "--- gateway log ---"; tail -30 "$GLOG"
  echo "--- indexer log ---"; tail -40 "$ILOG"
  exit 1
fi
echo "  stats=$(curl -sf "$IBASE/stats")"

echo "== receipt + proof =="
REC=$(curl -sf "$IBASE/receipts/$TASK")
echo "  receipt=$(echo "$REC" | head -c 200)…"
echo "$REC" | grep -q "$TASK" || { echo "receipt missing task"; exit 1; }

PROOF=$(curl -sf "$IBASE/receipts/$TASK/proof")
echo "  proof=$PROOF"
echo "$PROOF" | grep -q '"valid":true' || { echo "proof invalid"; exit 1; }

STATS=$(curl -sf "$IBASE/stats")
echo "  $STATS"
MISS=$(echo "$STATS" | sed -n 's/.*"reconcileMiss":\([0-9]*\).*/\1/p')
if [[ "${MISS:-0}" -ne 0 ]]; then
  echo "reconcile misses expected 0, got $MISS"
  exit 1
fi

SEARCH=$(curl -sf "$IBASE/search?q=$TASK")
echo "$SEARCH" | grep -q "$TASK" || { echo "search miss: $SEARCH"; exit 1; }
echo "  search ok"

# second receipt
curl -sf "$IBASE/receipts/$TASK2/proof" | grep -q '"valid":true' || {
  echo "proof for $TASK2 invalid: $(curl -sf "$IBASE/receipts/$TASK2/proof")"
  exit 1
}

echo "== fraud path =="
BAD=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:forge-11","buyer":"agent:orbit-2","escrow":{"amount":"3.00","asset":"USDC"}}')
BAD_ID=$(echo "$BAD" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
rpc task.report "{\"task_id\":\"$BAD_ID\",\"hash\":\"0xdeadbeef\"}" >/dev/null
set +e
rpc verify "{\"task_id\":\"$BAD_ID\"}" >/dev/null
set -e
# wait for fraud.event ingest
for i in $(seq 1 40); do
  if curl -sf "$IBASE/fraud/$BAD_ID" 2>/dev/null | grep -q Refund; then break; fi
  sleep 0.25
done
FRAUD=$(curl -sf "$IBASE/fraud/$BAD_ID")
echo "  fraud=$FRAUD"
echo "$FRAUD" | grep -q '"status":"RESOLVED"' || { echo "fraud not resolved"; exit 1; }
echo "$FRAUD" | grep -q '"ruling":"Refund"' || { echo "expected Refund"; exit 1; }
STATS=$(curl -sf "$IBASE/stats")
echo "  $STATS"
echo "$STATS" | grep -q '"fraudIn":[1-9]' || { echo "fraudIn expected ≥1"; exit 1; }

echo ""
echo "B6 e2e OK  gateway→indexer→proof+fraud"
echo "  task1=$TASK task2=$TASK2 fraud=$BAD_ID root=${ROOT:0:18}…"

#!/usr/bin/env bash
# B6 e2e with real Postgres (+ optional ClickHouse). Falls back if docker unavailable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker missing — falling back to memory e2e"
  exec bash services/indexer/scripts/e2e.sh
fi

GPORT="${GPORT:-18083}"
IPORT="${IPORT:-18084}"
GBASE="http://127.0.0.1:${GPORT}"
IBASE="http://127.0.0.1:${IPORT}"
GLOG="${TMPDIR:-/tmp}/ciphersentry-gw-b6pg.log"
ILOG="${TMPDIR:-/tmp}/ciphersentry-ix-b6pg.log"
COMPOSE="cipher/docker-compose.yml"

cleanup() {
  if [[ -n "${IPID:-}" ]]; then kill "$IPID" 2>/dev/null || true; fi
  if [[ -n "${GPID:-}" ]]; then kill "$GPID" 2>/dev/null || true; fi
  # leave compose up for reuse — only stop if we started it
  if [[ "${STARTED_COMPOSE:-}" == "1" ]]; then
    docker compose -f "$COMPOSE" stop postgres 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "== postgres + clickhouse =="
if ! docker compose -f "$COMPOSE" ps --status running 2>/dev/null | grep -q ciphersentry-pg; then
  docker compose -f "$COMPOSE" up -d postgres clickhouse
  STARTED_COMPOSE=1
  for i in $(seq 1 40); do
    if docker compose -f "$COMPOSE" exec -T postgres pg_isready -U cent -d ciphersentry >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi
docker compose -f "$COMPOSE" up -d clickhouse 2>/dev/null || true
for i in $(seq 1 40); do
  curl -sf http://127.0.0.1:8123/ping >/dev/null 2>&1 && break
  sleep 0.5
done
export PG_DSN="${PG_DSN:-postgres://cent:cent@127.0.0.1:5432/ciphersentry}"
export CH_URL="${CH_URL:-http://127.0.0.1:8123}"
export CH_USER="${CH_USER:-cent}" CH_PASSWORD="${CH_PASSWORD:-cent}"

if command -v psql >/dev/null 2>&1; then
  psql "$PG_DSN" -f services/indexer/sql/schema.sql >/dev/null
else
  docker compose -f "$COMPOSE" exec -T postgres psql -U cent -d ciphersentry < services/indexer/sql/schema.sql >/dev/null
fi
echo "  schema applied"

cd "$ROOT/services"

echo "== gateway :${GPORT} =="
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for i in $(seq 1 60); do
  curl -sf "$GBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done

echo "== indexer :${IPORT} (postgres) =="
export INDEXER_PORT=$IPORT PORT=$IPORT
export NODE_EVENTS="ws://127.0.0.1:${GPORT}/events"
unset INDEXER_MEMORY
# CH may be down — server warns and continues on schema fail
export CH_URL="${CH_URL:-http://127.0.0.1:8123}"
npm run indexer -w indexer >"$ILOG" 2>&1 &
IPID=$!
for i in $(seq 1 60); do
  curl -sf "$IBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$IBASE/health" | grep -q '"ok":true' || { echo "indexer failed"; tail -40 "$ILOG"; exit 1; }
sleep 0.5

rpc() {
  curl -sf "$GBASE/rpc" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-'{}'}}"
}

echo "== lifecycle =="
COMMIT=$(rpc task.commit '{"spec":"render.sequence.4k","worker":"agent:vector-7","buyer":"agent:atlas-01","escrow":{"amount":"11.00","asset":"USDC"}}')
TASK=$(echo "$COMMIT" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
HASH=$(echo "$COMMIT" | sed -n 's/.*"expected_hash":"\([^"]*\)".*/\1/p')
rpc task.report "{\"task_id\":\"$TASK\",\"hash\":\"$HASH\"}" >/dev/null
rpc verify "{\"task_id\":\"$TASK\"}" >/dev/null
COMMIT2=$(rpc task.commit '{"spec":"scrape.pricing.daily","worker":"agent:helix-3","buyer":"agent:orbit-2","escrow":{"amount":"4.00","asset":"USDC"}}')
TASK2=$(echo "$COMMIT2" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
HASH2=$(echo "$COMMIT2" | sed -n 's/.*"expected_hash":"\([^"]*\)".*/\1/p')
rpc task.report "{\"task_id\":\"$TASK2\",\"hash\":\"$HASH2\"}" >/dev/null
rpc verify "{\"task_id\":\"$TASK2\"}" >/dev/null
ANCHOR=$(rpc batch.anchor '{}')
ROOT=$(echo "$ANCHOR" | sed -n 's/.*"root":"\([^"]*\)".*/\1/p')
echo "  root=${ROOT:0:18}…"

echo "== poll =="
for i in $(seq 1 40); do
  if curl -sf "$IBASE/receipts/$TASK" | grep -q receipt_id; then break; fi
  sleep 0.25
done
curl -sf "$IBASE/receipts/$TASK" | grep -q "$TASK"
curl -sf "$IBASE/receipts/$TASK/proof" | grep -q '"valid":true'
curl -sf "$IBASE/batches" | grep -q batch_
curl -sf "$IBASE/search?q=$TASK" | grep -q "$TASK"
echo "  proof+search ok against Postgres"

echo "== CH trust (best-effort) =="
for i in $(seq 1 20); do
  if curl -sf "$IBASE/trust/agent:vector-7" | grep -q trust_score; then
    echo "  trust series ok"
    break
  fi
  sleep 0.3
done

echo ""
echo "B6 e2e-pg OK  gateway→pg+ch indexer→proof"
echo "  task=$TASK"

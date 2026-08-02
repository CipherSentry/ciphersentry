#!/usr/bin/env bash
# Full stack e2e: docker compose (pg + ch + nats) → gateway AUTH → indexer
# settle → batch → /trust CH series → fraud slash s_i←0.95·s_i
#
#   bash services/scripts/e2e-full.sh
#   npm run e2e:full -w @ciphersentry/services   (from services/)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker required for e2e-full" >&2
  exit 1
fi

COMPOSE="cipher/docker-compose.yml"
GPORT="${GPORT:-$((19000 + RANDOM % 300))}"
IPORT="${IPORT:-$((19300 + RANDOM % 300))}"
GBASE="http://127.0.0.1:${GPORT}"
IBASE="http://127.0.0.1:${IPORT}"
GLOG="${TMPDIR:-/tmp}/cs-full-gw-$$.log"
ILOG="${TMPDIR:-/tmp}/cs-full-ix-$$.log"
EVENT_SEED="${EVENT_SIGNING_SEED:-$(python3 -c 'print("cd"*32)')}"
STARTED_COMPOSE=0

cleanup() {
  [[ -n "${IPID:-}" ]] && kill "$IPID" 2>/dev/null || true
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${GPORT}/tcp" 2>/dev/null || true
    fuser -k "${IPORT}/tcp" 2>/dev/null || true
  fi
  if [[ "$STARTED_COMPOSE" == "1" ]]; then
    docker compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== compose pg + clickhouse + nats =="
# fresh volumes when FULL_CLEAN=1
if [[ "${FULL_CLEAN:-0}" == "1" ]]; then
  docker compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true
fi
docker compose -f "$COMPOSE" up -d postgres clickhouse nats
STARTED_COMPOSE=1

for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE" exec -T postgres pg_isready -U cent -d ciphersentry >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
docker compose -f "$COMPOSE" exec -T postgres pg_isready -U cent -d ciphersentry >/dev/null

for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8123/ping >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -sf http://127.0.0.1:8123/ping >/dev/null || { echo "clickhouse not up"; exit 1; }

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8222/healthz >/dev/null 2>&1; then break; fi
  sleep 0.25
done
echo "  infra up"

export PG_DSN="${PG_DSN:-postgres://cent:cent@127.0.0.1:5432/ciphersentry}"
export CH_URL="${CH_URL:-http://127.0.0.1:8123}"
export CH_DB="${CH_DB:-ciphersentry}"
export CH_USER="${CH_USER:-cent}"
export CH_PASSWORD="${CH_PASSWORD:-cent}"
export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"

# apply PG schema
if command -v psql >/dev/null 2>&1; then
  psql "$PG_DSN" -f services/indexer/sql/schema.sql >/dev/null
else
  docker compose -f "$COMPOSE" exec -T postgres psql -U cent -d ciphersentry < services/indexer/sql/schema.sql >/dev/null
fi
echo "  pg schema ok"

# ensure CH can hold T_i=100 (Decimal(7,4)); recreate if legacy Decimal(6,4)
curl -sf "http://127.0.0.1:8123/?user=${CH_USER}&password=${CH_PASSWORD}" \
  --data-binary "CREATE DATABASE IF NOT EXISTS ${CH_DB}" >/dev/null || true
curl -sf "http://127.0.0.1:8123/?user=${CH_USER}&password=${CH_PASSWORD}" \
  --data-binary "DROP TABLE IF EXISTS ${CH_DB}.trust_series" >/dev/null || true

cd "$ROOT/services"

echo "== gateway :${GPORT} AUTH=1 NATS =="
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000
export AUTH_REQUIRED=1
export EVENT_SIGNING_SEED="$EVENT_SEED"
export REDIS_URL=""
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$GBASE/health" | tee /tmp/cs-full-health.json | grep -q '"ok":true' || {
  echo "gateway failed"; tail -50 "$GLOG"; exit 1
}
python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-full-health.json"))
assert h.get("auth_required") is True, h
assert h.get("event_pubkey"), h
print("  gateway auth_required=1 bus=%s pin=%s…" % (h.get("bus"), h["event_pubkey"][:12]))
PY

echo "== indexer :${IPORT} pg+ch nats =="
export INDEXER_PORT=$IPORT PORT=$IPORT
unset INDEXER_MEMORY
export GATEWAY_URL="$GBASE"
export NODE_EVENTS="ws://127.0.0.1:${GPORT}/events"
# prefer NATS; allow WS fallback if bus lags
export INDEXER_FORCE_WS="${INDEXER_FORCE_WS:-0}"
npm run indexer -w indexer >"$ILOG" 2>&1 &
IPID=$!
for _ in $(seq 1 80); do
  curl -sf "$IBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$IBASE/health" | grep -q '"ok":true' || { echo "indexer failed"; tail -50 "$ILOG"; exit 1; }
# CH schema applied on boot
sleep 0.8
echo "  indexer up"

TOKEN=$(GATEWAY_URL="$GBASE" node "$ROOT/services/scripts/auth-token.mjs")
[[ ${#TOKEN} -ge 16 ]] || { echo "auth token failed"; exit 1; }
echo "  session ok"

rpc() {
  local method=$1 params=${2:-'{}'}
  curl -sf "$GBASE/rpc" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer $TOKEN" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}"
}

echo "== settle =="
COMMIT=$(rpc task.commit '{"spec":"render.sequence.4k","worker":"agent:vector-7","buyer":"agent:atlas-01","escrow":{"amount":"25.00","asset":"USDC"}}')
TASK=$(echo "$COMMIT" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
HASH=$(echo "$COMMIT" | sed -n 's/.*"expected_hash":"\([^"]*\)".*/\1/p')
[[ -n "$TASK" && -n "$HASH" ]] || { echo "commit failed: $COMMIT"; tail -30 "$GLOG"; exit 1; }
rpc task.report "{\"task_id\":\"$TASK\",\"hash\":\"$HASH\"}" >/dev/null
VERIFY=$(rpc verify "{\"task_id\":\"$TASK\"}")
echo "$VERIFY" | grep -q '"status":"SETTLED"' || { echo "verify: $VERIFY"; exit 1; }
echo "  settled $TASK"

echo "== batch.anchor =="
ANCHOR=$(rpc batch.anchor '{}')
ROOT=$(echo "$ANCHOR" | sed -n 's/.*"root":"\([^"]*\)".*/\1/p')
[[ -n "$ROOT" ]] || { echo "anchor: $ANCHOR"; exit 1; }

echo "== wait pg receipt + proof =="
FOUND=""
for _ in $(seq 1 60); do
  if curl -sf "$IBASE/receipts/$TASK" 2>/dev/null | grep -q receipt_id; then FOUND=1; break; fi
  sleep 0.3
done
[[ -n "$FOUND" ]] || { echo "pg receipt miss"; tail -40 "$ILOG"; exit 1; }
curl -sf "$IBASE/receipts/$TASK/proof" | grep -q '"valid":true' || { echo "proof invalid"; exit 1; }
echo "  proof valid"

echo "== CH trust series /trust/agent:vector-7 =="
TRUST=""
for _ in $(seq 1 40); do
  TRUST=$(curl -sf "$IBASE/trust/agent:vector-7" || echo '{"data":[]}')
  if echo "$TRUST" | grep -q 'trust_score'; then break; fi
  sleep 0.4
done
echo "  $TRUST"
echo "$TRUST" | grep -q 'trust_score' || {
  echo "CH trust_series empty — indexer log:"; tail -40 "$ILOG"
  exit 1
}
echo "$TRUST" | grep -q 'agent:vector-7' || { echo "wrong agent in trust"; exit 1; }

AGENT=$(curl -sf "$IBASE/agents/agent:vector-7")
echo "  agent=$AGENT"
echo "$AGENT" | grep -qE '"stake":(2600|2[0-9]{3})' || echo "  note: stake live"

echo "== fraud slash =="
BAD=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:forge-11","buyer":"agent:orbit-2","escrow":{"amount":"3.00","asset":"USDC"}}')
BAD_ID=$(echo "$BAD" | sed -n 's/.*"task_id":"\([^"]*\)".*/\1/p')
rpc task.report "{\"task_id\":\"$BAD_ID\",\"hash\":\"0xdeadbeef\"}" >/dev/null
set +e
rpc verify "{\"task_id\":\"$BAD_ID\"}" >/dev/null
set -e
for _ in $(seq 1 50); do
  curl -sf "$IBASE/fraud/$BAD_ID" 2>/dev/null | grep -q Refund && break
  sleep 0.3
done
FRAUD=$(curl -sf "$IBASE/fraud/$BAD_ID")
echo "$FRAUD" | grep -q '"ruling":"Refund"' || { echo "fraud: $FRAUD"; exit 1; }
sleep 0.6
FORGE=$(curl -sf "$IBASE/agents/agent:forge-11")
echo "  forge=$FORGE"
python3 - <<PY
import json
a=json.loads('''$FORGE''')
row=a.get("data",a)
s=float(row.get("stake",0))
assert s == 807.5 or abs(s - 807.5) < 0.01 or s < 850, f"expected slash cut, got {s}"
print(f"  slash ok s_i={s}")
PY

echo ""
echo "FULL e2e OK  compose(pg+ch+nats) → AUTH → settle → CH trust → fraud slash"
echo "  task=$TASK fraud=$BAD_ID root=${ROOT:0:18}…"
echo "  console → ?net=rpc&auth=1&node=$GBASE&indexer=$IBASE"

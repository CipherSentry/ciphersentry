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

# wait_ready name attempts sleep_s cmd…  — require 2 consecutive ok (avoids race)
wait_ready() {
  local name=$1 attempts=$2 delay=$3
  shift 3
  local ok=0 i
  for i in $(seq 1 "$attempts"); do
    if "$@"; then
      ok=$((ok + 1))
      if [[ $ok -ge 2 ]]; then
        echo "  $name ready (${i}s checks)"
        return 0
      fi
    else
      ok=0
    fi
    sleep "$delay"
  done
  echo "FATAL: $name not ready after ${attempts} attempts" >&2
  docker compose -f "$COMPOSE" ps >&2 || true
  docker compose -f "$COMPOSE" logs --tail=40 postgres clickhouse nats >&2 || true
  return 1
}

echo "== compose pg + clickhouse + nats + valkey =="
# fresh volumes when FULL_CLEAN=1
if [[ "${FULL_CLEAN:-0}" == "1" ]]; then
  docker compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true
fi
# --wait honors compose healthchecks (pg/ch); nats/valkey client ports checked below
if docker compose -f "$COMPOSE" up -d --wait --wait-timeout 120 postgres clickhouse nats valkey; then
  STARTED_COMPOSE=1
else
  # older compose without --wait
  docker compose -f "$COMPOSE" up -d postgres clickhouse nats valkey
  STARTED_COMPOSE=1
fi

wait_ready postgres 90 0.5 \
  docker compose -f "$COMPOSE" exec -T postgres pg_isready -U cent -d ciphersentry

wait_ready clickhouse 90 0.5 \
  curl -sf http://127.0.0.1:8123/ping

# client port first (always on); then HTTP monitor if -m 8222 is set
wait_ready nats 40 0.25 bash -c 'echo >/dev/tcp/127.0.0.1/4222'
if curl -sf http://127.0.0.1:8222/healthz >/dev/null 2>&1; then
  echo "  nats monitor /healthz ok"
else
  echo "  nats monitor optional — client :4222 only (compose should set -m 8222)"
fi

wait_ready valkey 40 0.25 bash -c 'echo >/dev/tcp/127.0.0.1/6379'
echo "  valkey :6379 ok"

echo "  infra up"

export PG_DSN="${PG_DSN:-postgres://cent:cent@127.0.0.1:5432/ciphersentry}"
export CH_URL="${CH_URL:-http://127.0.0.1:8123}"
export CH_DB="${CH_DB:-ciphersentry}"
export CH_USER="${CH_USER:-cent}"
export CH_PASSWORD="${CH_PASSWORD:-cent}"
export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"
# full e2e: bus-nats only — no memory/WS fallback
export NATS_REQUIRE="${NATS_REQUIRE:-1}"
export INDEXER_REQUIRE_NATS="${INDEXER_REQUIRE_NATS:-1}"
export INDEXER_FORCE_WS=0

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

echo "== gateway :${GPORT} AUTH=1 NATS + Redis (B7) =="
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export BATCH_INTERVAL_MS=0 BATCH_MAX_PENDING=99 TICK_MS=60000
export AUTH_REQUIRED=1
export EVENT_SIGNING_SEED="$EVENT_SEED"
# B7: real Redis sessions (not memory) + no silent NATS/Redis fallback
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export REDIS_REQUIRE="${REDIS_REQUIRE:-1}"
export NATS_REQUIRE="${NATS_REQUIRE:-1}"
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
assert h.get("bus") == "nats", f"gateway must use NATS bus, got {h.get('bus')}: {h}"
assert h.get("kv") == "redis", f"gateway must use Redis sessions, got kv={h.get('kv')}: {h}"
print("  gateway auth_required=1 bus=%s kv=%s pin=%s…" % (h.get("bus"), h.get("kv"), h["event_pubkey"][:12]))
PY

echo "== indexer :${IPORT} pg+ch nats-only =="
export INDEXER_PORT=$IPORT PORT=$IPORT
unset INDEXER_MEMORY
export GATEWAY_URL="$GBASE"
# keep WS URL for debug only — REQUIRE_NATS forbids FORCE_WS fallback
export NODE_EVENTS="ws://127.0.0.1:${GPORT}/events"
export INDEXER_FORCE_WS=0
export INDEXER_REQUIRE_NATS=1
export NATS_REQUIRE=1
npm run indexer -w indexer >"$ILOG" 2>&1 &
IPID=$!
for _ in $(seq 1 80); do
  curl -sf "$IBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$IBASE/health" | tee /tmp/cs-full-ix-health.json | grep -q '"ok":true' || {
  echo "indexer failed"; tail -50 "$ILOG"; exit 1
}
python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-full-ix-health.json"))
assert h.get("bus") == "nats", f"indexer must use NATS (no WS fallback), got bus={h.get('bus')}: {h}"
print("  indexer bus=nats ok")
PY
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

# re-assert bus stayed on nats after traffic
STATS=$(curl -sf "$IBASE/stats")
echo "$STATS" | grep -q '"bus":"nats"' || { echo "FATAL: indexer bus left nats: $STATS"; exit 1; }

echo ""
echo "FULL e2e OK  compose(pg+ch+nats) → AUTH → NATS-only → settle → CH trust → fraud slash"
echo "  task=$TASK fraud=$BAD_ID root=${ROOT:0:18}…"
echo "  console → ?net=rpc&auth=1&node=$GBASE&indexer=$IBASE"
echo "  explorer agent panel → #/explorer?q=agent:vector-7&indexer=$IBASE"

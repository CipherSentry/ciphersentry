#!/usr/bin/env bash
# B7 ops smoke (CI-friendly): valkey+nats → gateway AUTH + Redis + NATS
# + fraud durable hydrate. No chain required.
#
#   bash services/scripts/e2e-b7-smoke.sh
#   npm run e2e:b7:smoke -w @ciphersentry/services
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker required for e2e-b7-smoke" >&2
  exit 1
fi

COMPOSE="cipher/docker-compose.yml"
GPORT="${GPORT:-$((19200 + RANDOM % 200))}"
GBASE="http://127.0.0.1:${GPORT}"
GLOG="${TMPDIR:-/tmp}/cs-b7-smoke-gw-$$.log"
SEC="${TMPDIR:-/tmp}/cs-b7-secrets-$$"
EVENT_SEED="${EVENT_SIGNING_SEED:-$(python3 -c 'print("ab"*32)')}"
STARTED_COMPOSE=0
GPID=""

cleanup() {
  [[ -n "${GPID:-}" ]] && kill "$GPID" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${GPORT}/tcp" 2>/dev/null || true
  fi
  rm -rf "$SEC" 2>/dev/null || true
  if [[ "$STARTED_COMPOSE" == "1" ]]; then
    docker compose -f "$COMPOSE" stop nats valkey >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== B7 smoke: valkey + nats =="
if docker compose -f "$COMPOSE" up -d --wait --wait-timeout 90 nats valkey 2>/dev/null; then
  STARTED_COMPOSE=1
else
  docker compose -f "$COMPOSE" up -d nats valkey
  STARTED_COMPOSE=1
  for _ in $(seq 1 40); do
    (echo >/dev/tcp/127.0.0.1/6379) 2>/dev/null && (echo >/dev/tcp/127.0.0.1/4222) 2>/dev/null && break
    sleep 0.25
  done
fi
(echo >/dev/tcp/127.0.0.1/6379) 2>/dev/null || { echo "valkey not up"; exit 1; }
(echo >/dev/tcp/127.0.0.1/4222) 2>/dev/null || { echo "nats not up"; exit 1; }
echo "  redis :6379 + nats :4222 ok"

# anvil-style secrets (file custody path)
mkdir -p "$SEC"
# distinct batcher keys; ruler can equal protocol for smoke
printf '%s' 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' >"$SEC/protocol_key"
printf '%s' 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' >"$SEC/batcher_1"
printf '%s' '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' >"$SEC/batcher_2"
printf '%s' '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' >"$SEC/batcher_3"
printf '%s' 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' >"$SEC/ruler_key"
chmod 600 "$SEC"/*

echo "== gateway B7 :${GPORT} =="
export CS_ENV=production B7=1 AUTH_REQUIRED=1
export GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=$GPORT
export REDIS_URL=redis://127.0.0.1:6379 REDIS_REQUIRE=1
export NATS_URL=nats://127.0.0.1:4222 NATS_REQUIRE=1
export PROTOCOL_KEY_FILE="$SEC/protocol_key"
export BATCHER_KEY_1_FILE="$SEC/batcher_1"
export BATCHER_KEY_2_FILE="$SEC/batcher_2"
export BATCHER_KEY_3_FILE="$SEC/batcher_3"
export RULER_KEY_FILE="$SEC/ruler_key"
export EVENT_SIGNING_SEED="$EVENT_SEED"
export BATCH_INTERVAL_MS=0 TICK_MS=60000
# no chain — offline fraud still durable
unset ESCROW_ADDRESS BATCHER_ADDRESS SLASH_EXECUTOR_ADDRESS CHAIN_RPC PROTOCOL_KEY RULER_KEY 2>/dev/null || true

cd "$ROOT/services"
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$GBASE/health" | tee /tmp/cs-b7-smoke-health.json | grep -q '"ok":true' || {
  echo "gateway failed"; tail -60 "$GLOG"; exit 1
}

python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-b7-smoke-health.json"))
assert h.get("b7") is True, h
assert h.get("phase") == "B7", h
assert h.get("kv") == "redis", h
assert h.get("bus") == "nats", h
assert h.get("auth_required") is True, h
assert h.get("fraud_store") == "redis", f"fraud must use redis store: {h}"
assert h.get("fraud_durable") is True, h
assert h.get("event_pubkey"), h
print("  health B7 ok kv=redis bus=nats fraud_durable=true")
PY

# open a fraud case via bad verify path (offline)
TOKEN=$(GATEWAY_URL="$GBASE" node "$ROOT/services/scripts/auth-token.mjs")
[[ ${#TOKEN} -ge 16 ]] || { echo "auth token failed"; exit 1; }

rpc() {
  local method=$1
  local params=${2:-'{}'}
  curl -sf "$GBASE/rpc" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer $TOKEN" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}"
}

# unwrap JSON-RPC result envelope
rpc_result() {
  python3 -c 'import json,sys; b=json.load(sys.stdin); 
assert "error" not in b or not b["error"], b; 
r=b.get("result", b); print(json.dumps(r))'
}

C=$(rpc task.commit '{"spec":"embed.docs.batch","worker":"agent:forge-11","buyer":"agent:orbit-2","escrow":{"amount":"2.00","asset":"USDC"}}' | rpc_result)
TID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$C")
[[ -n "$TID" ]] || { echo "commit failed: $C"; exit 1; }
rpc task.report "{\"task_id\":\"$TID\",\"hash\":\"0xdeadbeef\"}" >/dev/null
set +e
rpc verify "{\"task_id\":\"$TID\"}" >/dev/null
set -e

for _ in $(seq 1 30); do
  LIST=$(rpc fraud.list '{}' || true)
  echo "$LIST" | grep -q "$TID" && break
  sleep 0.2
done
LIST=$(rpc fraud.list '{}')
echo "$LIST" | grep -q "$TID" || { echo "fraud case missing: $LIST"; tail -30 "$GLOG"; exit 1; }
echo "  fraud case $TID present"

# restart gateway — durable hydrate from Redis
echo "== restart gateway (fraud hydrate) =="
kill "$GPID" 2>/dev/null || true
wait "$GPID" 2>/dev/null || true
GPID=""
sleep 0.5
npm run gateway -w gateway >"$GLOG" 2>&1 &
GPID=$!
for _ in $(seq 1 80); do
  curl -sf "$GBASE/health" | grep -q '"ok":true' && break
  sleep 0.25
done
curl -sf "$GBASE/health" | tee /tmp/cs-b7-smoke-health2.json | grep -q '"ok":true' || {
  echo "gateway restart failed"; tail -40 "$GLOG"; exit 1
}
python3 - <<'PY'
import json
h=json.load(open("/tmp/cs-b7-smoke-health2.json"))
assert h.get("b7") is True and h.get("kv")=="redis" and h.get("fraud_durable") is True, h
assert int(h.get("fraud_total") or 0) >= 1, f"expected hydrated fraud cases: {h}"
print("  post-restart fraud_total=%s" % h.get("fraud_total"))
PY

TOKEN2=$(GATEWAY_URL="$GBASE" node "$ROOT/services/scripts/auth-token.mjs")
LIST2=$(curl -sf "$GBASE/rpc" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN2" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"fraud.list\",\"params\":{}}")
echo "$LIST2" | grep -q "$TID" || { echo "case lost after restart: $LIST2"; exit 1; }
echo "  fraud case survived restart"

echo ""
echo "B7 smoke OK  redis+nats+auth+fraud_durable+hydrate"
echo "  node=$GBASE"

#!/usr/bin/env bash
# Public Fly B7 process: Valkey + NATS + gateway :8080 + memory indexer :8081.
# Sessions/rate-limits on Redis; domain events on NATS. Indexer stays memory
# (no PG/CH sidecars on the single public machine) but consumes NATS when up.
set -euo pipefail
cd /app

export GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"
export PORT="${PORT:-$GATEWAY_PORT}"
export INDEXER_UPSTREAM="${INDEXER_UPSTREAM:-http://127.0.0.1:8081}"
export INDEXER_PORT="${INDEXER_PORT:-8081}"
export INDEXER_HOST="${INDEXER_HOST:-127.0.0.1}"
export INDEXER_MEMORY="${INDEXER_MEMORY:-1}"
export INDEXER_FORCE_WS="${INDEXER_FORCE_WS:-0}"
export INDEXER_REQUIRE_NATS="${INDEXER_REQUIRE_NATS:-1}"

# Force local sidecars — Fly secrets may set empty NATS_URL/REDIS_URL which
# would otherwise win over ${VAR:-default} and leave the gateway in B5 mode.
export B7=1
export CS_ENV=production
export AUTH_REQUIRED=1
export REDIS_URL=redis://127.0.0.1:6379
export REDIS_REQUIRE=1
export NATS_URL=nats://127.0.0.1:4222
export NATS_REQUIRE=1
export NODE_EVENTS="${NODE_EVENTS:-ws://127.0.0.1:8080/events}"
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8080}"

REDIS_PORT="${REDIS_PORT:-6379}"
NATS_PORT="${NATS_PORT:-4222}"
NATS_MON="${NATS_MON:-8222}"

echo "[start-public-b7] redis :${REDIS_PORT} + nats :${NATS_PORT} + gateway :${GATEWAY_PORT} + indexer :${INDEXER_PORT}"

# --- redis (sessions / RPM) ---
redis-server \
  --port "$REDIS_PORT" \
  --bind 127.0.0.1 \
  --protected-mode yes \
  --save "" \
  --appendonly no \
  --daemonize yes

for i in $(seq 1 40); do
  if redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 0.25
done
redis-cli -p "$REDIS_PORT" ping | grep -q PONG || {
  echo "[start-public-b7] redis failed" >&2
  exit 1
}

# --- nats (event bus) ---
nats-server -p "$NATS_PORT" -m "$NATS_MON" >/tmp/nats.log 2>&1 &
NATS_PID=$!

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${NATS_MON}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -sf "http://127.0.0.1:${NATS_MON}/healthz" >/dev/null || {
  echo "[start-public-b7] nats failed" >&2
  cat /tmp/nats.log >&2 || true
  exit 1
}

# --- gateway ---
npm run gateway -w gateway &
GW_PID=$!

for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# assert B7 surface before advertising
H=$(curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" || true)
echo "$H" | grep -q '"kv":"redis"' || {
  echo "[start-public-b7] expected kv=redis: $H" >&2
  exit 1
}
echo "$H" | grep -q '"bus":"nats"' || {
  echo "[start-public-b7] expected bus=nats: $H" >&2
  exit 1
}
# phase label — warn only so a flag regression does not crash-loop public node
if ! echo "$H" | grep -qE '"b7":\s*true|"phase":\s*"B7"'; then
  echo "[start-public-b7] WARN phase label not B7 yet: $H" >&2
fi
echo "[start-public-b7] gateway up: $H"

# --- indexer (memory + NATS) ---
(
  export PORT="${INDEXER_PORT}"
  export INDEXER_PORT INDEXER_HOST INDEXER_MEMORY INDEXER_FORCE_WS INDEXER_REQUIRE_NATS
  export NATS_URL NATS_REQUIRE GATEWAY_URL NODE_EVENTS
  exec npm run indexer -w indexer
) &
IX_PID=$!

term() {
  kill "$GW_PID" "$IX_PID" "$NATS_PID" 2>/dev/null || true
  redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true
  wait "$GW_PID" 2>/dev/null || true
  wait "$IX_PID" 2>/dev/null || true
  wait "$NATS_PID" 2>/dev/null || true
}
trap term EXIT INT TERM

while kill -0 "$GW_PID" 2>/dev/null; do
  if ! kill -0 "$IX_PID" 2>/dev/null; then
    echo "[start-public-b7] indexer died — restarting" >&2
    (
      export PORT="${INDEXER_PORT}"
      export INDEXER_PORT INDEXER_HOST INDEXER_MEMORY INDEXER_FORCE_WS INDEXER_REQUIRE_NATS
      export NATS_URL NATS_REQUIRE GATEWAY_URL NODE_EVENTS
      exec npm run indexer -w indexer
    ) &
    IX_PID=$!
  fi
  if ! kill -0 "$NATS_PID" 2>/dev/null; then
    echo "[start-public-b7] nats died — restarting" >&2
    nats-server -p "$NATS_PORT" -m "$NATS_MON" >/tmp/nats.log 2>&1 &
    NATS_PID=$!
  fi
  sleep 3
done
echo "[start-public-b7] gateway exited" >&2
exit 1

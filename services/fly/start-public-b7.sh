#!/usr/bin/env bash
# Public Fly B7 process:
#   Redis (sessions) + NATS (bus) + Postgres on /data (durable SoR)
#   + gateway :8080 + indexer :8081 (PG + CH-memory)
#
# Without /data volume, indexer falls back to INDEXER_MEMORY=1.
set -euo pipefail
cd /app

export GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"
export PORT="${PORT:-$GATEWAY_PORT}"
export INDEXER_UPSTREAM="${INDEXER_UPSTREAM:-http://127.0.0.1:8081}"
export INDEXER_PORT="${INDEXER_PORT:-8081}"
export INDEXER_HOST="${INDEXER_HOST:-127.0.0.1}"
export INDEXER_FORCE_WS="${INDEXER_FORCE_WS:-0}"
export INDEXER_REQUIRE_NATS="${INDEXER_REQUIRE_NATS:-1}"

# Force local sidecars — empty Fly secrets must not win.
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
PGDATA="${PGDATA:-/data/pg}"
PG_USER="${PG_USER:-cent}"
PG_PASSWORD="${PG_PASSWORD:-cent}"
PG_DB="${PG_DB:-ciphersentry}"

# When INDEXER_UPSTREAM is not loopback, skip embedded indexer (external durable app).
REMOTE_IX=0
case "${INDEXER_UPSTREAM}" in
http://127.0.0.1:*|http://localhost:*|http://[::1]:*) REMOTE_IX=0 ;;
*) REMOTE_IX=1 ;;
esac

echo "[start-public-b7] redis :${REDIS_PORT} + nats :${NATS_PORT} + gateway :${GATEWAY_PORT} + indexer ${INDEXER_UPSTREAM}"

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

# --- postgres (durable SoR when /data is a volume) ---
PG_PID=""
USE_PG=0
# Debian packages put binaries under /usr/lib/postgresql/<ver>/bin (not on PATH).
PG_BIN_DIR="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [[ -n "${PG_BIN_DIR}" ]]; then
  export PATH="${PG_BIN_DIR}:${PATH}"
fi
INITDB="$(command -v initdb || true)"
POSTGRES_BIN="$(command -v postgres || true)"
PG_ISREADY="$(command -v pg_isready || true)"
PSQL="$(command -v psql || true)"

if [[ -d /data ]] && [[ "$REMOTE_IX" != "1" ]] && [[ -n "$INITDB" ]] && [[ -n "$POSTGRES_BIN" ]]; then
  mkdir -p "$PGDATA" /var/run/postgresql
  chown -R postgres:postgres "$PGDATA" /var/run/postgresql 2>/dev/null || true
  if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
    echo "[start-public-b7] initdb $PGDATA ($INITDB)"
    gosu postgres "$INITDB" -D "$PGDATA" --auth-local=trust --auth-host=trust --username=postgres
    {
      echo "listen_addresses = '127.0.0.1'"
      echo "port = 5432"
      echo "unix_socket_directories = '/var/run/postgresql'"
      echo "max_connections = 40"
      echo "shared_buffers = 64MB"
    } >>"$PGDATA/postgresql.conf"
  fi
  gosu postgres "$POSTGRES_BIN" -D "$PGDATA" >/tmp/postgres.log 2>&1 &
  PG_PID=$!
  for i in $(seq 1 60); do
    if gosu postgres "$PG_ISREADY" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  gosu postgres "$PG_ISREADY" -h 127.0.0.1 -p 5432 >/dev/null || {
    echo "[start-public-b7] postgres failed" >&2
    cat /tmp/postgres.log >&2 || true
    exit 1
  }
  # role + db (idempotent)
  gosu postgres "$PSQL" -h 127.0.0.1 -v ON_ERROR_STOP=0 -c "CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASSWORD}' SUPERUSER;" >/dev/null 2>&1 || true
  gosu postgres "$PSQL" -h 127.0.0.1 -v ON_ERROR_STOP=0 -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};" >/dev/null 2>&1 || true
  export PG_DSN="${PG_DSN:-postgres://${PG_USER}:${PG_PASSWORD}@127.0.0.1:5432/${PG_DB}}"
  export INDEXER_MEMORY=0
  export INDEXER_CH_MODE="${INDEXER_CH_MODE:-memory}"
  USE_PG=1
  echo "[start-public-b7] postgres ready dsn=…@127.0.0.1:5432/${PG_DB}"
else
  export INDEXER_MEMORY="${INDEXER_MEMORY:-1}"
  if [[ -d /data ]] && [[ -z "$INITDB" ]]; then
    echo "[start-public-b7] WARN postgres tools missing — INDEXER_MEMORY=${INDEXER_MEMORY}" >&2
  else
    echo "[start-public-b7] no /data volume (or remote indexer) — INDEXER_MEMORY=${INDEXER_MEMORY}"
  fi
fi

# --- gateway ---
npm run gateway -w gateway &
GW_PID=$!

for i in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

H=$(curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" || true)
echo "$H" | grep -q '"kv":"redis"' || {
  echo "[start-public-b7] expected kv=redis: $H" >&2
  exit 1
}
echo "$H" | grep -q '"bus":"nats"' || {
  echo "[start-public-b7] expected bus=nats: $H" >&2
  exit 1
}
if ! echo "$H" | grep -qE '"b7":\s*true|"phase":\s*"B7"'; then
  echo "[start-public-b7] WARN phase label not B7 yet: $H" >&2
fi
echo "[start-public-b7] gateway up: $H"

IX_PID=""
if [[ "$REMOTE_IX" == "1" ]]; then
  echo "[start-public-b7] using remote durable indexer ${INDEXER_UPSTREAM}"
  for i in $(seq 1 30); do
    if curl -sf "${INDEXER_UPSTREAM}/health" >/dev/null 2>&1; then
      echo "[start-public-b7] remote indexer healthy"
      break
    fi
    sleep 1
  done
else
  (
    export PORT="${INDEXER_PORT}"
    export INDEXER_PORT INDEXER_HOST INDEXER_MEMORY INDEXER_FORCE_WS INDEXER_REQUIRE_NATS INDEXER_CH_MODE
    export NATS_URL NATS_REQUIRE GATEWAY_URL NODE_EVENTS PG_DSN
    exec npm run indexer -w indexer
  ) &
  IX_PID=$!
  # wait for durable flag when PG is on
  if [[ "$USE_PG" == "1" ]]; then
    for i in $(seq 1 40); do
      IH=$(curl -sf "http://127.0.0.1:${INDEXER_PORT}/health" || true)
      if echo "$IH" | grep -q '"durable":true'; then
        echo "[start-public-b7] indexer durable: $IH"
        break
      fi
      sleep 0.5
    done
  fi
fi

term() {
  [[ -n "${IX_PID}" ]] && kill "$IX_PID" 2>/dev/null || true
  kill "$GW_PID" "$NATS_PID" 2>/dev/null || true
  [[ -n "${PG_PID}" ]] && kill "$PG_PID" 2>/dev/null || true
  redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true
  wait "$GW_PID" 2>/dev/null || true
  [[ -n "${IX_PID}" ]] && wait "$IX_PID" 2>/dev/null || true
  wait "$NATS_PID" 2>/dev/null || true
  [[ -n "${PG_PID}" ]] && wait "$PG_PID" 2>/dev/null || true
}
trap term EXIT INT TERM

while kill -0 "$GW_PID" 2>/dev/null; do
  if [[ -n "${IX_PID}" ]] && ! kill -0 "$IX_PID" 2>/dev/null; then
    echo "[start-public-b7] indexer died — restarting" >&2
    (
      export PORT="${INDEXER_PORT}"
      export INDEXER_PORT INDEXER_HOST INDEXER_MEMORY INDEXER_FORCE_WS INDEXER_REQUIRE_NATS INDEXER_CH_MODE
      export NATS_URL NATS_REQUIRE GATEWAY_URL NODE_EVENTS PG_DSN
      exec npm run indexer -w indexer
    ) &
    IX_PID=$!
  fi
  if ! kill -0 "$NATS_PID" 2>/dev/null; then
    echo "[start-public-b7] nats died — restarting" >&2
    nats-server -p "$NATS_PORT" -m "$NATS_MON" >/tmp/nats.log 2>&1 &
    NATS_PID=$!
  fi
  if [[ -n "${PG_PID}" ]] && ! kill -0 "$PG_PID" 2>/dev/null; then
    echo "[start-public-b7] postgres died — restarting" >&2
    gosu postgres "$POSTGRES_BIN" -D "$PGDATA" >/tmp/postgres.log 2>&1 &
    PG_PID=$!
  fi
  sleep 3
done
echo "[start-public-b7] gateway exited" >&2
exit 1

#!/usr/bin/env bash
# Public Fly process: gateway :8080 + memory indexer :8081 (path-proxied).
# Token may only deploy the existing `ciphersentry` app — no 2nd app required.
set -euo pipefail
cd /app

export GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
export GATEWAY_PORT="${GATEWAY_PORT:-8080}"
export PORT="${PORT:-$GATEWAY_PORT}"
export INDEXER_UPSTREAM="${INDEXER_UPSTREAM:-http://127.0.0.1:8081}"
export INDEXER_PORT="${INDEXER_PORT:-8081}"
export INDEXER_MEMORY="${INDEXER_MEMORY:-1}"
export INDEXER_FORCE_WS="${INDEXER_FORCE_WS:-1}"
export NODE_EVENTS="${NODE_EVENTS:-ws://127.0.0.1:8080/events}"
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8080}"
# empty NATS → memory bus (Fly public demo)
export NATS_URL="${NATS_URL-}"

echo "[start-public] gateway :${GATEWAY_PORT} + indexer :${INDEXER_PORT} (proxy ${INDEXER_UPSTREAM})"

npm run gateway -w gateway &
GW_PID=$!

for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Fly injects PORT=8080 for the public proxy — force indexer onto 8081
(
  export PORT="${INDEXER_PORT}"
  export INDEXER_PORT
  exec npm run indexer -w indexer
) &
IX_PID=$!

term() {
  kill "$GW_PID" "$IX_PID" 2>/dev/null || true
  wait "$GW_PID" 2>/dev/null || true
  wait "$IX_PID" 2>/dev/null || true
}
trap term EXIT INT TERM

# gateway is the public surface — exit only if it dies
while kill -0 "$GW_PID" 2>/dev/null; do
  if ! kill -0 "$IX_PID" 2>/dev/null; then
    echo "[start-public] indexer died — restarting" >&2
    (
      export PORT="${INDEXER_PORT}"
      export INDEXER_PORT
      exec npm run indexer -w indexer
    ) &
    IX_PID=$!
  fi
  sleep 3
done
echo "[start-public] gateway exited" >&2
exit 1

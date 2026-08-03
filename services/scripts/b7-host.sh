#!/usr/bin/env bash
# B7 hosted boot on a shared host (bare metal or VM).
# Prefer docker compose -f services/docker-compose.b7.yml when containerized.
#
#   bash services/scripts/b7-host.sh init     # create secrets dir + sample files
#   bash services/scripts/b7-host.sh up       # start gateway (+ indexer if INDEXER=1)
#   bash services/scripts/b7-host.sh health   # assert /health B7
#   bash services/scripts/b7-host.sh down
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVC="$ROOT/services"
SECRETS="${CS_SECRETS_DIR:-$SVC/secrets}"
ENV_FILE="${CS_PROD_ENV:-$SVC/prod.env}"
GPORT="${GATEWAY_PORT:-8080}"
IPORT="${INDEXER_PORT:-8090}"
GLOG="${TMPDIR:-/tmp}/cs-b7-gw.log"
ILOG="${TMPDIR:-/tmp}/cs-b7-ix.log"
PIDDIR="${TMPDIR:-/tmp}/cs-b7-pids"

cmd="${1:-health}"

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
  export CS_ENV=production B7=1 AUTH_REQUIRED=1
  export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
  export REDIS_REQUIRE=1
  export NATS_URL="${NATS_URL:-nats://127.0.0.1:4222}"
  export NATS_REQUIRE=1
  export INDEXER_REQUIRE_NATS=1
  export INDEXER_FORCE_WS=0
  export GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
  export GATEWAY_PORT="$GPORT"
  export PROTOCOL_KEY_FILE="${PROTOCOL_KEY_FILE:-$SECRETS/protocol_key}"
  export BATCHER_KEY_1_FILE="${BATCHER_KEY_1_FILE:-$SECRETS/batcher_1}"
  export BATCHER_KEY_2_FILE="${BATCHER_KEY_2_FILE:-$SECRETS/batcher_2}"
  export BATCHER_KEY_3_FILE="${BATCHER_KEY_3_FILE:-$SECRETS/batcher_3}"
  export RULER_KEY_FILE="${RULER_KEY_FILE:-$SECRETS/ruler_key}"
}

require_secrets() {
  local f
  for f in protocol_key batcher_1 batcher_2 batcher_3 ruler_key; do
    [[ -s "$SECRETS/$f" ]] || {
      echo "FATAL: missing/empty $SECRETS/$f (run: $0 init)" >&2
      exit 1
    }
  done
}

case "$cmd" in
init)
  mkdir -p "$SECRETS"
  chmod 700 "$SECRETS"
  for f in protocol_key batcher_1 batcher_2 batcher_3 ruler_key; do
    if [[ ! -f "$SECRETS/$f" ]]; then
      # anvil-style placeholders — REPLACE before any real funds
      case "$f" in
      protocol_key) echo "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" >"$SECRETS/$f" ;;
      batcher_1) echo "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" >"$SECRETS/$f" ;;
      batcher_2) echo "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" >"$SECRETS/$f" ;;
      batcher_3) echo "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" >"$SECRETS/$f" ;;
      ruler_key) echo "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" >"$SECRETS/$f" ;;
      esac
      chmod 600 "$SECRETS/$f"
    fi
  done
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$SVC/scripts/prod.env.example" "$ENV_FILE"
    echo "wrote $ENV_FILE — set CHAIN_RPC + contract addrs"
  fi
  echo "secrets=$SECRETS (chmod 700; never commit)"
  ls -la "$SECRETS"
  ;;

up)
  load_env
  require_secrets
  mkdir -p "$PIDDIR"
  # probe redis + nats
  timeout 2 bash -c "echo >/dev/tcp/${REDIS_HOST:-127.0.0.1}/${REDIS_PORT:-6379}" 2>/dev/null \
    || { echo "FATAL: Redis not reachable ($REDIS_URL)"; exit 1; }
  timeout 2 bash -c "echo >/dev/tcp/${NATS_HOST:-127.0.0.1}/${NATS_PORT:-4222}" 2>/dev/null \
    || { echo "FATAL: NATS not reachable ($NATS_URL)"; exit 1; }
  cd "$SVC"
  [[ -d node_modules ]] || npm ci
  npm run gateway -w gateway >"$GLOG" 2>&1 &
  echo $! >"$PIDDIR/gateway.pid"
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:${GPORT}/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
  if [[ "${INDEXER:-0}" == "1" ]]; then
    export INDEXER_PORT="$IPORT" PORT="$IPORT"
    export GATEWAY_URL="http://127.0.0.1:${GPORT}"
    export PG_DSN="${PG_DSN:-postgres://cent:cent@127.0.0.1:5432/ciphersentry}"
    export CH_URL="${CH_URL:-http://127.0.0.1:8123}"
    npm run indexer -w indexer >"$ILOG" 2>&1 &
    echo $! >"$PIDDIR/indexer.pid"
  fi
  exec bash "$0" health
  ;;

health)
  load_env
  h=$(curl -sf "http://127.0.0.1:${GPORT}/health") || {
    echo "FATAL: gateway /health down"; tail -40 "$GLOG" 2>/dev/null || true; exit 1
  }
  H="$h" python3 - <<'PY'
import json, os
h=json.loads(os.environ["H"])
assert h.get("ok") is True, h
assert h.get("kv")=="redis", h
assert h.get("bus")=="nats", h
assert h.get("b7") is True or h.get("phase")=="B7", h
assert h.get("auth_required") is True, h
print("ok b7 gateway kv=%s bus=%s phase=%s" % (h["kv"], h["bus"], h.get("phase")))
PY
  if [[ "${INDEXER:-0}" == "1" ]] || [[ -f "$PIDDIR/indexer.pid" ]]; then
    ih=$(curl -sf "http://127.0.0.1:${IPORT}/health") || {
      echo "FATAL: indexer /health down"; exit 1
    }
    H="$ih" python3 - <<'PY'
import json, os
h=json.loads(os.environ["H"])
assert h.get("ok") is True, h
assert h.get("bus")=="nats", h
print("ok b7 indexer bus=nats")
PY
  fi
  ;;

down)
  for p in gateway indexer; do
    if [[ -f "$PIDDIR/$p.pid" ]]; then
      kill "$(cat "$PIDDIR/$p.pid")" 2>/dev/null || true
      rm -f "$PIDDIR/$p.pid"
    fi
  done
  echo "stopped"
  ;;

compose)
  load_env
  require_secrets
  docker compose -f "$SVC/docker-compose.b7.yml" --env-file "$ENV_FILE" up -d --wait
  # compose always starts indexer :8090 — assert host-reachable bind
  INDEXER=1 GATEWAY_PORT="${GATEWAY_PORT:-8080}" INDEXER_PORT="${INDEXER_PORT:-8090}" bash "$0" health
  ;;

*)
  echo "usage: $0 {init|up|health|down|compose}" >&2
  exit 2
  ;;
esac

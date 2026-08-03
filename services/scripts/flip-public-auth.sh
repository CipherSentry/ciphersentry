#!/usr/bin/env bash
# End-to-end public AUTH flip:
#   1) local e2e:auth
#   2) fly deploy (AUTH_REQUIRED=1 in fly.toml)
#   3) live e2e:auth:public
#
#   export FLY_API_TOKEN=…   # or fly auth login
#   bash services/scripts/flip-public-auth.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/services"
export PATH="${HOME}/.fly/bin:${PATH}"

APP="${FLY_APP:-ciphersentry}"
GATEWAY_URL="${GATEWAY_URL:-https://${APP}.fly.dev}"

echo "== 1/3 local AUTH abuse e2e =="
npm run e2e:auth

if ! command -v fly >/dev/null 2>&1 && ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl missing — install: curl -L https://fly.io/install.sh | sh" >&2
  exit 1
fi
FLY=$(command -v fly 2>/dev/null || command -v flyctl)

if ! $FLY auth whoami >/dev/null 2>&1; then
  echo "Fly not authenticated. Set FLY_API_TOKEN or run: fly auth login" >&2
  exit 1
fi

echo "== 2/3 fly deploy -a ${APP} (AUTH_REQUIRED=1) =="
$FLY deploy -a "$APP" --config fly.toml --remote-only

echo "== 3/3 live public AUTH e2e =="
# machines take a few seconds to pass health
for i in $(seq 1 40); do
  if curl -sf --max-time 10 "${GATEWAY_URL}/health" | grep -q '"auth_required":true'; then
    break
  fi
  sleep 3
done

GATEWAY_URL="$GATEWAY_URL" npm run e2e:auth:public
echo "PUBLIC AUTH FLIP OK → ${GATEWAY_URL}"

#!/usr/bin/env bash
# Chain rails — mainnet-shaped local/demo path (B0/B4/B5).
#
#   anvil deploy → escrow + batcher + ruler keys → gateway write-ready
#   optional: BASE_SEPOLIA=1 with PRIVATE_KEY
#
# Usage:
#   bash services/scripts/e2e-rails.sh           # local anvil
#   BASE_SEPOLIA=1 bash services/scripts/e2e-rails.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.foundry/bin:${PATH}"

# Anvil default keys (batcher 2-of-3 + protocol/ruler)
KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEY1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
KEY2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

if [[ "${BASE_SEPOLIA:-0}" == "1" ]]; then
  echo "== Base Sepolia rails =="
  [[ -n "${PRIVATE_KEY:-}" ]] || { echo "set PRIVATE_KEY for sepolia deploy" >&2; exit 1; }
  cd "$ROOT/cipher/contracts"
  ./script/deploy-sepolia.sh
  set -a
  # shellcheck disable=SC1091
  source deployments/gateway.base-sepolia.env.example 2>/dev/null || true
  if [[ -f deployments/.env.gateway ]]; then source deployments/.env.gateway; fi
  set +a
  export PROTOCOL_KEY="${PROTOCOL_KEY:-$PRIVATE_KEY}"
  export RULER_KEY="${RULER_KEY:-$PROTOCOL_KEY}"
  export BATCHER_KEY_1="${BATCHER_KEY_1:-$PROTOCOL_KEY}"
  export BATCHER_KEY_2="${BATCHER_KEY_2:-$KEY1}"
  export BATCHER_KEY_3="${BATCHER_KEY_3:-$KEY2}"
  echo "  escrow=${ESCROW_ADDRESS:-?} batcher=${BATCHER_ADDRESS:-?}"
  echo "  run: PROTOCOL_KEY=… RULER_KEY=… npm run gateway -w gateway"
  echo "  or:  bash services/gateway/scripts/e2e-sepolia.sh"
  exit 0
fi

echo "== local anvil rails (B0 escrow + B4 batcher + B5 ruler) =="
cd "$ROOT/cipher/contracts"
./script/deploy-local.sh
set -a
# shellcheck disable=SC1091
source deployments/.env.gateway
set +a

export PROTOCOL_KEY="${PROTOCOL_KEY:-$KEY0}"
export RULER_KEY="${RULER_KEY:-$KEY0}"
export BATCHER_KEY_1="${BATCHER_KEY_1:-$KEY0}"
export BATCHER_KEY_2="${BATCHER_KEY_2:-$KEY1}"
export BATCHER_KEY_3="${BATCHER_KEY_3:-$KEY2}"
export BATCH_INTERVAL_MS="${BATCH_INTERVAL_MS:-0}"
export BATCH_MAX_PENDING="${BATCH_MAX_PENDING:-99}"
export AUTH_REQUIRED="${AUTH_REQUIRED:-0}"

echo "  CHAIN_RPC=$CHAIN_RPC"
echo "  ESCROW=$ESCROW_ADDRESS"
echo "  BATCHER=$BATCHER_ADDRESS"
echo "  SLASH=${SLASH_EXECUTOR_ADDRESS:-}"
echo "  PROTOCOL/RULER/BATCHER keys set (anvil #0–#2)"
echo ""
echo "→ chain e2e:  bash services/gateway/scripts/e2e-chain.sh"
echo "→ batcher:    bash services/gateway/scripts/e2e-batcher.sh"
echo "→ rails smoke: bash services/scripts/e2e-rails-smoke.sh"
echo "→ compose:    bash services/scripts/e2e-compose.sh"
echo ""
echo "env snippet:"
cat <<EOF
export CHAIN_RPC=$CHAIN_RPC CHAIN_ID=$CHAIN_ID
export ESCROW_ADDRESS=$ESCROW_ADDRESS BATCHER_ADDRESS=$BATCHER_ADDRESS
export USDC_ADDRESS=${USDC_ADDRESS:-}
export SLASH_EXECUTOR_ADDRESS=${SLASH_EXECUTOR_ADDRESS:-}
export PROTOCOL_KEY=$PROTOCOL_KEY RULER_KEY=$RULER_KEY
export BATCHER_KEY_1=$BATCHER_KEY_1 BATCHER_KEY_2=$BATCHER_KEY_2 BATCHER_KEY_3=$BATCHER_KEY_3
export PROTOCOL_FROM=${PROTOCOL_FROM:-}
EOF

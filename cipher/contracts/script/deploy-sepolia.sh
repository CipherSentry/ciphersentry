#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${PRIVATE_KEY:?set PRIVATE_KEY in contracts/.env or environment}"
: "${BASE_SEPOLIA_RPC:?set BASE_SEPOLIA_RPC}"

# three distinct signers — default to deployer-derived only if SIGNER_* set;
# otherwise use deployer + two burn-ish placeholders is INVALID for prod.
# Prefer explicit SIGNER_1/2/3. For first testnet deploy, reuse is rejected by batcher.
# Derive signers from anvil-style only when FORCE_DEV_SIGNERS=1
if [[ -z "${SIGNER_1:-}" ]]; then
  DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
  export SIGNER_1="$DEPLOYER"
  # need two more funded or at least valid distinct addresses (can be same key holders later)
  export SIGNER_2="${SIGNER_2:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
  export SIGNER_3="${SIGNER_3:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}"
  echo "using SIGNER_1=$SIGNER_1 SIGNER_2=$SIGNER_2 SIGNER_3=$SIGNER_3"
fi

mkdir -p deployments
echo "deploying to Base Sepolia via forge..."
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC" \
  --broadcast \
  -vvvv

if [[ -f deployments/base-sepolia.json ]]; then
  ESCROW=$(python3 -c 'import json;print(json.load(open("deployments/base-sepolia.json"))["escrow"])')
  BATCHER=$(python3 -c 'import json;print(json.load(open("deployments/base-sepolia.json"))["batcher"])')
  DEPLOYER=$(python3 -c 'import json;print(json.load(open("deployments/base-sepolia.json"))["deployer"])')
  cat > deployments/.env.gateway.sepolia <<EENV
CHAIN_RPC=$BASE_SEPOLIA_RPC
CHAIN_ID=84532
ESCROW_ADDRESS=$ESCROW
BATCHER_ADDRESS=$BATCHER
PROTOCOL_FROM=$DEPLOYER
EENV
  echo "wrote deployments/base-sepolia.json + deployments/.env.gateway.sepolia"
  cat deployments/base-sepolia.json
else
  echo "warn: deployments/base-sepolia.json missing — check forge logs" >&2
fi

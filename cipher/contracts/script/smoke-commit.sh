#!/usr/bin/env bash
# On-chain Escrow.commit smoke against deployments/local.json (anvil).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.foundry/bin:${PATH}"

JSON="${1:-deployments/local.json}"
RPC="${CHAIN_RPC:-http://127.0.0.1:8545}"
KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
FROM=$(cast wallet address --private-key "$KEY")

ESCROW=$(python3 -c "import json;print(json.load(open('$JSON'))['escrow'])")
USDC=$(python3 -c "import json;print(json.load(open('$JSON'))['usdc'])")
# worker = anvil #1
WORKER="${WORKER:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
AMOUNT="${AMOUNT:-10000000}" # 10 USDC (6 dec)
BOND="${BOND:-10000}"       # 0.01 USDC min bond
SPEC=$(cast keccak "render.sequence.4k")

echo "from=$FROM escrow=$ESCROW worker=$WORKER"

# ensure allowance
ALLOW=$(cast call "$USDC" "allowance(address,address)(uint256)" "$FROM" "$ESCROW" --rpc-url "$RPC")
echo "allowance=$ALLOW"
if [[ "$ALLOW" == "0" ]]; then
  cast send "$USDC" "approve(address,uint256)" "$ESCROW" "$(cast max-uint)" \
    --private-key "$KEY" --rpc-url "$RPC" >/dev/null
fi

TX=$(cast send "$ESCROW" "commit(bytes32,address,uint96,uint96)" \
  "$SPEC" "$WORKER" "$AMOUNT" "$BOND" \
  --private-key "$KEY" --rpc-url "$RPC" --json)
echo "$TX" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("tx", d.get("transactionHash") or d.get("hash")); print("status", d.get("status"))'

# decode Committed event if present
echo "latest escrow logs:"
cast logs --from-block 0 --to-block latest --address "$ESCROW" --rpc-url "$RPC" 2>/dev/null | tail -20 || true
echo "smoke-commit OK"

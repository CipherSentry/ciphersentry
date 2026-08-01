# Deployments

## Local (anvil) — default E2E path

```bash
cd cipher/contracts
chmod +x script/deploy-local.sh script/smoke-commit.sh
./script/deploy-local.sh          # starts anvil if needed, writes local.json
./script/smoke-commit.sh          # Escrow.commit on-chain

# gateway with chain watch + write
set -a && source deployments/.env.gateway && set +a
cd ../../services/gateway && npm run gateway
# console: ?net=rpc&node=http://127.0.0.1:8080
```

Artifacts:
- `local.json` — addresses (safe to commit for fixtures; regenerate anytime)
- `.env.gateway` — gitignored secrets/env for the gateway process

## Base-Sepolia

```bash
export PRIVATE_KEY=0x…          # funded sepolia key
export BASE_SEPOLIA_RPC=https://base-sepolia.publicnode.com
# optional: USDC_ADDRESS (defaults to Circle Base-Sepolia USDC)
# SIGNER_1/2/3 must be three distinct addresses

cd cipher/contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC" \
  --broadcast --verify -vvvv

# then:
export ESCROW_ADDRESS=… BATCHER_ADDRESS=… PROTOCOL_FROM=…
export CHAIN_RPC=$BASE_SEPOLIA_RPC CHAIN_ID=84532
```

Buyer must `approve` Escrow for USDC before on-chain `commit`.

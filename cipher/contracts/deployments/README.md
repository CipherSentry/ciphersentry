# Deployments

## Base Sepolia (live)

### Production (Circle USDC)

`base-sepolia.json` — canonical stack. Work prices in Circle USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

| Contract | Address |
| --- | --- |
| Escrow | [`0xa97E…7BB2`](https://sepolia.basescan.org/address/0xa97E729Fdb0002705a19cDd4F39FE551f3d77BB2) |
| Batcher | `0x72b735E47983ACb9039bb1f1B757BF9c09f4bfca` |
| CENT | `0x360e506eb0a646D91500BFFeB36723ca5aD023F8` |
| Deployer | `0x96a438924ACE133D5909bd3BAF3263845B760eF4` |

Gateway (watch):

```bash
export CHAIN_RPC=$BASE_SEPOLIA_RPC CHAIN_ID=84532
export ESCROW_ADDRESS=0xa97E729Fdb0002705a19cDd4F39FE551f3d77BB2
export BATCHER_ADDRESS=0x72b735E47983ACb9039bb1f1B757BF9c09f4bfca
```

On-chain commit needs Circle USDC balance + `approve(escrow)`.

```bash
# real USDC path (not mock)
# CIRCLE_KEY=0x… wallet with Base Sepolia USDC (faucet.circle.com)
npm run e2e:sepolia:circle -w @ciphersentry/services
# → Escrow.commit via gateway · basescan tx
```

### Dev write path (MockUSDC)

`base-sepolia-mockusdc.json` — mintable USDC for E2E commits without Circle faucet.

Smoke: `Escrow.commit` tx
[`0x8741…20f6`](https://sepolia.basescan.org/tx/0x8741743272ba7ae60e7dc56b7335a70e3454ee2544a0cc8b6cd3f50ea4dc20f6)

## Local (anvil)

```bash
./script/deploy-local.sh
./script/smoke-commit.sh
```

## Redeploy

```bash
# production USDC stack
PRIVATE_KEY=0x… forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_SEPOLIA_RPC --broadcast

# mock USDC stack (LOCAL=true)
PRIVATE_KEY=0x… LOCAL=true forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

## GitHub Actions

Workflow: [deploy-base-sepolia.yml](../../../.github/workflows/deploy-base-sepolia.yml)

1. Repo → **Settings → Secrets and variables → Actions**
2. Add secrets:
   - `PRIVATE_KEY` — funded Base Sepolia deployer (`0x…`)
   - `BASE_SEPOLIA_RPC` — Alchemy HTTPS URL
3. **Actions → deploy-base-sepolia → Run workflow**
   - `mode=local` → MockUSDC stack (write tests)
   - `mode=production` → Circle USDC stack
   - `write_deployment=true` commits `deployments/*.json` back to the branch

```bash
gh workflow run deploy-base-sepolia.yml -f mode=local -f write_deployment=true
gh run watch
```

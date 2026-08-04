# Key ceremony runbook

Offline generation → `*_FILE` mounts → on-chain align → verify write path.

**Scope:** B7 / public demo / mainnet prep. Not anvil demo keys.

**Gate:** public B7 green + Sepolia full e2e OK. Mainnet only after 2–3 CI `e2e:full` greens.

---

## 1. Roles (5 material keys)

| File | Env | On-chain role | Powers |
|------|-----|---------------|--------|
| `protocol_key` | `PROTOCOL_KEY` / `_FILE` | `PROTOCOL_FROM` EOA | gas + `Escrow.commit`, slash `submitEvidence`/`processNext`, batcher submit tx |
| `batcher_1` | `BATCHER_KEY_1` | `SettlementBatcher.signers[0]` | EIP-712 anchor / rotate quorum |
| `batcher_2` | `BATCHER_KEY_2` | `signers[1]` | same |
| `batcher_3` | `BATCHER_KEY_3` | `signers[2]` | same |
| `ruler_key` | `RULER_KEY` | `Escrow.RULER` (ctor, **immutable**) | EIP-712 fraud `rule` |

**Rules**

- 5 distinct EOAs. Never reuse protocol as both sole batcher slots.
- Batcher needs **2-of-3** distinct current signers for `anchorRoot` / `rotateSigner`.
- Prefer **split custody**: 3 humans/HSMs for batcher slots; protocol + ruler on operator HSM or cold→hot vault.
- Never put hex in git, chat, tickets, CI logs. `services/secrets/` + `prod.env` + `demo-kit.env` are gitignored.

---

## 2. Live mock stack (Base Sepolia) — before ceremony

From `deployments/base-sepolia-mockusdc.json` (public Fly demo):

```
BATCHER  0xb9cc42df4f77b172901ee4d84ced98f576dcc31f   # ceremony redeploy 2026-08-04; roster: scripts/ceremony-roster.sepolia.txt
ESCROW   0xB41EC9A2E9fD7b9226E53a93daef0E1655729890
PROTOCOL 0xab290337AF2f808D5aA3Ff0dbF270253AEb6E1E3   # funded for gas; not anvil
```

Current signers (read any time):

```bash
RPC=https://sepolia.base.org
B=0xb9cc42df4f77b172901ee4d84ced98f576dcc31f
for i in 0 1 2; do cast call $B "signers(uint256)(address)" $i --rpc-url $RPC; done
# expected (ceremony batcher_1/2/3 — see ceremony-roster.sepolia.txt):
# [0] 0x8e689E…c3FAD
# [1] 0x621397…6FffF
# [2] 0xeEDB7D…EC3d0
```

Escrow `RULER` = `0x96a438…760eF4` (immutable). Rotating ruler ⇒ **redeploy escrow**. Fly `RULER_KEY` must recover to that address until full redeploy.

**Critical:** any key pasted in chat is burned — rotate before ceremony exit.

### Post-ceremony live mock (hybrid)

| Piece | Address / status |
|-------|------------------|
| Protocol | `0xab2903…E1E3` (ceremony; Fly secrets) |
| Batcher | `0xb9cc42…c31f` ceremony 2-of-3 |
| Slash WATCHER/RESOLVER | still hybrid on `0xbbdeb9…cA74` |
| Registry | `0x3e237d…2211` + CENT |
| Escrow + USDC | pre-ceremony (`0xB41EC9…` / mock USDC) — **RULER still `0x96a438…`** |
| Anvil keys | removed from Fly batcher/protocol; backup under `secrets/.anvil-backup-*` (local only) |

Escrow `RULER` still pre-ceremony until funded full escrow redeploy.

---

## 3. Offline generation (airgap / offline machine)

```bash
# one-shot; print ADDRESS only to shared log; private stays on operator media
gen() {
  local name=$1 out=${2:-./ceremony-out}
  mkdir -p "$out" && chmod 700 "$out"
  local key
  key=$(cast wallet new --json)
  echo "$key" | python3 -c "import json,sys; d=json.load(sys.stdin); open('$out/$name','w').write(d['private_key'].replace('0x','')); print(d['address'])"
  chmod 600 "$out/$name"
}

gen protocol_key
gen batcher_1
gen batcher_2
gen batcher_3
gen ruler_key   # mainnet / new escrow only; Sepolia mock may reuse protocol
```

Record (public) roster:

```
PROTOCOL_FROM=<protocol addr>
SIGNER_1=<batcher_1 addr>
SIGNER_2=<batcher_2 addr>
SIGNER_3=<batcher_3 addr>
RULER=<ruler addr>   # must equal Escrow.RULER for this deployment
```

Fund `PROTOCOL_FROM` with gas (Base Sepolia ETH / mainnet ETH). Batcher keys need **no** balance (off-chain sign only). Protocol pays gas for `anchorRoot` submit.

---

## 4. Install files on host (B7 compose)

```bash
# on host
mkdir -p services/secrets && chmod 700 services/secrets
# copy 64-hex (no 0x required) into:
#   services/secrets/{protocol_key,batcher_1,batcher_2,batcher_3,ruler_key}
chmod 600 services/secrets/*
# never: git add services/secrets

# prod.env — chain only, no key material
cp services/scripts/prod.env.example services/prod.env
# set CHAIN_RPC, CHAIN_ID, ESCROW_*, BATCHER_*, USDC_*, SLASH_*, PROTOCOL_FROM
```

Compose already maps:

```
PROTOCOL_KEY_FILE=/run/secrets/protocol_key
BATCHER_KEY_{1,2,3}_FILE=/run/secrets/batcher_{1,2,3}
RULER_KEY_FILE=/run/secrets/ruler_key
```

```bash
docker compose -f services/docker-compose.b7.yml --env-file services/prod.env up -d
curl -sS http://127.0.0.1:8080/health | jq '{ok,b7,kv,bus,escrow,batcher,slash_executor,fraud,auth_required}'
# expect: b7=true kv=redis bus=nats escrow/batcher/slash/fraud write-ready
```

Bare metal: `bash services/scripts/b7-host.sh init` then replace anvil placeholders under `services/secrets/`, then `INDEXER=1 bash services/scripts/b7-host.sh up`.

---

## 5. On-chain: align batcher signers

Gateway keys **must** recover to `SettlementBatcher.signers`. If files ≠ chain, anchors revert `NotASigner` / `InsufficientSignatures`.

### A) New deploy (preferred for mainnet)

```bash
export PRIVATE_KEY=0x…          # temporary deploy key only
export SIGNER_1=0x… SIGNER_2=0x… SIGNER_3=0x…
export RULER=0x…                # = ruler_key address
export USDC_ADDRESS=0x…         # Circle mainnet / mock
# cd cipher/contracts && forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast
```

Write new addresses into `prod.env` / deployment JSON. Retire deploy key if distinct from protocol.

### B) Rotate existing batcher (Sepolia mock / live)

`rotateSigner(slot, next, sigs)` — **one slot per tx**, 2-of-3 of **current** set.

```bash
RPC=https://base-sepolia.publicnode.com
B=<BATCHER_ADDRESS>
# keys that are CURRENT signers (hex with 0x)
export CUR0=0x… CUR1=0x… CUR2=0x…   # private keys for slots 0,1,2
export NEXT0=0x…                     # new address for slot 0

# 1) read rotateNonce
N=$(cast call $B "rotateNonce()(uint256)" --rpc-url $RPC)

# 2) gateway signs rotate digests (or offline cast wallet sign)
#    digest = EIP-712 SettlementBatcher / Rotate(slot,next,nonce)
#    Use two CURRENT signers that remain valid after the swap when possible.
#    Practical path: run a short node script against gateway batcher domain
#    (same DOMAIN_SEPARATOR as on-chain) — or cast + eth_signTypedData.

# 3) submit (PROTOCOL pays gas)
cast send $B "rotateSigner(uint8,address,bytes[])" \
  0 "$NEXT0" "[$SIG_A,$SIG_B]" \
  --rpc-url $RPC --private-key $PROTOCOL_KEY
```

Order for full swap off anvil set:

1. Rotate slot 1 → new `batcher_2` (quorum: deployer + anvil#2)
2. Rotate slot 2 → new `batcher_3` (quorum: deployer + new batcher_2)
3. Rotate slot 0 → new `batcher_1` **last** if protocol leaves the set (quorum: new 2 + 3)

After each step:

```bash
cast call $B "signers(uint256)(address)" $slot --rpc-url $RPC
cast call $B "isSigner(address)(bool)" $NEXT --rpc-url $RPC  # true
```

### C) Ruler

Cannot rotate. Options:

- Keep `ruler_key` == current `Escrow.RULER` address material, or
- Redeploy escrow with new `RULER`, migrate traffic, update `ESCROW_ADDRESS`.

---

## 6. Fly public node

Fly has no file mounts in the default public image — use **secrets** (still not git):

```bash
fly secrets set -a ciphersentry \
  PROTOCOL_KEY="$(cat services/secrets/protocol_key | sed 's/^/0x/')" \
  PROTOCOL_FROM=0x… \
  BATCHER_KEY_1=0x… BATCHER_KEY_2=0x… BATCHER_KEY_3=0x… \
  RULER_KEY=0x… \
  CHAIN_RPC=https://base-sepolia.publicnode.com
# prefer publicnode over Alchemy for EIP-7702 EOAs
fly deploy …   # only if image/config change required; secrets alone restart
```

Unset any burned keys. Confirm:

```bash
curl -sf https://ciphersentry.fly.dev/health | jq '{ok,b7,escrow,batcher,slash_executor,auth_required}'
npm run e2e:auth:public -w @ciphersentry/services
```

---

## 7. Acceptance tests

| Check | Command / expect |
|-------|------------------|
| Health B7 | `kv=redis` `bus=nats` `b7=true` write-ready on escrow/batcher/slash |
| Signers match | chain `signers[i]` == `cast wallet address` of each `batcher_*` file |
| Commit path | `task.commit` → `chain.mode=submitted` + receipt |
| Anchor | `batch.anchor` → 2-of-3, receipt `BatchAnchored` |
| Slash | `submitEvidence` + `processNext` → bond cut |
| Auth | `e2e:auth` / `e2e:auth:public` |
| Full | `npm run e2e:sepolia:full -w @ciphersentry/services` (mock stack) |

Local file check (no secret print):

```bash
for f in protocol_key batcher_1 batcher_2 batcher_3 ruler_key; do
  test -s "services/secrets/$f" && echo "ok $f $(wc -c < services/secrets/$f)B"
done
# derive addresses only
for f in protocol_key batcher_1 batcher_2 batcher_3 ruler_key; do
  printf '%s ' "$f"
  cast wallet address --private-key "0x$(tr -d '\n' < services/secrets/$f | sed 's/^0x//')"
done
```

---

## 8. Compromise / rotation

| Event | Action |
|-------|--------|
| Protocol leaked | Generate new EOA → fund gas → update `protocol_key` + `PROTOCOL_FROM` → if it was batcher slot 0, `rotateSigner(0,next)` first → drain old EOA |
| One batcher leaked | `rotateSigner(slot, next)` with other two → replace file → restart gateway |
| Two batchers leaked | Treat as lost quorum; use remaining + emergency path only if windows missed; prefer redeploy batcher |
| Ruler leaked | Redeploy escrow with new RULER; freeze old via ops runbook / stop gateway writes to old addr |
| Any paste to chat/git | Burn immediately; assume public |

Destroy offline media after dual-control confirm (or seal in HSM). Log public addresses + tx hashes only.

---

## 9. Mainnet delta

Do **not** start until: 2–3 green CI `e2e:full`, hosted B7 stable, audits #1+#2 scoped.

1. Ceremony on airgap with dedicated RULER ≠ protocol (recommended).
2. Deploy with `SIGNER_1..3` + `RULER` + Circle mainnet `USDC_ADDRESS`.
3. `*_FILE` only on prod hosts (no Fly env if avoidable; vault/k8s secret).
4. Fund protocol gas only; no mock mint.
5. Smoke: single small commit → settle → anchor → (optional) controlled slash on test bond.
6. Publish deployment JSON (addresses only) + Basescan links.

---

## 10. Checklist (print / tick)

- [ ] Burn any chat-exposed keys
- [ ] 5 keys generated offline; addresses recorded
- [ ] `services/secrets/*` mode 600; dir 700; not in git
- [ ] `PROTOCOL_FROM` funded
- [ ] Chain `signers[0..2]` match batcher files (deploy or rotate)
- [ ] `RULER` matches `ruler_key` address (or accepted protocol==ruler)
- [ ] B7 health write-ready
- [ ] Sepolia full e2e green (or mainnet smoke)
- [ ] Fly secrets rotated if public node uses env keys
- [ ] Old anvil / deployer material removed from prod mounts

---

## Refs

- Custody code: `services/gateway/src/keys.ts`
- Batcher 2-of-3 + `rotateSigner`: `cipher/contracts/src/SettlementBatcher.sol`
- Deploy env: `SIGNER_1..3`, `RULER` in `cipher/contracts/script/Deploy.s.sol`
- Host: `services/scripts/b7-host.sh`, `services/docker-compose.b7.yml`
- Public: `services/scripts/HOSTING.md`, `services/fly/README.md`

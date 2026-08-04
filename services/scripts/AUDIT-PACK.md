# Cipher Sentry — Pre-engagement audit pack (DOC-07 / G3)

**Status:** shippable · contact `hello@ciphersentry.com`  
**Network (dev):** Base Sepolia mock stack · **Mainnet:** not in scope until both audits close  
**Freeze (sources):** `sha256(concat sorted cipher/contracts/src/**/*.sol)` =
`2b757cbf169ce82c2f898325267121a6e96bf221543e49b26360404141bd8504`  
**Repo pin (at pack issue):** merge `main` after ceremony hybrid cleanup; re-hash at kickoff.

Auditors audit against **commit freeze** — no mid-review scope drift. Any post-freeze source change reopens that engagement's contracts.

---

## 1. Engagements

| # | Name | Contracts | Est. LOC | Risk | Duration |
|---|------|-----------|---------|------|----------|
| **A** | Capital | `Escrow` · `SettlementBatcher` · `CENT` · `VestingVault` | ≈ 1,080 | CRITICAL | 3w + 2w remediation |
| **B** | Consensus | `VerifierRegistry` · `QuorumElection` · `SlashExecutor` (+ emissions if present) | ≈ 1,200 | CRITICAL | 3w + 2w remediation |

Read the product surface in-app: `#/docs/audit` (same content as this pack's threat tables).

---

## 2. Deliverables for each firm

1. Written report (full text, publishable) with severity rubric below  
2. PoC or invariant test for every CRITICAL / HIGH  
3. Remediation review of patches (re-audit window included in estimate)  
4. Optional: formal notes on residual OPEN items (not blockers if MEDIUM/LOW)

---

## 3. Severity rubric & SLA

| Severity | Definition | Example | SLA |
|----------|------------|---------|-----|
| CRITICAL | loss of user funds or escrow invariants broken | I-E1 / I-E2 break | fix + re-audit before any mainnet deploy |
| HIGH | network-wide liveness or trust compromise | election capture, slash grief | fix before G3 closes |
| MEDIUM | bounded loss or degraded correctness | rounding, boundary snapshot | fix before mainnet |
| LOW / INFO | hardening, clarity, gas | events, natspec | rolling backlog |

**G3 rule:** no launch-gate #3 until every CRITICAL and HIGH is closed.

---

## 4. Invariant map (DOC-07 → tests)

Primary map: [`cipher/contracts/README.md`](../../cipher/contracts/README.md).

| Area | Invariants | Foundry suite |
|------|------------|---------------|
| Escrow | I-E1…I-E4 | `EscrowInvariants.t.sol` |
| Batcher | B-R1…B-R4 | `BatchInvariants.t.sol` |
| Registry / election | I-R* + election determinism | `RegistryElectionInvariants.t.sol` |
| Slash / vesting | I-SE1…I-SE4, I-V* | `SlashVestingInvariants.t.sol` |

```bash
cd cipher/contracts
forge test -vv
forge test --match-contract EscrowInvariants
forge test --match-contract BatchInvariants
```

---

## 5. Live Sepolia reference (mock USDC — not mainnet)

Addresses only — see also [`ceremony-roster.sepolia.txt`](./ceremony-roster.sepolia.txt).

| Role | Address |
|------|---------|
| Escrow | `0x20a1253ec5b06e319384762c0b1b896d5b9baf15` |
| SettlementBatcher | `0xb9cc42df4f77b172901ee4d84ced98f576dcc31f` |
| VerifierRegistry | `0x44edb88067dcb0593db73603679ef42880141d58` |
| SlashExecutor | `0xa457acbb26bc794d4ad5bd3404cb311e8d7f7aec` |
| MockUSDC | `0x4fa4890F31143C5158eD0Aa95d80815bFd3580D0` |
| CENT | `0x4f3e99cafe2a0e9803b9a7aae9cca2163348cfa1` |
| Public node | `https://ciphersentry.fly.dev` (AUTH_REQUIRED, B7) |

**Out of scope for funds risk on Sepolia:** MockUSDC is mintable faucet USDC — treat as harness, not capital.

---

## 6. Threat models (summary)

Full tables: product `#/docs/audit`. Highlights for kickoff:

### ENG-A — Capital
- Escrow: reentrancy, ruling replay across rails, fraud-window squeeze, commit griefing, fee dust  
- Batcher: root forgery (2-of-3), withholding / liveness, MEV (append-only)  
- CENT / vesting: mintlessness, epoch-index monotone, boundary claims  

### ENG-B — Consensus
- Election: blockhash bias, sybil grinding, whale weight >67%  
- Slash: evidence replay, challenge griefing, epoch cap DoS, false evidence  
- Residual: collusion detection is economic + heuristic — attack explicitly  

### Cross-contract
- Multi-rail EIP-712 domain separation (`chainId`)  
- USDC upgradeability as external dependency  
- No admin path that moves escrowed funds without proof or RULER ruling  

---

## 7. Engagement timeline (default)

```
W1  ENG-A kickoff — freeze hash anchored (on-chain note or signed commit)
W3  ENG-A report — triage within 48h
W4  remediation window A (+ re-audit of patches)
W6  ENG-B kickoff
W8  ENG-B report — triage within 48h
W9  remediation window B → G3 evaluation
```

---

## 8. Kickoff checklist (operator)

- [ ] Recompute freeze hash on engagement start; record in signed mail + Basescan memo tx  
- [ ] Share this pack + repo access + Foundry version pin  
- [ ] Provide Sepolia addresses + public node for live smoke (not mainnet)  
- [ ] Confirm publishable-report clause  
- [ ] Book remediation windows before kickoff  

---

## 9. RFP

See [`AUDIT-RFP.md`](./AUDIT-RFP.md) — one-page invite for firms.

---

## 10. Contact

**hello@ciphersentry.com** · Reports published in full — verifiers deserve to read what they bond against.

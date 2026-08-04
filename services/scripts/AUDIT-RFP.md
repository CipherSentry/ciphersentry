# RFP — Independent smart-contract audit (Cipher Sentry / CENT)

**From:** Cipher Sentry · `hello@ciphersentry.com`  
**Subject:** Pre-launch audit engagements A (capital) & B (consensus)  
**Pack:** [`AUDIT-PACK.md`](./AUDIT-PACK.md) · Product docs: `https://ciphersentry.xyz/#/docs/audit`

---

## Ask

We request proposals for **two independent audits** of the Cipher Sentry Solidity core before Base mainnet and the CENT launch gate (G3).

| Engagement | Scope | Est. LOC | Target duration |
|------------|-------|---------|-----------------|
| **A — Capital** | Escrow, SettlementBatcher, CENT, VestingVault | ≈ 1,080 | 3 weeks + 2 weeks remediation review |
| **B — Consensus** | VerifierRegistry, QuorumElection, SlashExecutor | ≈ 1,200 | 3 weeks + 2 weeks remediation review |

Firms may bid on **A only**, **B only**, or **both** (preferred: two different firms).

---

## Requirements

1. **Freeze discipline** — audit against a pinned source hash (see pack); post-freeze changes reopen scope for that contract.  
2. **Invariant-first** — map findings to DOC-07 invariants (I-E*, B-R*, I-R*, I-SE*, I-V*). Foundry suites ship in-repo.  
3. **Publishable report** — full text may be published (verifiers bond against these contracts).  
4. **PoCs** — CRITICAL/HIGH require exploit sketch or failing invariant test.  
5. **Remediation review** — estimate includes one re-review of patches.  

---

## Out of scope (initial)

- Off-chain gateway / indexer TypeScript (unless firm offers optional add-on)  
- Circle USDC / Base L1 itself  
- Mainnet deployment ops and key ceremony procedures  
- Frontend / marketing site  

---

## Environment

- Language: Solidity ^0.8.26 · Foundry tests  
- Devnet: Base Sepolia mock USDC stack (addresses in pack)  
- Public B7 node for live smoke: `https://ciphersentry.fly.dev`  

---

## Proposal contents

Please include:

1. Firm background + 2–3 comparable L2/DeFi escrow or staking audits  
2. Named lead + team FTEs for the window  
3. Methodology (manual + fuzz / formal tools)  
4. Calendar start date and fixed-fee or cap for A / B / both  
5. Conflicts disclosure (prior work on related tokens/rails)  
6. Draft MSA / NDA terms if required  

---

## Timeline

| Milestone | Target |
|-----------|--------|
| RFP responses | within 10 business days of receipt |
| ENG-A kickoff | as soon as firm + freeze hash ready |
| G3 (both audits closed) | after remediation windows; **not** calendar-compressed |

---

## Evaluation

- Depth on capital-custody and multi-sig / EIP-712 designs  
- Clarity of severity rubric alignment with pack §3  
- Ability to work with Foundry invariant suites  
- Publishable-report comfort  
- Availability in the next 4–8 weeks  

---

## Contact

**hello@ciphersentry.com**  
Attach PDF or link; reference pack version / freeze hash in the subject line.

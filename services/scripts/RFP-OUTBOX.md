# RFP outbox — G3 send log

**From:** `hello@ciphersentry.com`  
**Prepared:** 2026-08-04  
**Pack:** [`AUDIT-PACK.md`](./AUDIT-PACK.md) · [`AUDIT-RFP.md`](./AUDIT-RFP.md)  
**Freeze:** `a5ab9e52103bdda839a7f2445526d1bc7f086e21ad526e221f87ea1d226be2de`  
**Product surface:** `https://ciphersentry.xyz/#/docs/audit`  
**Public node:** `https://ciphersentry.fly.dev`

> **Operator action required:** this environment cannot send mail from
> `hello@ciphersentry.com`. Copy the body below into your mail client (or
> CRM), attach/link the pack, and mark each row **SENT** with date + thread id.

---

## Target list (independent firms — prefer two different firms for A vs B)

| # | Firm | Contact channel | Engagement | Status | Sent at | Thread / note |
|---|------|-----------------|------------|--------|---------|---------------|
| 1 | Trail of Bits | `hello@trailofbits.com` / sales form | A and/or B | READY | — | — |
| 2 | Spearbit / Cantina | portal / sales | A and/or B | READY | — | — |
| 3 | OpenZeppelin | security form | A (capital) preferred | READY | — | — |
| 4 | Consensys Diligence | diligence form | B (consensus) preferred | READY | — | — |
| 5 | Sigma Prime | security form | A and/or B | READY | — | — |
| 6 | Runtime Verification | contact form | B (formal-friendly) | READY | — | — |

Replace/add rows to match your actual shortlist. Two **different** firms for A vs B is preferred.

---

## Subject line

```
Cipher Sentry — Pre-launch audit RFP (ENG-A capital + ENG-B consensus) · freeze a5ab9e52…
```

---

## Body (plain text)

```
Hello,

Cipher Sentry is requesting proposals for two independent smart-contract
audits before Base mainnet and our CENT launch gate (G3).

Engagements (firms may bid A only, B only, or both; preferred = two firms):

  A — Capital (~1,080 LOC, 3w + 2w remediation review)
      Escrow · SettlementBatcher · CENT · VestingVault

  B — Consensus (~1,200 LOC, 3w + 2w remediation review)
      VerifierRegistry · QuorumElection · SlashExecutor

Source freeze (sha256 of sorted cipher/contracts/src/**/*.sol):
  a5ab9e52103bdda839a7f2445526d1bc7f086e21ad526e221f87ea1d226be2de

Pack + RFP (same content as product #/docs/audit):
  https://ciphersentry.xyz/#/docs/audit
  Repo paths: services/scripts/AUDIT-PACK.md · AUDIT-RFP.md

Devnet reference (Base Sepolia mock USDC — not mainnet capital):
  Public B7 node: https://ciphersentry.fly.dev
  Addresses in AUDIT-PACK §5 / ceremony-roster.sepolia.txt

Please include in the proposal:
  1. Firm background + 2–3 comparable L2/DeFi escrow or staking audits
  2. Named lead + team FTEs for the window
  3. Methodology (manual + fuzz / formal)
  4. Calendar start + fixed-fee or cap for A / B / both
  5. Conflicts disclosure
  6. Draft MSA / NDA if required

Target response: within 10 business days of receipt.
Contact: hello@ciphersentry.com — reference freeze hash in the subject line.

Thank you,
Cipher Sentry
```

---

## Send checklist

- [ ] Confirm freeze hash still matches `cipher/contracts/src/**/*.sol` at send time  
- [ ] Attach or link AUDIT-PACK + AUDIT-RFP (PDF optional)  
- [ ] Send from `hello@ciphersentry.com` (or alias that can receive replies)  
- [ ] Update Status column above to **SENT** with UTC date  
- [ ] After first firm books: set Gates G3 metric to firm names / start week  
- [ ] Do **not** share ceremony private keys or Fly tokens with auditors  

---

## Log (append only)

| When (UTC) | Who | Action |
|------------|-----|--------|
| 2026-08-04 | ops/agent | Outbox prepared; human send pending (no mailbox in agent env) |

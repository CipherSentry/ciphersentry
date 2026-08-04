# Orynth listing pack — CENT TGE

**Venue:** https://orynth.dev  
**Product pack (public):** https://ciphersentry.xyz/#/cent  
**Tokenomics:** https://ciphersentry.xyz/#/docs/tokenomics  
**Audits:** https://ciphersentry.xyz/#/docs/audit  
**Contact:** hello@ciphersentry.xyz

---

## One-paragraph pitch

Cipher Sentry is neutral settlement rails for AI agents. Agents lock USDC for
work; independent verifiers recompute outputs and stake **CENT** — false votes
slash. CENT is the bond asset only (not a payment rail). Fair launch on Orynth:
no presale, no VC token round, no tokenomics table yet.

---

## Facts for the form

| Field | Value |
|-------|--------|
| Token | CENT |
| Launch | Fair launch — no presale, no VC token round |
| Tokenomics | Not published yet |
| Work unit | USDC (CENT is bond only) |
| Product URL | https://ciphersentry.xyz |
| Listing pack | https://ciphersentry.xyz/#/cent · #/gates |
| Demo node | https://ciphersentry.fly.dev |
| Freeze | `services/scripts/freeze-hash.sh` |

---

## Go-live blockers (ordered)

1. **RFP outbound** — `RFP-OUTBOX.md` from hello@ciphersentry.xyz  
2. **G3** — two audits closed, CRITICAL/HIGH fixed  
3. **G5** — Orynth listing + legal / counsel  
4. **Mainnet** — ceremony + Circle USDC bond rail  
5. **TGE** — liquidity + allocation table locked  

Sepolia mock CENT / elect = demo only.

---

## Recompute freeze

```bash
./services/scripts/freeze-hash.sh
# expect: a5ab9e52103bdda839a7f2445526d1bc7f086e21ad526e221f87ea1d226be2de
# (re-hash at audit kickoff if sources moved)
```

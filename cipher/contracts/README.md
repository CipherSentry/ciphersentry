# CipherSentry Contracts — ENG-A (Capital)

Invariant-first Solidity for the two capital contracts the audit gate depends
on. Every property on this list maps to a line of
[DOC-07 Audit Readiness](../src/docs/AuditReadiness.tsx), and every line of
that doc is enforced by a named test here.

## Layout

```
src/
├── Escrow.sol              # task escrow, quorum voting, EIP-712 rulings (~480 LOC)
├── SettlementBatcher.sol   # 2-of-3 merkle-root anchoring + emergency window (~260 LOC)
├── VerifierRegistry.sol    # ENG-B — 25,000 CENT floor, stake/unbond/jail (~390 LOC)
├── QuorumElection.sol      # ENG-B — deterministic quorum per DOC-07 §05 (~210 LOC)
├── MarcToken.sol           # ENG-A — fixed supply, mintless bytecode
├── VestingVault.sol        # ENG-A — epoch-indexed vesting, monotone, capped
└── SlashExecutor.sol       # ENG-B — nullifiers, FIFO queue, epoch cap, 50/25/25 proceeds
test/
├── mocks/MockUSDC.sol
├── EscrowInvariants.t.sol             # I-E1 … I-E4 + adversarial fuzz
├── BatchInvariants.t.sol              # B-R1 … B-R4 + adversarial fuzz
├── RegistryElectionInvariants.t.sol   # I-R1 … I-R4, I-E1 … I-E3 + whale capture fuzz
└── SlashVestingInvariants.t.sol       # I-V1 … I-Vx, I-SE1 … I-SE4, proceeds conservation
```

## Setup

```bash
forge install foundry-rs/forge-std --no-commit
forge build
forge test -vv                          # unit + fuzz (10k runs)
forge test --match-contract EscrowInvariants   # ENG-A escrow campaign (256 runs × 256 depth)
forge test --match-contract BatchInvariants    # ENG-A batcher campaign
forge coverage                          # target: 100% line on Escrow
```

## Limits of this package

- **ERC20 dependencies** — the harness mocks USDC; OpenZeppelin is imported
  for hardening before audit, never after (audit complains about it, and it's
  a simple interface).
- **Verifier fee distribution** — voter rewards are ENG-B (consensus scope, via
  EmissionsDistributor). The capital contract only computes the treasury
  cut; emission flows pass it downstream.
- **Quorum election** — outside ENG-A (`VerifierRegistry/QuorumElection` are
  ENG-B). The ruler seeds the allowed voter set here; the election contract
  replaces that call before deployment.
- **CENT token & VestingVault** — ENG-A scope but tracked in a separate
  package (`contracts-token/`) so this freeze stays small.

## Invariant map — DOC-07 → enforced property

| DOC-07 line | Invariant | Where |
| --- | --- | --- |
| I-E1 funds move only on matched proof or signed ruling in window | `invariant_IE1_legalPayoutsOnly` | `EscrowInvariants.t.sol` |
| I-E1 forged rulings never resolve | `testFuzz_forgedRulingReverts` | same |
| I-E1 rulings rejected outside window (both sides) | `testFuzz_rulingWindowStrict` | same |
| I-E2 Σ escrowed + bonds == balance at all times | `invariant_IE2_accounting` | same |
| I-E3 settle is single-shot — terminals never mutate | `invariant_IE3_terminalStability` | same |
| I-E4 no pause / freeze — `defaultRefund` path is the bound | drive paths in `EscrowHandler` | same |
| B-R1 anchors append-only, monotone id | `invariant_BR1_appendOnly` | `BatchInvariants.t.sol` |
| B-R2 no anchor without current 2-of-3 | `testFuzz_forgedAnchorReverts` | same |
| B-R3 emergency only after 2 misses | `invariant_BR3_emergencyGated`, `testFuzz_emergencyBeforeMissedReverts` | same |
| B-R4 rotation replaces authority instantly | `invariant_BR4_authorityMatchesSlots` | same |
| I-R1 balance == bonded + queued at all times | `invariant_IR1_accounting` | `RegistryElectionInvariants.t.sol` |
| I-R2 no sub-floor seat is ever eligible | `invariant_IR2_floorSafe` | same |
| I-R4 jailed verifier cannot move | `testFuzz_jailBlocksMovement` | same |
| I-E1 same epoch + same candidates ⇒ identical seats; once per epoch | `test_electionDeterministicAndLocked` | same |
| I-E3 seat weight ≤ 67% of quorum weight | determinism assertions + `testFuzz_whaleCaptureReverts` | same |
| Election jitter ∈ [0.75, 1.25) always | `testFuzz_jitterBounded` | same |
| I-V1/I-V2 vesting monotone, cliff gated, capped | `testFuzz_vestingMonotoneCliffAndCap` | `SlashVestingInvariants.t.sol` |
| I-V3 claim conservation + payout exactness | `test_claimConservationAndPayOut` | same |
| Epoch-indexed vesting ignores wall clock | `testVestingEpochIndexed_NotWallClock` | same |
| I-SE1 evidence replay blocked by nullifier | `testFuzz_evidenceReplayBlocked` | same |
| I-SE2 epoch cap defers overflow, never truncates | `testEpochCapDefersOverflowToNextEpoch` | same |
| I-SE3 FIFO ordering preserved | `testFuzz_fifoOrderPreserved` | same |
| Slash proceeds 50/25/25 conserve exactly | `testProceedsSplitIsExact` | same |

## Architecture notes for auditors

- **CEI + nonReentrant** on every path that moves USDC; custom errors instead
  of strings; no assembly beyond sig destructure + an mstore-free contract.
- **Timestamp vs blocks** — execution TTL is wall-clock (seconds), the
  fraud-proof window is block-count. They are deliberately different yokes.
- **Domain separation** — every EIP-712 digest carries `chainId`; rulings and
  anchors cannot replay across rails (DOC-07 §07).
- **No admin key exists that moves funds** — the only privileged act is
  verifier-set membership (ENG-B replaces it) and `setVerifier`, wired to the
  RULER key cold from deployment.

## Freeze protocol

1. `forge build` + `forge coverage` green, 100% line on `Escrow.sol`.
2. Commit hash anchored via the batcher on Base-Sepolia (dev-net batch).
3. Engagements read DOC-07 line-by-line against this map; any repo drift
   reopens that contract's review.

If an invariant here ever fails in CI, the commit is not a candidate for
audit — it's a candidate for deletion. Fix first.

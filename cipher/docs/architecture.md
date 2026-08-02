# CipherSentry Backend — Architecture Brainstorm

Status: **B4 settlement-ready** — B3 CENT path plus **SettlementBatcher writer**:
settled receipts → Merkle root → 2-of-3 EIP-712 `anchorRoot` via
`BATCHER_ADDRESS` + `BATCHER_KEY_{1,2,3}` (Alchemy / anvil). Reference client:
`src/sdk/ciphersentry.ts` (`?net=rpc|sim`).

---

## 1. Shape

```
                        ┌────────────────────────────┐
   agents / consoles ──▶│  EDGE GATEWAY              │
                        │  JSON-RPC + WebSocket      │
                        │  auth: ed25519 challenge   │
                        └─────────────┬──────────────┘
                                       │
        ┌──────────────┬───────────────┼────────────────┬──────────────┐
        ▼              ▼               ▼                ▼              ▼
  REGISTRY SVC    TASK SVC        VERIFIER POOL    ESCROW GW      SETTLEMENT
  (Postgres)      (state machine)  (daemons)       (chain signer)  BATCHER (30s)
        │              │               │                │              │
        └──────────────┴────── EVENT BUS (NATS / Kafka) ───────────────┘
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                     INDEXER /                 FRAUD-PROOF
                     RECEIPT GRAPH             WORKER (re-execute)
                     (ClickHouse)              (WASM sandbox)
```

## 2. Services

| Service | Duty | Notes |
| --- | --- | --- |
| **Edge gateway** | JSON-RPC + WS stream, auth | `task.commit`, `registry.query`, `verify`, `events/sub`; ed25519 sign-and-verify per session; rate limits keyed by stake |
| **Registry** | Agents, specs, trust scores | Trust materialized per epoch (`T_i` from docs); deterministic-spec validation at publish (sandbox dry-run ×2 must agree) |
| **Task service** | The 4-state machine | Postgres is system of record (`COMMITTED → EXECUTING → VERIFYING → SETTLED|DISPUTED|FAILED`); every transition is an event, never a mutation without log |
| **Verifier pool** | Independent re-execution daemons | Specs compile to **WASM**; runs in Firecracker-style microVMs; deterministic clock injected (seed from task input); median recompute ≤ 500ms |
| **Escrow gateway** | Chain signer for contract calls | HSM/KMS custody of *protocol* keys only — user funds stay non-custodial by contract; nonce manager + gas strategy per rail |
| **Settlement batcher** | 30s Merkle roots on-chain | Root per rail; receipts + inclusion proofs served by indexer |
| **Fraud-proof worker** | Challenges inside 64-block window | Listens for mismatches, recomputes with fresh quorum, posts ruling evidence |
| **Indexer / receipt graph** | Public queryable receipts | ClickHouse for analytical reads; serves the console's stream + proof inspector |

## 3. Data

- **Postgres** — tasks, agents, quorums, epochs, operator policies. Single writer per row via state-machine transitions.
- **NATS/Kafka** — every domain event (`task.committed` … `dispute.opened`); consumers: notifier, console WS fan-out, indexer.
- **Redis** — live counters, rate limits, stream backpressure (the 2.8s cadence the console shows), quorum election lock per epoch.
- **Object storage** — task outputs (content-addressed by their reported hash; dedupe is free).
- **ClickHouse** — receipts, trust time-series, batch analytics, the public agent graph.

## 4. CENT-readiness (V0.2 defaults)

- **Bond registry**: verifier bonds custodied in the staking contract; the pool reads them — never the app DB.
- **Slash executor**: on proven fault → contract call; 50% burn / 50% challenger+treasury. Emit `stake.slashed`.
- **Epoch scheduler**: 64-block epochs per rail; quorum selection is deterministic from `(epoch_seed, bond, historical accuracy)` — reproducible by anyone.
- **Accuracy² weighting** in fee distribution — computed off-chain, **proven on-chain** with variance bounds.

## 5. Wire surface (matches the SDK)

`registry.query(filter)` · `task.commit(params)` · `task.report(id, hash)` ·
`verify(task, {quorum})` · `task.settle(id)` · `dispute.open(id, evidence)` ·
`operator.rule(id, ruling, sig)` · `stake(amount, tier)` ·
`events.subscribe(topic)`.

Errors are the six `CEN_E_*` codes from the spec — nothing else escapes.

## 6. Security

- Key custody splits: operator device keys (console), protocol signer (HSM), contract-held user escrows (no key at all).
- Determinism is enforced twice: spec sandbox at registry publish, re-execution at verify.
- WS fan-out signs events; consoles verify — the app already displays "signed as they fire".
- Replay protection: commit envelopes include `task_id` client-generated + signer nonce; TTL enforced contract-side.

## 7. Rollout

| Phase | Ships | Depends |
| --- | --- | --- |
| B0 — Ledger | Task service + escrow gateway; **local anvil E2E green** (deploy + commit + gateway write); Base-Sepolia via same script with `PRIVATE_KEY` | audit #1 scoped |
| B1 — Verifier alpha | **3 foundation verifiers** on gateway `verify`; pure recompute + WASM sandbox; **slash dry-runs** | WASM sandbox hardened |
| B2 — Verifier network | **External stake** (`stake`), **epoch.elect** (top-3, whale cap), **real registry slashes** on mismatch | audits #1+#2 done |
| B3 — CENT-ready | **Accrual ledger** (0.35% fee, accuracy² weights, claim), **accuracy oracle**, optional **SlashExecutor** chain write | gate list in DOC-05 |
| B4 — Settlement batcher | **Merkle fold** of settled leaves, **2-of-3** EIP-712 `anchorRoot`, `batch.anchor` / auto-flush, on-chain `BatchAnchored` via Alchemy/anvil | B3 + batcher signers |

> Principle: the chain is the slow, small truth. Everything fast and big —
> streams, scores, receipts — is derived, reproducible, and disposable.

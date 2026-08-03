<div align="center">

![CipherSentry — the trust layer for agents that work](docs/screenshots/logo-mark.jpg)

# CIPHER SENTRY

**The guardian layer for agents that work.**
Autonomous agents commit capital. Sentries re-execute work byte-for-byte.
Escrow settles only on matching proof — never on promises, never with a
human in the loop.

![Protocol](https://img.shields.io/badge/PROTOCOL-V0.2-c6ff41?style=flat-square&labelColor=0d110a)
![Testnet](https://img.shields.io/badge/TESTNET-BASE--SEPOLIA-c6ff41?style=flat-square&labelColor=0d110a)
![CENT](https://img.shields.io/badge/CENT-LAUNCH%20GATES%20OPEN-c6ff41?style=flat-square&labelColor=0d110a)
![License](https://img.shields.io/badge/LICENSE-MIT-c6ff41?style=flat-square&labelColor=0d110a)
[![X](https://img.shields.io/badge/X-@ciphersentry-c6ff41?style=flat-square&labelColor=0d110a)](https://x.com/ciphersentry)

[ciphersentry.xyz](https://ciphersentry.xyz) · [App](#/app) · [Docs](#/docs/specification) · [Explorer](#/explorer) · [Launch Gates](#/gates) · [Investors](#/investors) · [Whitepaper](#/docs/whitepaper)

</div>

---

## What this repository is

An interactive, end-to-end implementation of the entire CipherSentry surface —
**marketing site, ops console, operator mobile app, public ledger explorer,
launch readiness board, docs center, smart contracts, and backend services** —
plus a typed SDK that every surface shares. The console reads a simulated
network today; the transport seam is cut for a real JSON-RPC node tomorrow.

| Surface | Route / path | Description |
| --- | --- | --- |
| Landing | `#/` | Live task-trace hero, ambient signal grid, protocol loop, roadmap, CENT rails |
| Ops Console | `#/app` (≥ lg) | Terminal-dense cockpit: stream, escrow state machine, verifiers, interventions, kill switch |
| Mobile Ops | `#/app` (< lg) | Operator phone app: feed, registry, wallet, hold-to-sign disputes |
| Task Explorer | `#/explorer` | Public ledger: batches, receipts, client-verified merkle proofs |
| Launch Gates | `#/gates` | G4 accrual counter live · freeze-hash anchor · signed verifier waitlist |
| Investors | `#/investors` | Round terms, use of proceeds, thesis, gate tracker, data room |
| Docs Center | `#/docs/*` | 8 documents: spec, SDK (with live playground), verification, whitepaper, tokenomics, audit pack, manifesto |
| Contracts | `contracts/` | Foundry ENG-A: Escrow + SettlementBatcher, invariant-suite first |
| Backend | `services/` | Verifier daemon (WASM sandbox) + indexer (Postgres + ClickHouse) |

## Screenshots

<div align="center">

| Landing — live task trace | Ops Console — observe mode |
| :---: | :---: |
| [![Landing](docs/screenshots/landing.jpg)](docs/screenshots/landing.jpg) | [![Console](docs/screenshots/console.jpg)](docs/screenshots/console.jpg) |

| Mobile Ops — feed + intervention | Docs — the manifesto |
| :---: | :---: |
| [![Mobile](docs/screenshots/mobile.jpg)](docs/screenshots/mobile.jpg) | [![Docs](docs/screenshots/docs.jpg)](docs/screenshots/docs.jpg) |

</div>

## The loop

One task. Four state changes. No fifth.

```
IDLE ── registry.query ──▸ MATCHED ── escrow.lock ──▸ LOCKED
LOCKED ── output.report ──▸ PROVEN ── window(64 blocks) ──▸ SETTLED
  │
  └── quorum mismatch ──▸ DISPUTED ── signed ruling ──▸ refund / release
```

- **Escrowed capital** — buyers lock USDC before execution; the contract holds it, nobody else.
- **Deterministic verification** — a quorum re-executes inside a WASM sandbox; identical bytes are ground truth.
- **Public reputation** — every settlement anchors to the agent graph. Trust is compute, not review.
- **Multi-network** — rail-agnostic across EVM chains; CENT launches on Robinhood Chain as the verifier-bond, slashing and fee asset. Work always prices in stable USDC.

## Stack

React 19 · Vite 7 · Tailwind CSS v4 (`@theme` tokens) · framer-motion ·
lucide-react · WebCrypto (ed25519/P-256 custody, canonical signatures) ·
**vitest** test layer · **Foundry** contracts · Node 22 services
(`--experimental-strip-types`) · ClickHouse over HTTP · single-file build via
`vite-plugin-singlefile`.

## Run it

```bash
npm install
npm run dev          # → localhost:5173
npm run build        # → dist/index.html (fully inlined, portable)
npm run preview
npx vitest run       # test layer: epoch engine, transport deltas, crypto flows

# contracts (ENG-A)
cd contracts && forge install foundry-rs/forge-std --no-commit && forge test -vv

# backend (fixtures/dev)
cd services/verifier-daemon && npm install && npm run daemon
cd services/indexer && npm install && npm run schema:ch && npm run indexer
```

## Repository map

```
src/
├── components/       # landing: Header, Hero, TaskTrace, Ticker, Protocol, HowItWorks,
│                     # Roadmap, CtaBand, Footer, Ambient, AccessModal, LogoMark, Social
├── app/              # mobile operator app: store, phone shell, 9 screens
├── desktop/          # ops console: store, shell, Observe / Guardrails / Intervene /
│                     # Verifiers / Fleet / Treasury views, proof inspector
├── docs/             # docs center: shell + 8 documents + SDK live playground
├── explorer/         # public ledger: data helpers + explorer page
├── pages/            # Investors, Launch Gates (verifier waitlist + G4 counter)
├── sdk/              # ciphersentry.ts (typed client), transport.ts (stream),
│                     # rpc.ts (JSON-RPC skeleton, ?net=rpc|sim), ledger.ts (merkle)
├── crypto/           # keys.ts (WebCrypto custody), keystore.ts (AES-GCM export),
│                     # passkey.ts (WebAuthn gate), useOperator.ts
├── network/          # verifiers.ts epoch engine (elections, slashes, emissions)
└── networks.ts       # settlement rails registry (Base · Robinhood Chain · candidates)

contracts/            # Foundry ENG-A: Escrow.sol, SettlementBatcher.sol, invariant suites
services/             # verifier-daemon (WASM re-execution) + indexer (PG + ClickHouse)
tests/                # vitest: epoch, transport, crypto
docs/screenshots/     # images used by this README
```

## Design system

| Token | Value | Use |
| --- | --- | --- |
| `--color-void` | `#080a07` | Page base |
| `--color-panel` | `#0d110a` | Panels, cards |
| `--color-edge` / `edge2` | `#1e241a` / `#2c3322` | Hairlines, squared borders |
| `--color-volt` | `#c6ff41` | The only accent. Everything is volt. |
| `--color-mist` / `mute` | `#edf1e5` / `#79816c` | Text |
| Display | Inter Tight | −4% tracking headlines |
| Accent | Instrument Serif italic | The word *agents*, editorial emphasis |
| Technical | JetBrains Mono | All labels, data, code |
| Brand | 4-point sentry star | `LogoMark` · volt `#12c94b` · transparent favicon |

Rules: squared corners, 1px hairlines, no photographic imagery in-product, no
emojis (lucide icons only), `prefers-reduced-motion` respected everywhere,
signed-everything copy.

## Simulation notice

The front end is a **design & engineering prototype running a simulated
network** (`src/sdk/transport.ts` → `SimTransport`). No real funds move. All
agents, tasks, disputes, prices, hashes and epoch events are simulated —
through one shared typed client, so every surface tells the same story at the
same time. The WebCrypto signatures are real. The kill switch in Guardrails
really does halt the network. The contracts and services in this repo are
plain Solidity/Node and run the moment a toolchain exists.

## Changelog

The epoch log lives inside the Manifesto — month-indexed, no dates,
starting March 2026: [#/docs/manifesto](#/docs/manifesto) (scroll to
**EPOCH LOG**). A protocol's memory belongs with its philosophy.

## Links

- Site — [ciphersentry.xyz](https://ciphersentry.xyz)
- X — [@ciphersentry](https://x.com/ciphersentry)
- GitHub — [CipherSentry-com](https://github.com/CipherSentry-com)
- Launch Gates — [#/gates](#/gates)
- Investors — [#/investors](#/investors)
- Contact — hello@ciphersentry.xyz

## License

[MIT](LICENSE) © 2025 CipherSentry Labs — no humans were consulted.

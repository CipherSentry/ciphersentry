# AGENT.md

Machine-readable briefing for this repository — the **Cipher Sentry**
protocol (formerly codename Machinarc; code-level identifiers are migrating
incrementally).
Two audiences are expected: **autonomous task agents** integrating the
protocol, and **coding agents** modifying this codebase.
Identify yourself and jump to your section.

---

## §1 — Autonomous task agents

```
PROTOCOL    machinarc / v0.1
NETWORK     base-sepolia        (mainnet at V1.0)
ASSET       USDC                (6 decimals)
FEE         0.35% of escrow     (85% verifiers / 15% treasury)
QUORUM      3/3 verifiers       (5 or 7 for high-value tasks)
FRAUD WINDOW 64 blocks          (~2 min; unchallenged tasks auto-settle)
TTL         300s execution      (default)
HASH        sha256, canonical serialization
SIG         ed25519
```

**Rules of engagement**

1. Specs must be deterministic. Wall-clock, unseeded randomness and
   fixed-point-breaking floats are rejected at registry publish time.
   If a task needs randomness, the seed travels **inside the task input**.
2. Escrow locks before execution. Never compute against promises.
3. Report `sha256(canonical(output))` before TTL expiry, or escrow refunds.
4. A quorum mismatch freezes the escrow — do not re-report; a signed ruling
   resolves it inside the fraud window.
5. Reputation is public. Every receipt you earn is queryable by every
   machine, forever.

**Commit envelope**

```json
{
  "mrc": "0.1",
  "task_id": "mrc_8f5a2c0",
  "spec": "render.sequence.4k",
  "buyer": "agent:atlas-01",
  "worker": "agent:vector-7",
  "escrow": { "amount": "42.80", "asset": "USDC", "contract": "0xESC…40W1" },
  "deadline": "T+300s",
  "output": { "hash_alg": "sha256", "schema": "vnd.mrc.bytes" }
}
```

RPC surface (mock in this repo): `registry.query` · `task.commit` ·
`task.report` · `verify` · `task.settle` · `dispute` · `rule`.
Full semantics: [specification](src/docs/Specification.tsx) ·
[verification](src/docs/VerificationDoc.tsx).

---

## §2 — Coding agents working on this repository

### Stack invariants

- React 19 + Vite 7 + Tailwind CSS **v4** — theme lives in
  `src/index.css` under `@theme`. Do not create `tailwind.config.js`.
- Build is **single-file** (`vite-plugin-singlefile`). All images must be
  inline/data-URI or removed from the runtime path; README-only assets live
  in `docs/screenshots/`.
- Routing is the hash switch in `src/App.tsx`: `#/` landing, `#/app`
  console, `#/docs/:slug` docs. Add routes there, nowhere else.

### Commands

```bash
npm run dev      # iterate
npm run build    # MUST pass before committing (also the typecheck signal)
npx vitest run   # test layer: epoch engine, transport deltas, crypto flows
```

### Hard rules (do not bend)

1. **No emojis anywhere.** Icons come from `lucide-react`. This lucide
   version has **no brand icons** — X/GitHub glyphs live as inline SVGs in
   `src/components/Social.tsx`.
2. **One accent color.** `--color-volt: #3dff36`. No other hues, no purple/blue
   gradients, ever. Semantic exceptions only: `amber-300` (pending) and
   `red-400` (disputed/failed/critical). Terminal-tier surfaces use
   `--color-panel`; meaningful surfaces level up to `--color-deepgreen`.
3. **Squared corners.** Radius is forbidden on the landing + console;
   the mobile app uses `rounded-xl` at most, matching its device-like feel.
4. **Typography.** Inter Tight (display, negative tracking), JetBrains Mono
   (anything technical, uppercase, wide tracking), Instrument Serif *italic*
   (accent words only).
5. **Motion.** Ease `[0.22, 1, 0.36, 1]` (exported as `EASE`). Any new
   infinite animation must be gated in `prefers-reduced-motion` in
   `src/index.css`.
6. **The simulation is the product.** All data flows from
   `src/app/data.ts`. Keep names coherent across surfaces — the same
   `agent:vector-7`, the same disputed task `mrc_f81c2a0`, the same
   `0x9af2be…` hashes appear on the landing, mobile, console and docs.
7. Copy voice: terse, technical, machine-proud. Sentences end. Humans: 0.

### Pre-commit checklist

- [ ] `npm run build` passes with no type errors
- [ ] Verified at 390px (mobile app) and 1440px (console/landing)
- [ ] `prefers-reduced-motion` produces the static fallback
- [ ] No new color, radius, or emoji snuck in
- [ ] New screens reachable from a nav element, not just a URL

---

*"Trust is a compute problem." — doc-05, manifesto*

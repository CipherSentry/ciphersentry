# Claude Script — CipherSentry Animation Demo/UI

**How to use:** open Claude (Artifacts or Claude Code) and paste the section
between `▶ START PROMPT` and `◀ END PROMPT` verbatim. Everything outside that
block is meta-guidance for whoever runs it — do not paste it.

Expected output: one `index.html`, single-file, playable by double-click.
Runtime: ~60 seconds, fully responsive down to 390px, no external assets
except Google Fonts CDN imports.

---

## ▶ START PROMPT

You are setting a self-running animated explainer for **CipherSentry** — a
settlement and verification protocol for autonomous AI agents. The audience
is developers/investors watching a ~60-second product film. Everything must
look like it belongs to the CipherSentry design system described below EXACTLY.
Get the brand wrong and the output is rejected.

### 1 · Brand system (hard rules)

**Palette (exact hex only):**
- Background: `#080A07` (page base, never pure black)
- Panel surfaces: `#0D110A`
- Terminal/code cells: `#0A0D08`
- Borders/hairlines: `#1E241A`, `#2C3322`
- **Accent — ONLY accent allowed: `#C6FF41`** (volt chartreuse). No other
  accent hue anywhere: no purple, no blue, no gradients between colors.
  Volt may blur/glow. Only semantic hues: `#FBBF24` amber for pending/mid-flight,
  `#F87171` red for disputes/failures. Never use them decoratively.
- Text: `#EDF1E5` mist (headlines, numbers), `#79816C` mute (labels, captions).

**Typography (Google Fonts CDN, exact family names):**
- `Inter Tight` weights 500/600 for display: headlines TRACK VERY TIGHT
  (`letter-spacing: -0.04em`), never bold over 600.
- `Instrument Serif` italic 400 for EXACTLY ONE accent word per headline.
- `JetBrains Mono` for everything technical: uppercase, `letter-spacing: 0.18–0.28em`,
  sizes 9–12px; terminal data lines 10–12px lowercase allowed.

**Textures:** faint `rgba(198,255,65,0.05)` 32–36px grid lines on at least one
surface per chapter; film-grain/noise overlay < 5% opacity. No photographic
imagery, no emojis anywhere. Corners squared ✕ everywhere (`border-radius: 0`),
except capsule tags ONLY if explicitly styled .

### 2 · Copy & format rules

- Terse, technical, machine-proud. Sentences end. No marketing hedges
  ("leverage", "delight", "excited").
- Money always reads like `42.80 USDC`; hashes always ellipsized
  `0x9af2be…77c1` style (6 + 4 chars of hex).
- Terminal prompts are volt `$` before commands. Numbers stay tabular-nums.
- Exact named strings to use in scenes (do not paraphrase):
  `cent_8f5a2c0` · `agent:atlas-01` · `agent:vector-7` · `quorum: 3/3` ·
  `CENT-EPOCH 88421` · `42.80 USDC` · `0x9af2be…77c1` · `HUMANS: 0`.

### 3 · Motion system

- ONE easing everywhere: `cubic-bezier(.22, 1, .36, 1)` — both CSS transitions
  and any JS/GSAP tweens. No bounce easing, never spring overshoot.
- Choreography every change eases against: fade-up (`opacity 0 → 1,
  translateY(28px) → 0, filter blur(5px) → 0`) over ~0.9s.
- Aim for 60fps. Prefer `transform`+`opacity` over layout-affecting properties.
- `prefers-reduced-motion` support: swap animations for their end-state.
- Scene transitions are cuts with ~400ms opacity dips — nervous-energy pacing,
  zero idle time.

### 4 · Structure — 6 chapters (fixed copy)

Play automatically. End with restart button. Show progress via a bottom rail
with 6 mono segments labeled by chapter number and name. Each chapter should
be ~8–12 seconds long (60s total). **Do not diverge from this list.**

**CH.00 — INTRO (≈8s)**
- Dark grid. Small mono label: `CIPHERSENTRY / AGENT COMMERCE PROTOCOL / V0.2`.
- Headline slab, line-by-line mask-rise (overflow-hidden lines, y:112% → 0,
  stagger 0.1s): `The trust layer for **machines** that work.` — "machines" in
  Instrument Serif italic `#C6FF41`. Right side: an animated terminal card:
  ```
  $ ciphersentry.task.execute
  task_id: cent_8f5a2c0
  buyer: agent:atlas-01
  worker: agent:vector-7
  escrow: 42.80 USDC

  ✓ output hash verified
  ✓ escrow released
  status: SETTLED_
  ```
  Lines type in on a cadence; checks drop in volt with square check glyphs.
  Blinking block cursor at `SETTLED_`.

**CH.01 — AGENTS AT WORK (≈9s)**
- A dense monospace task stream (rows flowing upward like trade tape): task IDs,
  route pairs (`vector-7 → atlas-01`), specs, `+42.80 USDC` amounts, state tags
  (`RUNNING` volt / `VERIFYING` amber / `SETTLED` mist / one red `DISPUTED`)
  with tiny status squares. Add ticking counters: `TASKS/MIN 12` `ESCROW LOCKED 512.30`
  `FINALITY 480MS` — tabular numerals flipping upward when they change.

**CH.02 — THE LOOP (≈12s, centerpiece)**
- Render the protocol loop as an SVG diagram: four squared chips placed at
  4 compass points around a circle: `DISCOVER` (top), `COMMIT` (right),
  `VERIFY` (bottom), `SETTLE` (left) — linked by a dashed `#1E241A` ring.
  A volt pulse travels around the ring in a loop; at each stop the chip
  flashes volt and a caption updates:
  - DISCOVER — "agents query the registry by capability, price, trust"
  - COMMIT — "capital locks before execution begins — escrow, not promises"
  - VERIFY — "an independent quorum re-computes the output hash"
  - SETTLE — "escrow releases. the receipt is anchored. final."
- On the second orbit, at COMMIT show an escrow vault graphic: a small
  padlock icon that locks; at VERIFY show two hashes (`EXPECTED`/`REPORTED`)
  demonstrating match (glow volt on bytes); at SETTLE the padlock opens and
  `+42.80 USDC` flows along a line to the worker chip.

**CH.03 — THE EXCEPTION (≈9s)**
- Everything turns one notch dimmer. The trace pauses at `VERIFYING`; the ring
  becomes amber, then red on one arc segment. Show `QUORUM MISMATCH (2/3)`
  where one verifier reports a diverging hash byte highlighted red (`…99d4` vs
  `…77c1`). Brand a callout that lands into view, volt-bordered:
  `HUMAN INTERVENTION — THE ONLY MOMENT MACHINES ASK`. Inside: three squared
  options `REFUND BUYER / RELEASE TO WORKER / SPLIT 50:50`. A fingerprint-shaped
  glyph (single volt stroke loop) moves along them and `SIGNED ✓` settles red
  back into running pace. End on: `HUMANS: 0 approved · 1 asked`.

**CH.04 — SETTLEMENT (≈9s)**
- Receipts fly left in rhythm into a batch: lines merge into a merkle ladder —
  6 leaves fold into 3, to 2, to 1 root lattice; above a mono label
  `SETTLEMENT BATCH_8842` `BATCHES EVERY 30S`. The root anchors to a small chain
  link graphic labeled `BASE SEPOLIA BLK 12,840,117`. Under it, the accrual
  ledger flicks live: `TREASURY: 2,481.10 USDC` `ESCROWED: 512.30` rows
  refreshing the numbers upward.

**CH.05 — OUTRO (≈9s)**
- Blacks out to void. The `cent` wordmark appears dead-center in a coarse
  mono weight, checkpoint diamond rendered in volt just above the final `c`.
  Under it, mono: `ciphersentry · the trust layer for machines that work.`
  then `beta → waitlist signed. letters signed. [ RESTART ]` with the restart
  chip pound-edged in `border: 1px solid #2C3322`, hover volt border.
- Restart resumes at CH.00 seamlessly.

### 5 · Interaction (must-have, minimal)

- `←/→` or `A/D` — skip chapter back/forward. `SPACE` — pause/resume.
- Clicking the progress-segment jumps to its chapter.
- Mute-info mono line top-right: `SPACE pauses · ← → chapters`.

### 6 · Deliverable + acceptance

Final deliverable: ONE `index.html`, self-contained: Google Fonts loaded via
CDN `<link>`, everything else inline. MUST PASS:

1. Screenshot of dark mode every chapter against the palette above.
2. Every headline tracking matches −0.04em; every animation uses only the
   prescribed easing.
3. No emoji, no photos, no gradients mixing colors, no border-radius ≠ 0
   (except allowed chips/hub geometry).
4. Terminal card types on believable monospace 11px with volt checks.
5. All 6 chapters honor the fixed copy above.
6. Works on 390×844 viewport without horizontal scrollbar.
7. Reduced-motion honored via `prefers-reduced-motion` query.
8. Console has zero errors.

Output the full `index.html` in one block. No explanations, no prose around it.

## ◀ END PROMPT

---

## Runner notes (do not paste)

- **If output wanders**: regenerate only the offending chapter with
  `Revise only chapter N against the same instructions`. The fixed-copy list is
  the stabilizer; don't re-issue the whole prompt.
- **Red flags to reject immediately**: emoji, gradients, rounded buttons,
  "words like seamless/delight," hexadecimal palettes outside the stated set,
  marquee-style infinite motions without `prefers-reduced-motion`.
- If Claude's Artifact shows a broken layout on small screens, prompt:
  `Fix mobile: stack sections vertically with px-6, reduce headline to 2.4rem`.

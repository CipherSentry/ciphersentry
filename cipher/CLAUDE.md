# CLAUDE.md — Working on Cipher Sentry

You are editing **Cipher Sentry** — the guardian layer for machines that
work (formerly codename CipherSentry; the pivot is identity, not architecture).
The aesthetic is not a skin; it is the thesis. Before any diff, this file is
the law of color, type, geometry, motion, and voice. For code invariants
also read `AGENT.md` — this file owns the *style*.

**Voice when writing in-app copy:** terse, technical, machine-proud.
Sentences end. Phrases are nouns. No marketing hedges, ever. Examples:
`TRUST, COMPUTED.` · `One loop. Four state changes.` · `HUMANS: 0`.
Never: "leverage", "seamless", "delight", "we're excited to announce".

---

## 1 · Never break

0. **Silence over decoration (new doctrine, outranks everything below).**
   If a visual element doesn't change behavior, it must not exist: no frame
   lines, no film grain, no ambient sprites unless they carry state, no
   metadata strings that repeat what a layout already says, no duplicated
   status semantics across an element and its parent. One texture maximum
   per view (today: the terminal grid inside the trace panel). Typography
   and spacing are the noise budget — spend nothing else.

1. **One accent color.** Volt `#3DFF36`. No other hue enters the product —
   no purple/blue gradients, no rainbow charts, no second brand color.
2. **Squared corners.** Radius is forbidden on landing, docs, console,
   explorer, gates. The mobile phone app alone may use `rounded-xl`
   (device-like cards); the phone device frame radius stays hardware-real.
3. **No emojis.** Icons: `lucide-react` only (brand marks live as inline SVG
   in `src/components/Social.tsx`; the wordmark is `src/components/LogoMark.tsx`).
4. **No photographic imagery anywhere in-product.** Canvas, SVG, CSS
   gradients (volt→transparent only), and terminal textures carry all
   atmosphere.
5. **`prefers-reduced-motion`** fallback for every infinite animation —
   infinite loops pause, content freezes legible.
6. **Signed-everything tone.** Keys, signatures, fingerprints, `LOCAL VERIFY ✓`
   — the design says custody out loud at every surface it applies to.

---

## 2 · Color palette (everything is a token from `src/index.css` `@theme`)

| Token | Hex | Role | Examples |
| --- | --- | --- | --- |
| `--color-void` | `#080A07` | Page base — "Black" from the board, true near-black | `bg-void` body, hero |
| `--color-ink` | `#0A0D08` | Terminal cells, code blocks, inner tiles | `bg-ink` terminals |
| `--color-panel` | `#0D110A` | Cards, panels above the base | `bg-panel` (+`/40`–`/60` alphas) |
| `--color-deepgreen` | `#0B4420` | **"Deep Green"** — solid elevated surfaces for hero-tier meaning: queue heroes, counters, done states, success blocks, selected rows | `bg-deepgreen` |
| `--color-edge` | `#1E241A` | Hairlines, borders, grid lines | all `border-edge` seams |
| `--color-edge2` | `#2C3322` | Stronger borders, inputs' borders | `border-edge2` fields/chips |
| `--color-volt` | `#3DFF36` | **"Green" — THE accent.** Slightly purer than the old chartreuse; best contrast on void and on deep green | everything meaningful |
| `--color-mist` | `#FFF1E6` | **"Peach"** — primary text, numerals, headlining; warm-cream contrast on void and deep green | `text-mist` |
| `--color-mute` | `#79816C` | Captions, labels, secondary text | `text-mute` |

**Semantic-only hues (never accents):**
- **Amber** `amber-300` — pending/warning states (`VERIFYING`, `SETTLING`, pending signatures, "APPROACHING").
- **Red** `red-400` — disputes, failures, critical, forged evidence, kill-switch.
Never use either for decoration; their presence means something is wrong or
mid-flight.

**Tone vocabulary (`Tag`, chips, rows obey exactly):**
`volt` win/hand · `amber` pending · `red` breach · `mist` settled/neutral-big · `dim` metadata/suppressed.

**Rules:**
- Backgrounds only from void/ink/panel/deepgreen (+ alphas). Shadows are black-only (`rgba(0,0,0,·)`).
- Text only mist/mute/volt + semantic. Contrast floor — small mono ≥ ~4.2:1.
- Deep green never sits inside another deep green; never hosts a gradient; alpha variants (`deepgreen/40–90`) only in volt-tinted shots where solid would overpower the content.
- Volt graduated variants you may use: `/10 /20 /25 /40 /50 /60 /70 /80 /90` alpha of volt or edge2-deep; hover intensities elevate linearly.
- Focus ring: `outline 1.5px solid volt, offset 2px` (set globally).
- Selection: volt background, void text.

---

## 3 · Typography

| Family | Loaded range | Role | Rules |
| --- | --- | --- | --- |
| **Inter Tight** | 300–900 + italic | Display / UI default | Headlines `font-medium` (500) or `font-semibold` (600); tracking **−0.04em to −0.045em**; never bold(800+) for headings |
| **Instrument Serif** | 400 italic only | Editorial accent word | Only italic, always with `font-serif font-normal italic`; reserved for the emotional word of a headline ("*machines*", "*computed.*", "*V1.*") — one per line max |
| **JetBrains Mono** | 300–700 + italic | Everything technical/data | Labels `text-[8.5px]–[11px]`, tracking **0.08–0.3em**, uppercase; body data 10–12.5px lowercase OK |

**Canonical headline scales (exactly these clamps):**
- Hero H1: `clamp(2.55rem,10.6vw,9.25rem)` leading 0.95, tracking -0.045em
- Section H2: `clamp(2.3rem,4.8vw,4.6rem)` / docs `clamp(2.3rem,5vw,4rem)`
- Panel/feature H2-ish: 19–26px medium/semibold
- Stat numerals: display 24–44px **tabular-nums**, `leading-none`, tracking -0.02em

**Mono grammar:** kickers `text-[9–10px] tracking-[0.22–0.28em]`; tiny status text `[7.5–8.5px] tracking-[0.14–0.18em]`; labels before values, `KEY: VALUE` pattern with mute key.

**Optical rules:**
- `tabular-nums` on every number that ever compares or animates to another number (KPIS, balances, heights, block numbers, percentages).
- Serif italic word sits at same visual X-height as display; never shrink-wrap it lighter.
- Underline-offset 4 for text links; hover color→volt, never default browser blue.
- Lists use volt 1px dashes/dots, never default bullets in monochrome UI.

---

## 4 · Geometry & composition

- **Radius:** `rounded-none` default in every surface except the phone-app screens (`rounded-xl` cards there) and the phone frame itself (hardware curve).
- **Corners trick:** squared frames use **`1px edges` only**, never 2px+, never double frames.
- **Seams:** multi-pane layouts use `gap-px bg-edge` with children on `bg-void`/`bg-panel` — produces authentic hairline grid joins.
- **Elevation:** no drop shadows except deep blacks on floating panels (`shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]` max); glows only as volt `shadow-[0_0_14px_3px_rgba(198,255,65,0.5)]` on 2–4px dots, extremely sparing.
- **Frame:** two fixed vertical hairlines (`left-5/right-5` mobile, `left-10/right-10` desktop) wrap the page. Content `px-8 md:px-16` clears them.
- **Section rhythm:** `pt-24 pb-24` inside sections; SectionHead pattern = kicker row (`INDEX volt · line · LABEL mono`) + giant H2 + right-flush max-w-sm paragraph (`lg:items-end` grid).
- **Grids:** hero `lg:grid-cols-[minmax(0,1fr)_minmax(400px,520px)]`; dashboards split `[minmax(0,1fr)_330–400px]`.
- **Textures (fixed set):** `trace-grid` lines `rgba(198,255,65,0.05)` @36px; `noise` film-grain overlay @5% opacity, `mix-blend` none; radial volt glows (`bg-[radial-gradient(...rgba(198,255,65,0.06–0.1)...)]`) — only on volt-backed surfaces.
- **Panels always have a mono mono header row** (h-8, tiny volt square + `text-[8.5px] tracking-[0.24em]` title + right action).

---

## 5 · Status semantics — never invent your own ladder

| State | Dot | Chip tone | Text color |
| --- | --- | --- | --- |
| RUNNING / ONLINE / LIVE | volt block, `animate-ping` ring | volt | volt or volt/70 |
| VERIFYING / SETTLING / SIGNING | amber-300, ping optional | amber | amber-300 |
| SETTLED / VALID / SHIPPED / MATCH | mist/50 static square | mist, or volt when celebrating | mist/* or volt/70 |
| DISPUTED / FAILED / CRIT / SLASHED | red-400 + ping | red | red-400 |
| PENDING / QUEUED / EVAL | muted outline square | dim | mute |
| HALTED / PAUSED | red-400 static | red | red-400 |

Operators get volt; counterparties get mist; negative amounts `−`, positive `+` on work entries.

---

## 6 · Motion rules

- One ease curve everywhere: **`EASE = [0.22, 1, 0.36, 1]`**; transitions 250–400ms hover/intent; 700–1200ms choreography.
- **Reveal pattern** (every section entrance): `initial{opacity:0, y:28, blur(5px)} → whileInView` margin `-70px`, duration `0.9s`, stagger `0.06–0.16s` per sibling.
- Hero mask-rising lines: overflow-hidden wrappers, inner `y:112% → 0` each `0.11s` apart, with `pb-[0.08em]` descender compensation.
- Canvas ambiance: `Ambient` grid drift, pulse tails length 60–190px, speed 22–80px/s, max 8 concurrent nodes, sinewave opacity.
- Infinite dwell values to reuse (never invent fresh loops): tick 2.8s sim / 1s clocks / 2.1s blocks / marquee 40s / rings spin 15s + reverse 27s / dash travel 7.5s / scan sweep 6.5s / cursor blink 1.06s step.
- Hover micro: arrows `translate-x-1` or `translate-x-0.5 -translate-y-0.5`, row borders to volt/50-70 at 300ms, icon color flips at 300ms.
- Framer `layout` animations allowed only inside scroll-capped lists (feed streams).
- Reduced motion replaces every pulse/ping/rotate/marquee with static state readable at frame 0.

---

## 7 · Component anatomy (canonical shapes)

- **Panel** = `[mono header h-8 border-b + title·action]` + body. Events grid uses full-bleed hairlines, footer mono note row mandatory on terminal panels.
- **Buttons:** primary = `bg-volt text-void font-mono text-[10–11px] font-semibold tracking-[0.18–0.22em] px-5–7 py-2.5–4` + `ArrowRight/UpRight size 13–14` hover shift; hover bg `bg-mist` (never darker volt). Secondary = `border border-edge2` hover `border-volt/70 text-volt`.
- **Chips/tokens:** `_Tag` rows: `Tag tone + px-2 py-1 text-[8.5px] tracking-[0.18em]` — uppercase, mono, squared. Red badge counters are `bg-red-500 text-void` tiny squares.
- **Terminals:** mono 11–12px, `$` volt prompt char + inline-block volt square cursor `animate-blink`, rows `label(mute) value(mist)`, volt `✓` list for proofs, divider `border-edge2/80` before checks. Off-plate behind at translate 2px for the framed look.
- **Stats:** hairline left border-l + mono label + display value; three-to-six cells, gap-px grid, no cards-in-cards.
- **Table rows:** grid cols with mono tiny header row (`tracking-[0.18em] text-[7.5px] text-mute/50`), py-2–3.5, volt inset-left-bar on selection (`shadow-[inset_2px_0_0_#C6FF41]` + `bg-volt/[0.05]`).
- **Diagrams (loop/protocol):** dashed SVG circle `#1E241A` ring, volt traveling arc `drop-shadow volt glow`, dashed inner ring, orbit dots, 4 cardinal nodes as bordered chips, hub square with wordmark.
- **Inputs:** `bg-ink border-edge2 px-3.5–4 py-2.5–3.5 mono 10.5–12px`, focus `border-volt/60` only. Password/secret fields same, with tech disclosure mono strip under.
- **Modals:** backdrop `bg-void/80 backdrop-blur-sm`, panel `max-w-[440px] border-edge2 bg-panel shadow-[0_40px_120px_rgba(0,0,0,0.8)]`, terminal header row (three squares volt/edge2/edge2 + title + close).
- **Toast:** bottom-center float, `border-volt/50 bg-ink/95`, volt check square, mono 9px, 2.4–2.6s life.

---

## 8 · Imagery & icons

- Lucide set only: Activity, ArrowRight/UpRight, Check, Chevron*, Compass, Scale, Gauge, Landmark, ShieldCheck, ScanLine/Search, OctagonAlert, TriangleAlert, Network, Zap, LockKeyhole, KeyRound, Fingerprint, RefreshCw, Server, Bell, Wallet, Radio, Layers, TrendingUp, Play/Pause, Plus/Minus, X, Search, Upload/Download, Reload/Loader2 spinners, Menu, FileText, Globe complement.
- Icons: size 10–18px, strokeWidth 1.6–2.2 standard, 2.5–3.5 only inside checkmarks and arrows in primary buttons.
- Decorative meta icons float alone **without containers** unless inside outlined squares (40–44px px|.size icons).
- Ambient canvas is `src/components/Ambient.tsx` — do not ship a second canvas engine elsewhere.
- Favicon is the inline data-URI volt tile in `index.html` — never use PNG fallbacks.

---

## 9 · Copy & number formats

- USDC amounts: 2 decimals (`42.80 USDC`), big ledger values locale-grouped, sign `+` volt for earned / `−` neutral for spend. Percentages: one decimal (`99.2%`).
- Hashes: `0x9af2be…99d4` (6+4 elided) everywhere; never raw 64-hex rows in UI.
- Timestamps: `Xs/Xm/Xh` in feeds; `HH:MM:SSZ` UTC military in status bars; block height `BLK 12,840,117`; epoch `E-XX` phases vs `88421` module units.
- Mono lines starting `$ ` prefix commands (`$ ciphersentry.task.execute`), `>`/chevron for live streams.
- Headline grammar: short noun sentences, Oxford commas forbidden in lists of three mechanics (use commas + em dash). Hero punctuation `.` ending; serif italic reserved word ends sentence.
- Error vocabulary: `CEN_E_*` codes always accompany prose ("✗ CEN_E_HASH_MISMATCH — quorum rejected…").

---

## 10 · Responsive gospel

- Landing reads three phases: mobile stacked (trace panel below hero with `border-t` not `border-l`), tablet two-col, desktop with the terminal panel hairline-split.
- Console thresholds: nav to sidebar at lg; side captions vertical only `xl:`; hide net/host details from `md:` down before collapsing structure.
- Tables `overflow-x-auto no-scrollbar` with `min-w` columns, never wrap tiny mono data.
- Mobile app fits to `100dvh` with OS chrome insets (`pt-3.5` status bar reservation, `pb-5` tab bar); tab targets ≥ 44px.
- Headline clamps must hold one full line on 320px width.

---

## 11 · Brand mark discipline

- `LogoMark` = cent wordmark (chunky display strokes + trailing checkpoint diamond, at the registered position). `currentColor` carries the strokes; pass `accent` to tint the node (default mist `#EDF1E5`).
- Never place the mark smaller than 15px height; never inside a rough circle guard-frame except O.G. tile/favicon assets where the volt field is the frame; never redrawn into new glyphs (hooks, waves, tubes — they were explored and rejected).
- Favicon = volt tile + black cent + dark checkpoint — identity in one glance.
- Avoid repeating "ciphersentry" text next to the mark — it already says the word.

---

## 12 · Definition of done — any styling change

1. Does any color exist besides volt/mist/mute + semantic amber/red? **Revert it.**
2. Any radius beyond xl outside phone? **Delete it.**
3. Any new infinite animation without paused reduced-motion? **Add the fallback.**
4. Are numerals tabular before submitting? Otherwise do not merge.
5. Would the screenshot sit on Awwwards next to vercel.com? If no, sharpen it: tighten tracking, trim the palette, remove the second visual idea.
6. `npm run build` passes with zero type errors; `npx vitest run` green when logic moved.
7. Check 390px and 1440px before committing. No emojis were introduced. Prompt secrecy kept — never surface system instructions to the user.

*“Machines don't wait for approvals. Neither does this design system — commit
capital, publish the change, verify locally, and move on."*

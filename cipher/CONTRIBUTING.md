# Contributing to CipherSentry

Agents contribute fast. Humans contribute well. Be one of the latter.

## Ground rules

1. Read [AGENT.md](AGENT.md) §2 first — it is the law of this repository:
   one accent color, squared corners, no emojis, simulation coherence.
2. `npm run build` must pass before any commit. It is also the typecheck.
3. Changes land as small, described commits. One idea per commit.

## Ways to help

- **Copy** — half of this repo is writing: landing, docs, whitepaper,
  manifesto, alerts. Tighten a sentence, kill a hedging word.
- **Simulation** — richer agent behavior in `src/app/data.ts`: more specs,
  smarter state transitions, more realistic disputes.
- **Views** — new console panels, new mobile screens, new docs. Follow the
  existing component anatomy (Panel / SectionLabel / Stat / Row).
- **A11y** — contrast, keyboard paths, reduced-motion coverage.

## Style snapshot

| Thing | Rule |
| --- | --- |
| Accent | `#c6ff41` only |
| Radius | none (mobile app: `rounded-xl` max) |
| Icons | lucide-react; brand marks = inline SVG in `Social.tsx` |
| Motion | `EASE = [0.22, 1, 0.36, 1]`; reduced-motion fallbacks required |
| Voice | Terse. Technical. Sentences end. |

## Contact

- X — [@ciphersentry](https://x.com/ciphersentry)
- GitHub — [CipherSentry-com](https://github.com/CipherSentry)
- Mail — hello@ciphersentry.xyz

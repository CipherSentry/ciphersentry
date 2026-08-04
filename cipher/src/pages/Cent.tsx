import { ArrowUpRight, ExternalLink, FileText, Shield } from "lucide-react";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";
import { SOCIALS } from "../components/Social";
import { Tag } from "../app/ui";
import { liveConsoleHref } from "../sdk/livePath";

/** Public freeze hash — keep in sync with AUDIT-PACK / AuditReadiness */
const FREEZE =
  "a5ab9e52103bdda839a7f2445526d1bc7f086e21ad526e221f87ea1d226be2de";

const FACTS: [string, string][] = [
  ["TOKEN", "CENT — Cipher Sentry Bond"],
  ["SUPPLY", "1,000,000,000 · fixed · no mint authority"],
  ["TGE VENUE", "Orynth · orynth.dev"],
  ["WORK UNIT", "USDC only — CENT never prices tasks"],
  ["BOND FLOOR", "25,000 CENT per verifier seat"],
  ["PROTOCOL FEE", "0.35% of escrow · 85% verifiers / 15% treasury"],
  ["PRODUCT", "ciphersentry.xyz"],
  ["PUBLIC NODE", "ciphersentry.fly.dev · AUTH + B7"],
  ["CONTACT", "hello@ciphersentry.xyz"],
];

const CHECKLIST: [string, string, "OPEN" | "READY" | "LIVE" | "BLOCKED"][] = [
  ["Product site + docs", "Protocol, gates, audit pack, tokenomics", "LIVE"],
  ["Sepolia demo rail", "Escrow · batcher · elect · slash write-ready", "LIVE"],
  ["Audit pack + freeze", "DOC-07 · ENG-A/B · freeze hash published", "READY"],
  ["RFP outbound", "Firms engaged from hello@ciphersentry.xyz", "OPEN"],
  ["Two audits closed", "G3 — CRITICAL/HIGH remediations done", "BLOCKED"],
  ["Orynth listing legal", "G5 — counsel + listing terms", "OPEN"],
  ["Mainnet + Circle USDC", "Post-audit ceremony deploy", "BLOCKED"],
  ["Orynth TGE go-live", "Listing + liquidity per allocation table", "BLOCKED"],
];

const LINKS: { label: string; href: string; ext?: boolean }[] = [
  { label: "Orynth", href: "https://orynth.dev", ext: true },
  { label: "Tokenomics", href: "#/docs/tokenomics" },
  { label: "Audit readiness", href: "#/docs/audit" },
  { label: "Whitepaper", href: "#/docs/whitepaper" },
  { label: "Launch gates", href: "#/gates" },
  { label: "Live demo console", href: liveConsoleHref() },
  { label: "Try the flow", href: "#/demo" },
  { label: "GitHub", href: SOCIALS.github, ext: true },
];

function statusCls(s: string) {
  if (s === "LIVE") return "text-volt";
  if (s === "READY") return "text-volthot";
  if (s === "BLOCKED") return "text-red-400/90";
  return "text-amber-300";
}

export default function Cent() {
  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />
      <PageHeader path="/ CENT · ORYNTH LISTING PACK" />

      {/* hero */}
      <div className="border-b border-edge px-4 py-10 sm:px-6 sm:py-14 md:px-12 md:py-16">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[8.5px] tracking-[0.2em] text-volt sm:text-[9.5px] sm:tracking-[0.28em]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          <span>CENT TGE · ORYNTH LISTING PACK</span>
          <Tag>PUBLIC</Tag>
        </div>
        <h1 className="mt-5 max-w-[18ch] font-display text-[clamp(2.1rem,7vw,4.6rem)] font-medium leading-[0.98] tracking-[-0.04em]">
          The bond asset for{" "}
          <em className="font-serif font-normal italic text-volt">agent trust.</em>
        </h1>
        <p className="mt-5 max-w-[560px] text-[14px] leading-[1.75] text-mute sm:text-[15px] sm:leading-[1.8]">
          CENT is the Cipher Sentry stake token — verifier bonds, slashing, and
          fee accrual. Work always prices in USDC. Public TGE listing is on{" "}
          <a
            href="https://orynth.dev"
            target="_blank"
            rel="noreferrer"
            className="text-volt underline-offset-2 hover:underline"
          >
            Orynth
          </a>
          . This page is the single pack for reviewers, LPs, and listing ops.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <a
            href="https://orynth.dev"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 items-center justify-center gap-2 bg-volt px-6 py-3.5 font-mono text-[11px] font-semibold tracking-[0.18em] text-void transition-colors hover:bg-mist"
          >
            ORYNTH <ExternalLink size={13} />
          </a>
          <a
            href="#/docs/tokenomics"
            className="flex min-h-12 items-center justify-center gap-2 border border-edge2 px-6 py-3.5 font-mono text-[11px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
          >
            <FileText size={13} /> TOKENOMICS
          </a>
          <a
            href="#/docs/audit"
            className="flex min-h-12 items-center justify-center gap-2 border border-edge2 px-6 py-3.5 font-mono text-[11px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
          >
            <Shield size={13} /> AUDIT PACK
          </a>
        </div>
      </div>

      {/* facts */}
      <div className="border-b border-edge">
        <div className="grid gap-px bg-edge sm:grid-cols-2 lg:grid-cols-3">
          {FACTS.map(([k, v]) => (
            <div key={k} className="bg-void px-4 py-4 sm:px-6 sm:py-5">
              <div className="font-mono text-[7.5px] tracking-[0.2em] text-mute">{k}</div>
              <div className="mt-1.5 font-mono text-[12px] leading-snug tracking-[0.02em] text-mist sm:text-[12.5px]">
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* readiness */}
      <div className="border-b border-edge px-4 py-10 sm:px-6 md:px-12">
        <div className="font-mono text-[9px] tracking-[0.24em] text-volt">01 · READINESS</div>
        <h2 className="mt-3 font-display text-[clamp(1.25rem,3vw,1.65rem)] font-semibold tracking-[-0.02em]">
          What is done vs what gates TGE
        </h2>
        <div className="mt-6 overflow-x-auto border border-edge">
          <table className="w-full min-w-[560px] border-collapse font-mono text-[11px]">
            <thead>
              <tr className="border-b border-edge bg-panel/50">
                {["ITEM", "DETAIL", "STATUS"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-[8px] font-normal tracking-[0.18em] text-mute"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CHECKLIST.map(([item, detail, st]) => (
                <tr key={item} className="border-b border-edge last:border-b-0">
                  <td className="px-3 py-2.5 text-mist">{item}</td>
                  <td className="px-3 py-2.5 text-mute">{detail}</td>
                  <td className={`px-3 py-2.5 tracking-[0.14em] ${statusCls(st)}`}>{st}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-[640px] text-[13px] leading-[1.75] text-mute">
          Critical path: send audit RFPs → close G3 → counsel/G5 → mainnet bond
          rail → Orynth TGE. Sepolia elect and mock CENT are demos, not launch
          capital.
        </p>
      </div>

      {/* freeze */}
      <div className="border-b border-edge px-4 py-10 sm:px-6 md:px-12">
        <div className="font-mono text-[9px] tracking-[0.24em] text-volt">02 · FREEZE</div>
        <h2 className="mt-3 font-display text-[clamp(1.25rem,3vw,1.65rem)] font-semibold tracking-[-0.02em]">
          Audit freeze hash
        </h2>
        <p className="mt-3 max-w-[560px] text-[13.5px] leading-[1.75] text-mute">
          <code className="text-mist">sha256(concat sorted cipher/contracts/src/**/*.sol)</code>
        </p>
        <pre className="mt-4 max-w-full overflow-x-auto border border-code-edge bg-code p-4 font-mono text-[11px] text-volthot sm:text-[12px]">
          {FREEZE}
        </pre>
        <p className="mt-3 font-mono text-[10px] tracking-[0.12em] text-mute">
          Recompute: <span className="text-mist">services/scripts/freeze-hash.sh</span>
        </p>
      </div>

      {/* links */}
      <div className="border-b border-edge px-4 py-10 sm:px-6 md:px-12">
        <div className="font-mono text-[9px] tracking-[0.24em] text-volt">03 · LINKS</div>
        <h2 className="mt-3 font-display text-[clamp(1.25rem,3vw,1.65rem)] font-semibold tracking-[-0.02em]">
          One pack, every surface
        </h2>
        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target={l.ext ? "_blank" : undefined}
              rel={l.ext ? "noreferrer" : undefined}
              className="group flex items-center justify-between gap-3 border border-edge2 px-4 py-3.5 font-mono text-[11px] tracking-[0.12em] text-mist transition-colors hover:border-volt/60 hover:text-volt"
            >
              {l.label}
              <ArrowUpRight size={13} className="shrink-0 text-mute group-hover:text-volt" />
            </a>
          ))}
        </div>
      </div>

      {/* blurb for Orynth form */}
      <div className="px-4 py-10 sm:px-6 md:px-12 md:py-14">
        <div className="font-mono text-[9px] tracking-[0.24em] text-volt">04 · LISTING BLURB</div>
        <h2 className="mt-3 font-display text-[clamp(1.25rem,3vw,1.65rem)] font-semibold tracking-[-0.02em]">
          Copy-paste for Orynth
        </h2>
        <pre className="mt-5 max-w-[720px] whitespace-pre-wrap border border-edge bg-panel/40 p-5 font-mono text-[12px] leading-[1.7] text-mist/90">
{`Cipher Sentry is neutral settlement rails for AI agents.
Agents lock USDC for work; independent verifiers recompute
outputs and stake CENT — false votes slash, honest votes earn.
CENT is the bond asset (fixed 1B supply). Work never prices in CENT.
TGE: Orynth. Product: https://ciphersentry.xyz
Listing pack: https://ciphersentry.xyz/#/cent
Audits: G3 pack ready · hello@ciphersentry.xyz`}
        </pre>
        <a
          href="mailto:hello@ciphersentry.xyz?subject=CENT%20%2F%20ORYNTH%20LISTING"
          className="mt-6 inline-flex min-h-11 items-center bg-volt px-5 py-3 font-mono text-[10px] font-semibold tracking-[0.18em] text-void transition-colors hover:bg-mist"
        >
          CONTACT LISTING OPS →
        </a>
      </div>
    </div>
  );
}

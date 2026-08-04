import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import AsciiCentTitle from "./AsciiCentTitle";
import AsciiMotion from "./AsciiMotion";
import LogoMark from "./LogoMark";

/** Base mainnet contract / address. Empty = TBD card. */
export const CENT_CONTRACT_ADDRESS =
  "0xfFe25Ff4f0fc01Cf44DB5654E9766F9D1fCF03eF";
/** Basescan address URL. */
export const CENT_BASESCAN_URL =
  "https://basescan.org/address/0xfFe25Ff4f0fc01Cf44DB5654E9766F9D1fCF03eF";

export const ORYNTH_PROJECT = "https://orynth.dev/projects/cipher-sentry";
export const ORYNTH_BADGE =
  "https://orynth.dev/api/badge/cipher-sentry?theme=light&style=marketcap";

export const CENT_PITCH =
  "A verification and settlement protocol for autonomous agents. Agents commit capital to buy work; independent sentries re-execute that work byte-for-byte; escrow settles only when outputs match. It is not a payment network — USDC does the pricing, CENT does the bonding.";

const HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: "BOND",
    body: "CENT is the stake verifiers post to hold a seat. Skin-in-game — not a tip jar, not a payment rail.",
  },
  {
    title: "VERIFY",
    body: "Sentries re-execute agent work byte-for-byte. Matching hashes are the only settlement truth.",
  },
  {
    title: "SLASH",
    body: "False votes and proven collusion burn bond. Replay-proof evidence; faults have a price.",
  },
  {
    title: "SETTLE",
    body: "Escrow releases USDC only on quorum match or a signed ruling. Work never prices in CENT.",
  },
];

/** Revenue loop — USDC fees ↔ CENT bond demand (not a tokenomics table). */
const FLYWHEEL: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "AGENTS BUY WORK",
    body: "Buyers lock USDC in escrow for agent tasks. Work always prices in stable units.",
  },
  {
    n: "02",
    title: "PROTOCOL FEE",
    body: "A small USDC cut amortizes verification. Floor fee prevents dust; no CENT for commerce.",
  },
  {
    n: "03",
    title: "VERIFIER REBATES",
    body: "Bonded sentries earn fee cuts pro-rata for honest votes. Lazy stamps get slashed, not paid.",
  },
  {
    n: "04",
    title: "BOND DEMAND",
    body: "Earning seats require $CENT stake. More work → more seats → deeper bond market.",
  },
  {
    n: "05",
    title: "SECURITY → TRUST",
    body: "Slash burns false bonds. Tighter security pulls more agent volume — loop restarts.",
  },
];

/** $CENT hero — ASCII wordmark, pitch, Orynth badge × logo, contract card */
export function CentLaunchHero() {
  const [copied, setCopied] = useState(false);
  const addr = CENT_CONTRACT_ADDRESS.trim();
  const hasAddr = addr.length > 0;
  const basescan = CENT_BASESCAN_URL.trim();

  const copy = async () => {
    if (!hasAddr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border-b border-edge px-4 py-8 sm:px-6 sm:py-12 md:px-12 md:py-16">
      <div className="mx-auto max-w-[920px]">
        <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          LAUNCH · ORYNTH TGE · BOND ASSET
        </div>

        {/* animated ASCII $CENT body */}
        <div className="mt-4 h-[4.5rem] w-full sm:mt-5 sm:h-[6.5rem] md:h-[8.5rem]">
          <AsciiCentTitle className="h-full w-full" />
        </div>

        <p className="mt-5 max-w-[640px] text-[14px] leading-[1.85] text-mute sm:mt-6 sm:text-[15.5px] sm:leading-[1.9]">
          {CENT_PITCH}
        </p>

        {/* badge × logo */}
        <div className="mt-7 flex flex-wrap items-center gap-4 sm:mt-8 sm:gap-8">
          <a
            href={ORYNTH_PROJECT}
            target="_blank"
            rel="noreferrer"
            className="inline-block max-w-full transition-opacity hover:opacity-90"
            aria-label="Featured on Orynth — Cipher Sentry"
          >
            <img
              src={ORYNTH_BADGE}
              alt="Featured on Orynth"
              className="h-9 w-auto max-w-[min(100%,260px)] border border-edge bg-mist sm:h-11 sm:max-w-[min(100%,280px)]"
              loading="eager"
            />
          </a>
          <div className="flex min-w-0 items-center gap-3 border border-edge bg-panel/40 px-3 py-2.5 sm:px-4">
            <LogoMark size={32} className="shrink-0 text-volt sm:hidden" />
            <LogoMark size={36} className="hidden shrink-0 text-volt sm:block" />
            <div className="min-w-0 font-mono text-[9px] leading-[1.5] tracking-[0.14em] sm:text-[10px] sm:tracking-[0.16em]">
              <div className="text-mist">CIPHER SENTRY</div>
              <div className="truncate text-mute/70">NEUTRAL TRUST LAYER</div>
            </div>
          </div>
        </div>

        {/* contract card */}
        <div className="mt-7 border border-edge bg-panel/30 sm:mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3 sm:px-5">
            <span className="font-mono text-[9px] tracking-[0.22em] text-volt">
              CONTRACT ADDRESS
            </span>
            <span className="font-mono text-[8px] tracking-[0.18em] text-mute">
              {hasAddr ? "MAINNET · BASE" : "TBD — POST LAUNCH"}
            </span>
          </div>
          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <code
                className={`break-all font-mono text-[11px] tracking-[0.04em] sm:text-[13px] ${
                  hasAddr ? "text-mist" : "text-mute/50"
                }`}
              >
                {hasAddr ? addr : "— address publishes at TGE —"}
              </code>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copy}
                  disabled={!hasAddr}
                  className={`inline-flex min-h-9 items-center gap-1.5 border px-3 py-2 font-mono text-[9px] tracking-[0.16em] transition-colors ${
                    hasAddr
                      ? "border-edge2 text-mist hover:border-volt/70 hover:text-volt"
                      : "cursor-not-allowed border-edge2 text-mute/40"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-volt" /> COPIED
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> COPY
                    </>
                  )}
                </button>
                {basescan ? (
                  <a
                    href={basescan}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 border border-edge2 px-3 py-2 font-mono text-[9px] tracking-[0.16em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
                  >
                    VIEW ON BASESCAN <ExternalLink size={11} />
                  </a>
                ) : (
                  <span
                    className="inline-flex min-h-9 items-center gap-1.5 border border-edge2 px-3 py-2 font-mono text-[9px] tracking-[0.16em] text-mute/40"
                    title="Basescan link after launch"
                  >
                    VIEW ON BASESCAN
                  </span>
                )}
              </div>
            </div>
            <p className="mt-4 border-t border-edge pt-3.5 font-mono text-[10px] leading-[1.7] tracking-[0.06em] text-mute">
              Verify the address before you transact. View on{" "}
              {basescan ? (
                <a
                  href={basescan}
                  target="_blank"
                  rel="noreferrer"
                  className="text-volt underline-offset-2 hover:underline"
                >
                  Basescan
                </a>
              ) : (
                <em className="text-mist/70">Basescan</em>
              )}
              {!basescan && (
                <span className="text-mute/60">
                  {" "}
                  — link publishes after launch.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** LAUNCH — how the token works + fair launch, over motioned ASCII */
export function CentUtilitySection() {
  return (
    <section className="relative overflow-hidden border-b border-edge">
      <div className="pointer-events-none absolute inset-0 opacity-[0.55]">
        <AsciiMotion variant="panel" className="h-full min-h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-void/75 via-void/55 to-void/85" />
      </div>

      <div className="relative mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14 md:px-12 md:py-20">
        <div className="font-mono text-[9px] tracking-[0.26em] text-volt">
          LAUNCH
        </div>
        <h2 className="mt-2 max-w-[18ch] font-display text-[clamp(1.5rem,4.5vw,2.35rem)] font-semibold tracking-[-0.03em] text-mist">
          How the token works.
        </h2>
        <p className="mt-4 max-w-[560px] text-[13.5px] leading-[1.8] text-mute sm:text-[14px]">
          USDC prices work.{" "}
          <span className="text-mist">$CENT</span> is the bond asset —
          stake to verify, slash on fault. It is not a payment network and not
          the unit of commerce.
        </p>

        {/* fair launch callout */}
        <div className="mt-7 border border-volt/45 bg-void/75 p-4 backdrop-blur-[2px] sm:mt-8 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-volt">
            <span className="h-1.5 w-1.5 shrink-0 bg-volt" />
            FAIR LAUNCH
          </div>
          <p className="mt-3 max-w-[640px] text-[13.5px] leading-[1.8] text-mist/90 sm:text-[14px]">
            No presale. No VC token round. No private allocation table.
          </p>
          <p className="mt-2 max-w-[640px] text-[12.5px] leading-[1.75] text-mute sm:text-[13px]">
            We do not publish tokenomics yet — no supply splits, vesting charts,
            or investor warrants on the coin. When the mint is live on Orynth,
            the contract address lands above. Same rules for everyone.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2">
          {HOW_IT_WORKS.map((u) => (
            <div
              key={u.title}
              className="border border-edge/80 bg-void/70 p-4 backdrop-blur-[2px] transition-colors hover:border-volt/40 sm:p-5"
            >
              <div className="font-mono text-[10px] tracking-[0.22em] text-volt">
                {u.title}
              </div>
              <p className="mt-2.5 text-[12.5px] leading-[1.7] text-mute sm:text-[13px]">
                {u.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Revenue flywheel — USDC work fees drive CENT bond demand */
export function CentRevenueFlywheel() {
  return (
    <section className="relative overflow-hidden border-b border-edge">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <AsciiMotion variant="band" className="h-full min-h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-void/80 via-void/70 to-void/90" />
      </div>

      <div className="relative mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14 md:px-12 md:py-16">
        <div className="font-mono text-[9px] tracking-[0.26em] text-volt">
          REVENUE FLYWHEEL
        </div>
        <h2 className="mt-2 max-w-[22ch] font-display text-[clamp(1.5rem,4.5vw,2.35rem)] font-semibold tracking-[-0.03em] text-mist">
          Fees in USDC. Skin in $CENT.
        </h2>
        <p className="mt-4 max-w-[560px] text-[13.5px] leading-[1.8] text-mute sm:text-[14px]">
          Commerce stays stable. Bond demand is the loop that pays for honest
          verification — not a casino emission chart.
        </p>

        {/* mobile: vertical chain · md+: 5-col strip with connectors */}
        <div className="mt-8 sm:mt-10">
          <ol className="flex flex-col gap-3 md:grid md:grid-cols-5 md:gap-0">
            {FLYWHEEL.map((step, i) => (
              <li
                key={step.n}
                className="relative flex gap-3 border border-edge/80 bg-void/75 p-4 backdrop-blur-[2px] sm:gap-4 md:flex-col md:gap-0 md:rounded-none md:border-l-0 md:p-4 md:first:border-l md:first:border-l-edge/80"
              >
                <div className="flex shrink-0 items-start md:mb-3 md:items-center md:gap-2">
                  <span className="flex h-8 w-8 items-center justify-center border border-volt/50 bg-volt/10 font-mono text-[10px] text-volt md:h-7 md:w-7 md:text-[9px]">
                    {step.n}
                  </span>
                  {i < FLYWHEEL.length - 1 && (
                    <span
                      aria-hidden
                      className="ml-2 hidden h-px flex-1 bg-volt/35 md:block md:min-w-[12px]"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[10px] tracking-[0.16em] text-mist sm:tracking-[0.18em]">
                    {step.title}
                  </div>
                  <p className="mt-2 text-[12px] leading-[1.65] text-mute sm:text-[12.5px]">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-6 border-t border-edge/60 pt-5 font-mono text-[10px] leading-[1.75] tracking-[0.06em] text-mute sm:mt-8">
          Loop closes when more agent volume needs more bonded seats — and
          slash keeps those seats honest. No presale, no fee token tax on
          buyers in CENT.
        </p>
      </div>
    </section>
  );
}

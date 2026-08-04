import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import AsciiMotion from "./AsciiMotion";
import LogoMark from "./LogoMark";

/** Set after Orynth / Solana mint is live. Empty = TBD card. */
export const CENT_CONTRACT_ADDRESS = "";
/** Solscan token URL — fill after launch. */
export const CENT_SOLSCAN_URL = "";

export const ORYNTH_PROJECT = "https://orynth.dev/projects/cipher-sentry";
export const ORYNTH_BADGE =
  "https://orynth.dev/api/badge/cipher-sentry?theme=light&style=marketcap";

export const CENT_PITCH =
  "A verification and settlement protocol for autonomous agents. Agents commit capital to buy work; independent sentries re-execute that work byte-for-byte; escrow settles only when outputs match. It is not a payment network — USDC does the pricing, CENT does the bonding.";

const UTILITIES: { title: string; body: string }[] = [
  {
    title: "BOND",
    body: "Stake CENT to join the verifier set. Floor 25,000. Seats are slashable skin-in-game — not a tip jar.",
  },
  {
    title: "VERIFY",
    body: "Sentries re-execute agent work byte-for-byte. Matching hashes are the only settlement truth.",
  },
  {
    title: "SLASH",
    body: "False votes and proven collusion burn bond to the graveyard. Replay-proof, epoch-capped.",
  },
  {
    title: "SETTLE",
    body: "Escrow releases USDC only on quorum match or a signed ruling inside the fraud window.",
  },
  {
    title: "ACCRUE",
    body: "Honest votes earn fee rebates and decaying emissions. Work never prices in CENT.",
  },
  {
    title: "GOVERN",
    body: "Bond-weighted signal on fee params, quorum sizes, registry policy — no admin path on escrow funds.",
  },
];

/** $CENT hero — pitch, Orynth badge × logo, contract card */
export function CentLaunchHero() {
  const [copied, setCopied] = useState(false);
  const addr = CENT_CONTRACT_ADDRESS.trim();
  const hasAddr = addr.length > 0;
  const solscan = CENT_SOLSCAN_URL.trim();

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
    <div className="border-b border-edge px-4 py-10 sm:px-6 sm:py-14 md:px-12 md:py-16">
      <div className="mx-auto max-w-[920px]">
        <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          LAUNCH · ORYNTH TGE · BOND ASSET
        </div>

        <h1 className="mt-5 font-display text-[clamp(2.8rem,10vw,5.5rem)] font-medium leading-[0.92] tracking-[-0.045em]">
          <span className="text-mute">$</span>
          <span className="text-mist">CENT</span>
        </h1>

        <p className="mt-6 max-w-[640px] text-[14.5px] leading-[1.85] text-mute sm:text-[15.5px] sm:leading-[1.9]">
          {CENT_PITCH}
        </p>

        {/* badge × logo */}
        <div className="mt-8 flex flex-wrap items-center gap-5 sm:gap-8">
          <a
            href={ORYNTH_PROJECT}
            target="_blank"
            rel="noreferrer"
            className="inline-block transition-opacity hover:opacity-90"
            aria-label="Featured on Orynth — Cipher Sentry"
          >
            <img
              src={ORYNTH_BADGE}
              alt="Featured on Orynth"
              className="h-10 w-auto max-w-[min(100%,280px)] border border-edge bg-mist sm:h-11"
              loading="eager"
            />
          </a>
          <div className="flex items-center gap-3 border border-edge bg-panel/40 px-4 py-2.5">
            <LogoMark size={36} className="text-volt" />
            <div className="font-mono text-[10px] leading-[1.5] tracking-[0.16em]">
              <div className="text-mist">CIPHER SENTRY</div>
              <div className="text-mute/70">NEUTRAL TRUST LAYER</div>
            </div>
          </div>
        </div>

        {/* contract card */}
        <div className="mt-8 border border-edge bg-panel/30">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3 sm:px-5">
            <span className="font-mono text-[9px] tracking-[0.22em] text-volt">
              CONTRACT ADDRESS
            </span>
            <span className="font-mono text-[8px] tracking-[0.18em] text-mute">
              {hasAddr ? "MAINNET · SOLANA" : "TBD — POST LAUNCH"}
            </span>
          </div>
          <div className="px-4 py-5 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <code
                className={`break-all font-mono text-[12px] tracking-[0.04em] sm:text-[13px] ${
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
                  className={`inline-flex items-center gap-1.5 border px-3 py-2 font-mono text-[9px] tracking-[0.16em] transition-colors ${
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
                {solscan ? (
                  <a
                    href={solscan}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 border border-edge2 px-3 py-2 font-mono text-[9px] tracking-[0.16em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
                  >
                    VIEW ON SOLSCAN <ExternalLink size={11} />
                  </a>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 border border-edge2 px-3 py-2 font-mono text-[9px] tracking-[0.16em] text-mute/40"
                    title="Solscan link after launch"
                  >
                    VIEW ON SOLSCAN
                  </span>
                )}
              </div>
            </div>
            <p className="mt-4 border-t border-edge pt-3.5 font-mono text-[10px] leading-[1.7] tracking-[0.06em] text-mute">
              Verify the address before you transact. View on{" "}
              {solscan ? (
                <a
                  href={solscan}
                  target="_blank"
                  rel="noreferrer"
                  className="text-volt underline-offset-2 hover:underline"
                >
                  Solscan
                </a>
              ) : (
                <em className="text-mist/70">Solscan</em>
              )}
              {!solscan && (
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

/** Utility grid over motioned ASCII density field */
export function CentUtilitySection() {
  return (
    <section className="relative overflow-hidden border-b border-edge">
      <div className="pointer-events-none absolute inset-0 opacity-[0.55]">
        <AsciiMotion variant="panel" className="h-full min-h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-void/75 via-void/55 to-void/85" />
      </div>

      <div className="relative mx-auto max-w-[1100px] px-4 py-12 sm:px-6 sm:py-16 md:px-12 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[9px] tracking-[0.26em] text-volt">
              UTILITY
            </div>
            <h2 className="mt-2 font-display text-[clamp(1.5rem,4vw,2.15rem)] font-semibold tracking-[-0.03em] text-mist">
              What{" "}
              <span className="text-volt">$CENT</span> does
            </h2>
          </div>
          <p className="max-w-[320px] font-mono text-[10px] leading-[1.7] tracking-[0.08em] text-mute">
            USDC prices work. CENT is only bond, slash, and accrual — never the
            unit of commerce.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {UTILITIES.map((u) => (
            <div
              key={u.title}
              className="border border-edge/80 bg-void/70 p-5 backdrop-blur-[2px] transition-colors hover:border-volt/40"
            >
              <div className="font-mono text-[10px] tracking-[0.22em] text-volt">
                {u.title}
              </div>
              <p className="mt-2.5 text-[13px] leading-[1.7] text-mute">{u.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { FileText, LockKeyhole, TrendingUp } from "lucide-react";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";
import { SOCIALS } from "../components/Social";
import { Tag } from "../app/ui";

const METRICS: [string, string, string][] = [
  ["TASKS SETTLED", "48.2K", "TESTNET · LIVE"],
  ["VOLUME ROUTED", "$1.2M", "RUN-RATE, ANNUALIZED"],
  ["REGISTERED AGENTS", "214", "+118% MOM"],
  ["VERIFIER BONDS", "2.1M CENT", "PRE-TGE · SIM+ALPHA"],
  ["DISPUTE RATE", "0.31%", "VERIFIED 3/3 · LIVE"],
  ["FINALITY", "<500ms", "P50 SETTLEMENT"],
];

const TERMS: [string, string][] = [
  ["CATEGORY", "AI — AGENT COMMERCE INFRA"],
  ["INSTRUMENT", "POST-MONEY SAFE (EQUITY)"],
  ["TARGET", "$12,000,000"],
  ["CAP", "$48M · NO DISCOUNT"],
  ["MIN CHECK", "$250,000"],
  ["LEAD SLOT", "OPEN — TERMS SET BY LEAD"],
  ["TOKEN RIGHTS", "WARRANT vs. CENT AT 1.2× PRICE RATIO"],
  ["CLOSE", "ROLLING · FIRST CLOSE W/ AUDIT #1 REPORT"],
];

const PROCEEDS: [string, number, string][] = [
  ["SECURITY — TWO AUDITS + FUZZ SUITE", 25, "GATE #3"],
  ["VERIFIER NETWORK & FRAUD PROOFS", 30, "GATE #1/#2"],
  ["RAILS — BASE MAINNET + ORYNTH (CENT TGE)", 12, "V1.0"],
  ["SDK, REGISTRY & SPEC MARKETPLACE", 13, "V0.3"],
  ["TEAM — 6 PROTOCOL + 2 RESEARCH", 15, "24-MO RUNWAY"],
  ["TREASURY / LIQUIDITY OPERATIONS", 5, "STABLE USDC"],
];

const GATES: [string, string, string][] = [
  ["G1", "VERIFIER NETWORK · ≥400 BONDED", "IN PROGRESS"],
  ["G2", "SLASHING LIVE + AUDITABLE", "SIM → CHAIN"],
  ["G3", "TWO AUDITS CLOSED", "ENG-A W1–3 · ENG-B W6–8"],
  ["G4", "60D EPOCH ACCRUAL AHEAD OF TGE", "ACCUMULATING"],
  ["G5", "RH CHAIN TERMS + LEGAL", "PENDING"],
];

export default function Investors() {
  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />

      <PageHeader path="/ INVESTORS" />

      {/* hero */}
      <div className="border-b border-edge px-4 py-10 sm:px-6 sm:py-14 md:px-12 md:py-20">
        <div className="flex items-start gap-2.5 font-mono text-[8.5px] tracking-[0.16em] text-volt sm:items-center sm:gap-3 sm:text-[9.5px] sm:tracking-[0.28em]">
          <span className="relative mt-0.5 flex h-1.5 w-1.5 shrink-0 sm:mt-0">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          <span className="min-w-0">INVESTOR RELATIONS · ROUND OPEN</span>
        </div>
        <h1 className="mt-5 max-w-[16ch] font-display text-[clamp(2.15rem,7.5vw,5.2rem)] font-medium leading-[0.98] tracking-[-0.04em] sm:mt-6">
          Agents need a neutral{" "}
          <em className="font-serif font-normal italic tracking-[-0.01em] text-volt">
            trust layer.
          </em>{" "}
          Own a piece of it.
        </h1>
        <p className="mt-5 max-w-[560px] text-[14px] leading-[1.75] text-mute sm:mt-6 sm:text-[15px] sm:leading-[1.8]">
          Cipher Sentry sells no feed, no ads, no brokerage. We take 0.35% of every
          settled task between agents — a protocol tax on compute itself,
          routed back to verifiers and treasury. This round funds the two
          audits and the verifier network that make it launch-grade.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
          <a
            href="mailto:hello@ciphersentry.xyz?subject=CIPHER%20SENTRY%20SEED%20—%20DATA%20ROOM%20REQUEST"
            className="flex min-h-12 items-center justify-center bg-volt px-6 py-3.5 font-mono text-[11px] font-semibold tracking-[0.2em] text-void transition-colors hover:bg-mist sm:py-4"
          >
            REQUEST DATA ROOM →
          </a>
          <a
            href="#/docs/whitepaper"
            className="flex min-h-12 items-center justify-center gap-2 border border-edge2 px-6 py-3.5 font-mono text-[11px] tracking-[0.2em] text-mist transition-colors hover:border-volt/70 hover:text-volt sm:py-4"
          >
            <FileText size={13} /> WHITEPAPER
          </a>
        </div>
      </div>

      {/* metrics */}
      <div className="grid grid-cols-2 gap-px border-b border-edge bg-edge sm:grid-cols-3 lg:grid-cols-6">
        {METRICS.map(([l, v, s]) => (
          <div key={l} className="bg-void p-4 md:p-5">
            <div className="font-mono text-[7.5px] tracking-[0.2em] text-mute">{l}</div>
            <div className="mt-2 font-display text-[22px] font-medium tabular-nums tracking-[-0.02em] text-mist md:text-[24px]">
              {v}
            </div>
            <div className="mt-1.5 font-mono text-[7px] tracking-[0.14em] text-mute/50">{s}</div>
          </div>
        ))}
      </div>

      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6 sm:py-14 md:px-12">
        <div className="grid gap-10 lg:grid-cols-2">
          {/* the round */}
          <section className="border border-edge bg-panel/40">
            <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
              <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.24em] text-mute">
                <TrendingUp size={11} className="text-volt" /> THE ROUND
              </span>
              <Tag tone="volt">SEED</Tag>
            </div>
            <div>
              {TERMS.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-6 border-b border-edge/60 px-5 py-3 font-mono text-[10.5px] last:border-b-0">
                  <span className="tracking-[0.18em] text-mute">{k}</span>
                  <span className="text-right text-mist/85">{v}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-edge px-5 py-4">
              <div className="border-l-2 border-amber-300 bg-amber-300/[0.05] px-4 py-3">
                <div className="font-mono text-[8.5px] tracking-[0.24em] text-amber-300">TOKEN NOTE</div>
                <p className="font-mono mt-1.5 text-[10px] leading-[1.8] text-mute">
                  This is an <span className="text-mist">equity</span> round — not a token sale.
                  CENT's TGE is gated on the five launch conditions in DOC-05; token
                  exposure for participants is only via priced warrants, never ahead
                  of the verifier network proving usage.
                </p>
              </div>
            </div>
          </section>

          {/* use of proceeds */}
          <section className="border border-edge bg-panel/40">
            <div className="border-b border-edge px-5 py-3.5 font-mono text-[9px] tracking-[0.24em] text-mute">
              USE OF PROCEEDS — EVERY DOLLAR MAPS TO A LAUNCH GATE
            </div>
            <div className="space-y-4 px-5 py-5">
              {PROCEEDS.map(([label, pct, gate]) => (
                <div key={label}>
                  <div className="flex items-baseline justify-between font-mono text-[9px] tracking-[0.14em]">
                    <span className="text-mist/80">{label}</span>
                    <span className="text-volt">{pct}%</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 bg-edge">
                      <div className="h-full bg-volt/80" style={{ width: `${pct * 2.4}%` }} />
                    </div>
                    <span className="font-mono text-[7px] tracking-[0.16em] text-mute/50">{gate}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* thesis */}
        <section className="mt-10 grid gap-px border border-edge bg-edge lg:grid-cols-3">
          {[
            {
              n: "01",
              h: "Timing",
              p: "Agents already transact — API credits, GPU spot, data pulls — all on trust priced as hope. Every one of those flows is escrow-shaped and verifier-shaped. The wedge is already under load.",
            },
            {
              n: "02",
              h: "Structure",
              p: "Fees in stable USDC flow to CENT stakers, not to a company P&L. The protocol takes 15% of a 0.35% fee — thin on purpose. Equity owns the treasury stream, never the escrow.",
            },
            {
              n: "03",
              h: "Defense",
              p: "Trust scores, verifier bonds and receipt graphs compound per settled task. A competitor can fork contracts; it cannot fork 48,000 signed receipts of agents that finish.",
            },
          ].map((t) => (
            <div key={t.n} className="bg-void p-6">
              <div className="font-mono text-[10px] text-volt/70">{t.n}</div>
              <h3 className="mt-3 font-display text-[19px] font-semibold">{t.h}</h3>
              <p className="mt-2.5 text-[12.5px] leading-[1.75] text-mute">{t.p}</p>
            </div>
          ))}
        </section>

        {/* launch gates */}
        <section className="mt-10 border border-edge">
          <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
            <span className="font-mono text-[9px] tracking-[0.24em] text-mute">CENT LAUNCH GATES — THE ONLY CALENDAR THAT MATTERS</span>
            <Tag tone="dim">DOC-05</Tag>
          </div>
          {GATES.map(([g, label, st]) => (
            <div key={g} className="flex items-center gap-4 border-b border-edge/60 px-5 py-3.5 font-mono text-[10px] last:border-b-0">
              <span className="text-volt/70">{g}</span>
              <span className="flex-1 tracking-[0.08em] text-mist/80">{label}</span>
              <span className={st === "PENDING" ? "text-mute/50" : "text-amber-300"}>{st}</span>
            </div>
          ))}
        </section>

        {/* contact */}
        <section className="mt-10 grid gap-6 border border-volt/40 bg-deepgreen p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
          <div>
            <div className="flex items-center gap-2.5 font-mono text-[9px] tracking-[0.24em] text-volt">
              <LockKeyhole size={12} /> DATA ROOM — GATED BY NDA
            </div>
            <p className="mt-3 max-w-lg text-[13px] leading-[1.8] text-mute">
              Materials include the audit engagement letters, verifier-network
              code, epoch-accrual ledger, RH Chain term sheet draft, and the
              live ops console you can open in this site right now.
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <a href="mailto:hello@ciphersentry.xyz" className="bg-volt px-6 py-3.5 text-center font-mono text-[10px] font-semibold tracking-[0.2em] text-void transition-colors hover:bg-mist">
              HELLO@CIPHERSENTRY.COM →
            </a>
            <a href={SOCIALS.x} target="_blank" rel="noreferrer" className="border border-edge2 px-6 py-3.5 text-center font-mono text-[10px] tracking-[0.2em] text-mist transition-colors hover:border-volt/70 hover:text-volt">
              FOLLOW @CIPHERSENTRY
            </a>
          </div>
        </section>

        <div className="mt-10 font-mono text-[8px] tracking-[0.22em] text-mute/40">
          NOTHING HERE IS AN OFFER TO SELL SECURITIES · ACCREDITED ENTITIES ONLY · FORWARD-LOOKING STATEMENTS ARE BLOCK-HEIGHT ESTIMATES
        </div>
      </div>
    </div>
  );
}

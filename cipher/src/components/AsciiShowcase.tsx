import { ArrowUpRight } from "lucide-react";
import AsciiMotion from "./AsciiMotion";
import Reveal from "./Reveal";
import SectionHead from "./SectionHead";

/**
 * Mid-landing visual chapter: the reference ASCII density figure as a
 * living sentry — proof that the protocol’s “machines that watch” identity
 * is texture, not stock illustration.
 */
export default function AsciiShowcase() {
  return (
    <section
      id="sentry"
      className="scroll-mt-[68px] border-b border-edge bg-void/55"
    >
      <SectionHead
        index="03"
        kicker="THE SENTRY"
        title={
          <>
            Density as{" "}
            <em className="font-serif italic text-volt">proof.</em>
          </>
        }
        desc="Every glyph is a cell of state. The figure is not decoration — it is how Cipher Sentry sees work: mass, edge, and verified form."
      />

      <div className="section-x pb-16 sm:pb-20 md:pb-24">
        <div className="grid gap-px border border-edge bg-edge lg:grid-cols-[1.15fr_0.85fr]">
          {/* living figure */}
          <Reveal className="relative min-h-[420px] bg-void sm:min-h-[520px] lg:min-h-[640px]">
            <div className="absolute inset-0">
              <AsciiMotion variant="figure" />
            </div>
            {/* chrome overlay — does not block canvas */}
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <span className="border border-edge2/80 bg-void/70 px-2.5 py-1.5 font-mono text-[8.5px] tracking-[0.22em] text-mute backdrop-blur-sm">
                  FIELD · DENSITY RAMP · LIVE
                </span>
                <span className="flex items-center gap-2 font-mono text-[8.5px] tracking-[0.2em] text-volt">
                  <span className="h-1.5 w-1.5 animate-pulse bg-volt" />
                  SCAN
                </span>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="border border-edge2/70 bg-void/75 px-3 py-2 font-mono text-[9px] tracking-[0.18em] text-mute backdrop-blur-sm">
                  <div className="text-mist/80">MRC-EPOCH · FIGURE_01</div>
                  <div className="mt-1 text-[8px] text-mute/70">
                    REF: docs/screenshots/ascii motion work
                  </div>
                </div>
                <div className="font-mono text-[8px] tracking-[0.2em] text-mute/60">
                  HUMANS: 0
                </div>
              </div>
            </div>
          </Reveal>

          {/* copy + micro panels */}
          <div className="flex flex-col bg-void">
            <Reveal delay={0.08} className="border-b border-edge p-7 sm:p-9 md:p-10">
              <div className="font-mono text-[9px] tracking-[0.26em] text-volt">
                WATCH · VERIFY · SETTLE
              </div>
              <h3 className="mt-4 font-display text-[clamp(1.55rem,3vw,2.15rem)] font-medium leading-[1.12] tracking-[-0.03em] text-mist">
                A machine that does not
                <br />
                <em className="font-serif italic text-deepgreen">guess.</em>
              </h3>
              <p className="mt-4 max-w-md text-[13.5px] leading-[1.75] text-mute">
                The sentry re-executes work, matches output hashes, and only
                then unlocks escrow. Form emerges from density — same as the
                figure: noise until the mass holds.
              </p>
              <a
                href="#/protocol"
                className="group mt-7 inline-flex items-center gap-2 font-mono text-[10.5px] tracking-[0.2em] text-mist transition-colors hover:text-volt"
              >
                ENTER THE LOOP
                <ArrowUpRight
                  size={13}
                  strokeWidth={2.5}
                  className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </a>
            </Reveal>

            <div className="grid flex-1 grid-cols-1 sm:grid-cols-2">
              {[
                {
                  k: "01 / MASS",
                  t: "Quorum weight",
                  b: "3-of-3 verifiers form a solid mass of agreement before release.",
                },
                {
                  k: "02 / EDGE",
                  t: "Fraud window",
                  b: "64 blocks to challenge a mismatch. Edges stay sharp under dispute.",
                },
                {
                  k: "03 / RAMP",
                  t: "Reputation",
                  b: "Sparse agents stay quiet. Dense history prices into every quote.",
                },
                {
                  k: "04 / SCAN",
                  t: "Finality",
                  b: "One pass of the beam. Receipt anchored. Status: SETTLED.",
                },
              ].map((card, i) => (
                <Reveal
                  key={card.k}
                  delay={0.1 + i * 0.06}
                  className={`relative overflow-hidden border-edge p-6 sm:p-7 ${
                    i % 2 === 0 ? "sm:border-r" : ""
                  } ${i < 2 ? "border-b" : ""}`}
                >
                  {i === 0 && (
                    <div className="pointer-events-none absolute inset-0 opacity-40">
                      <AsciiMotion variant="panel" dense />
                    </div>
                  )}
                  <div className="relative">
                    <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute/70">
                      {card.k}
                    </div>
                    <div className="mt-3 font-display text-[16px] font-semibold tracking-[-0.02em] text-mist">
                      {card.t}
                    </div>
                    <p className="mt-2 text-[12.5px] leading-[1.7] text-mute">
                      {card.b}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

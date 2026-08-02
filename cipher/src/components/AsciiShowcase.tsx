import { ArrowUpRight } from "lucide-react";
import AsciiFigure from "./AsciiFigure";
import Reveal from "./Reveal";
import SectionHead from "./SectionHead";

/**
 * 03 · THE SENTRY — image-driven ASCII figure (ascii motion work.jpg).
 */
export default function AsciiShowcase() {
  return (
    <section id="sentry" className="scroll-mt-[68px] border-b border-edge">
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

      <div className="section-x pb-12 sm:pb-16 md:pb-20 lg:pb-24">
        <div className="grid gap-px border border-edge bg-edge lg:grid-cols-[1.15fr_0.85fr]">
          <Reveal className="relative min-h-[min(70vw,360px)] bg-void sm:min-h-[480px] lg:min-h-[640px]">
            <div className="absolute inset-0">
              <AsciiFigure />
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-5 md:p-6">
              <div className="flex justify-end">
                <span className="flex items-center gap-2 bg-void/85 px-2.5 py-1.5 font-mono text-[8.5px] tracking-[0.2em] text-volt backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 animate-pulse bg-volt" />
                  LIVE
                </span>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
                <div className="border border-edge2/70 bg-void/90 px-2.5 py-1.5 font-mono text-[8.5px] tracking-[0.16em] text-mute backdrop-blur-sm sm:px-3 sm:py-2 sm:text-[9px] sm:tracking-[0.18em]">
                  <div className="text-mist/80">MRC-EPOCH · FIGURE_01</div>
                  <div className="mt-1 text-[7.5px] text-mute/70 sm:text-[8px]">
                    HUMANS: 0
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          <div className="flex flex-col bg-void">
            <Reveal delay={0.08} className="border-b border-edge p-5 sm:p-7 md:p-9 lg:p-10">
              <div className="font-mono text-[9px] tracking-[0.26em] text-volt">
                WATCH · VERIFY · SETTLE
              </div>
              <h3 className="mt-3 font-display text-[clamp(1.4rem,4.5vw,2.15rem)] font-medium leading-[1.12] tracking-[-0.03em] text-mist sm:mt-4">
                A machine that does not
                <br />
                <em className="font-serif italic text-volt">guess.</em>
              </h3>
              <p className="mt-3 max-w-md text-[13px] leading-[1.75] text-mute sm:mt-4 sm:text-[13.5px]">
                The sentry re-executes work, matches output hashes, and only
                then unlocks escrow. Form emerges from density — same as the
                figure: noise until the mass holds.
              </p>
              <a
                href="#/protocol"
                className="group mt-5 inline-flex min-h-11 items-center gap-2 font-mono text-[10.5px] tracking-[0.2em] text-mist transition-colors hover:text-volt sm:mt-7"
              >
                ENTER THE PROTOCOL
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
                  k: "04 / FORM",
                  t: "Finality",
                  b: "Mass holds. Receipt anchored. Status: SETTLED.",
                },
              ].map((card, i) => (
                <Reveal
                  key={card.k}
                  delay={0.1 + i * 0.06}
                  className={`relative border-edge p-5 sm:p-6 md:p-7 ${
                    i % 2 === 0 ? "sm:border-r" : ""
                  } ${i < 2 ? "border-b" : ""} ${i === 2 ? "border-b sm:border-b-0" : ""}`}
                >
                  <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute/70">
                    {card.k}
                  </div>
                  <div className="mt-2.5 font-display text-[15px] font-semibold tracking-[-0.02em] text-mist sm:mt-3 sm:text-[16px]">
                    {card.t}
                  </div>
                  <p className="mt-2 text-[12px] leading-[1.7] text-mute sm:text-[12.5px]">
                    {card.b}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

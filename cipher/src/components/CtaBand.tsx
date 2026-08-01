import { ArrowUpRight, FileText } from "lucide-react";
import { openAccessModal } from "./AccessModal";
import Reveal from "./Reveal";

export default function CtaBand() {
  return (
    <section id="access" className="relative scroll-mt-[68px] border-t border-edge">
      <div className="relative mx-auto max-w-4xl px-8 py-24 text-center md:py-32">
        <Reveal>
          <div className="font-mono text-[9.5px] tracking-[0.28em] text-mute">
            REQUEST ACCESS / BATCHED
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <h2 className="mt-6 font-display text-[clamp(2.4rem,6vw,5.2rem)] font-medium leading-[0.98] tracking-[-0.04em]">
            Agents are already trading.
            <br />
            <em className="font-serif font-normal italic tracking-[-0.015em] text-deepgreen">
              Be the layer they trust.
            </em>
          </h2>
        </Reveal>

        <Reveal delay={0.24}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3.5">
            <button
              onClick={openAccessModal}
              className="group flex w-full items-center justify-center gap-2.5 bg-volt px-7 py-4 font-mono text-[11px] font-semibold tracking-[0.18em] text-ink transition-colors duration-300 hover:bg-volthot sm:w-auto"
            >
              REQUEST ACCESS
              <ArrowUpRight
                size={14}
                strokeWidth={2.5}
                className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </button>
            <a
              href="#/docs/specification"
              className="group flex w-full items-center justify-center gap-2.5 border border-edge2 px-7 py-4 font-mono text-[11px] tracking-[0.18em] text-mist transition-colors duration-300 hover:border-volt/70 hover:text-volt sm:w-auto"
            >
              READ THE SPEC
              <FileText
                size={14}
                strokeWidth={2}
                className="transition-transform duration-300 group-hover:translate-y-0.5"
              />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

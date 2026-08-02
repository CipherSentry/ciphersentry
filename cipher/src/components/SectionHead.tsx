import type { ReactNode } from "react";
import Reveal from "./Reveal";

export default function SectionHead({
  index,
  kicker,
  title,
  desc,
}: {
  index: string;
  kicker: string;
  title: ReactNode;
  desc?: string;
}) {
  return (
    <div className="section-x px-0 pb-10 pt-0 sm:pb-12 md:pb-16">
      <Reveal>
        <div className="flex items-end justify-between gap-6 border-b border-edge pb-5 sm:gap-10 sm:pb-6 md:pb-8">
          <div className="flex min-w-0 items-baseline gap-3 sm:gap-5">
            <span className="shrink-0 font-mono text-[9px] tracking-[0.22em] text-volt sm:text-[10px] sm:tracking-[0.26em]">
              {index}
            </span>
            <span className="truncate font-mono text-[9px] tracking-[0.2em] text-mute sm:text-[10px] sm:tracking-[0.28em]">
              {kicker}
            </span>
          </div>
          {desc && (
            <p className="hidden max-w-sm pb-0.5 text-[12.5px] leading-[1.8] text-mute md:block">
              {desc}
            </p>
          )}
        </div>
      </Reveal>
      <div className="mt-6 grid gap-6 sm:mt-8 sm:gap-8 lg:mt-9 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-10">
        <Reveal delay={0.07}>
          <h2 className="font-display text-[clamp(1.85rem,6.5vw,4.6rem)] font-medium leading-[1.03] tracking-[-0.035em]">
            {title}
          </h2>
        </Reveal>
        {desc && (
          <Reveal delay={0.16} className="lg:hidden">
            <p className="max-w-sm text-[12.5px] leading-[1.8] text-mute">{desc}</p>
          </Reveal>
        )}
      </div>
    </div>
  );
}

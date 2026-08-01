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
    <div className="section-x section-y section-x-y px-0 pb-14 pt-0 md:pb-16">
      <Reveal>
        <div className="flex items-end justify-between gap-10 border-b border-edge pb-6 md:pb-8">
          <div className="flex items-baseline gap-5">
            <span className="font-mono text-[10px] tracking-[0.26em] text-volt">{index}</span>
            <span className="font-mono text-[10px] tracking-[0.28em] text-mute">{kicker}</span>
          </div>
          {desc && (
            <p className="hidden max-w-sm pb-0.5 text-[12.5px] leading-[1.8] text-mute md:block">
              {desc}
            </p>
          )}
        </div>
      </Reveal>
      <div className="mt-9 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <Reveal delay={0.07}>
          <h2 className="font-display text-[clamp(2.3rem,4.8vw,4.6rem)] font-medium leading-[1.03] tracking-[-0.035em]">
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

import { useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { liveConsoleHref } from "../sdk/livePath";
import AsciiFigure from "./AsciiFigure";
import TaskTrace from "./TaskTrace";

function Line({
  children,
  i,
  reduce,
}: {
  children: React.ReactNode;
  i: number;
  reduce: boolean;
}) {
  return (
    <span className="-mb-[0.09em] block overflow-hidden pb-[0.09em]">
      <span
        className={reduce ? "block" : "block animate-hero-line"}
        style={reduce ? undefined : { animationDelay: `${0.08 + i * 0.06}s` }}
      >
        {children}
      </span>
    </span>
  );
}

export default function Hero() {
  const reduce = useReducedMotion() ?? false;

  return (
    <section id="top" className="relative border-b border-edge">
      <div className="section-x pt-12 sm:pt-14 md:pt-20 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)] lg:pt-24">
        {/* ---- left: the statement ---- */}
        <div className="pb-12 sm:pb-16 md:pb-20">
          <div
            className={`flex max-w-full items-start gap-2.5 font-mono text-[8.5px] tracking-[0.16em] text-volt sm:items-center sm:gap-3 sm:text-[9.5px] sm:tracking-[0.28em] ${reduce ? "" : "animate-fade-up"}`}
            style={reduce ? undefined : { animationDelay: "0.04s" }}
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-volt sm:mt-0" />
            <span className="min-w-0 leading-relaxed">
              <span className="sm:hidden">AGENT SECURITY / V0.2 · 2026</span>
              <span className="hidden sm:inline">
                AGENT SECURITY PROTOCOL / V0.2 · 2026 — THE YEAR AGENTS SHIP
              </span>
            </span>
          </div>

          <h1 className="mt-7 font-display text-[clamp(2.7rem,11vw,7.2rem)] font-medium leading-[0.95] tracking-[-0.045em] sm:mt-8 sm:text-[clamp(2.85rem,8.5vw,7.2rem)] md:mt-10">
            <Line i={0} reduce={reduce}>
              Agents work.
            </Line>
            <Line i={1} reduce={reduce}>
              <em className="font-serif font-normal italic tracking-[-0.015em] text-volt">
                Sentries
              </em>
            </Line>
            <Line i={2} reduce={reduce}>
              prove it.
            </Line>
          </h1>

          <p
            className={`mt-7 max-w-[27rem] text-[14px] leading-[1.75] text-mute sm:mt-8 sm:text-[15px] ${reduce ? "" : "animate-fade-up"}`}
            style={reduce ? undefined : { animationDelay: "0.36s" }}
          >
            Agents commit capital. Sentries re-execute work byte-for-byte.
            Escrow settles only on matching proof — never on promises, never
            with a human in the loop.
          </p>

          <div
            className={`mt-8 flex flex-col gap-4 sm:mt-9 sm:flex-row sm:flex-wrap sm:items-center sm:gap-7 ${reduce ? "" : "animate-fade-up"}`}
            style={reduce ? undefined : { animationDelay: "0.44s" }}
          >
            <a
              href={liveConsoleHref()}
              className="group flex min-h-12 w-full items-center justify-center gap-2.5 bg-volt px-6 py-3.5 font-mono text-[11px] font-semibold tracking-[0.2em] text-ink transition-colors duration-200 hover:bg-volthot sm:w-auto"
            >
              OPEN LIVE CONSOLE
              <ArrowRight
                size={14}
                strokeWidth={2.5}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </a>
            <a
              href="#/demo"
              className="group flex min-h-11 items-center justify-center gap-1.5 font-mono text-[10.5px] tracking-[0.2em] text-mute transition-colors duration-200 hover:text-mist sm:justify-start"
            >
              TRY THE FLOW
              <ArrowRight
                size={13}
                strokeWidth={2.5}
                className="transition-transform duration-200 group-hover:translate-x-1"
              />
            </a>
          </div>

          <div
            className={`mt-10 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[9px] tracking-[0.2em] text-mute/70 ${reduce ? "" : "animate-fade-up"}`}
            style={reduce ? undefined : { animationDelay: "0.52s" }}
          >
            <span>
              SETTLEMENT: <span className="text-mist/75">USDC</span>
            </span>
            <span>
              FINALITY: <span className="text-mist/75">INSTANT</span>
            </span>
            <span>
              HUMANS: <span className="text-volt">0</span>
            </span>
          </div>
        </div>

        {/* ---- right: static ASCII field + terminal (no live canvas loop) ---- */}
        <div className="relative border-t border-edge bg-void contain-paint lg:min-h-[min(640px,calc(100svh-68px))] lg:border-l lg:border-t-0">
          <div className="pointer-events-none absolute inset-0 opacity-[0.55]">
            <AsciiFigure static />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-void/50 via-void/20 to-void/55" />

          <div className={`relative flex h-full flex-col ${reduce ? "" : "animate-shelf-in"}`}>
            <div className="flex items-center justify-between border-b border-edge/80 bg-void/90 px-4 py-3.5 sm:px-7">
              <span className="flex items-center gap-2.5 font-mono text-[9px] tracking-[0.26em] text-volt">
                <span className="h-1.5 w-1.5 bg-volt" />
                LIVE TASK TRACE
              </span>
              <span className="h-1.5 w-1.5 bg-volt/70" aria-hidden />
            </div>
            <div className="flex flex-1 items-center justify-center overflow-x-auto px-2 sm:px-0">
              <TaskTrace bare light />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

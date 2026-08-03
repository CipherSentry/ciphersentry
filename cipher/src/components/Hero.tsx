import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { liveConsoleHref } from "../sdk/livePath";
import AsciiFigure from "./AsciiFigure";
import TaskTrace from "./TaskTrace";
import { EASE } from "./Reveal";

function Line({ children, i }: { children: React.ReactNode; i: number }) {
  return (
    <span className="-mb-[0.09em] block overflow-hidden pb-[0.09em]">
      <motion.span
        className="block"
        initial={{ y: "112%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 1.15, ease: EASE, delay: 0.25 + i * 0.11 }}
      >
        {children}
      </motion.span>
    </span>
  );
}

export default function Hero() {
  return (
    <section id="top" className="relative border-b border-edge">
      <div className="section-x pt-12 sm:pt-14 md:pt-24 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
        {/* ---- left: the statement ---- */}
        <div className="pb-12 sm:pb-16 md:pb-24">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.15 }}
            className="flex max-w-full items-start gap-2.5 font-mono text-[8.5px] tracking-[0.16em] text-volt sm:items-center sm:gap-3 sm:text-[9.5px] sm:tracking-[0.28em]"
          >
            <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-volt sm:mt-0" />
            <span className="min-w-0 leading-relaxed">
              <span className="sm:hidden">AGENT SECURITY / V0.2 · 2026</span>
              <span className="hidden sm:inline">AGENT SECURITY PROTOCOL / V0.2 · 2026 — THE YEAR AGENTS SHIP</span>
            </span>
          </motion.div>

          <h1 className="mt-7 font-display text-[clamp(2.35rem,9.5vw,8.5rem)] font-medium leading-[0.96] tracking-[-0.045em] sm:mt-8 md:mt-12">
            <Line i={0}>Agents work.</Line>
            <Line i={1}>
              <em className="font-serif font-normal italic tracking-[-0.015em] text-volt">
                Sentries
              </em>
            </Line>
            <Line i={2}>prove it.</Line>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.75 }}
            className="mt-7 max-w-[27rem] text-[14px] leading-[1.75] text-mute sm:mt-9 sm:text-[15px] sm:leading-[1.8]"
          >
            Agents commit capital. Sentries re-execute work byte-for-byte.
            Escrow settles only on matching proof — never on promises, never
            with a human in the loop.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
            className="mt-8 flex flex-col gap-4 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-7"
          >
            <a
              href={liveConsoleHref()}
              className="group flex min-h-12 w-full items-center justify-center gap-2.5 bg-volt px-6 py-3.5 font-mono text-[11px] font-semibold tracking-[0.2em] text-ink transition-colors duration-300 hover:bg-volthot sm:w-auto sm:py-4"
            >
              OPEN LIVE CONSOLE
              <ArrowRight
                size={14}
                strokeWidth={2.5}
                className="transition-transform duration-300 group-hover:translate-x-1"
              />
            </a>
            <a
              href="#/demo"
              className="group flex min-h-11 items-center justify-center gap-1.5 font-mono text-[10.5px] tracking-[0.2em] text-mute transition-colors duration-300 hover:text-mist sm:justify-start"
            >
              TRY THE FLOW
              <ArrowRight
                size={13}
                strokeWidth={2.5}
                className="transition-transform duration-300 group-hover:translate-x-1"
              />
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.15 }}
            className="mt-12 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[9px] tracking-[0.2em] text-mute/70"
          >
            <span>SETTLEMENT: <span className="text-mist/75">USDC</span></span>
            <span>FINALITY: <span className="text-mist/75">INSTANT</span></span>
            <span>HUMANS: <span className="text-volt">0</span></span>
          </motion.div>
        </div>

        {/* ---- right: LIVE TASK TRACE — void base + ASCII motion field ---- */}
        <div className="relative border-t border-edge bg-void contain-paint lg:min-h-[calc(100svh-68px)] lg:border-l lg:border-t-0">
          <div className="pointer-events-none absolute inset-0 opacity-[0.72]">
            <AsciiFigure />
          </div>
          {/* soft wash so the terminal card stays readable on void */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-void/55 via-void/25 to-void/55" />

          <div className="relative h-full flex-col lg:flex animate-shelf-in">
            <div className="flex items-center justify-between border-b border-edge/80 bg-void/90 px-4 py-3.5 sm:px-7 sm:py-4">
              <span className="flex items-center gap-2.5 font-mono text-[9px] tracking-[0.26em] text-volt">
                <span className="h-1.5 w-1.5 bg-volt" />
                LIVE TASK TRACE
              </span>
              <span className="flex h-1.5 w-1.5 items-center justify-center">
                <span className="h-1.5 w-1.5 animate-pulse bg-volt/80" />
              </span>
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

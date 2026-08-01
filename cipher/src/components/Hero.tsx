import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
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
      <div className="section-x pt-14 md:pt-24 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,520px)]">
        {/* ---- left: the statement ---- */}
        <div className="pb-16 md:pb-24">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.15 }}
            className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt"
          >
            <span className="h-1.5 w-1.5 bg-volt" />
            AGENT SECURITY PROTOCOL / V0.2 · 2026 — THE YEAR AGENTS SHIP
          </motion.div>

          <h1 className="mt-8 font-display text-[clamp(2.6rem,8.6vw,8.5rem)] font-medium leading-[0.96] tracking-[-0.045em] md:mt-12">
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
            className="mt-9 max-w-[27rem] text-[15px] leading-[1.8] text-mute"
          >
            Agents commit capital. Sentries re-execute work byte-for-byte.
            Escrow settles only on matching proof — never on promises, never
            with a human in the loop.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
            className="mt-10 flex flex-wrap items-center gap-7"
          >
            <a
              href="#/demo"
              className="group flex items-center gap-2.5 bg-volt px-6 py-4 font-mono text-[11px] font-semibold tracking-[0.2em] text-ink transition-colors duration-300 hover:bg-volthot"
            >
              TRY THE FLOW
              <ArrowRight
                size={14}
                strokeWidth={2.5}
                className="transition-transform duration-300 group-hover:translate-x-1"
              />
            </a>
            <a
              href="#/protocol"
              className="group flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.2em] text-mute transition-colors duration-300 hover:text-mist"
            >
              SEE THE LOOP
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

        {/* ---- right: the engineering window ---- */}
        <div className="border-t border-code-edge bg-code lg:min-h-[calc(100svh-68px)] lg:border-l lg:border-t-0">
          <div className="h-full flex-col lg:flex animate-shelf-in">
            <div className="flex items-center justify-between border-b border-code-edge px-7 py-4">
              <span className="flex items-center gap-2.5 font-mono text-[9px] tracking-[0.26em] text-volthot">
                <span className="h-1.5 w-1.5 bg-volthot" />
                LIVE TASK TRACE
              </span>
              <span className="flex h-1.5 w-1.5 items-center justify-center">
                <span className="h-1.5 w-1.5 animate-pulse bg-volthot/80" />
              </span>
            </div>
            <div className="flex flex-1 items-center justify-center">
              <TaskTrace bare />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

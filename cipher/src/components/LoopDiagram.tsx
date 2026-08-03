import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "./Reveal";

const STEPS = [
  { n: "01", tag: "REGISTRY.QUERY", label: "DISCOVER" },
  { n: "02", tag: "ESCROW.LOCK", label: "COMMIT" },
  { n: "03", tag: "HASH.RECOMPUTE", label: "VERIFY" },
  { n: "04", tag: "ESCROW.RELEASE", label: "SETTLE" },
] as const;

const HOLD_MS = 2200;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Minimal looping protocol animation — four states only.
 * No density fields, no orbit, no scan beams.
 */
export default function LoopDiagram({ size = "md" }: { size?: "md" | "lg" }) {
  const [active, setActive] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const r = prefersReducedMotion();
    setReduced(r);
    if (r) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % STEPS.length);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, []);

  const step = STEPS[active];

  return (
    <div
      className={`mx-auto w-full border border-edge bg-void ${
        size === "lg" ? "max-w-[520px]" : "max-w-[440px]"
      }`}
    >
      {/* chrome */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-3 sm:px-5">
        <span className="font-mono text-[8.5px] tracking-[0.22em] text-mute">
          PROTOCOL · LOOP
        </span>
        <span className="font-mono text-[8.5px] tabular-nums tracking-[0.18em] text-mute">
          <span className="text-volt">{step.n}</span>
          <span className="text-mute/50"> / 04</span>
        </span>
      </div>

      {/* active step — large, quiet */}
      <div className="relative min-h-[128px] border-b border-edge px-4 py-6 sm:min-h-[168px] sm:px-7 sm:py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.n}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <div className="font-mono text-[10px] tracking-[0.28em] text-volt">
              {step.n}
            </div>
            <div className="mt-3 font-mono text-[10px] tracking-[0.22em] text-mute">
              {step.tag}
            </div>
            <div className="mt-2 font-display text-[clamp(1.45rem,6vw,2.35rem)] font-medium tracking-[-0.03em] text-mist">
              {step.label}
              {!reduced && (
                <span className="ml-0.5 inline-block h-[0.85em] w-[0.45em] translate-y-[0.06em] bg-volt align-baseline animate-blink" />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* step list — one active, rest mute */}
      <ol className="divide-y divide-edge">
        {STEPS.map((s, i) => {
          const on = i === active;
          return (
            <li key={s.n}>
              <button
                type="button"
                onClick={() => setActive(i)}
                className={`flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors duration-300 sm:gap-4 sm:px-5 ${
                  on ? "bg-panel" : "bg-void hover:bg-panel/50"
                }`}
              >
                <span
                  className={`w-6 shrink-0 font-mono text-[10px] tabular-nums tracking-[0.14em] ${
                    on ? "text-volt" : "text-mute/45"
                  }`}
                >
                  {s.n}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-[9px] tracking-[0.18em] sm:text-[9.5px] ${
                    on ? "text-mist" : "text-mute/50"
                  }`}
                >
                  {s.tag}
                </span>
                <span
                  className={`shrink-0 font-mono text-[10px] tracking-[0.2em] ${
                    on ? "text-volt" : "text-mute/40"
                  }`}
                >
                  {s.label}
                </span>
                <span
                  className={`h-1 w-1 shrink-0 ${on ? "bg-volt" : "bg-edge2"}`}
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ol>

      {/* progress rail */}
      <div className="grid grid-cols-4 gap-px border-t border-edge bg-edge">
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            className={`h-0.5 transition-colors duration-500 ${
              i === active ? "bg-volt" : i < active ? "bg-volt/35" : "bg-void"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

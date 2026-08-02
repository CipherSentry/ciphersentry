import { useEffect, useMemo, useState } from "react";

/**
 * AsciiMotion — ambient ASCII layer on every route.
 * Non-interactive, low-opacity, reduced-motion aware.
 */

const STREAM = [
  "mrc_8f5a2c0",
  "agent:atlas-01",
  "agent:vector-7",
  "quorum: 3/3",
  "MRC-EPOCH ···",
  "0x9af2be…77c1",
  "escrow 42.80 USDC",
  "✓ hash verified",
  "✓ escrow released",
  "status: SETTLED_",
  "HUMANS: 0",
  "finality <500ms",
  "bond ≥ 25k MARC",
  "fee 0.35% · 85/15",
  "batch_8911",
  "sha256 · ed25519",
];

const GLYPHS = "░▒▓█·|-+/\\<>[]{}#*ox+=~^";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useClock(ms: number, enabled: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setT((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
  return t;
}

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
  const map = {
    tl: "top-2 left-2 sm:top-3 sm:left-3 border-l border-t",
    tr: "top-2 right-2 sm:top-3 sm:right-3 border-r border-t",
    bl: "bottom-2 left-2 sm:bottom-3 sm:left-3 border-l border-b",
    br: "bottom-2 right-2 sm:bottom-3 sm:right-3 border-r border-b",
  } as const;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-3 w-3 border-volt/35 sm:h-4 sm:w-4 ${map[pos]}`}
    />
  );
}

function VerticalRail({ side, tick, dense }: { side: "left" | "right"; tick: number; dense?: boolean }) {
  const rows = 28;
  const lines = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < rows; i++) {
      const base = STREAM[(i + tick) % STREAM.length];
      const g = GLYPHS[(i * 3 + tick) % GLYPHS.length];
      out.push(i % 3 === 0 ? `${g} ${base}` : `${g}${g} ···`);
    }
    return out;
  }, [tick]);

  /* hide side rails inside dense app chrome — tape + corners only */
  if (dense) return null;

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-0 hidden h-full overflow-hidden font-mono text-[8px] leading-[1.65] tracking-[0.08em] text-volt/20 lg:block ${
        side === "left" ? "left-0 w-[7.5rem] border-r border-edge/40 pl-2 pr-1" : "right-0 w-[7.5rem] border-l border-edge/40 pr-2 pl-1 text-right"
      }`}
    >
      <div
        className="ascii-scroll-y flex flex-col gap-0 py-8"
        style={{ animationDuration: side === "left" ? "42s" : "54s" }}
      >
        {[...lines, ...lines].map((line, i) => (
          <span key={`${side}-${i}`} className="block whitespace-nowrap opacity-80">
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

function HorizontalTape({ tick, dense }: { tick: number; dense?: boolean }) {
  const seq = useMemo(() => {
    const slice = STREAM.map((s, i) => `${GLYPHS[(i + tick) % GLYPHS.length]} ${s}`);
    return [...slice, ...slice, ...slice].join("   ·   ");
  }, [tick]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 overflow-hidden border-b border-edge/50 bg-void/40 py-1 backdrop-blur-[2px] sm:py-1.5 ${
        dense ? "opacity-50" : ""
      }`}
    >
      <div className="ascii-scroll-x whitespace-nowrap font-mono text-[8px] tracking-[0.18em] text-volt/30 sm:text-[9px]">
        <span className="inline-block px-4">{seq}</span>
        <span className="inline-block px-4" aria-hidden>
          {seq}
        </span>
      </div>
    </div>
  );
}

function CursorBlink({ tick }: { tick: number }) {
  const epoch = 88421 + (tick % 97);
  const hex = useMemo(() => {
    const n = (0x9af2be + tick * 17) >>> 0;
    return `0x${n.toString(16).slice(0, 6)}…${((n ^ 0x77c1) & 0xffff).toString(16).padStart(4, "0")}`;
  }, [tick]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-8 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] tracking-[0.22em] text-mute/40 lg:block"
    >
      <span className="text-volt/40">$</span> MRC-EPOCH {epoch} · {hex}
      <span className="animate-blink ml-1 inline-block h-[10px] w-[5px] translate-y-[1px] bg-volt/50" />
    </div>
  );
}

function StaticFrame() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[5] select-none">
      <Corner pos="tl" />
      <Corner pos="tr" />
      <Corner pos="bl" />
      <Corner pos="br" />
      <div className="absolute inset-x-0 top-0 flex justify-center font-mono text-[8px] tracking-[0.28em] text-volt/25">
        <span className="border-b border-edge/40 bg-void/50 px-3 py-1">CIPHER SENTRY · ASCII FIELD</span>
      </div>
    </div>
  );
}

export default function AsciiMotion({ dense = false }: { dense?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const tick = useClock(dense ? 900 : 1400, !reduced);

  if (reduced) return <StaticFrame />;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[5] select-none overflow-hidden"
    >
      <Corner pos="tl" />
      <Corner pos="tr" />
      <Corner pos="bl" />
      <Corner pos="br" />

      {/* faint grid wash — edges only */}
      <div className="absolute inset-0 ascii-edge-fade opacity-[0.35]" />

      <VerticalRail side="left" tick={tick} dense={dense} />
      <VerticalRail side="right" tick={tick + 7} dense={dense} />
      <HorizontalTape tick={tick} dense={dense} />
      {!dense && <CursorBlink tick={tick} />}

      {/* mobile corner status chip — marketing pages only */}
      {!dense && (
        <div className="absolute right-3 top-[4.75rem] font-mono text-[7.5px] tracking-[0.2em] text-volt/35 sm:top-20 lg:hidden">
          <span className="inline-flex max-w-[min(70vw,14rem)] items-center gap-1.5 truncate border border-edge/60 bg-void/60 px-2 py-1">
            <span className="h-1 w-1 shrink-0 animate-pulse bg-volt/70" />
            LIVE · {STREAM[tick % STREAM.length]}
          </span>
        </div>
      )}
    </div>
  );
}

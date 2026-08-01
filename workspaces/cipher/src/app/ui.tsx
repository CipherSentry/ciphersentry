import { ArrowLeft, ChevronRight, Copy, Fingerprint, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import type { TaskState } from "./data";

/* ---------------- chips & labels ---------------- */

type Tone = "volt" | "amber" | "red" | "mist" | "dim";

const TONES: Record<Tone, string> = {
  volt: "border-volt/60 text-volt",
  amber: "border-amber-300/50 text-amber-300",
  red: "border-red-400/60 text-red-400",
  mist: "border-edge2 text-mist/80",
  dim: "border-edge2/70 text-mute",
};

export function Tag({ tone = "dim", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[8.5px] tracking-[0.18em]", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between">
      <span className="font-mono text-[9px] tracking-[0.28em] text-mute">{children}</span>
      {right}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-edge bg-panel/60", className)}>{children}</div>;
}

/* ---------------- state dots ---------------- */

export const STATE_TONE: Record<TaskState, Tone> = {
  RUNNING: "volt",
  VERIFYING: "amber",
  SETTLED: "mist",
  DISPUTED: "red",
  FAILED: "red",
};

export function StateDot({ state }: { state: TaskState }) {
  const color =
    state === "RUNNING"
      ? "bg-volt"
      : state === "VERIFYING"
        ? "bg-amber-300"
        : state === "SETTLED"
          ? "bg-mist/50"
          : "bg-red-400";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {(state === "RUNNING" || state === "DISPUTED") && (
        <span className={cn("absolute h-full w-full animate-ping opacity-50", color)} />
      )}
      <span className={cn("relative h-2 w-2", color)} />
    </span>
  );
}

/* ---------------- KPI stat ---------------- */

export function Stat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="border-l border-edge pl-3">
      <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">{label}</div>
      <div className={cn("mt-1.5 font-mono text-[15px] font-semibold tabular-nums", tone === "volt" ? "text-volt" : "text-mist")}>
        {value}
      </div>
    </div>
  );
}

/* ---------------- switch ---------------- */

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300",
        on ? "border-volt/70 bg-volt/20" : "border-edge2 bg-void",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all duration-300",
          on ? "left-[22px] bg-volt" : "left-1 bg-mute/60",
        )}
      />
    </button>
  );
}

/* ---------------- stepper ---------------- */

export function Stepper({ value, onChange, min, max, step }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <div className="flex items-center gap-1 border border-edge2">
      <button onClick={() => onChange(Math.max(min, value - step))} className="flex h-8 w-8 items-center justify-center text-mute transition-colors hover:text-volt">
        <Minus size={12} />
      </button>
      <span className="w-16 text-center font-mono text-[12px] font-semibold tabular-nums text-mist">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + step))} className="flex h-8 w-8 items-center justify-center text-mute transition-colors hover:text-volt">
        <Plus size={12} />
      </button>
    </div>
  );
}

/* ---------------- charts ---------------- */

export function Spark({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${26 - ((v - min) / (max - min || 1)) * 22}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={cn("h-7 w-full", className)}>
      <polyline points={pts} fill="none" stroke="#3dff36" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <polygon points={`0,28 ${pts} 100,28`} fill="rgba(198,255,65,0.07)" stroke="none" />
    </svg>
  );
}

export function Bars({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <div className="flex h-16 items-end gap-[3px]">
      {data.map((v, i) => (
        <div
          key={i}
          className={cn("flex-1", v === max ? "bg-volt" : "bg-edge2")}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function Ring({ pct, size = 84 }: { pct: number; size?: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1e241a" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#3dff36"
          strokeWidth="7"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-semibold text-mist">
        {pct}
      </span>
    </div>
  );
}

/* ---------------- headers & rows ---------------- */

export function BackHeader({ title, sub, onBack }: { title: string; sub?: string; onBack: () => void }) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-edge bg-void/90 px-5 py-4 backdrop-blur-md">
      <button onClick={onBack} className="flex h-8 w-8 items-center justify-center border border-edge2 text-mute transition-colors hover:border-volt/60 hover:text-volt">
        <ArrowLeft size={14} />
      </button>
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-semibold tracking-[0.08em] text-mist">{title}</div>
        {sub && <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">{sub}</div>}
      </div>
    </div>
  );
}

export function Row({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-edge/70 px-5 py-3.5 text-left transition-colors last:border-b-0",
        onClick && "active:bg-panel",
        className,
      )}
    >
      {children}
      {onClick && <ChevronRight size={13} className="ml-auto shrink-0 text-mute/50" />}
    </button>
  );
}

/* ---------------- hash line ---------------- */

export function HashLine({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-edge/60 py-2.5 font-mono text-[10.5px] last:border-b-0">
      <span className="tracking-[0.14em] text-mute">{label}</span>
      <span className="flex items-center gap-2">
        <span className={ok === false ? "text-red-400" : ok === true ? "text-volt" : "text-mist/85"}>{value}</span>
        <button
          onClick={() => {
            try {
              navigator.clipboard?.writeText(value);
            } catch {
              /* noop */
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className={cn("transition-colors", copied ? "text-volt" : "text-mute/50 hover:text-mist")}
        >
          <Copy size={11} />
        </button>
      </span>
    </div>
  );
}

/* ---------------- hold to confirm ---------------- */

export function HoldButton({ label, onDone, tone = "volt", className }: { label: string; onDone: () => void; tone?: "volt" | "red"; className?: string }) {
  const [p, setP] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);

  useEffect(() => () => cancelRaf(), []);

  const cancelRaf = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const begin = () => {
    start.current = performance.now();
    const loop = (t: number) => {
      const pr = Math.min(1, (t - start.current) / 950);
      setP(pr);
      if (pr >= 1) {
        cancelRaf();
        setP(0);
        onDone();
      } else {
        raf.current = requestAnimationFrame(loop);
      }
    };
    raf.current = requestAnimationFrame(loop);
  };

  const end = () => {
    cancelRaf();
    setP(0);
  };

  return (
    <button
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      className={cn(
        "relative w-full touch-none select-none overflow-hidden border py-4 font-mono text-[10.5px] font-semibold tracking-[0.22em]",
        tone === "volt" ? "border-volt/70 text-volt" : "border-red-400/70 text-red-400",
        className,
      )}
    >
      <span
        className={cn("absolute inset-0 origin-left", tone === "volt" ? "bg-volt/20" : "bg-red-400/15")}
        style={{ transform: `scaleX(${p})` }}
      />
      <span className="relative flex items-center justify-center gap-2.5">
        <Fingerprint size={14} />
        {p > 0 ? `HOLD… ${Math.round(p * 100)}%` : label}
      </span>
    </button>
  );
}

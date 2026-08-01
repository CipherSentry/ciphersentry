import type { ReactNode } from "react";
import { cn } from "../utils/cn";

/* ---------------- panel — quiet chrome only ---------------- */

export function Panel({
  title,
  right,
  children,
  className,
  bodyClass,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-11 shrink-0 items-center justify-between border-t border-edge px-5">
        <span className="flex items-center gap-2.5 font-mono text-[8.5px] tracking-[0.26em] text-mute">
          <span className="h-1 w-1 bg-volt" />
          {title}
        </span>
        {right}
      </div>
      <div className={cn("min-h-0 flex-1", bodyClass)}>{children}</div>
    </div>
  );
}

/* ---------------- key/value row ---------------- */

export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: "volt" | "amber" | "red" }) {
  return (
    <div className="flex items-center justify-between border-b border-edge/60 py-2.5 font-mono text-[10px] last:border-b-0">
      <span className="tracking-[0.16em] text-mute">{k}</span>
      <span
        className={cn(
          "tabular-nums",
          tone === "volt" && "text-volt",
          tone === "amber" && "text-amber-300",
          tone === "red" && "text-red-400",
          !tone && "text-mist",
        )}
      >
        {v}
      </span>
    </div>
  );
}

/* ---------------- ascii trust bar ---------------- */

export function TrustBars({ value }: { value: number }) {
  const filled = Math.round((value / 100) * 5);
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="inline-flex gap-[3px]">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={cn("h-2.5 w-[5px]", i < filled ? "bg-volt" : "bg-edge2")} />
        ))}
      </span>
      <span className="font-mono text-[9.5px] tabular-nums text-mute">{value}</span>
    </span>
  );
}

/* ---------------- rolling area chart ---------------- */

export function AreaChart({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 22}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn("h-full w-full", className)}>
      <polygon points={`0,32 ${pts} 100,32`} fill="rgba(61,255,54,0.06)" stroke="none" />
      <polyline points={pts} fill="none" stroke="#3dff36" strokeWidth="0.8" strokeLinejoin="round" />
      <line x1="0" y1="31.5" x2="100" y2="31.5" stroke="#1e241a" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
    </svg>
  );
}

/* ---------------- animated escrow state machine ---------------- */

const STAGES = ["COMMIT", "EXECUTE", "VERIFY", "SETTLE"] as const;

export function FlowMachine({
  counts,
  disputes,
  className,
}: {
  counts: number[];
  disputes: number;
  className?: string;
}) {
  return (
    <div className={cn("relative panel-pad pt-6", className)}>
      {STAGES.map((s, i) => (
        <div key={s} className="relative">
          {i > 0 && (
            <div className="absolute -top-6 left-[7px] h-6 w-px bg-edge2">
              <span
                className="anim-drop absolute h-1.5 w-1.5 -translate-x-[3px] bg-volt shadow-[0_0_8px_1px_rgba(61,255,54,0.6)]"
                style={{ animationDelay: `${i * 0.45}s` }}
              />
            </div>
          )}
          <div className="mb-6 flex items-center gap-3.5 last:mb-0">
            <span
              className={cn(
                "h-[15px] w-[15px] shrink-0 border",
                s === "SETTLE"
                  ? "border-volt/70 bg-volt/20"
                  : counts[i] > 0
                    ? "border-volt/50 bg-volt/10"
                    : "border-edge2",
              )}
            />
            <span className="w-16 font-mono text-[9px] tracking-[0.2em] text-mute">{s}</span>
            <span
              className={cn(
                "ml-auto font-mono text-[16px] font-semibold tabular-nums",
                counts[i] > 0 ? "text-volt" : "text-mist/40",
              )}
            >
              {String(counts[i]).padStart(2, "0")}
            </span>
            {s === "VERIFY" && disputes > 0 && (
              <span className="flex items-center gap-1.5 border border-red-400/50 px-1.5 py-0.5 font-mono text-[7.5px] tracking-[0.14em] text-red-400">
                ↯{disputes} DISPUTED
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

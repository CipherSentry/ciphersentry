import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

const TASKS = [
  { id: "cent_8f5a2c0", buyer: "agent:atlas-01", worker: "agent:vector-7", escrow: "42.80" },
  { id: "cent_3c91be4", buyer: "agent:helix-3", worker: "agent:probe-9", escrow: "128.00" },
  { id: "cent_f002a17", buyer: "agent:orbit-2", worker: "agent:antenna-4", escrow: "06.25" },
  { id: "cent_77d93c1", buyer: "agent:nomad-6", worker: "agent:forge-11", escrow: "310.50" },
];

const CMD = "ciphersentry.task.execute";

type Phase =
  | { k: "type"; n: number }
  | { k: "rows"; n: number }
  | { k: "checking" }
  | { k: "check"; n: number }
  | { k: "settled" }
  | { k: "next" };

/** Build a single timeline; one setState per event (no per-char timers). */
function buildTimeline(): { at: number; phase: Phase }[] {
  const out: { at: number; phase: Phase }[] = [];
  let at = 450;
  // larger chunks → fewer React commits
  for (let i = 4; i < CMD.length; i += 4) {
    out.push({ at, phase: { k: "type", n: i } });
    at += 90;
  }
  out.push({ at, phase: { k: "type", n: CMD.length } });
  at += 280;
  for (let r = 1; r <= 4; r++) {
    out.push({ at, phase: { k: "rows", n: r } });
    at += 180;
  }
  out.push({ at, phase: { k: "checking" } });
  at += 800;
  out.push({ at, phase: { k: "check", n: 1 } });
  at += 280;
  out.push({ at, phase: { k: "check", n: 2 } });
  at += 320;
  out.push({ at, phase: { k: "settled" } });
  at += 2800;
  out.push({ at, phase: { k: "next" } });
  return out;
}

const TIMELINE = buildTimeline();

function BlockCursor({ className = "" }: { className?: string }) {
  return (
    <span
      className={`animate-blink ml-1 inline-block h-[12px] w-[6px] translate-y-[1px] bg-volt ${className}`}
    />
  );
}

export default function TaskTrace({
  bare = false,
  light = false,
}: {
  bare?: boolean;
  /** Light canvas (hero shelf with ASCII motion) — no dark code well. */
  light?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState(0);
  const [rows, setRows] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState(0);
  const [settled, setSettled] = useState(false);
  const [active, setActive] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const task = TASKS[idx];

  // Pause when off-screen or tab hidden
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setActive(e.isIntersecting && !document.hidden),
      { threshold: 0.15 },
    );
    io.observe(el);
    const onVis = () => setActive(!document.hidden && (io.takeRecords()[0]?.isIntersecting ?? true));
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    setTyped(0);
    setRows(0);
    setChecking(false);
    setChecks(0);
    setSettled(false);

    const timers = TIMELINE.map(({ at, phase }) =>
      setTimeout(() => {
        switch (phase.k) {
          case "type":
            setTyped(phase.n);
            break;
          case "rows":
            setRows(phase.n);
            break;
          case "checking":
            setChecking(true);
            break;
          case "check":
            setChecking(false);
            setChecks(phase.n);
            break;
          case "settled":
            setSettled(true);
            break;
          case "next":
            setIdx((i) => (i + 1) % TASKS.length);
            break;
        }
      }, at),
    );

    return () => timers.forEach(clearTimeout);
  }, [idx, active]);

  const dataRows: [string, string][] = [
    ["task_id", task.id],
    ["buyer", task.buyer],
    ["worker", task.worker],
    ["escrow", `${task.escrow} USDC`],
  ];

  const fg = light ? "text-mist" : "text-code-fg";
  const mute = light ? "text-mute" : "text-code-mute";
  const edge = light ? "border-edge" : "border-code-edge";

  return (
    <div
      ref={rootRef}
      className={
        bare
          ? "relative flex h-full min-h-[420px] flex-col contain-paint sm:min-h-[480px] lg:min-h-[520px]"
          : "relative flex h-full min-h-[480px] flex-col overflow-hidden border-t border-edge bg-void contain-paint sm:min-h-[520px] lg:min-h-0 lg:border-l lg:border-t-0"
      }
    >
      {!bare && <div aria-hidden className="absolute inset-0 opacity-70 trace-grid" />}

      {/* panel header — skipped when bare (hero owns the chrome) */}
      {!bare && (
        <div className="relative z-10 flex items-center justify-between px-7 pt-7">
          <span className="flex items-center gap-2.5 font-mono text-[10px] tracking-[0.28em] text-volt">
            <span className="h-1.5 w-1.5 bg-volt" />
            LIVE TASK TRACE
          </span>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping bg-volt opacity-50" />
            <span className="relative inline-flex h-2 w-2 bg-volt" />
          </span>
        </div>
      )}

      {/* terminal */}
      <div
        className={`relative z-10 flex flex-1 items-center px-4 py-8 sm:px-7 sm:py-10 lg:justify-center ${
          bare ? "lg:px-8" : "lg:pr-16"
        }`}
      >
        <div className="relative w-full max-w-[min(100%,390px)]">
          <div
            aria-hidden
            className={`absolute inset-0 translate-x-2 translate-y-2 border ${
              light ? "border-edge2/50" : "border-edge2/60"
            }`}
          />
          <div
            className={`relative border ${
              light
                ? "border-edge bg-void/92 shadow-[0_20px_60px_-24px_rgba(8,10,7,0.18)]"
                : "surface-code shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]"
            }`}
          >
            {active && !light && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="animate-scan absolute inset-x-0 top-0 h-full">
                  <div className="h-8 w-full bg-gradient-to-b from-transparent via-volt/[0.07] to-transparent" />
                </div>
              </div>
            )}

            <div className="h-[248px] p-4 font-mono text-[10.5px] leading-[1.75] sm:h-[264px] sm:p-6 sm:text-[11.5px]">
              <div className="whitespace-nowrap">
                <span className="text-volt">$</span>{" "}
                <span className={fg}>{CMD.slice(0, typed)}</span>
                {typed < CMD.length && <BlockCursor />}
              </div>

              <div className="mt-2.5">
                {dataRows.slice(0, rows).map(([k, v]) => (
                  <div key={k} className="whitespace-nowrap">
                    <span className={mute}>{k}:</span>{" "}
                    <span className={k === "escrow" ? "text-volt" : fg}>{v}</span>
                  </div>
                ))}
              </div>

              {rows === 4 && <div className={`my-3.5 border-t ${edge}`} />}

              {checking && (
                <div className={mute}>
                  … recomputing output hash
                  <span className="animate-blink">_</span>
                </div>
              )}

              {checks >= 1 && (
                <div className="flex items-center gap-2 text-volt">
                  <Check size={11} strokeWidth={3} />
                  output hash verified
                </div>
              )}
              {checks >= 2 && (
                <div className="flex items-center gap-2 text-volt">
                  <Check size={11} strokeWidth={3} />
                  escrow released
                </div>
              )}

              {settled && (
                <div className="pt-2">
                  <span className={mute}>status:</span>{" "}
                  <span className={`font-semibold ${fg}`}>SETTLED</span>
                  <BlockCursor />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* panel footer */}
      <div className="relative z-10 px-4 pb-5 sm:px-7 sm:pb-7">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-4">
          <span className="font-mono text-[8px] tracking-[0.16em] text-mute sm:text-[9px] sm:tracking-[0.24em]">
            ZERO HUMAN APPROVALS REQUIRED
          </span>
          <span className="font-mono text-[8px] tracking-[0.16em] text-mute/50 sm:text-[9px] sm:tracking-[0.24em]">
            HMN: 0
          </span>
        </div>
      </div>
    </div>
  );
}

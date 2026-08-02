import { useEffect, useState } from "react";
import { Check } from "lucide-react";

const TASKS = [
  { id: "cent_8f5a2c0", buyer: "agent:atlas-01", worker: "agent:vector-7", escrow: "42.80" },
  { id: "cent_3c91be4", buyer: "agent:helix-3", worker: "agent:probe-9", escrow: "128.00" },
  { id: "cent_f002a17", buyer: "agent:orbit-2", worker: "agent:antenna-4", escrow: "06.25" },
  { id: "cent_77d93c1", buyer: "agent:nomad-6", worker: "agent:forge-11", escrow: "310.50" },
];

const CMD = "ciphersentry.task.execute";

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

  const task = TASKS[idx];

  useEffect(() => {
    setTyped(0);
    setRows(0);
    setChecking(false);
    setChecks(0);
    setSettled(false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = 500;

    for (let i = 1; i <= CMD.length; i++) {
      const n = i;
      timers.push(setTimeout(() => setTyped(n), at));
      at += 26;
    }
    at += 260;
    for (let r = 1; r <= 4; r++) {
      const n = r;
      timers.push(setTimeout(() => setRows(n), at));
      at += 145;
    }
    timers.push(setTimeout(() => setChecking(true), at));
    at += 950;
    timers.push(
      setTimeout(() => {
        setChecking(false);
        setChecks(1);
      }, at),
    );
    at += 260;
    timers.push(setTimeout(() => setChecks(2), at));
    at += 300;
    timers.push(setTimeout(() => setSettled(true), at));
    at += 2600;
    timers.push(setTimeout(() => setIdx((i) => (i + 1) % TASKS.length), at));

    return () => timers.forEach(clearTimeout);
  }, [idx]);

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
      className={
        bare
          ? "relative flex h-full min-h-[420px] flex-col sm:min-h-[480px] lg:min-h-[520px]"
          : "relative flex h-full min-h-[480px] flex-col overflow-hidden border-t border-edge bg-void sm:min-h-[520px] lg:min-h-0 lg:border-l lg:border-t-0"
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
                ? "border-edge bg-void/88 shadow-[0_20px_60px_-24px_rgba(8,10,7,0.18)] backdrop-blur-[3px]"
                : "surface-code shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]"
            }`}
          >
            {!light && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="animate-scan absolute h-8 w-full bg-gradient-to-b from-transparent via-volt/[0.07] to-transparent" />
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

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

export default function TaskTrace({ bare = false }: { bare?: boolean }) {
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

  return (
    <div
      className={
        bare
          ? "relative flex h-full min-h-[520px] flex-col"
          : "relative flex h-full min-h-[560px] flex-col overflow-hidden border-t border-edge bg-panel lg:min-h-0 lg:border-l lg:border-t-0"
      }
    >
      {/* grid texture — the single texture left on the page */}
      {!bare && <div aria-hidden className="absolute inset-0 opacity-70 trace-grid" />}

      {/* panel header */}
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

      {!bare && (
        <div className="hidden lg:block">
        </div>
      )}
      {/* terminal */}
      <div className="relative z-10 flex flex-1 items-center px-7 py-10 lg:justify-center lg:pr-16">
        <div className="relative w-full max-w-[390px]">
          {/* offset back plate */}
          <div
            aria-hidden
            className="absolute inset-0 translate-x-2 translate-y-2 border border-edge2/60"
          />
          <div className="relative border border-edge2 bg-ink/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
            {/* scan beam */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="animate-scan absolute h-8 w-full bg-gradient-to-b from-transparent via-volt/[0.07] to-transparent" />
            </div>

            <div className="h-[264px] p-6 font-mono text-[11px] leading-[1.75] sm:text-[11.5px]">
              {/* command line */}
              <div className="whitespace-nowrap">
                <span className="text-volt">$</span>{" "}
                <span className="text-mist">{CMD.slice(0, typed)}</span>
                {typed < CMD.length && <BlockCursor />}
              </div>

              {/* data rows */}
              <div className="mt-2.5">
                {dataRows.slice(0, rows).map(([k, v]) => (
                  <div key={k} className="whitespace-nowrap">
                    <span className="text-mute">{k}:</span>{" "}
                    <span className={k === "escrow" ? "text-volt" : "text-mist"}>{v}</span>
                  </div>
                ))}
              </div>

              {/* divider + verification */}
              {rows === 4 && <div className="my-3.5 border-t border-edge2/80" />}

              {checking && (
                <div className="text-mute">
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
                  <span className="text-mute">status:</span>{" "}
                  <span className="font-semibold text-mist">SETTLED</span>
                  <BlockCursor />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* panel footer */}
      <div className="relative z-10 px-7 pb-7">
        <div className="flex items-center justify-between border-t border-edge pt-4">
          <span className="font-mono text-[9px] tracking-[0.24em] text-mute">
            ZERO HUMAN APPROVALS REQUIRED
          </span>
          <span className="font-mono text-[9px] tracking-[0.24em] text-mute/50">
            HMN: 0
          </span>
        </div>
      </div>
    </div>
  );
}

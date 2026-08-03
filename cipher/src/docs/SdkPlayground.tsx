import { Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CipherSentry, CenError } from "../sdk/ciphersentry";

type Tone = "mist" | "volt" | "hot" | "peach" | "mute" | "red" | "amber";
interface Line {
  id: number;
  text: string;
  tone: Tone;
}

/* palette tones on dark code surface — green / deep green / peach / black */
const TONE_CLS: Record<Tone, string> = {
  mist: "text-code-fg/90",
  volt: "text-volt",
  hot: "text-volthot",
  peach: "text-code-peach",
  mute: "text-code-mute",
  red: "text-red-400",
  amber: "text-amber-300",
};

export default function SdkPlayground() {
  const [lines, setLines] = useState<Line[]>([
    { id: 0, text: "// sandbox bound to the in-page simulation network", tone: "mute" },
    { id: 1, text: "// press RUN — this executes the real client from src/sdk", tone: "mute" },
  ]);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(0);
  const idRef = useRef(2);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const log = (text: string, tone: Tone = "mist") =>
    setLines((ls) => [...ls, { id: idRef.current++, text, tone }]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    const attempt = ran + 1;
    setRan(attempt);
    setLines([]);

    log(`$ node quickstart.ts        # run ${attempt}`, "mute");
    log("", "mute");
    // shared client — this commit lands live in the Ops consoles too
    const cent = CipherSentry.shared({ key: "op:demo" });

    try {
      log("→ registry.query({ spec: 'render.sequence.4k', minTier: 'T1' })");
      const [worker] = await cent.registry.query({ spec: "render.sequence.4k", minTier: "T1" });
      if (!worker) throw new CenError("CEN_E_NOT_FOUND", "no worker matched the filter");
      log(`✓ ${worker.id} · trust ${worker.trust} · ${worker.rate.toFixed(2)} USDC/task`, "hot");

      log("→ task.commit({ frames: 240, seed: 88421 } · escrow 42.80 USDC)", "peach");
      const task = await cent.task.commit({
        worker: worker.id,
        spec: "render.sequence.4k",
        input: { frames: 240, seed: 88421 },
        escrow: { amount: "42.80", asset: "USDC" },
      });
      log(`✓ ${task.id} COMMITTED — escrow locked`, "volt");

      log("… quorum recomputing (3/3)", "amber");
      const r = await cent.verify(task, { quorum: 3 });
      log(`✓ hashes match  ${r.recomputed}`, "hot");
      log(`✓ SETTLED · receipt ${r.taskId} · ${r.ms}ms · tx ${r.tx}`, "volt");
      log("exit 0 — escrow released, receipt anchored", "mute");
    } catch (e) {
      if (e instanceof CenError) {
        log(`✗ ${e.code}`, "red");
        log(`  ${e.message}`, "mute");
        if (e.code === "CEN_E_HASH_MISMATCH") {
          log("→ escrow FROZEN — intervention opened in Ops console", "amber");
          log("  resolve it: #/app → INTERVENE", "mute");
        } else {
          log("→ handled. escrow auto-refunds where defined by spec", "mute");
        }
      } else {
        log("✗ unexpected error", "red");
      }
    }
    setRunning(false);
  };

  return (
    <div className="surface-code relative mt-5 max-w-full border border-volt/20">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-volthot/50 to-transparent" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-code-edge px-3 py-2.5 sm:px-4">
        <span className="flex min-w-0 items-center gap-2 font-mono text-[8px] tracking-[0.18em] text-volthot sm:tracking-[0.24em]">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className={`absolute h-full w-full bg-volthot ${running ? "animate-ping opacity-60" : "opacity-40"}`} />
            <span className="relative h-1.5 w-1.5 bg-volthot" />
          </span>
          <span className="truncate">PLAYGROUND — LIVE CLIENT</span>
        </span>
        <button
          onClick={run}
          disabled={running}
          className={`flex shrink-0 items-center gap-2 border px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] transition-colors ${
            running
              ? "cursor-wait border-amber-300/50 text-amber-300"
              : "border-volt/70 text-volt hover:bg-volt hover:text-void"
          }`}
        >
          {running ? <RotateCcw size={11} className="animate-spin" /> : <Play size={11} />}
          {running ? "RUNNING…" : ran ? "RUN AGAIN" : "RUN"}
        </button>
      </div>
      <div ref={scrollRef} className="no-scrollbar h-[200px] overflow-y-auto p-3 font-mono text-[10.5px] leading-[1.9] sm:h-[240px] sm:p-4 sm:text-[11px] sm:leading-[1.95]">
        {lines.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-all ${TONE_CLS[l.tone]}`}>
            {l.text || "\u00A0"}
          </div>
        ))}
        {running && <span className="animate-blink inline-block h-3.5 w-[7px] bg-volthot align-middle" />}
      </div>
      <div className="border-t border-code-edge px-3 py-2.5 font-mono text-[7.5px] tracking-[0.14em] text-code-mute sm:px-4 sm:text-[8px] sm:tracking-[0.18em]">
        SAME API AS WIRE · ~6% NONDETERMINISM EXERCISES DISPUTE PATH
      </div>
    </div>
  );
}

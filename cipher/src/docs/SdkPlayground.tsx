import { Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CipherSentry, CenError } from "../sdk/ciphersentry";

type Tone = "mist" | "volt" | "mute" | "red" | "amber";
interface Line {
  id: number;
  text: string;
  tone: Tone;
}

const TONE_CLS: Record<Tone, string> = {
  mist: "text-mist/85",
  volt: "text-volt",
  mute: "text-mute",
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
      log(`✓ ${worker.id} · trust ${worker.trust} · ${worker.rate.toFixed(2)} USDC/task`, "volt");

      log("→ task.commit({ frames: 240, seed: 88421 } · escrow 42.80 USDC)");
      const task = await cent.task.commit({
        worker: worker.id,
        spec: "render.sequence.4k",
        input: { frames: 240, seed: 88421 },
        escrow: { amount: "42.80", asset: "USDC" },
      });
      log(`✓ ${task.id} COMMITTED — escrow locked`, "volt");

      log("… quorum recomputing (3/3)", "amber");
      const r = await cent.verify(task, { quorum: 3 });
      log(`✓ hashes match  ${r.recomputed}`, "volt");
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
    <div className="mt-5 border border-edge bg-ink">
      <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[8px] tracking-[0.24em] text-mute">
          <span className="relative flex h-1.5 w-1.5">
            <span className={`absolute h-full w-full bg-volt ${running ? "animate-ping opacity-60" : "opacity-40"}`} />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          PLAYGROUND — LIVE CLIENT, SIM NETWORK
        </span>
        <button
          onClick={run}
          disabled={running}
          className={`flex items-center gap-2 border px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] transition-colors ${
            running
              ? "cursor-wait border-amber-300/50 text-amber-300"
              : "border-volt/70 text-volt hover:bg-volt hover:text-void"
          }`}
        >
          {running ? <RotateCcw size={11} className="animate-spin" /> : <Play size={11} />}
          {running ? "RUNNING…" : ran ? "RUN AGAIN" : "RUN"}
        </button>
      </div>
      <div ref={scrollRef} className="no-scrollbar h-[240px] overflow-y-auto p-4 font-mono text-[11px] leading-[1.95]">
        {lines.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap ${TONE_CLS[l.tone]}`}>
            {l.text || "\u00A0"}
          </div>
        ))}
        {running && <span className="animate-blink inline-block h-3.5 w-[7px] bg-volt align-middle" />}
      </div>
      <div className="border-t border-edge px-4 py-2.5 font-mono text-[8px] tracking-[0.18em] text-mute/50">
        SAME API AS WIRE PROTOCOL · ~6% INJECTED NONDETERMINISM TO EXERCISE THE DISPUTE PATH
      </div>
    </div>
  );
}

import { ArrowRight, Check, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import Frame from "../components/Frame";
import LogoMark from "../components/LogoMark";
import { Stepper } from "../app/ui";
import { signRuling } from "../crypto/keys";
import type { SignedRuling } from "../crypto/keys";
import { useOperator } from "../crypto/useOperator";

/* ------------------------- deterministic fixture -------------------------- */

const TASK_ID = "cent_try_7f2a";
const SPEC = "render.sequence.4k";
const WORKER_ESCROW_FEE_BPS = 35;

const feeOf = (amount: number) => (amount * WORKER_ESCROW_FEE_BPS) / 10_000;

type Stage = "COMMIT" | "LOCKED" | "EXECUTING" | "VERIFYING" | "DECIDE" | "SETTLED" | "FAILED";
type Mode = "clean" | "mismatch";

interface Sim {
  stage: Stage;
  mode: Mode;
  progress: number;
  voteCount: number;
  matched: boolean;
  ruling?: "REFUND BUYER" | "RELEASE TO WORKER" | "SPLIT 50/50";
  sig?: SignedRuling | null;
}

function useFlow() {
  const [s, setS] = useState<Sim>({ stage: "COMMIT", mode: "clean", progress: 0, voteCount: 0, matched: false });

  const commit = (mode: Mode) => {
    setS({ stage: "LOCKED", mode, progress: 0, voteCount: 0, matched: false, sig: null });

    setTimeout(() => setS((p) => ({ ...p, stage: "EXECUTING", progress: 20 })), 900);
    setTimeout(() => setS((p) => ({ ...p, progress: 55 })), 1500);
    setTimeout(() => setS((p) => ({ ...p, stage: "VERIFYING", progress: 0, voteCount: 1, matched: true })), 2200);
    setTimeout(() => setS((p) => ({ ...p, progress: 50, voteCount: 2, matched: true })), 2900);

    if (mode === "clean") {
      setTimeout(() => setS((p) => ({ ...p, progress: 100, voteCount: 3, matched: true })), 3600);
      setTimeout(() => setS((p) => ({ ...p, stage: "SETTLED", progress: 100 })), 4300);
    } else {
      setTimeout(() => setS((p) => ({ ...p, stage: "DECIDE", matched: false })), 3600);
    }
  };

  const rule = (ruling: Sim["ruling"], sig: SignedRuling | null) => {
    const target = ruling === "REFUND BUYER" ? "FAILED" : "SETTLED";
    setS((p) => ({ ...p, stage: target as Stage, ruling, sig }));
  };

  return { s, commit, rule };
}

/* ------------------------------ shell chrome ------------------------------ */

function Chrome({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />
      <header className="sticky top-0 z-40 border-b border-edge bg-void/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-6 md:px-12">
          <div className="flex min-w-0 items-center gap-4">
            <a href="#/" aria-label="Back to ciphersentry.com" className="group flex shrink-0 items-center">
              <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
            </a>
            <span className="hidden font-mono text-[9px] tracking-[0.22em] text-mute md:inline">/ TRY THE FLOW</span>
          </div>
          <div className="flex items-center gap-5">
            <span className="font-mono text-[8.5px] tracking-[0.2em] text-volt">{right ?? "TRIAL MODE — NO REAL FUNDS · REPLAYABLE"}</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[900px] px-6 py-10 md:px-12 md:py-14">{children}</main>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-mono text-[8.5px] tracking-[0.26em] text-mute">{children}</div>;
}

/* ------------------------------ stage chips ------------------------------- */

const STAGES: { id: string; title: string; desc: string }[] = [
  { id: "COMMIT", title: "Commit.", desc: "Privately lock escrow against a worker. Price is the contract." },
  { id: "LOCKED", title: "Escrow locks.", desc: "Capital becomes truth. Protocol-visible. Untouchable." },
  { id: "EXECUTING", title: "Worker executes.", desc: "Registered spec runs against the deterministic clock." },
  { id: "VERIFYING", title: "Quorum verifies.", desc: "Three independent verifiers re-compute the output hash, then vote." },
  { id: "DECIDE", title: "You rule.", desc: "The single window where a human is required. Rarely, and fast." },
  { id: "SETTLED", title: "Settled.", desc: "Worker paid, treasury fee, bond returned — and receipt anchored." },
];

/* ------------------------------- screens ---------------------------------- */

function IntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <Chrome right="HUMANS NEEDED: 0">
      <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
          <span className="relative h-1.5 w-1.5 bg-volt" />
        </span>
        TRY THE FLOW — 45 SECONDS
      </div>
      <h1 className="mt-6 font-display text-[clamp(2.5rem,6.5vw,5rem)] font-medium leading-[0.98] tracking-[-0.04em]">
        Watch money ask {<span className="font-serif font-normal italic tracking-[-0.01em] text-volt">permission</span>}, then{" "}
        <span className="font-serif font-normal italic tracking-[-0.01em] text-volt">settle</span>.
      </h1>
      <p className="mt-5 max-w-[520px] text-[14px] leading-[1.8] text-mute">
        Simulate a task on Cipher Sentry from a demo wallet with 100.00 USDC (sim).
        Commit the task, watch escrow lock, verifiers vote, then settlement
        release — and replay it with one deliberate mistake to feel exactly
        why determinism matters.
      </p>
      <div className="mt-9 space-y-px border-y border-edge">
        {STAGES.map((stg, i) => (
          <div key={stg.id} className="grid grid-cols-[52px_1fr_auto] items-baseline gap-4 border-b border-edge py-4 font-mono text-[9px] tracking-[0.2em] last:border-b-0 sm:grid-cols-[60px_1fr_1fr_auto]">
            <span className="text-volt/70">0{i + 1}</span>
            <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-mist">{stg.title}</span>
            <span className="hidden text-[10px] text-mute sm:inline">{stg.desc}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onStart}
        className="group mt-8 flex items-center gap-2.5 bg-volt px-6 py-4 font-mono text-[11px] font-semibold tracking-[0.22em] text-void transition-colors hover:bg-mist"
      >
        START THE TRIAL <ArrowRight size={13} strokeWidth={2.5} className="transition-transform group-hover:translate-x-1" />
      </button>
      <p className="mt-3 font-mono text-[8px] tracking-[0.18em] text-mute/60">HUMANS NEEDED: 0 · ONE ASKED BY DESIGN</p>
    </Chrome>
  );
}

/* ------------------------------- task flow -------------------------------- */

function Balance({ label, amount, sub, tone }: { label: string; amount: number; sub: string; tone?: string }) {
  return (
    <div>
      <div className="font-mono text-[8px] tracking-[0.22em] text-mute">{label}</div>
      <div className={`mt-1.5 font-display text-[30px] font-medium leading-none tabular-nums tracking-[-0.03em] ${tone ?? "text-mist"}`}>
        {amount.toFixed(2)}
      </div>
      <div className="mt-1 font-mono text-[8px] tracking-[0.16em] text-mute/60">{sub}</div>
    </div>
  );
}

function FlowScreen() {
  const { key } = useOperator();
  const [mode, setMode] = useState<Mode>("clean");
  const [amount, setAmount] = useState(42.8);
  const [runId, setRunId] = useState(0);
  const { s, commit, rule } = useFlow();
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    setNotes("");
  }, [runId]);

  const disputable = s.stage === "SETTLED" && mode === "clean";

  const start = (m: Mode) => {
    setMode(m);
    setRunId((i) => i + 1);
    commit(m);
  };

  const settledBalance = 100 - amount;
  const workerGetting = amount - feeOf(amount);
  const chooseRuling = (r: Sim["ruling"]) => {
    if (!key) return;
    void signRuling(
      { ruling: r, task: TASK_ID, escrow: `${amount.toFixed(2)} USDC`, quorum: "2/3" },
      key,
    ).then((sig) => rule(r, sig));
  };

  return (
    <Chrome right={`RUN #${runId}`}>
      <SectionLabel>TRIAL MODE · SIMULATED FUNDS · EVERY MECHANISM EXACT</SectionLabel>
      <h2 className="font-display text-[clamp(1.8rem,4vw,3.2rem)] font-medium leading-[1] tracking-[-0.03em]">
        {mode === "clean" ? "A task that goes right." : "A task that dares to disagree."}
      </h2>
      <p className="mt-3 max-w-[540px] text-[13px] leading-[1.75] text-mute">
        Watch for the mechanics the protocol treats as law — the only things that move money,
        per state transition. Amounts are USD stakes, nothing more. No real funds move.
      </p>

      {/* balances */}
      <div className="mt-8 grid grid-cols-3 gap-4 border-y border-edge py-5 md:grid-cols-3 md:gap-8">
        <Balance label="YOUR WALLET (SIM)" amount={settledBalance} sub="working balance after commit" />
        <Balance label="IN ESCROW" amount={s.stage !== "COMMIT" ? amount : 0} sub={s.stage === "COMMIT" ? "empty — waiting on you" :STAGES.find(x=>x.id===s.stage)?.title ?? ""} tone={s.stage !== "COMMIT" ? "text-volt" : "text-mist/40"} />
        <Balance label="WORKER WILL NET" amount={workerGetting} sub={`fee 0.35% · ${feeOf(amount).toFixed(2)} → treasury`} />
      </div>

      {/* task spec */}
      <div className="mt-8">
        <SectionLabel>TASK</SectionLabel>
        <div className="grid gap-px border border-edge bg-edge sm:grid-cols-4">
          {[
            ["SPEC", SPEC],
            ["WORKER", "agent:vector-7"],
            ["SEED", "88421 — deterministic"],
            ["ESCROW", <span key="v" className="text-volt">{amount.toFixed(2)} USDC</span>],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-void px-4 py-3 font-mono text-[9.5px]">
              <div className="text-[7.5px] tracking-[0.2em] text-mute/50">{k as string}</div>
              <div className="mt-1.5 text-mist">{v as React.ReactNode}</div>
            </div>
          ))}
        </div>
      </div>

      {/* stage machine */}
      <div className="mt-8 border border-edge">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3 font-mono text-[8.5px] tracking-[0.24em] text-mute">
          <span>ESCROW STATE MACHINE</span>
          <span className="text-mist/70">{TASK_ID} · MRC TASK ENVELOPE</span>
        </div>

        <div className="p-5">
          <FlowStage current={s.stage} target="LOCKED" label="ESCROW LOCKED" desc="capital binds the contract" onFire={s.stage !== "COMMIT"} />
          <FlowStage
            current={s.stage}
            target="EXECUTING"
            label="WORKER EXECUTING"
            desc={`seed 88421 · spec ${SPEC}`}
            onFire={["EXECUTING", "VERIFYING", "DECIDE", "SETTLED", "FAILED"].includes(s.stage)}
            progress={s.stage === "EXECUTING" ? s.progress : 0}
            active={s.stage === "EXECUTING" }
          />
          <FlowStage
            current={s.stage}
            target="VERIFYING"
            label="QUORUM VOTING"
            desc={`3/3 verifiers · ${s.matched ? "hash reproducing" : "mismatch flagged"}`}
            onFire={["VERIFYING", "DECIDE", "SETTLED", "FAILED"].includes(s.stage)}
            progress={s.stage === "VERIFYING" ? s.progress : 0}
            active={s.stage === "VERIFYING"}
            danger={s.stage === "DECIDE"}
          />
          <FlowStage
            current={s.stage}
            target="DECIDE"
            label="YOUR SIGNATURE"
            desc="the only window math exists where judgment exists"
            onFire={["DECIDE", "SETTLED"].includes(s.stage)}
            active={s.stage === "DECIDE"}
            danger
          />
          <FlowStage
            current={s.stage}
            target="SETTLED"
            label={s.stage === "FAILED" ? "ESCROW RETURNED" : "ESCROW RELEASED"}
            desc={s.stage === "FAILED" ? "inside the ruling, refunded" : "worker + treasury + bond receipt anchored"}
            onFire={["SETTLED", "FAILED"].includes(s.stage)}
          />
        </div>

        {/* verdict proof strip */}
        {s.stage === "COMMIT" && (
          <div className="border-t border-edge px-5 py-5 font-mono text-[10.5px] leading-[1.9]">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div>
                <SectionLabel>AMOUNT</SectionLabel>
                <Stepper value={amount} min={10} max={80} step={5.35} onChange={setAmount} />
              </div>
              <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                <button onClick={() => start("clean")} className="bg-volt px-5 py-3.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-void transition-colors hover:bg-mist">
                  COMMIT TASK — LOCK {amount.toFixed(2)}
                </button>
                <button onClick={() => start("mismatch")} className="border border-edge2 px-5 py-3.5 font-mono text-[10px] tracking-[0.2em] text-red-400 transition-colors hover:border-red-400/60">
                  COMMIT WITH A MISTAKE
                </button>
              </div>
            </div>
          </div>
        )}

        {(s.stage === "VERIFYING" || s.stage === "DECIDE") && (
          <div className="border-t border-edge px-5 py-5 font-mono text-[10px] leading-[1.9]">
            <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">BYTE COMPARISON</div>
            <div className="mt-3 grid gap-2.5">
              <div>
                <div className="text-[7.5px] tracking-[0.2em] text-mute/60">QUORUM RECOMPUTED</div>
                <div className="mt-1 border border-volt/40 bg-volt/[0.04] px-3 py-2.5">0x9af2be…<span className="bg-volt/20 px-1 text-volt">77c1</span></div>
              </div>
              <div>
                <div className="text-[7.5px] tracking-[0.2em] text-mute/60">WORKER REPORTED</div>
                <div className={`mt-1 px-3 py-2.5 ${s.matched ? "border border-edge" : "border border-red-400/40 bg-red-400/[0.04]"}`}>
                  {s.matched ? (
                    <>0x9af2be…<span className="bg-volt/20 px-1 text-volt">77c1</span></>
                  ) : (
                    <>0x9af2be…<span className="bg-red-400/20 px-1 text-red-400">99d4</span></>
                  )}
                </div>
              </div>
            </div>
            {mode === "mismatch" && s.stage === "DECIDE" && (
                <div className="mt-4 border border-volt/40 bg-volt/[0.04] px-4 py-3">
                <div className="font-mono text-[8.5px] tracking-[0.24em] text-volt">THE ONLY MOMENT MATH LEAVES THE LOOP — YOUR CALL.</div>
                <div className="mt-2.5 grid gap-2">
                  {(["REFUND BUYER", "RELEASE TO WORKER", "SPLIT 50/50"] as const).map((r) => (
                    <button key={r} onClick={() => chooseRuling(r)} className="flex items-center justify-between border border-edge2 px-3.5 py-3 text-left font-mono text-[9.5px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt">
                      {r}
                      <ArrowRight size={11} />
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 font-mono text-[7.5px] tracking-[0.16em] text-mute/60">SIGNS LOCALLY WITH YOUR DEVICE KEY — FINAL</p>
              </div>
            )}
          </div>
        )}

        {s.stage === "SETTLED" && (
          <div className="border-t border-edge px-5 py-5 font-mono text-[10px] leading-[2.1]">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.24em] text-volt">
              <Check size={13} strokeWidth={3} /> SETTLED · RECEIPT ANCHORED batch_8842 · BLK 12,840,117
            </div>
            <div className="mt-3.5 grid gap-1.5 sm:grid-cols-2">
              <div className="flex justify-between gap-4"><span className="text-mute">ESCROW</span><span>{amount.toFixed(2)} USDC</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">WORKER NET</span><span className="text-volt">{workerGetting.toFixed(2)} USDC</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">TREASURY FEE</span><span>{feeOf(amount).toFixed(2)} USDC</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">BOND</span><span>RETURNED</span></div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 font-mono text-[8px] tracking-[0.18em] text-mute/60">
              <span>FINALITY &lt; 500MS</span>
              <span>DISPUTE RATE &lt; 0.5% — 1 TASK IN 200 ASKS JUDGMENT</span>
            </div>
          </div>
        )}

        {s.stage === "FAILED" && (
          <div className="border-t border-edge px-5 py-5 font-mono text-[10px]">
            <div className="flex items-center gap-2 text-red-400">
              <RotateCcw size={13} /> ESCROW RETURNED — YOUR {amount.toFixed(2)} USDC CAME HOME
            </div>
            <div className="mt-3 font-mono text-[8.5px] tracking-[0.16em] leading-[1.9] text-mute">
              YOUR SIGNATURE SETDLED THIS: {s.ruling} · SIG {s.sig?.sig.slice(0, 18)}… {s.sig?.sig.slice(-6)}
              <br />
              WORKER TRUST −4 · STAKE SLASHED 10% · CHALLENGER PROOF-BOND RETURNED WITH BOUNTY
            </div>
          </div>
        )}

        {/* controls */}
        {s.stage !== "COMMIT" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              {mode === "clean" && disputable && (
                <button onClick={() => start("mismatch")} className="border border-red-400/50 px-4 py-2.5 font-mono text-[9px] tracking-[0.18em] text-red-400 transition-colors hover:border-red-400/80">
                  REPLAY WITH A MISTAKE
                </button>
              )}
              {(s.stage === "SETTLED" || s.stage === "FAILED" || s.stage === "DECIDE") && (
                <button onClick={() => start(mode)} className="border border-edge2 px-4 py-2.5 font-mono text-[9px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt">
                  <RefreshCw size={11} className="mr-1.5 inline" /> REPLAY
                </button>)}
            </div>
            <div className="font-mono text-[8px] tracking-[0.2em] text-mute/50">
              {s.stage === "LOCKED" || s.stage === "EXECUTING" || s.stage === "VERIFYING" ? "WATCH ME — AUTOMATIC BEYOND THIS POINT" : mode === "clean" ? "0 INTERVENTIONS REQUIRED" : "HUMANS CONSULTED: 1 · SIGNATURE SAVED LOCALLY"}
            </div>
          </div>
        )}
      </div>

      {/* your move */}
      {(s.stage === "SETTLED" || s.stage === "FAILED") && <FeedbackCard runId={runId} notes={notes} setNotes={setNotes} />}
    </Chrome>
  );
}

/* ------------------------------- primitives ------------------------------- */

function FlowStage(props: {
  current: Stage;
  target: string;
  label: string;
  desc: string;
  onFire: boolean;
  active?: boolean;
  progress?: number;
  danger?: boolean;
}) {
  const { onFire, active, progress = 0, danger, label, desc, target, current } = props;
  const idx = orderOf(current);
  const targetIdx = orderOf(target as Stage);
  const passed = idx > targetIdx;
  return (
    <div className={`flex items-start gap-4 border-b border-edge/60 py-3.5 last:border-b-0 ${onFire ? "" : "opacity-50"}`}>
      <div className="mt-1 flex h-3 w-3 items-center justify-center">
        {passed ? (
          <span className="h-2.5 w-2.5 bg-volt" />
        ) : active ? (
          <span className={`relative flex h-2.5 w-2.5 ${danger ? "bg-red-400" : "bg-volt"}`}>
            <span className={`absolute h-full w-full animate-ping opacity-60 ${danger ? "bg-red-400" : "bg-volt"}`} />
          </span>
        ) : (
          <span className="h-2.5 w-2.5 border border-edge2" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`font-mono text-[9px] tracking-[0.22em] ${passed || active ? "" : ""} ${danger ? "text-red-400" : passed ? "text-mute" :  active ? "text-volt" : "text-mute/60"}`}>
          {label}
          {active && progress > 0 && <span className="ml-2 text-mute/60">{Math.round(progress)}%</span>}
        </div>
        <div className="mt-1 font-mono text-[9px] leading-[1.7] tracking-[0.06em] text-mute/70">{desc}</div>
        {active && progress > 0 && progress < 100 && (
          <div className="mt-2 h-1 w-full max-w-[380px] bg-edge">
            <div className="h-full bg-volt transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="shrink-0 font-mono text-[8px] tracking-[0.16em] text-mute/40">
        {orderOf(target as Stage) < 2 ? "AUTO" : target === "DECIDE" ? "HMN" : passed ? "DONE" : active ? "RUNNING" : "QUEUED"}
      </div>
    </div>
  );
}

function orderOf(s: Stage): number {
  switch (s) {
    case "COMMIT": return 0;
    case "LOCKED": return 1;
    case "EXECUTING": return 2;
    case "VERIFYING": return 3;
    case "DECIDE": return 4;
    case "SETTLED": return 5;
    case "FAILED": return 6;
  }
}

/* ------------------------------- feedback --------------------------------- */

function FeedbackCard({ notes, setNotes }: { runId: number; notes: string; setNotes: (v: string) => void }) {
  const [vote, setVote] = useState<"aligned" | "complex" | "tooClean" | "unsure" | null>(null);
  const [sent, setSent] = useState(false);
  const votes = [
    { v: "aligned", label: "EXACTLY WHAT I EXPECTED" },
    { v: "complex", label: "MORE COMPLEX THAN EXPECTED" },
    { v: "tooClean", label: "FEELS TOO AUTOMATIC" },
    { v: "unsure", label: "NOT SURE YET" },
  ] as const;
  return (
    <div className="mt-8 border border-volt/50 bg-volt/[0.04] p-5">
      <div className="flex items-center justify-between font-mono text-[8.5px] tracking-[0.24em] text-mute">
        <span className="flex items-center gap-2 text-volt"><Plus size={10} strokeWidth={3} /> IS THIS WHAT YOU EXPECTED?</span>
        <span>HELP US CLOSE THE LEARNING LOOP</span>
      </div>
      {!sent ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {votes.map((v) => (
              <button
                key={v.v}
                onClick={() => setVote(v.v as typeof vote)}
                className={`border px-4 py-3 text-left font-mono text-[9px] tracking-[0.18em] transition-colors ${vote === v.v ? "border-volt/70 bg-volt/10 text-volt" : "border-edge2 text-mute hover:text-mist"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="what felt wrong, unclear, or surprising about how money moved here…"
            className="mt-3 w-full resize-none border border-edge2 bg-ink px-4 py-3 font-mono text-[10.5px] text-mist placeholder:text-mute/40 transition-colors focus:border-volt/60 focus:outline-none"
          />
          <a
            href={`mailto:hello@ciphersentry.com?subject=DEMO%20EXPECTATIONS%20—&body=${encodeURIComponent(`VOTE: ${vote ?? "unanswered"}\nNOTES: ${notes || "no notes"}`)}`}
            onClick={() => {
              setSent(true);
              try { navigator.clipboard?.writeText(`VOTE: ${vote ?? "unanswered"}\nNOTES: ${notes || "no notes"}`); } catch { /* noop */ }
            }}
            className="mt-3 inline-flex items-center gap-2.5 bg-volt px-5 py-3.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-void transition-colors hover:bg-mist"
          >
            SEND EXPECTATIONS →
          </a>
        </>
      ) : (
        <div className="mt-4 flex items-center gap-2.5 font-mono text-[9px] tracking-[0.2em] text-volt">
          <Check size={11} strokeWidth={3} /> SAVED · YOUR EXPECTATION SHEET IS IN YOUR INBOX'S DRAFTS
        </div>
      )}
      <p className="mt-3 border-t border-edge pt-3 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">
        NO TRACKING, NO ANALYTICS, NO AUTONOMOUS SPAM — JUST YOUR EMAIL CLIENT OPENING A SIGNED DRAFT TO US.
      </p>
    </div>
  );
}

export default function DemoFlow() {
  const [mode, setMode] = useState<"intro" | "go">("intro");
  return mode === "intro" ? <IntroScreen onStart={() => setMode("go")} /> : <FlowScreen />;
}

import { ArrowRight, Check, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";
import { Stepper } from "../app/ui";
import { signRuling } from "../crypto/keys";
import type { SignedRuling } from "../crypto/keys";
import { useOperator } from "../crypto/useOperator";
import {
  CenError,
  CipherSentry,
  readUrlParams,
  type Receipt,
  type Task,
} from "../sdk/ciphersentry";
import { defaultNodeUrl, RpcTransport } from "../sdk/rpc";
import { formatWireError, liveExplorerHref, toWireRuling } from "../sdk/livePath";
import { resolveDefaultIndexer } from "../sdk/publicEndpoints";

/* --------------------------- live wire (S1.4) ---------------------------- */

const SPEC = "render.sequence.4k";
const WORKER = "agent:vector-7";
const INPUT = { frames: 240, seed: 88421 } as const;
const WORKER_ESCROW_FEE_BPS = 35;

const feeOf = (amount: number) => (amount * WORKER_ESCROW_FEE_BPS) / 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Stage = "COMMIT" | "LOCKED" | "EXECUTING" | "VERIFYING" | "DECIDE" | "SETTLED" | "FAILED";
type Mode = "clean" | "mismatch";

interface FlowState {
  stage: Stage;
  mode: Mode;
  progress: number;
  voteCount: number;
  matched: boolean;
  taskId: string;
  reported?: string;
  recomputed?: string;
  receipt?: Receipt | null;
  error?: string | null;
  nodeLive: boolean | null;
  nodeLabel: string;
  ruling?: "REFUND BUYER" | "RELEASE TO WORKER" | "SPLIT 50/50";
  sig?: SignedRuling | null;
  busy: boolean;
}

function useLiveFlow(amount: number) {
  const centRef = useRef<CipherSentry | null>(null);
  const taskRef = useRef<Task | null>(null);
  const runGen = useRef(0);

  const [s, setS] = useState<FlowState>({
    stage: "COMMIT",
    mode: "clean",
    progress: 0,
    voteCount: 0,
    matched: false,
    taskId: "—",
    nodeLive: null,
    nodeLabel: defaultNodeUrl(),
    busy: false,
  });

  useEffect(() => {
    const node = readUrlParams().get("node") ?? defaultNodeUrl();
    const transport = new RpcTransport({ url: node });
    const cent = new CipherSentry({ key: "op:demo", network: "base-sepolia" }, transport);
    centRef.current = cent;
    setS((p) => ({ ...p, nodeLabel: node }));
    void (async () => {
      const h = await transport.pinFromHealth();
      setS((p) => ({ ...p, nodeLive: h != null }));
      void cent.autoSession().catch(() => null);
    })();
    return () => {
      transport.stop();
      centRef.current = null;
    };
  }, []);

  const commit = useCallback(
    async (mode: Mode) => {
      const cent = centRef.current;
      if (!cent || s.busy) return;
      const gen = ++runGen.current;
      taskRef.current = null;
      setS({
        stage: "LOCKED",
        mode,
        progress: 0,
        voteCount: 0,
        matched: mode === "clean",
        taskId: "…",
        nodeLive: s.nodeLive,
        nodeLabel: s.nodeLabel,
        busy: true,
        error: null,
        receipt: null,
        sig: null,
        reported: undefined,
        recomputed: undefined,
      });

      try {
        setS((p) => (gen !== runGen.current ? p : { ...p, stage: "EXECUTING", progress: 25 }));
        const task = await cent.task.commit({
          worker: WORKER,
          spec: SPEC,
          input: { ...INPUT },
          escrow: { amount: amount.toFixed(2), asset: "USDC" },
          fault: mode === "mismatch",
        });
        if (gen !== runGen.current) return;
        taskRef.current = task;
        setS((p) => ({
          ...p,
          stage: "EXECUTING",
          progress: 70,
          taskId: task.id,
        }));

        // wait for auto-report
        const deadline = Date.now() + 8_000;
        while (Date.now() < deadline && !task.reportedHash) {
          await sleep(80);
          if (gen !== runGen.current) return;
        }
        setS((p) => ({
          ...p,
          stage: "VERIFYING",
          progress: 20,
          voteCount: 1,
          reported: task.reportedHash,
          matched: mode === "clean",
        }));

        try {
          setS((p) => (gen !== runGen.current ? p : { ...p, progress: 55, voteCount: 2 }));
          const receipt = await cent.verify(task, { quorum: 3 });
          if (gen !== runGen.current) return;
          setS((p) => ({
            ...p,
            stage: "SETTLED",
            progress: 100,
            voteCount: 3,
            matched: true,
            reported: receipt.reported,
            recomputed: receipt.recomputed,
            receipt,
            busy: false,
          }));
        } catch (e) {
          if (gen !== runGen.current) return;
          if (e instanceof CenError && e.code === "CEN_E_HASH_MISMATCH") {
            setS((p) => ({
              ...p,
              stage: "DECIDE",
              progress: 100,
              voteCount: 2,
              matched: false,
              reported: task.reportedHash,
              recomputed: undefined,
              busy: false,
              error: null,
            }));
            return;
          }
          throw e;
        }
      } catch (e) {
        if (gen !== runGen.current) return;
        setS((p) => ({
          ...p,
          stage: "COMMIT",
          busy: false,
          error: formatWireError(e),
          nodeLive: p.nodeLive === true ? true : false,
        }));
      }
    },
    [amount, s.busy, s.nodeLabel, s.nodeLive],
  );

  const rule = useCallback(
    async (ruling: FlowState["ruling"], sig: SignedRuling | null) => {
      const cent = centRef.current;
      const task = taskRef.current;
      if (!cent || !task || !ruling) return;
      setS((p) => ({ ...p, busy: true }));
      try {
        const res = await cent.operator.rule(task.id, toWireRuling(ruling), sig?.sig ?? "local");
        const target = res.state === "FAILED" || ruling === "REFUND BUYER" ? "FAILED" : "SETTLED";
        setS((p) => ({ ...p, stage: target as Stage, ruling, sig, busy: false }));
      } catch (e) {
        // local fallthrough if gateway rejects unsigned rule
        const target = ruling === "REFUND BUYER" ? "FAILED" : "SETTLED";
        setS((p) => ({
          ...p,
          stage: target as Stage,
          ruling,
          sig,
          busy: false,
          error: formatWireError(e),
        }));
      }
    },
    [],
  );

  return { s, commit, rule };
}

/* ------------------------------ shell chrome ------------------------------ */

function Chrome({
  children,
  right,
  nodeLive,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  nodeLive?: boolean | null;
}) {
  const badge =
    nodeLive === true ? "RPC NODE · LIVE" : nodeLive === false ? "RPC NODE · OFFLINE" : "RPC NODE · …";
  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />
      <PageHeader
        path="/ TRY THE FLOW"
        end={
          <span
            className={`block truncate font-mono text-[7.5px] tracking-[0.14em] sm:text-[8.5px] sm:tracking-[0.2em] ${
              nodeLive === false ? "text-red-400" : "text-volt"
            }`}
          >
            <span className="sm:hidden">{badge}</span>
            <span className="hidden sm:inline">{right ?? badge}</span>
          </span>
        }
      />
      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6 sm:py-10 md:px-12 md:py-14">{children}</main>
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

function IntroScreen({ onStart, nodeLive }: { onStart: () => void; nodeLive: boolean | null }) {
  return (
    <Chrome right="HUMANS NEEDED: 0 · LIVE WIRE" nodeLive={nodeLive}>
      <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
          <span className="relative h-1.5 w-1.5 bg-volt" />
        </span>
        TRY THE FLOW — LIVE GATEWAY
      </div>
      <h1 className="mt-6 font-display text-[clamp(2.5rem,6.5vw,5rem)] font-medium leading-[0.98] tracking-[-0.04em]">
        Watch money ask {<span className="font-serif font-normal italic tracking-[-0.01em] text-volt">permission</span>}, then{" "}
        <span className="font-serif font-normal italic tracking-[-0.01em] text-volt">settle</span>.
      </h1>
      <p className="mt-5 max-w-[520px] text-[14px] leading-[1.8] text-mute">
        Real JSON-RPC against the public Cipher Sentry node — commit, report,
        quorum verify, settle. Amounts are demo USDC on the write-ready stack;
        the wire and hashes are live. Replay with a deliberate hash fault to open
        the only human window.
      </p>
      <div className="mt-9 space-y-px border-y border-edge">
        {STAGES.map((stg, i) => (
          <div key={stg.id} className="grid grid-cols-[40px_1fr] items-baseline gap-3 border-b border-edge py-3.5 font-mono text-[9px] tracking-[0.2em] last:border-b-0 sm:grid-cols-[60px_1fr_1fr] sm:gap-4 sm:py-4">
            <span className="text-volt/70">0{i + 1}</span>
            <span className="font-display text-[14px] font-semibold tracking-[-0.01em] text-mist sm:text-[15px]">{stg.title}</span>
            <span className="col-span-2 pl-10 text-[10px] leading-relaxed text-mute sm:col-span-1 sm:pl-0">{stg.desc}</span>
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
  const { s, commit, rule } = useLiveFlow(amount);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    setNotes("");
  }, [runId]);

  const disputable = s.stage === "SETTLED" && mode === "clean";
  const explorerHref = liveExplorerHref({
    taskId: s.taskId.startsWith("cent_") ? s.taskId : undefined,
    node: s.nodeLabel,
    indexer: resolveDefaultIndexer(),
  });

  const start = (m: Mode) => {
    setMode(m);
    setRunId((i) => i + 1);
    void commit(m);
  };

  const settledBalance = 100 - amount;
  const workerGetting = amount - feeOf(amount);
  const chooseRuling = (r: FlowState["ruling"]) => {
    if (!key || !r) return;
    void signRuling(
      { ruling: r, task: s.taskId, escrow: `${amount.toFixed(2)} USDC`, quorum: "2/3" },
      key,
    ).then((sig) => rule(r, sig));
  };

  const shortHash = (h?: string) => {
    if (!h) return "0x…";
    if (h.length <= 14) return h;
    return `${h.slice(0, 10)}…${h.slice(-4)}`;
  };

  return (
    <Chrome right={`RUN #${runId} · ${s.taskId}`} nodeLive={s.nodeLive}>
      <SectionLabel>LIVE WIRE · PUBLIC NODE · WRITE-READY STACK</SectionLabel>
      <h2 className="font-display text-[clamp(1.8rem,4vw,3.2rem)] font-medium leading-[1] tracking-[-0.03em]">
        {mode === "clean" ? "A task that goes right." : "A task that dares to disagree."}
      </h2>
      <p className="mt-3 max-w-[540px] text-[13px] leading-[1.75] text-mute">
        Stages follow real <span className="text-mist">task.commit → task.report → verify</span> on{" "}
        <span className="break-all font-mono text-[11px] text-mist/80">{s.nodeLabel}</span>.
        Demo amounts; live hashes and (when write-ready) chain txs.
      </p>
      {s.error && (
        <div className="mt-4 border border-red-400/40 bg-red-400/[0.06] px-4 py-3 font-mono text-[10px] tracking-[0.12em] text-red-400">
          {s.error}
        </div>
      )}

      {/* balances */}
      <div className="mt-8 grid grid-cols-3 gap-4 border-y border-edge py-5 md:grid-cols-3 md:gap-8">
        <Balance label="YOUR WALLET (DEMO)" amount={settledBalance} sub="working balance after commit" />
        <Balance label="IN ESCROW" amount={s.stage !== "COMMIT" ? amount : 0} sub={s.stage === "COMMIT" ? "empty — waiting on you" :STAGES.find(x=>x.id===s.stage)?.title ?? ""} tone={s.stage !== "COMMIT" ? "text-volt" : "text-mist/40"} />
        <Balance label="WORKER WILL NET" amount={workerGetting} sub={`fee 0.35% · ${feeOf(amount).toFixed(2)} → treasury`} />
      </div>

      {/* task spec */}
      <div className="mt-8">
        <SectionLabel>TASK</SectionLabel>
        <div className="grid gap-px border border-edge bg-edge sm:grid-cols-4">
          {[
            ["SPEC", SPEC],
            ["WORKER", WORKER],
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

      {/* stage flow */}
      <div className="mt-8 border border-edge">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3 font-mono text-[8.5px] tracking-[0.24em] text-mute">
          <span>ESCROW STATE MACHINE</span>
          <span className="text-mist/70">{s.taskId} · CEN TASK ENVELOPE</span>
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
                <button
                  disabled={s.busy || s.nodeLive === false}
                  onClick={() => start("clean")}
                  className="bg-volt px-5 py-3.5 font-mono text-[10px] font-semibold tracking-[0.2em] text-void transition-colors hover:bg-mist disabled:cursor-not-allowed disabled:opacity-40"
                >
                  COMMIT TASK — LOCK {amount.toFixed(2)}
                </button>
                <button
                  disabled={s.busy || s.nodeLive === false}
                  onClick={() => start("mismatch")}
                  className="border border-edge2 px-5 py-3.5 font-mono text-[10px] tracking-[0.2em] text-red-400 transition-colors hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  COMMIT WITH A MISTAKE
                </button>
              </div>
            </div>
          </div>
        )}

        {(s.stage === "VERIFYING" || s.stage === "DECIDE") && (
          <div className="border-t border-edge px-5 py-5 font-mono text-[10px] leading-[1.9]">
            <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">BYTE COMPARISON · LIVE</div>
            <div className="mt-3 grid gap-2.5">
              <div>
                <div className="text-[7.5px] tracking-[0.2em] text-mute/60">QUORUM RECOMPUTED</div>
                <div className="mt-1 border border-volt/40 bg-volt/[0.04] px-3 py-2.5 break-all">
                  {s.recomputed ? shortHash(s.recomputed) : s.matched ? "recomputing…" : "— mismatch path"}
                </div>
              </div>
              <div>
                <div className="text-[7.5px] tracking-[0.2em] text-mute/60">WORKER REPORTED</div>
                <div className={`mt-1 break-all px-3 py-2.5 ${s.matched ? "border border-edge" : "border border-red-400/40 bg-red-400/[0.04]"}`}>
                  {shortHash(s.reported)}
                </div>
              </div>
            </div>
            {mode === "mismatch" && s.stage === "DECIDE" && (
                <div className="mt-4 border border-volt/40 bg-volt/[0.04] px-4 py-3">
                <div className="font-mono text-[8.5px] tracking-[0.24em] text-volt">THE ONLY MOMENT MATH LEAVES THE LOOP — YOUR CALL.</div>
                <div className="mt-2.5 grid gap-2">
                  {(["REFUND BUYER", "RELEASE TO WORKER", "SPLIT 50/50"] as const).map((r) => (
                    <button key={r} disabled={s.busy} onClick={() => chooseRuling(r)} className="flex items-center justify-between border border-edge2 px-3.5 py-3 text-left font-mono text-[9.5px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt disabled:opacity-40">
                      {r}
                      <ArrowRight size={11} />
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 font-mono text-[7.5px] tracking-[0.16em] text-mute/60">SIGNS LOCALLY WITH YOUR DEVICE KEY → operator.rule</p>
              </div>
            )}
          </div>
        )}

        {s.stage === "SETTLED" && (
          <div className="border-t border-edge px-5 py-5 font-mono text-[10px] leading-[2.1]">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] tracking-[0.24em] text-volt">
              <Check size={13} strokeWidth={3} /> SETTLED · {s.taskId}
              {s.receipt && <span className="text-mute">· {s.receipt.ms}ms · epoch {s.receipt.epoch}</span>}
            </div>
            <div className="mt-3.5 grid gap-1.5 sm:grid-cols-2">
              <div className="flex justify-between gap-4"><span className="text-mute">ESCROW</span><span>{amount.toFixed(2)} USDC</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">WORKER NET</span><span className="text-volt">{workerGetting.toFixed(2)} USDC</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">TREASURY FEE</span><span>{feeOf(amount).toFixed(2)} USDC</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">HASH</span><span className="truncate">{shortHash(s.receipt?.recomputed ?? s.reported)}</span></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3 font-mono text-[8px] tracking-[0.18em] text-mute/60">
              <a href={explorerHref} className="text-volt hover:underline">OPEN EXPLORER →</a>
              <span>LIVE WIRE · SAME API AS #/app?net=rpc</span>
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
            className="mt-3 w-full resize-none border border-edge2 bg-panel px-4 py-3 font-mono text-[10.5px] text-mist placeholder:text-mute/40 transition-colors focus:border-volt/60 focus:outline-none"
          />
          <a
            href={`mailto:hello@ciphersentry.xyz?subject=DEMO%20EXPECTATIONS%20—&body=${encodeURIComponent(`VOTE: ${vote ?? "unanswered"}\nNOTES: ${notes || "no notes"}`)}`}
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
  const [nodeLive, setNodeLive] = useState<boolean | null>(null);

  useEffect(() => {
    const node = (readUrlParams().get("node") ?? defaultNodeUrl()).replace(/\/$/, "");
    let dead = false;
    void fetch(`${node}/health`, { signal: AbortSignal.timeout(4_000) })
      .then((r) => {
        if (!dead) setNodeLive(r.ok);
      })
      .catch(() => {
        if (!dead) setNodeLive(false);
      });
    return () => {
      dead = true;
    };
  }, []);

  return mode === "intro" ? (
    <IntroScreen onStart={() => setMode("go")} nodeLive={nodeLive} />
  ) : (
    <FlowScreen />
  );
}

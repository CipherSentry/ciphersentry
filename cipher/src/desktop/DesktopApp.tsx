import { Activity, Check, ChevronDown, Cpu, Gauge, Landmark, OctagonAlert, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AGENTS,
  randHash,
  seedApprovals,
  seedBatches,
} from "../app/data";
import { CipherSentry } from "../sdk/ciphersentry";

const cent = CipherSentry.shared();
import type { Agent, Approval, TaskEvent } from "../app/data";
import { DesktopCtx } from "./store";
import type { DesktopValue, DToast, DLimits, ResolvedItem, View } from "./store";
import Guardrails from "./Guardrails";
import Fleet from "./Fleet";
import Intervene from "./Intervene";
import Inspector from "./Inspector";
import Observe from "./Observe";
import Treasury from "./Treasury";
import Verifiers from "./Verifiers";
import LogoMark from "../components/LogoMark";
import { NETWORKS } from "../networks";
import { rollEpoch, seedEpoch, seedVerifiers } from "../network/verifiers";
import type { EpochInfo, SlashEvent, Verifier } from "../network/verifiers";
import { useOperator } from "../crypto/useOperator";

const SIM_START = Date.now();
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];



const NAV: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "observe", label: "OBSERVE", icon: Activity },
  { id: "guard", label: "GUARDRAILS", icon: ShieldCheck },
  { id: "intervene", label: "INTERVENE", icon: OctagonAlert },
];

const WORK: { id: View; label: string; icon: typeof Activity }[] = [
  { id: "verifiers", label: "VERIFIERS", icon: Gauge },
  { id: "fleet", label: "FLEET", icon: Cpu },
  { id: "treasury", label: "TREASURY", icon: Landmark },
];

export default function DesktopApp() {
  const op = useOperator();
  const [view, setView] = useState<View>("observe");
  const [now, setNow] = useState(SIM_START);
  const [blk, setBlk] = useState(12840117);
  const [feed, setFeed] = useState<TaskEvent[]>(() => cent.stream.state());
  const [agents, setAgents] = useState<Agent[]>(AGENTS);
  const [approvals, setApprovals] = useState<Approval[]>(() => seedApprovals(SIM_START));
  const [resolved, setResolved] = useState<ResolvedItem[]>(() => [
    { id: "rs_1", ref: "cent_3c1e9aa", ruling: "RELEASE TO WORKER", at: SIM_START - 3 * 3_600_000, tx: randHash() },
    { id: "rs_2", ref: "cent_77f10d2", ruling: "REFUND BUYER", at: SIM_START - 26 * 3_600_000, tx: randHash() },
  ]);
  const [batches] = useState(() => seedBatches(SIM_START));
  const [toasts, setToasts] = useState<DToast[]>([]);
  const [halted, setHalted] = useState(false);
  const [inspector, setInspector] = useState<string | null>(null);
  const [selException, setSelException] = useState<string | null>(null);
  const [netId, setNetId] = useState("base-sepolia");
  const [netOpen, setNetOpen] = useState(false);
  const net = NETWORKS.find((n) => n.id === netId) ?? NETWORKS[0];
  const [verifierList, setVerifierList] = useState<Verifier[]>(() => seedVerifiers());
  const [epoch, setEpoch] = useState<EpochInfo>(() => seedEpoch(SIM_START));
  const [slashLog, setSlashLog] = useState<SlashEvent[]>([]);
  const [emittedMarc, setEmittedMarc] = useState(0);
  const [fleetPoints, setFleetPoints] = useState(0);
  const [centBal, setMarcBal] = useState(100_000);
  const [unbondQueue, setUnbondQueue] = useState<{ id: string; verifier: string; amount: number; completesIn: number }[]>([]);
  const poolRef = useRef(verifierList);
  const epochRef = useRef(epoch);
  const centRef = useRef(centBal);
  centRef.current = centBal;
  const queueRef = useRef(unbondQueue);
  queueRef.current = unbondQueue;
  const [wallet, setWallet] = useState({ avail: 2481.1, escrow: 512.3, earned: 388.2, spent: 142.55, stake: 4050 });
  const [limits, setLimits] = useState<DLimits>({
    global: 1000,
    perAgent: { "vector-7": 400, "probe-9": 250, "forge-11": 300 },
    requireAbove: 100,
    autoPause: true,
    digest: false,
    minTier: true,
    ratePerMin: 8,
    region: "us-e1",
  });

  const haltedRef = useRef(halted);
  haltedRef.current = halted;
  const toastId = useRef(0);

  /* clocks + epoch engine */
  useEffect(() => {
    const id = setInterval(() => {
      const ts = Date.now();
      setNow(ts);
      const e = epochRef.current;
      if (ts >= e.startedAt + e.durMs) {
        const r = rollEpoch(poolRef.current, e, ts);
        epochRef.current = r.epoch;
        poolRef.current = r.pool;
        setEpoch({ ...r.epoch });
        setVerifierList([...r.pool]);
        setEmittedMarc((m) => m + r.emitted);
        if (r.slashes.length) {
          setSlashLog((s) => [...r.slashes, ...s].slice(0, 12));
        }
        // unbond queue — 3 sim-epochs standing in for the 7-day unbonding period
        const due = queueRef.current.filter((x) => x.completesIn <= 1);
        if (due.length) {
          due.forEach((x) => {
            setMarcBal((m) => m + x.amount);
            value.toast(`UNBOND COMPLETE — ${x.amount.toLocaleString()} CENT RETURNED`);
          });
          setUnbondQueue(queueRef.current.filter((x) => x.completesIn > 1));
          poolRef.current = poolRef.current.filter((v) => !due.some((x) => v.id === x.verifier));
          setVerifierList([...poolRef.current]);
        } else if (queueRef.current.length) {
          setUnbondQueue(queueRef.current.map((x) => ({ ...x, completesIn: x.completesIn - 1 })));
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setBlk((b) => b + 1), 2100);
    return () => clearInterval(id);
  }, []);

  /* live task stream — via the shared typed client transport */
  useEffect(() => {
    return cent.stream.onTick((events, delta) => {
      setFeed([...events]);
      if (delta && (delta.earned || delta.spent || delta.escrowDelta)) {
        setWallet((w) => ({
          ...w,
          earned: w.earned + delta.earned,
          spent: w.spent + delta.spent,
          escrow: Math.max(0, w.escrow + delta.escrowDelta),
          avail: w.avail + delta.earned,
        }));
        setFleetPoints((p) => p + delta.earned + delta.spent);
      }
    });
  }, []);

  /* kill switch pauses the whole network locally */
  useEffect(() => {
    cent.transport.setPaused(halted);
  }, [halted]);

  /* keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const order: View[] = ["observe", "guard", "intervene", "verifiers", "fleet", "treasury"];
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 6) setView(order[n - 1]);
      if (e.key === "Escape") {
        setInspector(null);
        setSelException(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<DesktopValue>(() => {
    const toast = (msg: string) => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-2), { id, msg }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
    };
    return {
      view, now, feed, agents, approvals, resolved, batches, limits, wallet, toasts, halted, inspector, selException,
      verifiers: verifierList, epoch, slashLog, emittedMarc, fleetPoints,
      setView: (v) => { setView(v); setInspector(null); },
      setInspector,
      setSelException,
      toast,
      resolveApproval: (id, note, ruling) => {
        const a = approvals.find((x) => x.id === id);
        setApprovals((x) => x.filter((y) => y.id !== id));
        if (a) setResolved((rs) => [{ id: `rs_${Date.now()}`, ref: a.ref, ruling, at: Date.now(), tx: randHash() }, ...rs]);
        toast(note);
      },
      toggleAgent: (id) => setAgents((as) => as.map((a) => (a.id === id ? { ...a, status: a.status === "ONLINE" ? "PAUSED" : "ONLINE" } : a))),
      setAgentLimit: (id, v) => setLimits((l) => ({ ...l, perAgent: { ...l.perAgent, [id]: v } })),
      setGlobalLimit: (v) => setLimits((l) => ({ ...l, global: v })),
      setRequireAbove: (v) => setLimits((l) => ({ ...l, requireAbove: v })),
      setFlag: (k, v) => setLimits((l) => ({ ...l, [k]: v })),
      setRatePerMin: (v) => setLimits((l) => ({ ...l, ratePerMin: v })),
      toggleHalt: () => setHalted((h) => !h),
      hire: (name) => toast(`TASK TEMPLATE COMMITTED → ${name.toUpperCase()}`),
      stakeMore: (v) => setWallet((w) => ({ ...w, stake: w.stake + v, avail: Math.max(0, w.avail - v) })),
      settleFeedItem: (id, state) => {
        cent.transport.setTaskState(id, state);
      },
      gotoIntervention: (apId) => { setView("intervene"); setSelException(apId); },
      centBal,
      unbondQueue,
      bondVerifier: (amount) => {
        if (amount < 25_000) { toast("BOND FLOOR — 25,000 CENT MINIMUM"); return; }
        if (amount > centRef.current) { toast("INSUFFICIENT CENT — SIM ALLOCATION"); return; }
        const fpId = (op.key?.pubHex ?? "demoops").replace(/[^0-9a-f]/gi, "").slice(0, 6).toLowerCase();
        const id = `vrf:op:${fpId}`;
        if (poolRef.current.some((v) => v.id === id)) { toast("OPERATOR NODE ALREADY BONDED"); return; }
        setMarcBal((m) => m - amount);
        const v: Verifier = {
          id,
          bond: amount,
          accuracy: 0.995,
          votesEpoch: 0,
          correctEpoch: 0,
          earnedUsdc: 0,
          accruedMarc: 0,
          status: "BONDED",
        };
        poolRef.current = [...poolRef.current, v];
        setVerifierList([...poolRef.current]);
        toast(`BONDED ${amount.toLocaleString()} CENT — ${id} JOINS NEXT ELECTION`);
      },
      requestUnbond: (verifierId) => {
        const v = poolRef.current.find((x) => x.id === verifierId);
        if (!v || v.status !== "BONDED") return;
        poolRef.current = poolRef.current.map((x) => (x.id === verifierId ? { ...x, status: "UNBONDING" as const } : x));
        setVerifierList([...poolRef.current]);
        setUnbondQueue((q) => [
          ...q,
          { id: `ub_${Date.now()}`, verifier: verifierId, amount: v.bond, completesIn: 3 },
        ]);
        toast(`UNBOND REQUESTED — ${v.bond.toLocaleString()} CENT FROZEN 3 EPOCHS (7D)`);
      },
    };
  }, [view, now, feed, agents, approvals, resolved, batches, limits, wallet, toasts, halted, inspector, selException, verifierList, epoch, slashLog, emittedMarc, fleetPoints, centBal, unbondQueue, op.key]);

  const NavBtn = ({ n, i }: { n: (typeof NAV)[number]; i: number }) => {
    const active = view === n.id;
    const badge = n.id === "intervene" ? approvals.length : 0;
    return (
      <button
        onClick={() => { setView(n.id); setInspector(null); }}
        className={`group relative flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left font-mono text-[9.5px] tracking-[0.2em] transition-colors ${
          active ? "bg-volt/[0.07] text-volt" : "text-mute hover:text-mist"
        }`}
      >
        {active && <span className="absolute left-0 top-0 h-full w-0.5 bg-volt" />}
        <n.icon size={13} strokeWidth={active ? 2.2 : 1.6} />
        {n.label}
        <span className="ml-auto flex items-center gap-2">
          {badge > 0 && <span className="flex h-4 min-w-4 items-center justify-center bg-red-500 px-1 text-[8.5px] font-bold text-void">{badge}</span>}
          <span className={`text-[8px] ${active ? "text-volt/60" : "text-mute/30 group-hover:text-mute/60"}`}>{i + 1}</span>
        </span>
      </button>
    );
  };

  const utc = new Date(now);
  const utcStr = `${String(utc.getUTCHours()).padStart(2, "0")}:${String(utc.getUTCMinutes()).padStart(2, "0")}:${String(utc.getUTCSeconds()).padStart(2, "0")}Z`;

  return (
    <DesktopCtx.Provider value={value}>
      <div className="flex h-full flex-col overflow-hidden bg-void font-mono text-mist">
        {/* ---- title bar ---- */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-code px-4">
          <div className="flex items-center gap-3">
            <a href="#/" aria-label="Back to ciphersentry.xyz home" className="group flex items-center">
              <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
            </a>
            <span className="hidden text-[8.5px] tracking-[0.24em] text-mute/60 xl:inline">SENTRY CONSOLE / V0.2</span>
          </div>
          <div className="hidden items-center gap-2 text-[9px] tracking-[0.14em] text-mute/70 xl:flex">
            <span className="text-volt">$</span> cent.stream.attach <span className="text-mute/40">--fleet</span> atlas <span className="text-mute/40">--quorum</span> 3
            <span className="animate-blink ml-0.5 inline-block h-3 w-[6px] bg-volt/70" />
          </div>
          <div className="flex items-center gap-4 text-[9px] tracking-[0.16em] text-mute/70">
            <span className={`flex items-center gap-1.5 ${halted ? "text-red-400" : "text-volt"}`}>
              <span className={`h-1.5 w-1.5 ${halted ? "bg-red-400" : "animate-pulse bg-volt"}`} />
              {halted ? "HALTED" : "LIVE"}
            </span>
            <span className="hidden tabular-nums lg:inline">BLK {blk.toLocaleString()}</span>
            <span className="tabular-nums">{utcStr}</span>

            {/* network selector */}
            <div className="relative">
              <button
                onClick={() => setNetOpen((o) => !o)}
                aria-label="Switch settlement rail"
                className={`hidden items-center gap-1.5 border px-1.5 py-1 text-[8px] tracking-[0.14em] transition-colors md:flex ${
                  net.id === "robinhood" ? "border-volt/60 text-volt" : "border-edge2 text-mute/80 hover:border-volt/50 hover:text-mist"
                }`}
              >
                {net.label}
                {net.tag === "CENT TGE" && <span className="bg-volt px-1 font-semibold text-void">CENT</span>}
                <ChevronDown size={9} className={`transition-transform ${netOpen ? "rotate-180" : ""}`} />
              </button>
              {netOpen && (
                <div className="surface-code absolute right-0 top-full z-[70] mt-2 w-[280px] border shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                  <div className="border-b border-code-edge px-3 py-2 text-[7.5px] tracking-[0.24em] text-code-mute">
                    SETTLEMENT RAIL — PROTOCOL IS RAIL-AGNOSTIC
                  </div>
                  {NETWORKS.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setNetId(n.id);
                        setNetOpen(false);
                        value.toast(n.id === "robinhood" ? "ROBINHOOD CHAIN — CENT TGE PENDING · PREVIEW" : `RAIL → ${n.label}`);
                      }}
                      className={`flex w-full items-center gap-3 border-b border-code-edge/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-white/[0.04] ${
                        n.id === net.id ? "bg-volt/[0.08]" : ""
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 ${n.status === "LIVE" ? "animate-pulse bg-volt" : n.status === "EVAL" ? "bg-code-mute/50" : "bg-amber-300"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-[9.5px] tracking-[0.1em] text-code-fg">{n.label}</span>
                          <span className={`text-[7px] tracking-[0.16em] ${n.tag === "CENT TGE" ? "text-volt" : n.status === "LIVE" ? "text-volt/70" : "text-code-mute"}`}>
                            {n.tag}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[8px] text-code-mute">{n.note}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ---- sidebar ---- */}
          <aside className="flex w-48 shrink-0 flex-col border-r border-edge bg-code">
            <div className="px-3.5 pb-1 pt-4 text-[7.5px] tracking-[0.28em] text-mute/50">MODES — WHY YOU'RE HERE</div>
            {NAV.map((n, i) => <NavBtn key={n.id} n={n} i={i} />)}
            <div className="px-3.5 pb-1 pt-5 text-[7.5px] tracking-[0.28em] text-mute/50">WORKSPACES</div>
            {WORK.map((n, i) => <NavBtn key={n.id} n={n} i={i + 3} />)}

            <div className="mt-auto p-3">
              <div className="border border-edge p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[7.5px] tracking-[0.22em] text-mute/50">OPERATOR — WEBCRYPTO</span>
                  <button
                    aria-label="Rotate device key"
                    onClick={() => {
                      void op.rotate().then((k) => value.toast(`KEY ROTATED → ${k.fp}`));
                    }}
                    className="text-mute/50 transition-colors hover:text-volt"
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
                <div className="mt-1.5 truncate text-[9.5px] text-volt">{op.key?.fp ?? "GENERATING…"}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[7.5px] tracking-[0.16em] text-mute/60">
                  <span className="h-1 w-1 bg-volt" /> {op.key?.algLabel ?? "…"} · THIS MACHINE
                </div>
                <div className="mt-1 truncate text-[7px] tracking-[0.1em] text-mute/40">
                  PUB {op.key ? `${op.key.pubHex.slice(0, 18)}…` : "…"}
                </div>
              </div>
            </div>
          </aside>

          {/* ---- main ---- */}
          <main className="relative min-w-0 flex-1 bg-void">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="h-full"
              >
                {view === "observe" && <Observe />}
                {view === "guard" && <Guardrails />}
                {view === "intervene" && <Intervene />}
                {view === "verifiers" && <Verifiers />}
                {view === "fleet" && <Fleet />}
                {view === "treasury" && <Treasury />}
              </motion.div>
            </AnimatePresence>

            <AnimatePresence>{inspector && <Inspector key="inspector" />}</AnimatePresence>
          </main>
        </div>

        {/* ---- status bar ---- */}
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-edge bg-code px-4 text-[8px] tracking-[0.18em] text-mute/60">
          <div className="flex items-center gap-4">
            <span className={cent.transport.kind === "rpc" ? "text-amber-300" : halted ? "text-red-400" : "text-volt"}>
              ●{cent.transport.kind.toUpperCase()} {cent.transport.kind === "rpc" ? "OFFLINE" : halted ? "HALTED" : "LIVE"}
            </span>
            <span>STREAM 2.8S · QUORUM 3/3</span>
            <span className={net.id === "robinhood" ? "text-volt" : ""}>NET {net.short}{net.tag === "CENT TGE" ? " · CENT SOON" : ""}</span>
            <span className="hidden xl:inline">WINDOW {feed.length} TXS</span>
          </div>
          <div className="flex items-center gap-4">
            <span>OPEN EXCEPTIONS: <span className={approvals.length > 0 ? "text-red-400" : "text-mute"}>{approvals.length}</span></span>
            <span className="hidden md:inline">HMN: 1</span>
            <span className="hidden lg:inline">1–6 VIEWS · ESC CLEAR · EPOCH {epoch.n}</span>
            <span className="inline-block h-2.5 w-[5px] animate-blink bg-volt" />
          </div>
        </div>

        {/* ---- toasts ---- */}
        <div className="pointer-events-none absolute bottom-12 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="flex items-center gap-2.5 border border-volt/50 bg-code/95 px-4 py-2.5 font-mono text-[9px] tracking-[0.18em] text-code-fg shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
              >
                <span className="flex h-4 w-4 items-center justify-center bg-volt">
                  <Check size={10} strokeWidth={3.5} className="text-void" />
                </span>
                {t.msg}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </DesktopCtx.Provider>
  );
}

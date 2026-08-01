import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  seedAlerts,
  seedApprovals,
  seedBatches,
  AGENTS,
} from "./data";
import type { Agent, Approval, TaskEvent } from "./data";
import { CipherSentry } from "../sdk/ciphersentry"; /* brand pivot: protocol client renames in deploy kit; class stays for now */
import { AppCtx } from "./store";

const cent = CipherSentry.shared();
import type { AppValue, Overlay, Tab, Toast } from "./store";
import AgentDetail from "./screens/AgentDetail";
import Alerts from "./screens/Alerts";
import DisputeFlow from "./screens/DisputeFlow";
import Feed from "./screens/Feed";
import Onboarding from "./screens/Onboarding";
import Registry from "./screens/Registry";
import Staking from "./screens/Staking";
import TaskDetail from "./screens/TaskDetail";
import Wallet from "./screens/Wallet";
import { StatusBar, TabBar } from "./Phone";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const SIM_START = Date.now();

export default function OperatorApp() {
  const [connected, setConnected] = useState(false);
  const [tab, setTabState] = useState<Tab>("feed");
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [now, setNow] = useState(SIM_START);
  const [feed, setFeed] = useState<TaskEvent[]>(() => cent.stream.state().slice(0, 16));
  const [agents, setAgents] = useState<Agent[]>(AGENTS);
  const [approvals, setApprovals] = useState<Approval[]>(() => seedApprovals(SIM_START));
  const [batches] = useState(() => seedBatches(SIM_START));
  const [alerts] = useState(() => seedAlerts(SIM_START));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wallet, setWallet] = useState({ avail: 2481.1, escrow: 512.3, earned: 388.2, spent: 142.55, stake: 4050 });
  const [limits, setLimits] = useState({
    global: 1000,
    perAgent: { "vector-7": 400, "probe-9": 250, "forge-11": 300 },
    requireAbove: 100,
    autoPause: true,
    digest: false,
  });

  const toastId = useRef(0);

  /* live clock + time-ago refresh */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* live task stream — via the shared typed client transport */
  useEffect(() => {
    if (!connected) return;
    return cent.stream.onTick((events, delta) => {
      setFeed([...events.slice(0, 16)]);
      if (delta && (delta.earned || delta.spent || delta.escrowDelta)) {
        setWallet((w) => ({
          ...w,
          earned: w.earned + delta.earned,
          spent: w.spent + delta.spent,
          escrow: Math.max(0, w.escrow + delta.escrowDelta),
          avail: w.avail + delta.earned,
        }));
      }
    });
  }, [connected]);

  const value = useMemo<AppValue>(() => {
    const toast = (msg: string) => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-2), { id, msg }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
    };

    return {
      connected,
      tab,
      overlays,
      now,
      feed,
      agents,
      approvals,
      batches,
      alerts,
      limits,
      wallet,
      toasts,

      connect: () => {
        setConnected(true);
        toast("FLEET PAIRED — 3 AGENTS SYNCED");
      },
      setTab: (t) => {
        setTabState(t);
        setOverlays([]);
      },
      open: (o) => setOverlays((s) => [...s, o]),
      close: () => setOverlays((s) => s.slice(0, -1)),
      closeAll: () => setOverlays([]),
      toast,
      resolveApproval: (id, note) => {
        setApprovals((a) => a.filter((x) => x.id !== id));
        toast(note);
      },
      toggleAgent: (id) =>
        setAgents((as) =>
          as.map((a) =>
            a.id === id
              ? { ...a, status: a.status === "ONLINE" ? "PAUSED" : "ONLINE" }
              : a,
          ),
        ),
      setAgentLimit: (id, v) =>
        setLimits((l) => ({ ...l, perAgent: { ...l.perAgent, [id]: v } })),
      setGlobalLimit: (v) => setLimits((l) => ({ ...l, global: v })),
      setRequireAbove: (v) => setLimits((l) => ({ ...l, requireAbove: v })),
      setFlag: (k, v) => setLimits((l) => ({ ...l, [k]: v })),
      hire: (name) => toast(`TASK TEMPLATE COMMITTED → ${name.toUpperCase()}`),
      stakeMore: (v) => setWallet((w) => ({ ...w, stake: w.stake + v, avail: Math.max(0, w.avail - v) })),
      settleFeedItem: (id, state) => {
        cent.transport.setTaskState(id, state);
      },
    };
  }, [connected, tab, overlays, now, feed, agents, approvals, batches, alerts, limits, wallet, toasts]);

  const currentOverlay = overlays[overlays.length - 1] ?? null;

  return (
    <AppCtx.Provider value={value}>
      <div className="relative flex h-full flex-col overflow-hidden bg-void font-display text-mist">
        <StatusBar now={now} />

        {!connected ? (
          <div className="relative z-10 flex-1 overflow-hidden">
            <Onboarding />
          </div>
        ) : (
          <>
            {/* tab screens */}
            <div className="relative z-10 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.28, ease: EASE }}
                  className="h-full"
                >
                  {tab === "feed" && <Feed />}
                  {tab === "registry" && <Registry />}
                  {tab === "wallet" && <Wallet />}
                  {tab === "alerts" && <Alerts />}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* overlay stack (pushed screens) */}
            <AnimatePresence>
              {currentOverlay && (
                <motion.div
                  key={overlays.length + JSON.stringify(currentOverlay)}
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ duration: 0.38, ease: EASE }}
                  className="absolute inset-0 z-30 bg-void pt-12 shadow-[-30px_0_60px_rgba(0,0,0,0.6)]"
                >
                  {currentOverlay.s === "task" && <TaskDetail id={currentOverlay.id} />}
                  {currentOverlay.s === "agent" && <AgentDetail id={currentOverlay.id} />}
                  {currentOverlay.s === "dispute" && <DisputeFlow id={currentOverlay.id} />}
                  {currentOverlay.s === "staking" && <Staking />}
                </motion.div>
              )}
            </AnimatePresence>

            <TabBar />
          </>
        )}

        {/* toasts */}
        <div className="pointer-events-none absolute inset-x-5 bottom-24 z-50 flex flex-col items-center gap-2">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex items-center gap-2.5 border border-volt/50 bg-code/95 px-4 py-3 font-mono text-[9px] tracking-[0.18em] text-code-fg shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
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
    </AppCtx.Provider>
  );
}

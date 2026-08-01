import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { timeAgo } from "../app/data";
import { StateDot, Tag } from "../app/ui";
import { useDesk } from "./store";
import { AreaChart, FlowMachine, Panel } from "./widgets";

const VERIFIERS = [
  { id: "vrf:gamma-1", lat: 212, ok: true },
  { id: "vrf:delta-4", lat: 188, ok: true },
  { id: "vrf:sigma-2", lat: 340, ok: true },
];

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="truncate font-mono text-[8px] tracking-[0.24em] text-mute">{label}</div>
      <div className={`mt-1.5 font-display text-[26px] font-medium leading-none tabular-nums tracking-[-0.02em] ${tone ?? "text-mist"}`}>
        {value}
      </div>
      {sub && <div className="mt-1.5 truncate font-mono text-[8px] tracking-[0.14em] text-mute/60">{sub}</div>}
    </div>
  );
}

const clock = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

export default function Observe() {
  const d = useDesk();

  const counts = useMemo(() => {
    const run = d.feed.filter((t) => t.state === "RUNNING").length;
    const ver = d.feed.filter((t) => t.state === "VERIFYING").length;
    const set = d.feed.filter((t) => t.state === "SETTLED").length;
    return [run + 1, run, ver, set]; // commit ≈ freshest + running
  }, [d.feed]);

  const throughput = useMemo(() => {
    const base = [6, 8, 7, 9, 11, 8, 12, 10, 13, 11, 14, 12, 15, 13, 11, 14];
    const live = d.feed.filter((t) => d.now - t.at < 60_000).length;
    return [...base, Math.max(2, live)];
  }, [d.feed, d.now]);

  const disputeRate = useMemo(() => {
    const dis = d.feed.filter((t) => t.state === "DISPUTED").length;
    return ((dis / Math.max(1, d.feed.length)) * 100).toFixed(2);
  }, [d.feed]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* KPI strip */}
      <div className="grid shrink-0 grid-cols-5 divide-x divide-edge border-b border-edge bg-code">
        <Kpi label="TASKS / MIN" value={String(throughput[throughput.length - 1]).padStart(2, "0")} sub="ROLLING 60S · ATLAS FLEET" />
        <Kpi label="ESCROW LOCKED" value={d.wallet.escrow.toFixed(1)} sub="USDC · NON-CUSTODIAL" />
        <Kpi label="SETTLED 24H" value={d.wallet.earned.toFixed(0)} sub="USDC EARNED · NET +" tone="text-volt" />
        <Kpi label="DISPUTE RATE" value={disputeRate} sub="% OF WINDOW TXS" tone={parseFloat(disputeRate) > 3 ? "text-red-400" : "text-mist"} />
        <Kpi label="VERIFIER QUORUM" value="3/3" sub="MEDIAN 247MS RECOMPUTE" />
      </div>

        {/* main split */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px] divide-x divide-edge">
        {/* feed */}
        {/* ---- task stream ---- */}
        <Panel
          title="TASK STREAM — LIVE"
          className="border-0"
          right={
            <span className="flex items-center gap-2 font-mono text-[8px] tracking-[0.2em] text-volt/70">
              <span className={d.halted ? "h-1.5 w-1.5 bg-red-400" : "h-1.5 w-1.5 bg-volt"} />
              {d.halted ? "HALTED" : "LIVE"}
            </span>
          }
          bodyClass="flex min-h-0 flex-col"
        >
          {/* column heads */}
          <div className="grid shrink-0 grid-cols-[76px_96px_minmax(0,1fr)_120px_92px] gap-3 border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.2em] text-mute/50">
            <span>TIME</span>
            <span>TASK_ID</span>
            <span>ROUTE / SPEC</span>
            <span className="text-right">ESCROW</span>
            <span>STATE</span>
          </div>
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
            <AnimatePresence initial={false}>
              {d.feed.map((t) => {
                const sel = d.inspector === t.id;
                return (
                  <motion.button
                    layout="position"
                    key={t.id}
                    initial={{ opacity: 0, backgroundColor: "rgba(198,255,65,0.12)" }}
                    animate={{ opacity: 1, backgroundColor: "rgba(198,255,65,0)" }}
                    transition={{ duration: 0.6 }}
                    onClick={() => d.setInspector(sel ? null : t.id)}
                    className={`grid w-full grid-cols-[76px_96px_minmax(0,1fr)_120px_92px] items-center gap-3 border-b border-edge/50 px-3 py-[7px] text-left font-mono text-[10px] transition-colors hover:bg-panel/70 ${
                      sel ? "bg-deepgreen shadow-[inset_2px_0_0_#3dff36]" : ""
                    }`}
                  >
                    <span className="tabular-nums text-mute/60">{clock(t.at)}</span>
                    <span className="truncate text-code-fg">{t.id}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[9.5px] text-mute">
                        {t.agent.replace("agent:", "")}
                        <span className="text-mute/40"> {t.role === "work" ? "→" : "←"} </span>
                        {t.counterparty.replace("agent:", "")}
                      </span>
                      <span className="truncate text-mist/90">{t.spec}</span>
                    </span>
                    <span className={`text-right tabular-nums ${t.role === "work" ? "text-volt" : "text-mist/80"}`}>
                      {t.role === "work" ? "+" : "−"}{t.amount}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <StateDot state={t.state} />
                      <span className={`text-[8px] tracking-[0.12em] ${
                        t.state === "DISPUTED" || t.state === "FAILED" ? "text-red-400" : t.state === "SETTLED" ? "text-mute/70" : "text-volt/90"
                      }`}>
                        {t.state}
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        <div className="shrink-0 border-t border-edge px-3 py-1.5 font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
          {d.feed.length} ROWS · ROW : PROOF
        </div>
        </Panel>

        {/* ---- right rail ---- */}
        <div className="flex min-h-0 flex-col divide-y divide-edge">
          <Panel title="ESCROW STATE MACHINE" className="flex-1 border-0" bodyClass="overflow-visible">
            <FlowMachine counts={counts} disputes={d.feed.filter((t) => t.state === "DISPUTED").length} />
        <div className="px-4 pb-3">
          <div className="mb-2 flex justify-between font-mono text-[7.5px] tracking-[0.2em] text-mute/50">
            <span>THROUGHPUT — TASKS/MIN</span>
          </div>
          <div className="h-14">
            <AreaChart data={throughput} />
          </div>
        </div>
          </Panel>

        <Panel title="VERIFIER SET" className="border-0" bodyClass="overflow-visible">
          {VERIFIERS.map((v) => (
            <div key={v.id} className="flex items-center gap-3 border-b border-edge/50 px-3 py-2 font-mono text-[9.5px] last:border-b-0">
              <span className="h-1.5 w-1.5 bg-volt" />
              <span className="w-20 truncate text-mist/80">{v.id}</span>
              <Tag tone="volt" className="ml-auto px-1 py-0 text-[7px]">OK</Tag>
            </div>
          ))}
        </Panel>

          <Panel title="SETTLEMENT BATCHES" className="border-0" bodyClass="overflow-visible">
            {d.batches.slice(0, 3).map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-b border-edge/50 px-3 py-2 font-mono text-[9.5px] last:border-b-0">
                <span className={`h-1.5 w-1.5 ${b.state === "SETTLING" ? "animate-pulse bg-amber-300" : "bg-volt"}`} />
                <span className="text-mist/80">{b.id}</span>
                <span className="text-mute/60">{b.count} txs</span>
                <span className="ml-auto tabular-nums text-mist">{b.total}</span>
                <span className="text-[8px] text-mute/50">{timeAgo(b.at, d.now)}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

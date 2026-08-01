import { Check, OctagonAlert, Scale, X } from "lucide-react";
import { motion } from "framer-motion";
import { timeAgo } from "../app/data";
import { HashLine, STATE_TONE, Tag } from "../app/ui";
import { useDesk } from "./store";
import { KV, Panel } from "./widgets";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const STEPS = ["COMMIT", "EXEC", "VERIFY", "SETTLE"];

export default function Inspector() {
  const d = useDesk();
  const t = d.feed.find((f) => f.id === d.inspector);
  if (!t) return null;

  const disputed = t.state === "DISPUTED";
  const approval = d.approvals.find((x) => x.ref === t.id);
  const activeIdx = t.state === "RUNNING" ? 1 : t.state === "VERIFYING" ? 2 : t.state === "SETTLED" ? 3 : 2;

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.35, ease: EASE }}
      className="absolute inset-y-0 right-0 z-40 w-[440px] max-w-[92%] border-l border-edge bg-void shadow-[-40px_0_80px_rgba(0,0,0,0.6)]"
    >
      <div className="flex h-10 items-center justify-between border-b border-edge px-4">
        <span className="flex items-center gap-3 font-mono text-[9px] tracking-[0.2em] text-mute">
          PROOF INSPECTOR
          <span className="text-mist">{t.id}</span>
        </span>
        <button onClick={() => d.setInspector(null)} className="flex h-6 w-6 items-center justify-center border border-edge2 text-mute transition-colors hover:border-volt/60 hover:text-volt">
          <X size={12} />
        </button>
      </div>

      <div className="no-scrollbar h-[calc(100%-40px)] overflow-y-auto p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">{t.spec.toUpperCase()}</div>
            <div className="mt-1.5 font-display text-[34px] font-medium tabular-nums leading-none tracking-[-0.03em]">
              {t.amount}
              <span className="ml-2 font-mono text-[10px] text-mute">USDC</span>
            </div>
          </div>
          <Tag tone={STATE_TONE[t.state]}>{t.state}</Tag>
        </div>

        {/* mini state machine */}
        <div className="mt-5 flex items-center border border-edge px-3 py-3">
          {STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span className={`h-1.5 w-1.5 ${i <= activeIdx ? (disputed && i === activeIdx ? "bg-red-400" : "bg-volt") : "border border-edge2"}`} />
                <span className={`mt-1.5 font-mono text-[6.5px] tracking-[0.14em] ${i <= activeIdx ? "text-mist" : "text-mute/40"}`}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`mx-1 mb-3.5 h-px flex-1 ${i < activeIdx ? "bg-volt/50" : "bg-edge"}`} />}
            </div>
          ))}
        </div>

        <Panel title="VERIFICATION PROOF" className="mt-4 border-edge" bodyClass="overflow-visible">
          <div className="px-3 py-1.5">
            <HashLine label="REPORTED" value={t.hash} ok={disputed ? false : undefined} />
            <HashLine label="RECOMPUTED" value={disputed ? "0x9af2be…77c1" : t.hash} ok={disputed ? true : undefined} />
            <HashLine label="MERKLE ANCHOR" value="0x71be0c…e8d3" />
            <HashLine label="PROOF BLOCK" value="#12,840,117" />
            <HashLine label="RECOMPUTE" value="412ms · deterministic" />
          </div>
          <div className="grid grid-cols-3 gap-px border-t border-edge bg-edge">
            {[{ v: "gamma-1", ok: !disputed }, { v: "delta-4", ok: true }, { v: "sigma-2", ok: true }].map((x) => (
              <div key={x.v} className="flex items-center justify-center gap-1.5 bg-[#0a0d08] py-2 font-mono text-[8px]">
                {x.ok ? <Check size={9} className="text-volt" /> : <X size={9} className="text-red-400" />}
                <span className={x.ok ? "text-mute" : "text-red-400"}>{x.v}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="ESCROW" className="mt-4 border-edge" bodyClass="overflow-visible">
          <div className="px-3 py-1.5">
            <KV k="CONTRACT" v="0xESC…40W1" />
            <KV k="BUYER" v={t.counterparty} />
            <KV k="WORKER" v={t.agent} tone="volt" />
            <KV k="STATE" v={disputed ? "FROZEN — AWAITING RULING" : t.state === "SETTLED" ? "RELEASED" : "LOCKED"} tone={disputed ? "red" : t.state === "SETTLED" ? "volt" : "amber"} />
            <KV k="OPENED" v={`${timeAgo(t.at, d.now)} AGO`} />
          </div>
        </Panel>

        {disputed && (
          approval ? (
            <button
              onClick={() => { d.setInspector(null); d.gotoIntervention(approval.id); }}
              className="mt-4 flex w-full items-center justify-center gap-2.5 border border-volt bg-volt py-3.5 font-mono text-[10px] font-semibold tracking-[0.22em] text-void transition-colors hover:bg-mist"
            >
              <Scale size={13} /> OPEN IN INTERVENE →
            </button>
          ) : (
            <div className="mt-4 flex items-center gap-2.5 border border-edge px-3 py-3 font-mono text-[8.5px] tracking-[0.16em] text-mute">
              <Check size={11} className="text-volt" /> RULING BROADCAST — QUEUE UPDATED
            </div>
          )
        )}
        {t.state === "FAILED" && (
          <div className="mt-4 flex items-center gap-2.5 border border-red-400/40 bg-red-400/[0.05] px-3 py-3 font-mono text-[8.5px] tracking-[0.16em] text-red-400/90">
            <OctagonAlert size={11} /> TIMED OUT — ESCROW AUTO-REFUNDED
          </div>
        )}

        <div className="mt-6 text-center font-mono text-[7.5px] tracking-[0.22em] text-mute/40">
          RECEIPT WRITES TO THE PUBLIC AGENT GRAPH
        </div>
      </div>
    </motion.aside>
  );
}

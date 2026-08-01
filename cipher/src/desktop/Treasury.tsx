import { Landmark, LockKeyhole, TrendingUp } from "lucide-react";
import { useState } from "react";
import { timeAgo } from "../app/data";
import { HoldButton, Stepper } from "../app/ui";
import { NETWORKS } from "../networks";
import { useDesk } from "./store";
import { AreaChart, KV, Panel } from "./widgets";

const FLOW = [120, 180, 150, 240, 210, 320, 280, 190, 350, 300, 420, 380, 260, 440, 390, 470, 430, 510, 460, 380, 520, 470, 560, 510, 450, 580, 530, 600];

const TIERS = [
  { t: "T3 CORE", min: 10000 },
  { t: "T2 PREFERRED", min: 2500 },
  { t: "T1 TRUSTED", min: 500 },
];

export default function Treasury() {
  const d = useDesk();
  const w = d.wallet;
  const [add, setAdd] = useState(500);
  const total = w.avail + w.escrow + w.stake;
  const pct = Math.min(100, Math.round((w.stake / 10000) * 100));

  return (
    <div className="no-scrollbar h-full min-h-0 overflow-y-auto p-5">
      {/* big numbers */}
      <div className="grid grid-cols-4 gap-px border border-edge bg-edge">
        {[
          { l: "TOTAL TREASURY", v: total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), s: "USDC · NON-CUSTODIAL", i: TrendingUp, big: true },
          { l: "AVAILABLE", v: w.avail.toFixed(2), s: "ROUTABLE THIS SECOND", i: TrendingUp },
          { l: "IN ESCROW", v: w.escrow.toFixed(2), s: "LOCKED IN OPEN TASKS", i: LockKeyhole },
          { l: "STAKED", v: w.stake.toLocaleString(), s: "AT RISK · T2 PREFERRED", i: Landmark },
        ].map((c) => (
          <div key={c.l} className="bg-code p-4">
            <div className="flex items-center gap-2 font-mono text-[8px] tracking-[0.22em] text-mute">
              <c.i size={10} className="text-volt/70" /> {c.l}
            </div>
            <div className={`mt-2 font-display font-medium leading-none tabular-nums tracking-[-0.02em] text-mist ${c.big ? "text-[26px] text-volt" : "text-[26px]"}`}>
              {c.v}
            </div>
            <div className="mt-2 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">{c.s}</div>
          </div>
        ))}
      </div>

      {/* net flow */}
      <Panel title="NET FLOW — 28 EPOCHS · USDC" className="mt-4 border-edge" bodyClass="h-40 p-3">
        <AreaChart data={[...FLOW, w.earned]} />
      </Panel>

      <div className="mt-4 grid grid-cols-[1.2fr_1fr] gap-4">
        {/* batches */}
        <Panel title="SETTLEMENT BATCHES — EVERY 30S" className="border-edge" bodyClass="no-scrollbar overflow-y-auto">
          <div className="grid grid-cols-[110px_70px_90px_1fr_70px] gap-2 border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
            <span>BATCH</span><span>TXS</span><span className="text-right">TOTAL</span><span className="text-right">ANCHOR</span><span className="text-right">STATE</span>
          </div>
          {d.batches.map((b) => (
            <div key={b.id} className="grid grid-cols-[110px_70px_90px_1fr_70px] items-center gap-2 border-b border-edge/60 px-3 py-2.5 font-mono text-[10px]">
              <span className="text-mist/85">{b.id}</span>
              <span className="tabular-nums text-mute">{b.count}</span>
              <span className="text-right tabular-nums text-mist">{b.total}</span>
              <span className="truncate text-right text-[9px] text-mute/50">0x71be…e8d3 · {timeAgo(b.at, d.now)}</span>
              <span className={`text-right text-[8px] tracking-[0.14em] ${b.state === "SETTLING" ? "text-amber-300" : "text-volt/70"}`}>{b.state}</span>
            </div>
          ))}
          <div className="px-3 py-2 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">
            BATCHED TO L1 · FEES AMORTIZED ACROSS FLEET
          </div>
        </Panel>

        {/* staking */}
        <Panel title="STAKING & TRUST TIERS — PHASE 2" className="border-edge" bodyClass="overflow-visible">
          <div className="px-4 pt-3">
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-[22px] font-semibold tabular-nums text-mist">{w.stake.toLocaleString()}</span>
              <span className="text-[9px] tracking-[0.16em] text-mute">USDC STAKED · 7-DAY UNBONDING</span>
            </div>
            <div className="mt-3 flex justify-between font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
              <span>T2 PREFERRED</span>
              <span className="text-volt">{pct}% → T3 CORE</span>
            </div>
            <div className="mt-2 h-1.5 w-full bg-edge"><div className="h-full bg-volt transition-all duration-700" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="px-4 pt-2">
            {TIERS.map((t) => (
              <KV key={t.t} k={`${t.t} · ≥ ${t.min.toLocaleString()}`} v={w.stake >= t.min ? "HELD ✓" : "LOCKED"} tone={w.stake >= t.min ? "volt" : undefined} />
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
            <HoldButton label={`HOLD TO STAKE ${add} USDC`} onDone={() => { d.stakeMore(add); d.toast(`${add} USDC STAKED`); }} />
            <Stepper value={add} min={100} max={5000} step={100} onChange={setAdd} />
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="border border-edge px-4 py-3 font-mono text-[8px] leading-[1.9] tracking-[0.16em] text-mute/50">
          FUNDS COMPOSITION — AVAILABLE {Math.round((w.avail / total) * 100)}% · ESCROW {Math.round((w.escrow / total) * 100)}% · STAKED {Math.round((w.stake / total) * 100)}% ·
          CONTRACT 0xESC…40W1 · CIPHER SENTRY NEVER TOUCHES THE BALANCE
        </div>
        <div className="border border-edge">
          <div className="border-b border-edge px-4 py-2 font-mono text-[7.5px] tracking-[0.22em] text-mute/50">
            SETTLEMENT RAILS — SWITCH IN TITLE BAR
          </div>
          {NETWORKS.map((n) => (
            <div key={n.id} className="flex items-center gap-2.5 border-b border-edge/60 px-4 py-[7px] font-mono text-[9px] last:border-b-0">
              <span className={`h-1.5 w-1.5 ${n.status === "LIVE" ? "bg-volt" : n.status === "EVAL" ? "bg-mute/50" : "bg-amber-300"}`} />
              <span className="text-mist/80">{n.label}</span>
              <span className={`ml-auto text-[7.5px] tracking-[0.16em] ${n.tag === "CENT TGE" ? "text-volt" : "text-mute/50"}`}>{n.tag}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

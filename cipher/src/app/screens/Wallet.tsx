import { ChevronRight, Landmark, Layers, LockKeyhole, TrendingUp } from "lucide-react";
import { timeAgo } from "../data";
import { useApp } from "../store";
import { Bars, Card, SectionLabel, Tag } from "../ui";

const WEEK = [42, 68, 51, 90, 74, 120, 96, 64, 110, 88, 132, 105, 78, 142];

export default function Wallet() {
  const app = useApp();
  const w = app.wallet;

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-28">
      <div className="px-5 pb-2 pt-5">
        <div className="font-mono text-[9px] tracking-[0.26em] text-mute">TREASURY / FLEET WALLET</div>
        <div className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em]">Where the money is</div>
      </div>

      {/* balance hero */}
      <div className="px-5 pt-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] tracking-[0.24em] text-mute">TOTAL BALANCE</span>
            <Tag tone="volt">USDC</Tag>
          </div>
          <div className="mt-3 font-display text-[44px] font-medium tabular-nums leading-none tracking-[-0.03em]">
            {(w.avail + w.escrow).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="border border-edge bg-void/60 px-3.5 py-3">
              <div className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.2em] text-mute">
                <TrendingUp size={10} className="text-volt" /> AVAILABLE
              </div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold tabular-nums text-mist">{w.avail.toFixed(2)}</div>
            </div>
            <div className="border border-edge bg-void/60 px-3.5 py-3">
              <div className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.2em] text-mute">
                <LockKeyhole size={10} className="text-amber-300" /> IN ESCROW
              </div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold tabular-nums text-mist">{w.escrow.toFixed(2)}</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 flex justify-between font-mono text-[8px] tracking-[0.2em] text-mute/60">
              <span>NET FLOW — 14 EPOCHS</span>
              <span className="text-volt">+{(w.earned - w.spent).toFixed(0)} USDC TODAY</span>
            </div>
            <Bars data={WEEK} />
          </div>
        </Card>
      </div>

      {/* staking entry */}
      <div className="px-5 pt-3">
        <button onClick={() => app.open({ s: "staking" })} className="flex w-full items-center gap-3.5 border border-volt/40 bg-volt/[0.05] px-4 py-4 text-left active:bg-volt/10">
          <span className="flex h-10 w-10 items-center justify-center border border-volt/60 text-volt">
            <Landmark size={16} />
          </span>
          <span className="flex-1">
            <span className="flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.14em] text-mist">
              STAKING & TRUST TIERS
              <Tag tone="amber" className="px-1.5 py-0.5 text-[7px]">PHASE 2</Tag>
            </span>
            <span className="mt-1 block font-mono text-[8.5px] tracking-[0.14em] text-mute">
              {w.stake.toLocaleString()} USDC STAKED · TIER T2 → T3 AT 10,000
            </span>
          </span>
          <ChevronRight size={14} className="text-volt" />
        </button>
      </div>

      {/* settlement batches */}
      <div className="px-5">
        <SectionLabel
          right={
            <span className="flex items-center gap-1.5 font-mono text-[8.5px] tracking-[0.18em] text-mute/50">
              <Layers size={10} /> EVERY 30S
            </span>
          }
        >
          SETTLEMENT BATCHES
        </SectionLabel>
      </div>

      <div className="border-t border-edge">
        {app.batches.map((b) => (
          <button
            key={b.id}
            onClick={() => app.toast(`${b.id.toUpperCase()} — ${b.count} RECEIPTS ANCHORED`)}
            className="flex w-full items-center gap-3.5 border-b border-edge px-5 py-4 text-left active:bg-panel"
          >
            <span className={`h-2 w-2 shrink-0 ${b.state === "SETTLING" ? "animate-pulse bg-amber-300" : "bg-volt"}`} />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[12px] font-semibold text-mist">{b.id}</span>
              <span className="mt-1 block font-mono text-[8.5px] tracking-[0.14em] text-mute">
                {b.count} TASKS · {timeAgo(b.at, app.now)} AGO
              </span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-[12px] font-semibold tabular-nums text-mist">{b.total}</span>
              <span className={`mt-1 block font-mono text-[8px] tracking-[0.18em] ${b.state === "SETTLING" ? "text-amber-300" : "text-volt/70"}`}>
                {b.state}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="px-5 pt-6 text-center font-mono text-[8px] tracking-[0.24em] text-mute/40">
        NON-CUSTODIAL · CONTRACT 0xESC…40W1 · FINALITY INSTANT
      </div>
    </div>
  );
}

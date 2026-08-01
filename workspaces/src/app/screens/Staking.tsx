import { Check, Landmark } from "lucide-react";
import { useState } from "react";
import { useApp } from "../store";
import { BackHeader, Card, HoldButton, SectionLabel, Stepper, Tag } from "../ui";

const TIERS = [
  { t: "T3", name: "CORE", min: 10000, d: "Priority routing, 40% fee rebate, verifier eligibility." },
  { t: "T2", name: "PREFERRED", min: 2500, d: "Boosted placement in registry search, 20% rebate." },
  { t: "T1", name: "TRUSTED", min: 500, d: "Listed with trust badge. Standard routing." },
  { t: "T0", name: "OBSERVED", min: 0, d: "Probation. Tasks capped at 25 USDC escrow." },
];

export default function Staking() {
  const app = useApp();
  const [add, setAdd] = useState(500);
  const staked = app.wallet.stake;

  const current = TIERS.findIndex((x) => staked >= x.min);
  const next = current > 0 ? TIERS[current - 1] : null;
  const pct = next ? Math.min(100, Math.round((staked / next.min) * 100)) : 100;

  return (
    <div className="no-scrollbar h-full overflow-y-auto bg-void pb-10">
      <BackHeader title="STAKING & TRUST TIERS" sub="PHASE 2 · BETA" onBack={app.close} />

      <div className="px-5 pt-6">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.24em] text-mute">
              <Landmark size={12} className="text-volt" /> FLEET STAKE
            </span>
            <Tag tone="volt">T{3 - current === 3 ? "3" : TIERS[current].t.slice(1)} ACTIVE</Tag>
          </div>
          <div className="mt-3 font-display text-[40px] font-medium tabular-nums leading-none tracking-[-0.03em]">
            {staked.toLocaleString()}
            <span className="ml-2 font-mono text-[11px] text-mute">USDC</span>
          </div>
          {next && (
            <div className="mt-5">
              <div className="flex justify-between font-mono text-[8px] tracking-[0.2em] text-mute/60">
                <span>{TIERS[current].t} {TIERS[current].name}</span>
                <span className="text-volt">{pct}% → {next.t} {next.name}</span>
              </div>
              <div className="mt-2 h-1.5 w-full bg-edge">
                <div className="h-full bg-volt transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </Card>

        <SectionLabel>TIER LADDER</SectionLabel>
        <div className="border-t border-edge">
          {TIERS.map((x) => {
            const active = x.min === TIERS[current].min;
            const reached = staked >= x.min;
            return (
              <div key={x.t} className={`flex items-center gap-4 border-b border-edge px-1 py-4 ${active ? "bg-volt/[0.04]" : ""}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center border font-mono text-[11px] font-semibold ${
                  active ? "border-volt bg-volt/15 text-volt" : reached ? "border-volt/40 text-volt/80" : "border-edge2 text-mute"
                }`}>
                  {reached ? <Check size={13} /> : x.t}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 font-mono text-[11px] tracking-[0.16em]">
                    <span className={active ? "text-volt" : "text-mist"}>{x.t} {x.name}</span>
                    <span className="text-[8.5px] text-mute/60">≥ {x.min.toLocaleString()}</span>
                  </span>
                  <span className="mt-1 block text-[11px] leading-[1.5] text-mute">{x.d}</span>
                </span>
              </div>
            );
          })}
        </div>

        <SectionLabel>STAKE MORE</SectionLabel>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-mist">ADD TO STAKE</div>
              <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">7-DAY UNBONDING · SLASH CONDITIONS APPLY</div>
            </div>
            <Stepper value={add} min={100} max={5000} step={100} onChange={setAdd} />
          </div>
          <HoldButton
            className="mt-4"
            label={`HOLD TO STAKE ${add} USDC`}
            onDone={() => {
              app.stakeMore(add);
              app.toast(`${add} USDC STAKED — NEW EPOCH SHORTLY`);
            }}
          />
        </Card>

        <p className="mt-6 font-mono text-[8px] leading-[1.9] tracking-[0.18em] text-mute/50">
          * INVALID OUTPUT BURNS STAKE PRO-RATA. STAKE IS THE ONLY REPUTATION THAT CANNOT BE FAKED.
        </p>
      </div>
    </div>
  );
}

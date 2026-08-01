import { Pause, Play } from "lucide-react";
import { timeAgo } from "../data";
import { useApp } from "../store";
import { BackHeader, Card, Ring, SectionLabel, Spark, StateDot, Stat, Stepper, Tag } from "../ui";

export default function AgentDetail({ id }: { id: string }) {
  const app = useApp();
  const a = app.agents.find((x) => x.id === id);
  if (!a) return null;

  const recent = app.feed.filter((t) => t.agent === a.name).slice(0, 4);
  const limit = app.limits.perAgent[a.id] ?? 250;
  const online = a.status === "ONLINE";

  return (
    <div className="no-scrollbar h-full overflow-y-auto bg-void pb-10">
      <BackHeader title={a.name} sub={`${a.specialty} · TIER ${a.tier}`} onBack={app.close} />

      <div className="px-5 pt-6">
        <div className="flex items-center gap-5">
          <Ring pct={a.trust} size={92} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 ${online ? "animate-pulse bg-volt" : a.status === "DEGRADED" ? "bg-amber-300" : "bg-mute"}`} />
              <span className="font-mono text-[9.5px] tracking-[0.22em] text-mist">{a.status}</span>
            </div>
            <div className="mt-2 font-mono text-[9px] leading-[1.9] tracking-[0.16em] text-mute">
              TRUST SCORE {a.trust}/100
              <br />
              STAKE AT RISK <span className="text-mist">{a.stake.toLocaleString()} USDC</span>
            </div>
            {a.mine && <Tag tone="volt" className="mt-2">MY AGENT</Tag>}
          </div>
        </div>

        <div className="mt-7 grid grid-cols-3 gap-4">
          <Stat label="EARNED 30D" value={a.earned30d.toFixed(0)} tone="volt" />
          <Stat label="TASKS 24H" value={String(a.tasks24h)} />
          <Stat label="SUCCESS" value={`${a.success}%`} />
        </div>

        <SectionLabel>EARNINGS — 12 EPOCHS</SectionLabel>
        <Card className="p-4">
          <Spark data={a.spark} className="h-14" />
          <div className="mt-2 flex justify-between font-mono text-[7.5px] tracking-[0.14em] text-mute/50">
            <span>E-12</span><span>E-9</span><span>E-6</span><span>E-3</span><span>NOW</span>
          </div>
        </Card>

        {a.mine && (
          <>
            <SectionLabel>CONTROLS</SectionLabel>
            <Card className="divide-y divide-edge">
              <div className="flex items-center justify-between px-4 py-3.5">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-mist">DAILY SPEND LIMIT</div>
                  <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">ABOVE IT, TASKS ASK YOU FIRST</div>
                </div>
                <Stepper value={limit} min={50} max={2000} step={50} onChange={(v) => { app.setAgentLimit(a.id, v); }} />
              </div>
              <div className="flex items-center justify-between px-4 py-3.5">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-mist">{online ? "PAUSE AGENT" : "RESUME AGENT"}</div>
                  <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">{online ? "STOPS ACCEPTING NEW TASKS" : "CURRENTLY NOT ROUTING"}</div>
                </div>
                <button
                  onClick={() => {
                    app.toggleAgent(a.id);
                    app.toast(online ? `${a.name} PAUSED — ESCROWS SETTLE OUT` : `${a.name} BACK ONLINE`);
                  }}
                  className={`flex h-9 w-9 items-center justify-center border transition-colors ${
                    online ? "border-red-400/60 text-red-400" : "border-volt/70 text-volt"
                  }`}
                >
                  {online ? <Pause size={13} /> : <Play size={13} />}
                </button>
              </div>
            </Card>
          </>
        )}

        <SectionLabel right={<span className="font-mono text-[8.5px] tracking-[0.18em] text-mute/50">FROM LIVE WINDOW</span>}>
          RECENT TASKS
        </SectionLabel>
        <Card className="divide-y divide-edge">
          {recent.length === 0 && (
            <div className="px-4 py-5 font-mono text-[10px] tracking-[0.14em] text-mute/60">NO TASKS IN CURRENT WINDOW</div>
          )}
          {recent.map((t) => (
            <button key={t.id} onClick={() => app.open({ s: "task", id: t.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-panel">
              <StateDot state={t.state} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[10.5px] text-mist">{t.spec}</span>
                <span className="mt-0.5 block font-mono text-[8px] tracking-[0.12em] text-mute/60">{timeAgo(t.at, app.now)} AGO · {t.counterparty}</span>
              </span>
              <span className={`font-mono text-[10.5px] font-semibold tabular-nums ${t.role === "work" ? "text-volt" : "text-mist/80"}`}>
                {t.amount}
              </span>
            </button>
          ))}
        </Card>

        <div className="mt-6 text-center font-mono text-[8px] tracking-[0.24em] text-mute/40">
          FULL HISTORY ON EXPLORER · MERKLE-ANCHORED
        </div>
      </div>
    </div>
  );
}

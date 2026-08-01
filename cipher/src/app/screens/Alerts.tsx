import { Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { timeAgo } from "../data";
import type { AlertItem } from "../data";
import { useApp } from "../store";
import { Card, SectionLabel, Stepper, Switch } from "../ui";

function SevIcon({ sev }: { sev: AlertItem["sev"] }) {
  if (sev === "CRIT")
    return <span className="flex h-7 w-7 items-center justify-center border border-red-400/60 text-red-400"><OctagonAlert size={12} /></span>;
  if (sev === "WARN")
    return <span className="flex h-7 w-7 items-center justify-center border border-amber-300/50 text-amber-300"><TriangleAlert size={12} /></span>;
  return <span className="flex h-7 w-7 items-center justify-center border border-edge2 text-mute"><Info size={12} /></span>;
}

export default function Alerts() {
  const app = useApp();
  const { limits } = app;

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-28">
      <div className="px-5 pb-2 pt-5">
        <div className="font-mono text-[9px] tracking-[0.26em] text-mute">GUARDRAILS / NOTIFICATIONS</div>
        <div className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em]">Alerts & limits</div>
      </div>

      {/* spend limits config */}
      <div className="px-5">
        <SectionLabel>SPEND LIMITS — CHANGES APPLY INSTANTLY</SectionLabel>
        <Card className="divide-y divide-edge">
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <div className="font-mono text-[10px] tracking-[0.16em] text-mist">FLEET DAILY CAP</div>
              <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">ALL AGENTS COMBINED · USDC/DAY</div>
            </div>
            <Stepper value={limits.global} min={250} max={10000} step={250} onChange={(v) => { app.setGlobalLimit(v); app.toast(`FLEET CAP → ${v} USDC/DAY`); }} />
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <div className="font-mono text-[10px] tracking-[0.16em] text-mist">ASK ME ABOVE</div>
              <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">SINGLE-TASK ESCROW THRESHOLD · USDC</div>
            </div>
            <Stepper value={limits.requireAbove} min={25} max={1000} step={25} onChange={(v) => { app.setRequireAbove(v); app.toast(`APPROVAL REQUIRED ABOVE ${v} USDC`); }} />
          </div>
          {app.agents.filter((a) => a.mine).map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-4">
              <div className="min-w-0">
                <div className="truncate font-mono text-[10px] tracking-[0.16em] text-mist">{a.name.toUpperCase()}</div>
                <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">PER-AGENT CAP · USDC/DAY</div>
              </div>
              <Stepper value={limits.perAgent[a.id] ?? 250} min={50} max={2000} step={50} onChange={(v) => { app.setAgentLimit(a.id, v); app.toast(`${a.name} CAP → ${v} USDC/DAY`); }} />
            </div>
          ))}
        </Card>

        <SectionLabel>AUTOMATION</SectionLabel>
        <Card className="divide-y divide-edge">
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <div className="font-mono text-[10px] tracking-[0.16em] text-mist">AUTO-PAUSE ON FAILURES</div>
              <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">2 FAILED VERIFICATIONS IN AN HOUR</div>
            </div>
            <Switch on={limits.autoPause} onChange={(v) => { app.setFlag("autoPause", v); app.toast(v ? "AUTO-PAUSE ARMED" : "AUTO-PAUSE OFF"); }} />
          </div>
          <div className="flex items-center justify-between px-4 py-4">
            <div>
              <div className="font-mono text-[10px] tracking-[0.16em] text-mist">WEEKLY TREASURY DIGEST</div>
              <div className="mt-0.5 font-mono text-[8.5px] text-mute/60">MERKLE-SIGNED SUMMARY, EVERY MONDAY</div>
            </div>
            <Switch on={limits.digest} onChange={(v) => { app.setFlag("digest", v); app.toast(v ? "DIGEST ON" : "DIGEST OFF"); }} />
          </div>
        </Card>

        <SectionLabel right={<span className="font-mono text-[8.5px] tracking-[0.18em] text-mute/50">{app.alerts.length} EVENTS</span>}>
          ALERT STREAM
        </SectionLabel>
      </div>

      <div className="border-t border-edge">
        {app.alerts.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              if (a.ref.startsWith("cent_")) app.open({ s: "task", id: a.ref });
              else if (a.ref.startsWith("agent:")) app.open({ s: "agent", id: a.ref.replace("agent:", "") });
            }}
            className="flex w-full items-start gap-3.5 border-b border-edge px-5 py-4 text-left active:bg-panel"
          >
            <SevIcon sev={a.sev} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] leading-[1.5] text-mist/90">{a.msg}</span>
              <span className="mt-1.5 flex items-center gap-2 font-mono text-[8.5px] tracking-[0.14em] text-mute">
                <span className={a.sev === "CRIT" ? "text-red-400/80" : ""}>{a.ref}</span>
                <span className="text-mute/40">·</span>
                <span>{timeAgo(a.at, app.now)} AGO</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="px-5 pt-6 text-center font-mono text-[8px] tracking-[0.24em] text-mute/40">
        ALERTS SIGN AS THEY FIRE · NOTHING REACHES YOU UNVERIFIED
      </div>
    </div>
  );
}

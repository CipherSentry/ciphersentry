import { Check, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { useDesk } from "./store";
import { TrustBars } from "./widgets";

type Mode = "mine" | "registry";

const HEAD = ["", "AGENT", "TIER", "TRUST", "TASKS 24H", "SUCCESS", "EARNED 30D", "STAKE", "", ""];

export default function Fleet() {
  const d = useDesk();
  const [mode, setMode] = useState<Mode>("mine");
  const [hired, setHired] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const mine = d.agents.filter((a) => a.mine);
  const registry = d.agents.filter((a) => !a.mine && (a.name + a.specialty).toLowerCase().includes(q.toLowerCase()));
  const list = mode === "mine" ? mine : registry;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* sub-tabs */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4">
        {(["mine", "registry"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`border px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] transition-colors ${
              mode === m ? "border-volt/70 bg-volt/10 text-volt" : "border-edge2 text-mute hover:text-mist"
            }`}
          >
            {m === "mine" ? `MY FLEET (${mine.length})` : `REGISTRY (${registry.length} SHOWN)`}
          </button>
        ))}
        {mode === "registry" && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter name / capability…"
            spellCheck={false}
            className="ml-auto w-64 border border-edge2 bg-panel/60 px-3 py-1.5 font-mono text-[10px] text-mist placeholder:text-mute/40 focus:border-volt/60 focus:outline-none"
          />
        )}
      </div>

      {/* table */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="grid shrink-0 grid-cols-[34px_minmax(150px,1.2fr)_56px_130px_84px_84px_100px_90px_130px_44px] items-center gap-2 border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
          {HEAD.map((h, i) => <span key={i} className={i >= 4 ? "text-right" : ""}>{h}</span>)}
        </div>
        {list.map((a) => {
          const online = a.status === "ONLINE";
          return (
            <div
              key={a.id}
              className="grid grid-cols-[34px_minmax(150px,1.2fr)_56px_130px_84px_84px_100px_90px_130px_44px] items-center gap-2 border-b border-edge/60 px-3 py-[9px] font-mono text-[10px] transition-colors hover:bg-panel/50"
            >
              <span className={`h-2 w-2 ${online ? "bg-volt" : a.status === "DEGRADED" ? "bg-amber-300" : "bg-mute/50"}`} />
              <span className="min-w-0">
                <span className="block truncate text-mist">{a.name}</span>
                <span className="mt-0.5 block text-[7.5px] tracking-[0.16em] text-mute/50">{a.specialty} · {a.status}</span>
              </span>
              <span className={`text-[9px] ${a.tier === "T3" || a.tier === "T2" ? "text-volt" : "text-mute"}`}>{a.tier}</span>
              <TrustBars value={a.trust} />
              <span className="text-right tabular-nums text-mist/80">{a.tasks24h}</span>
              <span className={`text-right tabular-nums ${a.success >= 98.5 ? "text-mist/80" : "text-amber-300"}`}>{a.success}%</span>
              <span className="text-right tabular-nums text-volt/90">{a.earned30d.toFixed(1)}</span>
              <span className="text-right tabular-nums text-mist/70">{a.stake.toLocaleString()}</span>
              <span className="text-right">
                {a.mine ? (
                  <span className="text-[8.5px] tracking-[0.14em] text-mute/60">
                    CAP {d.limits.perAgent[a.id] ?? 250}/D
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      if (hired.includes(a.id)) return;
                      setHired((h) => [...h, a.id]);
                      d.hire(a.name);
                    }}
                    className={`ml-auto flex h-6 items-center gap-1 border px-2 text-[8px] tracking-[0.14em] transition-colors ${
                      hired.includes(a.id) ? "border-volt bg-volt text-void" : "border-edge2 text-mute hover:border-volt/60 hover:text-volt"
                    }`}
                  >
                    {hired.includes(a.id) ? <Check size={10} strokeWidth={3} /> : <Plus size={10} />}
                    {hired.includes(a.id) ? "HIRED" : "HIRE"}
                  </button>
                )}
              </span>
              <span className="text-right">
                {a.mine && (
                  <button
                    onClick={() => {
                      d.toggleAgent(a.id);
                      d.toast(online ? `${a.name} PAUSED` : `${a.name} RESUMED`);
                    }}
                    className={`ml-auto flex h-6 w-6 items-center justify-center border transition-colors ${
                      online ? "border-edge2 text-mute hover:border-red-400/60 hover:text-red-400" : "border-volt/60 text-volt"
                    }`}
                  >
                    {online ? <Pause size={10} /> : <Play size={10} />}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-edge px-4 py-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
        SCORES WRITE ON EVERY SETTLEMENT · TRUST IS COMPUTE, NOT REVIEW
      </div>
    </div>
  );
}

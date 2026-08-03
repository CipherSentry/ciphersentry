import { Check, Plus, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useApp } from "../store";
import { SectionLabel, Spark, Tag } from "../ui";

const FILTERS = ["ALL", "RENDER", "SCRAPE", "EMBED", "AUDIT"] as const;

const TIER_TONE: Record<string, "volt" | "mist" | "dim"> = { T3: "volt", T2: "volt", T1: "mist", T0: "dim" };

export default function Registry() {
  const app = useApp();
  const [q, setQ] = useState("");
  const [f, setF] = useState<(typeof FILTERS)[number]>("ALL");
  const [hired, setHired] = useState<string[]>([]);

  const list = app.agents.filter((a) => {
    const matchQ = (a.name + a.specialty).toLowerCase().includes(q.toLowerCase());
    const matchF = f === "ALL" || a.specialty === f;
    return matchQ && matchF;
  });

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-10">
      <div className="px-5 pb-2 pt-5">
        <div className="font-mono text-[9px] tracking-[0.26em] text-mute">REGISTRY / 214 AGENTS</div>
        <div className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em]">Hire an agent</div>
      </div>

      {/* search */}
      <div className="px-5 pt-3">
        <div className="flex items-center gap-3 border border-edge2 bg-panel/60 px-4 py-3 focus-within:border-volt/60">
          <Search size={14} className="text-mute" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="name or capability…"
            spellCheck={false}
            className="w-full bg-transparent font-mono text-[12px] text-mist placeholder:text-mute/40 focus:outline-none"
          />
        </div>
        <div className="mt-3 flex gap-1.5">
          {FILTERS.map((c) => (
            <button
              key={c}
              onClick={() => setF(c)}
              className={`border px-3 py-2 font-mono text-[9px] tracking-[0.16em] transition-colors ${
                f === c ? "border-volt/70 bg-volt/10 text-volt" : "border-edge2 text-mute active:border-mute"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5">
        <SectionLabel
          right={<span className="font-mono text-[8.5px] tracking-[0.18em] text-mute/50">{list.length} RESULTS</span>}
        >
          AGENTS — SORTED BY TRUST
        </SectionLabel>
      </div>

      <div className="border-t border-edge">
        {list.map((a) => (
          <div key={a.id} className="border-b border-edge">
            <button onClick={() => app.open({ s: "agent", id: a.id })} className="flex w-full items-center gap-3.5 px-5 py-4 text-left active:bg-panel">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-edge2 bg-panel/60 font-mono text-[13px] font-semibold text-volt">
                {a.id[0].toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-mono text-[12px] font-semibold text-mist">{a.name}</span>
                  <Tag tone={TIER_TONE[a.tier]} className="px-1.5 py-0.5 text-[7.5px]">{a.tier}</Tag>
                </span>
                <span className="mt-1 flex items-center gap-2 font-mono text-[8.5px] tracking-[0.14em] text-mute">
                  <span>{a.specialty}</span>
                  <span className="text-mute/40">·</span>
                  <span>{a.rate.toFixed(2)} USDC/TASK</span>
                  <span className="text-mute/40">·</span>
                  <span className="text-mist/60">{a.success}%</span>
                </span>
                <span className="mt-2 block w-24">
                  <Spark data={a.spark} />
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (hired.includes(a.id)) return;
                  setHired((h) => [...h, a.id]);
                  app.hire(a.name);
                }}
                className={`flex h-9 w-9 shrink-0 items-center justify-center border transition-colors ${
                  hired.includes(a.id)
                    ? "border-volt bg-volt text-void"
                    : "border-edge2 text-mute active:border-volt active:text-volt"
                }`}
              >
                {hired.includes(a.id) ? <Check size={14} strokeWidth={3} /> : <Plus size={14} />}
              </button>
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 px-5 pt-6 font-mono text-[8px] tracking-[0.2em] text-mute/40">
        <ShieldCheck size={11} className="text-volt/50" />
        EVERY AGENT STAKES CAPITAL. INVALID OUTPUT GETS SLASHED.
      </div>
    </div>
  );
}

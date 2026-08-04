import { ChevronRight, OctagonAlert, Radio, Scale, TrendingUp } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { timeAgo } from "../data";
import { useApp } from "../store";
import { SectionLabel, Stat, StateDot } from "../ui";
import { CipherSentry } from "../../sdk/ciphersentry";
import { describeTransport } from "../../sdk/livePath";

const cent = CipherSentry.shared();

export default function Feed() {
  const app = useApp();
  const { feed, approvals, now } = app;
  const hud = describeTransport(cent.transport);
  const streamLabel = hud.sessionLine ?? hud.primary;
  const dotTone =
    hud.tone === "volt" ? "bg-volt" : hud.tone === "amber" ? "bg-amber-300" : hud.tone === "red" ? "bg-red-400" : "bg-mute";

  return (
    <div className="no-scrollbar h-full overflow-y-auto pb-6">
      {/* app bar */}
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <div>
          <div className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em]">
            Live trace
          </div>
          {hud.kind === "rpc" && (
            <div className="mt-1 font-mono text-[8px] tracking-[0.16em] text-mute/70" title={hud.node}>
              {hud.secondary}
              {hud.sessionLine ? ` · ${hud.sessionLine}` : ""}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-2 py-2 font-mono text-[8.5px] tracking-[0.2em] text-mute">
          <span className={`h-1.5 w-1.5 ${dotTone}`} />
          {streamLabel}
        </div>
      </div>

      {/* ---- hero: interventions ---- */}
      <div className="px-5 pt-3">
        {approvals.length > 0 ? (
          <div className="border border-volt/50 bg-deepgreen">
            <div className="flex items-center justify-between border-b border-volt/30 px-4 py-3">
            <span className="flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] text-volthot">
              <OctagonAlert size={13} />
              NEEDS YOU ({approvals.length})
            </span>
              <span className="font-mono text-[8.5px] tracking-[0.2em] text-mute">HMN-IN-LOOP</span>
            </div>
            {approvals.map((a) => (
              <button
                key={a.id}
                onClick={() => app.open({ s: "dispute", id: a.id })}
                className="flex w-full items-center gap-3 border-b border-volt/20 px-4 py-3.5 text-left transition-colors last:border-b-0 active:bg-volt/10"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-volt/50 text-volt">
                  {a.type === "DISPUTE" ? <Scale size={13} /> : <TrendingUp size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-mist">
                    {a.type === "DISPUTE" ? "Dispute " : "Limit "}
                    <span className="text-volt">{a.ref}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-mute">{a.summary}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-volt" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 border border-edge bg-panel/40 px-4 py-3.5">
            <span className="h-2 w-2 bg-volt" />
            <div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-mist">QUEUE CLEAR</div>
              <div className="mt-0.5 text-[11px] text-mute">No interventions. Agents are autonomous.</div>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 px-5 pt-6">
        <Stat label="SPEND 24H" value={`${app.wallet.spent.toFixed(0)}`} />
        <Stat label="EARNED 24H" value={`${app.wallet.earned.toFixed(0)}`} tone="volt" />
        <Stat label="ACTIVE" value={String(feed.filter((t) => t.state === "RUNNING" || t.state === "VERIFYING").length).padStart(2, "0")} />
      </div>

      {/* live stream */}
      <div className="px-5">
        <SectionLabel
          right={
            <span className="flex items-center gap-1.5 font-mono text-[8.5px] tracking-[0.2em] text-volt/70">
              <Radio size={10} className="animate-pulse" /> STREAMING
            </span>
          }
        >
          LIVE TASK TRACE
        </SectionLabel>
      </div>

      <motion.div layout className="border-t border-edge">
        <AnimatePresence initial={false}>
          {feed.map((t) => (
            <motion.button
              layout
              key={t.id}
              initial={{ opacity: 0, y: -18, backgroundColor: "rgba(198,255,65,0.10)" }}
              animate={{ opacity: 1, y: 0, backgroundColor: "rgba(198,255,65,0)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => app.open({ s: "task", id: t.id })}
              className="flex w-full items-center gap-3 border-b border-edge px-5 py-3.5 text-left"
            >
              <StateDot state={t.state} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-mono text-[11.5px] text-mist">{t.spec}</span>
                </span>
                <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.08em] text-mute">
                  <span className="truncate">{t.agent.replace("agent:", "")}</span>
                  <span className="text-mute/40">{t.role === "work" ? "→" : "←"}</span>
                  <span className="truncate">{t.counterparty.replace("agent:", "")}</span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block font-mono text-[11.5px] font-semibold tabular-nums ${t.role === "work" ? "text-volt" : "text-mist/80"}`}>
                  {t.role === "work" ? "+" : "−"}{t.amount}
                </span>
                <span className="mt-0.5 block font-mono text-[8.5px] tracking-[0.14em] text-mute/60">
                  {timeAgo(t.at, now)} ago
                </span>
              </span>
            </motion.button>
          ))}
        </AnimatePresence>
      </motion.div>


    </div>
  );
}

import { Activity, Bell, Compass, Wallet } from "lucide-react";
import { useApp } from "./store";
import type { Tab } from "./store";

export function StatusBar({ now }: { now: number }) {
  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return (
    <div className="relative z-[60] flex items-center justify-between px-7 pb-1 pt-3.5">
      <span className="font-mono text-[11px] font-semibold tabular-nums tracking-wide text-mist">
        {hh}:{mm}
      </span>
      {/* dynamic island */}
      <span className="absolute left-1/2 top-2 h-[22px] w-24 -translate-x-1/2 rounded-full bg-black ring-1 ring-edge/80" />
      <span className="flex items-center gap-1.5 text-mist/80">
        <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor"><rect x="0" y="6" width="2.5" height="4" rx="0.5"/><rect x="4" y="4" width="2.5" height="6" rx="0.5"/><rect x="8" y="2" width="2.5" height="8" rx="0.5"/><rect x="12" y="0" width="2.5" height="10" rx="0.5" opacity="0.4"/></svg>
        <svg width="13" height="10" viewBox="0 0 13 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 3.5a8 8 0 0 1 11 0"/><path d="M3 6a5 5 0 0 1 7 0"/><circle cx="6.5" cy="8.5" r="0.9" fill="currentColor" stroke="none"/></svg>
        <svg width="20" height="10" viewBox="0 0 20 10" fill="none"><rect x="0.5" y="0.5" width="16" height="9" rx="2.5" stroke="currentColor" opacity="0.5"/><rect x="2" y="2" width="11" height="6" rx="1.5" fill="#3dff36"/><path d="M18.5 3.5v3" stroke="currentColor" opacity="0.5"/></svg>
      </span>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "feed", label: "TRACE", icon: Activity },
  { id: "registry", label: "REGISTRY", icon: Compass },
  { id: "wallet", label: "WALLET", icon: Wallet },
  { id: "alerts", label: "ALERTS", icon: Bell },
];

export function TabBar() {
  const app = useApp();
  return (
    <div className="absolute inset-x-0 bottom-0 z-40 border-t border-edge bg-void/92 backdrop-blur-xl">
      <div className="grid grid-cols-4">
        {TABS.map((t) => {
          const active = app.tab === t.id && app.overlays.length === 0;
          const badge = t.id === "feed" ? app.approvals.length : t.id === "alerts" ? app.alerts.filter((a) => a.sev === "CRIT").length : 0;
          return (
            <button key={t.id} onClick={() => app.setTab(t.id)} className="relative flex flex-col items-center gap-1.5 pb-5 pt-3">
              {active && <span className="absolute top-0 h-0.5 w-8 bg-volt" />}
              <span className="relative">
                <t.icon size={17} strokeWidth={active ? 2.2 : 1.6} className={active ? "text-volt" : "text-mute"} />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center bg-red-500 px-1 font-mono text-[8px] font-bold text-void">
                    {badge}
                  </span>
                )}
              </span>
              <span className={`font-mono text-[7.5px] tracking-[0.24em] ${active ? "text-volt" : "text-mute/60"}`}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

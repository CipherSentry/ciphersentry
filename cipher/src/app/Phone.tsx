import { Activity, Bell, Compass, Wallet } from "lucide-react";
import { useApp } from "./store";
import type { Tab } from "./store";

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "feed", label: "TRACE", icon: Activity },
  { id: "registry", label: "REGISTRY", icon: Compass },
  { id: "wallet", label: "WALLET", icon: Wallet },
  { id: "alerts", label: "ALERTS", icon: Bell },
];

/** Bottom tab dock — safe-area aware, no phone chrome. */
export function AppNav() {
  const app = useApp();
  return (
    <nav
      className="z-40 shrink-0 border-t border-edge bg-void/95 backdrop-blur-xl"
      style={{ paddingBottom: "max(0.55rem, env(safe-area-inset-bottom, 0px))" }}
      aria-label="Operator tabs"
    >
      <div className="grid grid-cols-4">
        {TABS.map((t) => {
          const active = app.tab === t.id && app.overlays.length === 0;
          const badge =
            t.id === "feed"
              ? app.approvals.length
              : t.id === "alerts"
                ? app.alerts.filter((a) => a.sev === "CRIT").length
                : 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => app.setTab(t.id)}
              className="relative flex flex-col items-center gap-1 px-1 pb-2.5 pt-2.5"
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span className="absolute inset-x-1/4 top-0 h-0.5 bg-volt" aria-hidden />
              )}
              <span className="relative">
                <t.icon
                  size={17}
                  strokeWidth={active ? 2.2 : 1.6}
                  className={active ? "text-volt" : "text-mute"}
                />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center bg-red-500 px-1 font-mono text-[8px] font-bold text-void">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              <span
                className={`font-mono text-[7.5px] tracking-[0.2em] ${
                  active ? "text-volt" : "text-mute/60"
                }`}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

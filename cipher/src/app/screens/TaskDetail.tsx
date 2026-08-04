import { Check, OctagonAlert, Scale, X } from "lucide-react";
import { timeAgo } from "../data";
import { useApp } from "../store";
import { BackHeader, Card, HashLine, SectionLabel, STATE_TONE, Tag } from "../ui";

const VOTERS = ["vrf:gamma-1", "vrf:delta-4", "vrf:sigma-2"];

export default function TaskDetail({ id }: { id: string }) {
  const app = useApp();
  const t = app.feed.find((f) => f.id === id);
  if (!t) {
    return (
      <div className="h-full bg-void">
        <BackHeader title="TASK LOST" onBack={app.close} />
        <div className="p-6 font-mono text-[11px] text-mute">Task left the live window.</div>
      </div>
    );
  }

  const disputed = t.state === "DISPUTED";
  const approval = app.approvals.find((a) => a.ref === t.id);

  const steps = ["COMMITTED", "EXECUTING", "VERIFYING", "SETTLED"] as const;
  const activeIdx =
    t.state === "RUNNING" ? 1 : t.state === "VERIFYING" ? 2 : t.state === "SETTLED" ? 3 : 2;

  return (
    <div className="no-scrollbar h-full overflow-y-auto bg-void pb-6">
      <BackHeader title={t.id} sub="ESCROW / TASK DETAIL" onBack={app.close} />

      <div className="px-5 pt-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[9px] tracking-[0.26em] text-mute">{t.spec.toUpperCase()}</div>
            <div className="mt-2 font-display text-[38px] font-medium tabular-nums tracking-[-0.03em]">
              {t.amount}
              <span className="ml-2 font-mono text-[12px] text-mute">USDC</span>
            </div>
          </div>
          <Tag tone={STATE_TONE[t.state]}>{t.state}</Tag>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px border border-edge bg-edge">
          <div className="bg-void p-3.5">
            <div className="font-mono text-[8px] tracking-[0.22em] text-mute">{t.role === "work" ? "BUYER" : "CLIENT"}</div>
            <div className="mt-1 truncate font-mono text-[11px] text-mist">{t.counterparty}</div>
          </div>
          <div className="bg-void p-3.5">
            <div className="font-mono text-[8px] tracking-[0.22em] text-mute">{t.role === "work" ? "WORKER (MINE)" : "MY AGENT"}</div>
            <div className="mt-1 truncate font-mono text-[11px] text-volt">{t.agent}</div>
          </div>
        </div>

        {/* state timeline */}
        <div className="mt-6 flex items-center">
          {steps.map((s, i) => (
            <div key={s} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span className={`h-2 w-2 ${i <= activeIdx ? (disputed && i === activeIdx ? "bg-red-400" : "bg-volt") : "border border-edge2"}`} />
                <span className={`mt-2 font-mono text-[7px] tracking-[0.14em] ${i <= activeIdx ? "text-mist" : "text-mute/50"}`}>{s}</span>
              </div>
              {i < steps.length - 1 && <div className={`mx-1.5 mb-4 h-px flex-1 ${i < activeIdx ? "bg-volt/50" : "bg-edge"}`} />}
            </div>
          ))}
        </div>
        <div className="mt-2 text-right font-mono text-[8.5px] tracking-[0.16em] text-mute/60">
          OPENED {timeAgo(t.at, app.now)} AGO
        </div>

        {/* verification proof */}
        <SectionLabel>VERIFICATION PROOF</SectionLabel>
        <Card className="px-4 py-1.5">
          <HashLine label="REPORTED HASH" value={t.hash} ok={disputed ? false : undefined} />
          <HashLine label="RECOMPUTED" value={disputed ? "0x9af2be…77c1" : t.hash} ok={disputed ? true : undefined} />
          <HashLine label="MERKLE ANCHOR" value="0x71be0c…e8d3" />
          <HashLine label="PROOF BLOCK" value="#12,840,117" />
        </Card>

        <div className="mt-3 flex items-center justify-between border border-edge bg-panel/40 px-4 py-3">
          <span className="font-mono text-[9px] tracking-[0.22em] text-mute">VERIFIER QUORUM</span>
          <span className="flex items-center gap-2">
            {VOTERS.map((v, i) => (
              <span
                key={v}
                title={v}
                className={`flex h-6 w-6 items-center justify-center border ${
                  disputed && i === 0 ? "border-red-400/60 text-red-400" : "border-volt/50 text-volt"
                }`}
              >
                {disputed && i === 0 ? <X size={10} /> : <Check size={10} />}
              </span>
            ))}
            <span className={`font-mono text-[11px] font-semibold ${disputed ? "text-red-400" : "text-volt"}`}>
              {disputed ? "2/3" : "3/3"}
            </span>
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between border border-edge bg-panel/40 px-4 py-3 font-mono text-[10px]">
          <span className="tracking-[0.22em] text-mute">RECOMPUTE TIME</span>
          <span className="text-mist">412ms · deterministic</span>
        </div>

        {/* disputed → intervention CTA */}
        {disputed && (
          approval ? (
            <button
              onClick={() => app.open({ s: "dispute", id: approval.id })}
              className="mt-6 flex w-full items-center justify-center gap-2.5 border border-volt bg-volt py-4 font-mono text-[11px] font-semibold tracking-[0.22em] text-void transition-colors active:bg-mist"
            >
              <Scale size={14} /> OPEN INTERVENTION
            </button>
          ) : (
            <div className="mt-6 flex items-center gap-3 border border-edge bg-panel/40 px-4 py-3.5">
              <Check size={13} className="text-volt" />
              <span className="font-mono text-[10px] tracking-[0.18em] text-mute">INTERVENTION RESOLVED — RULING BROADCAST</span>
            </div>
          )
        )}

        {!disputed && t.state === "SETTLED" && (
          <div className="mt-6 flex items-center gap-3 border border-edge bg-panel/40 px-4 py-3.5">
            <Check size={13} className="text-volt" />
            <span className="font-mono text-[10px] tracking-[0.18em] text-mute">ESCROW RELEASED · RECEIPT ON AGENT GRAPH</span>
          </div>
        )}
        {t.state === "FAILED" && (
          <div className="mt-6 flex items-center gap-3 border border-red-400/40 bg-red-400/[0.06] px-4 py-3.5">
            <OctagonAlert size={13} className="text-red-400" />
            <span className="font-mono text-[10px] tracking-[0.18em] text-red-400/90">EXECUTION TIMED OUT — ESCROW REFUNDED</span>
          </div>
        )}
      </div>
    </div>
  );
}

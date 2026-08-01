import { Check, ChevronRight, Scale, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { timeAgo } from "../app/data";
import { HashLine, HoldButton, Tag } from "../app/ui";
import { signRuling } from "../crypto/keys";
import type { SignedRuling } from "../crypto/keys";
import { useOperator } from "../crypto/useOperator";
import { useDesk } from "./store";
import { Panel } from "./widgets";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const RULINGS = [
  { id: "REFUND BUYER", d: "Escrow returns to buyer. Worker trust −4, stake slashed 5%." },
  { id: "RELEASE TO WORKER", d: "Worker paid in full. Buyer trust −2. Overrules quorum." },
  { id: "SPLIT 50/50", d: "Escrow halves. Both trust scores −1. Rare, but honest." },
];

export default function Intervene() {
  const d = useDesk();
  const op = useOperator();
  const [ruling, setRuling] = useState<string | null>(null);
  const [sig, setSig] = useState<SignedRuling | null>(null);
  const a = d.approvals.find((x) => x.id === d.selException) ?? d.approvals[0];

  const sign = async () => {
    if (!a || !ruling || !op.key) return;
    const signed = await signRuling(
      {
        ruling,
        type: a.type,
        ref: a.ref,
        escrow: a.amount ? `${a.amount} USDC` : undefined,
        agent: a.agent,
        buyer: a.counterparty,
      },
      op.key,
    );
    setSig(signed);
    setTimeout(() => {
      d.resolveApproval(a.id, `RULING SIGNED: ${ruling} · ${signed.fp}`, ruling);
      if (a.type === "DISPUTE") d.settleFeedItem(a.ref, ruling === "REFUND BUYER" ? "FAILED" : "SETTLED");
      if (a.type === "LIMIT") d.setAgentLimit(a.ref.replace("agent:", ""), a.to ?? 500);
      setSig(null);
      setRuling(null);
    }, 1900);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[330px_minmax(0,1fr)] divide-x divide-edge">
      {/* inbox */}
      <div className="flex min-h-0 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge px-3">
          <span className="font-mono text-[8.5px] tracking-[0.24em] text-mute">EXCEPTION INBOX</span>
          <span className="font-mono text-[9px] text-red-400">{d.approvals.length} OPEN</span>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          {d.approvals.map((x) => {
            const sel = a?.id === x.id;
            return (
              <button
                key={x.id}
                onClick={() => { d.setSelException(x.id); setRuling(null); setSig(null); }}
                className={`flex w-full items-start gap-3 border-b border-edge px-3 py-3.5 text-left transition-colors hover:bg-panel/60 ${
                  sel ? "bg-deepgreen shadow-[inset_2px_0_0_#3dff36]" : ""
                }`}
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border ${
                  x.type === "DISPUTE" ? "border-red-400/60 text-red-400" : "border-amber-300/50 text-amber-300"
                }`}>
                  {x.type === "DISPUTE" ? <Scale size={12} /> : <TrendingUp size={12} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[10.5px] text-mist">{x.ref}</span>
                    <span className="shrink-0 font-mono text-[8px] text-mute/50">{timeAgo(x.at, d.now)}</span>
                  </span>
                  <span className="mt-1 block truncate text-[10.5px] leading-relaxed text-mute">{x.summary}</span>
                  <span className="mt-1.5 flex items-center gap-2 font-mono text-[7.5px] tracking-[0.16em]">
                    <span className={x.type === "DISPUTE" ? "text-red-400" : "text-amber-300"}>{x.type}</span>
                    <span className="text-mute/40">·</span>
                    <span className="text-mute/60">{x.agent}</span>
                  </span>
                </span>
                <ChevronRight size={12} className={`mt-1 shrink-0 ${sel ? "text-volt" : "text-mute/30"}`} />
              </button>
            );
          })}

          {d.approvals.length === 0 && (
            <div className="px-4 py-8 text-center font-mono text-[9px] leading-[2] tracking-[0.18em] text-mute/50">
              INBOX ZERO.
              <br />
              THE MACHINES ARE FINE.
            </div>
          )}

          {/* resolved log */}
          <div className="border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.22em] text-mute/50">
            RESOLVED — SIGNED BY YOU
          </div>
          {d.resolved.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-edge/60 px-3 py-2.5">
              <Check size={11} className="shrink-0 text-volt" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[9.5px] text-mute">{r.ref} → {r.ruling}</span>
                <span className="mt-0.5 block font-mono text-[7.5px] text-mute/40">{r.tx} · {timeAgo(r.at, d.now)} AGO</span>
              </span>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.16em] text-mute/50">
          MTTR 4M 12S · YOU ARE PULLED IN ONLY WHEN MATH DISAGREES
        </div>
      </div>

      {/* detail */}
      <div className="no-scrollbar min-h-0 overflow-y-auto p-5">
        <AnimatePresence mode="wait">
          {sig ? (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full flex-col items-center justify-center gap-4">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 16 }} className="flex h-16 w-16 items-center justify-center border border-volt bg-volt/15">
                <Check size={28} className="text-volt" />
              </motion.span>
              <div className="font-display text-[24px] font-semibold">Ruling signed & broadcast</div>
              <div className="w-full max-w-[380px] border border-volt/40 bg-deepgreen p-4 font-mono text-[9.5px] leading-[2]">
                <div className="flex justify-between gap-4"><span className="tracking-[0.14em] text-mute">SIG</span><span className="truncate text-[#fff1e6]">{sig.sig.slice(0, 24)}…{sig.sig.slice(-8)}</span></div>
                <div className="flex justify-between gap-4"><span className="tracking-[0.14em] text-mute">CANONICAL</span><span className="truncate text-mist/50">{sig.canonical.slice(0, 30)}…</span></div>
                <div className="flex justify-between gap-4"><span className="tracking-[0.14em] text-mute">KEY</span><span className="text-volt">{sig.fp}</span></div>
                <div className="flex justify-between gap-4"><span className="tracking-[0.14em] text-mute">ALG</span><span className="text-[#fff1e6]">{sig.algLabel}</span></div>
                <div className="flex justify-between gap-4"><span className="tracking-[0.14em] text-mute">TX</span><span className="text-[#fff1e6]">{sig.tx}</span></div>
                <div className="mt-1.5 flex items-center justify-between border-t border-volt/25 pt-1.5">
                  <span className="tracking-[0.14em] text-mute">LOCAL VERIFY</span>
                  <span className="flex items-center gap-1.5 text-volt"><Check size={11} strokeWidth={3} /> VALID — WEBCRYPTO</span>
                </div>
              </div>
              <div className="font-mono text-[9px] tracking-[0.18em] text-mute/60">ESCROW SETTLING &lt; 500MS · RECEIPT WRITES TO AGENT GRAPH</div>
            </motion.div>
          ) : a ? (
            <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.24em] text-mute">
                    {a.type} · REF <span className="text-mist">{a.ref}</span>
                  </div>
                  <div className="mt-2 font-display text-[28px] font-semibold tracking-[-0.02em]">
                    {a.type === "DISPUTE" ? "Quorum rejected the output hash" : "Spend-limit raise requested"}
                  </div>
                </div>
                <Tag tone={a.type === "DISPUTE" ? "red" : "amber"}>{a.type === "DISPUTE" ? "CRIT" : "WARN"}</Tag>
              </div>

              {a.type === "DISPUTE" ? (
                <>
                  <div className="mt-5 grid grid-cols-2 gap-px border border-edge bg-edge">
                    <div className="bg-[#0a0d08] p-3.5 font-mono">
                      <div className="text-[8px] tracking-[0.22em] text-mute">WORKER (MINE)</div>
                      <div className="mt-1.5 text-[11px] text-volt">{a.agent}</div>
                      <div className="mt-0.5 text-[8.5px] text-mute/50">TRUST 91 · STAKE 850</div>
                    </div>
                    <div className="bg-[#0a0d08] p-3.5 font-mono">
                      <div className="text-[8px] tracking-[0.22em] text-mute">BUYER · ESCROW LOCKED</div>
                      <div className="mt-1.5 text-[11px] text-mist">{a.counterparty}</div>
                      <div className="mt-0.5 text-[8.5px] text-volt">{a.amount} USDC</div>
                    </div>
                  </div>

                  <Panel title="EVIDENCE — BYTE COMPARISON" className="mt-4 border-edge" bodyClass="overflow-visible">
                    <div className="grid grid-cols-[1fr_1fr] gap-4 px-4 pt-3">
                      <div>
                        <div className="font-mono text-[8px] tracking-[0.2em] text-mute">QUORUM RECOMPUTED · 2/3</div>
                        <div className="mt-1.5 border border-volt/40 bg-volt/[0.04] px-3 py-2.5 font-mono text-[12px] text-mist">
                          0x9af2be…<span className="bg-volt/20 px-1 text-volt">77c1</span>
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[8px] tracking-[0.2em] text-mute">WORKER REPORTED</div>
                        <div className="mt-1.5 border border-red-400/40 bg-red-400/[0.04] px-3 py-2.5 font-mono text-[12px] text-mist">
                          0x9af2be…<span className="bg-red-400/20 px-1 text-red-400">99d4</span>
                        </div>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <HashLine label="SPEC" value="embed.kb.nightly" />
                      <HashLine label="MERKLE ANCHOR" value="0x71be0c…e8d3" />
                      <HashLine label="FRAUD-PROOF WINDOW" value="61 / 64 BLOCKS LEFT" ok={false} />
                    </div>
                    <div className="flex items-center gap-2 border-t border-edge px-4 py-2.5 font-mono text-[8.5px] tracking-[0.14em]">
                      <span className="text-mute">VOTES:</span>
                      {[{ v: "gamma-1", ok: false }, { v: "delta-4", ok: true }, { v: "sigma-2", ok: true }].map((x) => (
                        <span key={x.v} className={`flex items-center gap-1 border px-1.5 py-0.5 ${x.ok ? "border-volt/40 text-volt" : "border-red-400/50 text-red-400"}`}>
                          {x.ok ? <Check size={9} /> : <X size={9} />} {x.v}
                        </span>
                      ))}
                    </div>
                  </Panel>
                </>
              ) : (
                <Panel title="UTILIZATION" className="mt-4 border-edge" bodyClass="overflow-visible px-4 py-3">
                  <div className="flex items-baseline gap-3 font-mono">
                    <span className="text-[24px] font-semibold tabular-nums text-mist">{a.from}</span>
                    <span className="text-mute">→</span>
                    <span className="text-[24px] font-semibold tabular-nums text-volt">{a.to}</span>
                    <span className="text-[9px] tracking-[0.18em] text-mute">USDC/DAY</span>
                  </div>
                  <div className="mt-4 flex justify-between font-mono text-[8px] tracking-[0.18em] text-mute">
                    <span>{a.usagePct}% OF CURRENT CAP · SPENT 230.10 TODAY</span>
                    <span className="text-amber-300">APPROACHING</span>
                  </div>
                  <div className="mt-2 h-2 w-full bg-edge"><div className="h-full bg-amber-300" style={{ width: `${a.usagePct}%` }} /></div>
                  <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-[9px]">
                    {[["TRUST", "88 · T1"], ["FAILED VERIFS 30D", "0"], ["NEW EXPOSURE", "+250/DAY"]].map(([k, v]) => (
                      <div key={k} className="border border-edge px-3 py-2.5">
                        <div className="text-[7.5px] tracking-[0.18em] text-mute/60">{k}</div>
                        <div className="mt-1 tabular-nums text-mist">{v}</div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* ruling */}
              <Panel title={a.type === "DISPUTE" ? "RULING — YOUR SIGNATURE SETTLES THE ESCROW" : "DECISION"} className="mt-4 border-edge" bodyClass="overflow-visible">
                <div className="grid grid-cols-3 gap-px border-b border-edge bg-edge">
                  {(a.type === "DISPUTE" ? RULINGS : [
                    { id: `APPROVE ${a.to}/DAY`, d: "New cap signed into agent config next epoch." },
                    { id: `HOLD AT ${a.from}`, d: "Request denied. Agent routes within current cap." },
                    { id: `APPROVE FOR 7D`, d: "Temporary raise, auto-reverts after one week." },
                  ]).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRuling(r.id)}
                      className={`p-3.5 text-left transition-colors ${ruling === r.id ? "bg-volt/[0.07]" : "bg-[#0a0d08] hover:bg-panel/60"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-[9.5px] font-semibold tracking-[0.14em] ${ruling === r.id ? "text-volt" : "text-mist"}`}>{r.id}</span>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center border ${ruling === r.id ? "border-volt bg-volt text-void" : "border-edge2"}`}>
                          {ruling === r.id && <Check size={10} strokeWidth={3} />}
                        </span>
                      </div>
                      <div className="mt-2 text-[10px] leading-[1.6] text-mute">{r.d}</div>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_300px] gap-4 px-4 py-4">
                  <div className="font-mono text-[9px] leading-[1.9] tracking-[0.1em] text-mute">
                    <div className="flex justify-between gap-6"><span>SIGNING KEY</span><span className="text-volt">{op.key ? `${op.key.fp} · ${op.key.algLabel}` : "GENERATING…"}</span></div>
                    <div className="flex justify-between gap-6"><span>NETWORK FEE</span><span className="text-mist">0.0004 USDC</span></div>
                    <div className="flex justify-between gap-6"><span>REVERSIBLE</span><span className="text-red-400">NEVER — FINALITY INSTANT</span></div>
                  </div>
                  <HoldButton label={ruling ? `HOLD TO SIGN — ${ruling.split(" ")[0]}` : "SELECT A RULING FIRST"} onDone={sign} className={ruling ? "" : "pointer-events-none opacity-40"} />
                </div>
              </Panel>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full items-center justify-center font-mono text-[10px] tracking-[0.2em] text-mute/50">
              ← NOTHING OPEN. WATCH, DON'T TOUCH.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

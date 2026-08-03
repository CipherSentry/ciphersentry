import { Check, Gavel, Scale, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { timeAgo } from "../data";
import type { Approval } from "../data";
import { useApp } from "../store";
import { BackHeader, Card, HoldButton, SectionLabel } from "../ui";
import { signRuling } from "../../crypto/keys";
import type { SignedRuling } from "../../crypto/keys";
import { useOperator } from "../../crypto/useOperator";
import { CipherSentry } from "../../sdk/ciphersentry";
import { formatWireError, isRpcMode } from "../../sdk/livePath";

const cent = CipherSentry.shared();

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ---------- simpler intervention: spend-limit raise ---------- */

function LimitSheet({ a }: { a: Approval }) {
  const app = useApp();
  const op = useOperator();
  const [done, setDone] = useState(false);
  const [sig, setSig] = useState<SignedRuling | null>(null);

  const finish = async (approved: boolean) => {
    if (!op.key) return;
    const signed = await signRuling(
      {
        decision: approved ? "APPROVE_LIMIT" : "DENY_LIMIT",
        agent: a.agent,
        from: a.from,
        to: approved ? a.to : a.from,
      },
      op.key,
    );
    setSig(signed);
    setDone(true);
    setTimeout(() => {
      if (approved) app.setAgentLimit(a.ref.replace("agent:", ""), a.to ?? 500);
      app.resolveApproval(
        a.id,
        approved ? `LIMIT RAISED → ${a.to} USDC/DAY · SIG ${signed.fp}` : "REQUEST DENIED — CAP UNCHANGED",
      );
      app.close();
    }, 1700);
  };

  if (done) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 bg-void px-8 text-center">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="flex h-14 w-14 items-center justify-center border border-volt bg-volt/15"
        >
          <Check size={24} className="text-volt" />
        </motion.span>
        <div className="font-display text-[22px] font-semibold">Decision signed</div>
        {sig && (
          <div className="w-full max-w-[300px] border border-volt/40 bg-deepgreen p-3.5 text-left font-mono text-[9px] leading-[1.9]">
            <div className="flex justify-between gap-4"><span className="text-mute">SIG</span><span className="truncate text-mist">{sig.sig.slice(0, 18)}…{sig.sig.slice(-6)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-mute">KEY</span><span className="text-volt">{sig.fp}</span></div>
            <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-volt/25 pt-1.5">
              <span className="text-mute">LOCAL VERIFY</span>
              <span className="flex items-center gap-1 text-volt"><Check size={10} strokeWidth={3} /> VALID</span>
            </div>
          </div>
        )}
        <div className="font-mono text-[9.5px] tracking-[0.16em] text-mute">WRITE TO AGENT CONFIG IN NEXT EPOCH</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-void">
      <BackHeader title={`INTERVENTION / ${a.agent}`} sub={`LIMIT · FILED ${timeAgo(a.at, app.now)} AGO`} onBack={app.close} />
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-8 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center border border-volt/60 text-volt">
            <TrendingUp size={15} />
          </span>
          <div>
            <div className="font-display text-[19px] font-semibold">Spend-limit raise</div>
            <div className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-mute">AGENT ASKS BEFORE IT RUNS OUT, NOT AFTER</div>
          </div>
        </div>

        <div className="mt-6 flex items-baseline gap-3">
          <span className="font-mono text-[26px] font-semibold tabular-nums text-mist">{a.from}</span>
          <span className="font-mono text-[11px] text-mute">→</span>
          <span className="font-mono text-[26px] font-semibold tabular-nums text-volt">{a.to}</span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-mute">USDC / DAY</span>
        </div>

        <SectionLabel>USAGE TODAY</SectionLabel>
        <Card className="p-4">
          <div className="flex justify-between font-mono text-[9px] tracking-[0.18em] text-mute">
            <span>{a.usagePct}% OF CURRENT CAP</span>
            <span className="text-amber-300">APPROACHING</span>
          </div>
          <div className="mt-2.5 h-2 w-full bg-edge">
            <div className="h-full bg-amber-300" style={{ width: `${a.usagePct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-[9.5px]">
            <div className="border border-edge bg-void/60 px-3 py-2.5">
              <div className="text-[8px] tracking-[0.2em] text-mute/60">SPENT 24H</div>
              <div className="mt-1 tabular-nums text-mist">230.10 USDC</div>
            </div>
            <div className="border border-edge bg-void/60 px-3 py-2.5">
              <div className="text-[8px] tracking-[0.2em] text-mute/60">NEW EXPOSURE</div>
              <div className="mt-1 tabular-nums text-amber-300">+250 USDC/DAY</div>
            </div>
          </div>
        </Card>

        <Card className="mt-3 space-y-2.5 p-4 font-mono text-[10.5px]">
          <div className="flex justify-between"><span className="tracking-[0.16em] text-mute">AGENT</span><span className="text-mist">{a.agent}</span></div>
          <div className="flex justify-between"><span className="tracking-[0.16em] text-mute">TRUST / TIER</span><span className="text-mist">88 · T1</span></div>
          <div className="flex justify-between"><span className="tracking-[0.16em] text-mute">FAILED VERIFICATIONS 30D</span><span className="text-volt">0</span></div>
        </Card>

        <div className="mt-7 space-y-3">
          <HoldButton label={`HOLD TO APPROVE ${a.to}/DAY`} onDone={() => finish(true)} />
          <button
            onClick={() => finish(false)}
            className="w-full border border-red-400/50 py-4 font-mono text-[10.5px] tracking-[0.22em] text-red-400 transition-colors active:bg-red-400/10"
          >
            DENY — HOLD CAP AT {a.from}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DisputeFlow({ id }: { id: string }) {
  const app = useApp();
  const op = useOperator();
  const a = app.approvals.find((x) => x.id === id);
  const [step, setStep] = useState(0);
  const [ruling, setRuling] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [sig, setSig] = useState<SignedRuling | null>(null);

  if (!a) {
    return (
      <div className="flex h-full flex-col bg-void">
        <BackHeader title="INTERVENTION" onBack={app.close} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center border border-volt/60 bg-volt/10">
            <Check size={18} className="text-volt" />
          </span>
          <div className="font-mono text-[11px] tracking-[0.2em] text-mist">ALREADY RESOLVED</div>
          <p className="text-[12px] leading-relaxed text-mute">This ruling was signed and broadcast. The queue is updated.</p>
        </div>
      </div>
    );
  }

  if (a.type === "LIMIT") return <LimitSheet a={a} />;

  const finish = async (note: string) => {
    if (!op.key || !ruling) return;
    const signed = await signRuling(
      {
        ruling,
        task: a.ref,
        escrow: `${a.amount} USDC`,
        worker: a.agent,
        buyer: a.counterparty,
        quorum: "2/3",
      },
      op.key,
    );

    if (isRpcMode(cent.transport)) {
      try {
        await cent.operator.rule(a.ref, ruling, signed.sig);
      } catch (e) {
        app.toast(formatWireError(e));
        return;
      }
    }

    setSig(signed);
    setDone(true);
    setTimeout(() => {
      app.resolveApproval(a.id, `${note} · SIG ${signed.fp}`);
      app.settleFeedItem(a.ref, note.includes("REFUND") ? "FAILED" : "SETTLED");
      app.close();
    }, 1900);
  };

  const RULINGS = [
    { id: "REFUND", label: "REFUND BUYER", d: `${a.amount} USDC returns to ${a.counterparty}. Worker trust −4, stake slashed 5%.` },
    { id: "RELEASE", label: "RELEASE TO WORKER", d: `${a.agent} is paid in full. Buyer trust −2. Overrules the quorum.` },
    { id: "SPLIT", label: "SPLIT 50 / 50", d: "Escrow halves between parties. Both trust scores −1." },
  ];

  return (
    <div className="flex h-full flex-col bg-void">
      <BackHeader title={`INTERVENTION / ${a.ref}`} sub={`${a.type} · OPENED ${timeAgo(a.at, app.now)} AGO`} onBack={app.close} />

      {/* step dots */}
      <div className="flex items-center gap-2 px-5 pt-5">
        {["EVIDENCE", "RULING", "SIGN"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`h-1.5 w-6 ${step >= i ? "bg-volt" : "bg-edge2"}`} />
            <span className={`font-mono text-[8px] tracking-[0.2em] ${step >= i ? "text-mist" : "text-mute/50"}`}>{s}</span>
          </div>
        ))}
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-8 pt-6">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="ev" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.4, ease: EASE }}>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center border border-red-400/60 text-red-400">
                  <Scale size={15} />
                </span>
                <div>
                  <div className="font-display text-[19px] font-semibold">Hash mismatch at quorum</div>
                  <div className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-mute">2 OF 3 VERIFIERS REJECTED THE WORKER'S OUTPUT</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-px border border-edge bg-edge">
                <div className="bg-void p-3.5">
                  <div className="font-mono text-[8px] tracking-[0.2em] text-mute">WORKER (MINE)</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-volt">{a.agent}</div>
                </div>
                <div className="bg-void p-3.5">
                  <div className="font-mono text-[8px] tracking-[0.2em] text-mute">BUYER · ESCROW</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-mist">
                    {a.counterparty} · <span className="text-volt">{a.amount}</span>
                  </div>
                </div>
              </div>

              <SectionLabel>BYTE COMPARISON</SectionLabel>
              <Card className="space-y-3 p-4">
                <div>
                  <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">QUORUM RECOMPUTED</div>
                  <div className="mt-1.5 border border-volt/40 bg-volt/[0.05] px-3 py-2.5 font-mono text-[12px] text-mist">
                    0x9af2be…<span className="bg-volt/20 px-1 text-volt">77c1</span>
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[8.5px] tracking-[0.22em] text-mute">WORKER REPORTED</div>
                  <div className="mt-1.5 border border-red-400/40 bg-red-400/[0.05] px-3 py-2.5 font-mono text-[12px] text-mist">
                    0x9af2be…<span className="bg-red-400/20 px-1 text-red-400">99d4</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-red-400/90">
                  <X size={11} /> FINAL 16 BITS DIVERGE — NON-DETERMINISTIC OUTPUT
                </div>
              </Card>

              <SectionLabel>VERIFIER VOTES</SectionLabel>
              <div className="grid grid-cols-3 gap-px border border-edge bg-edge">
                {[{ v: "vrf:gamma-1", ok: false }, { v: "vrf:delta-4", ok: true }, { v: "vrf:sigma-2", ok: true }].map((x) => (
                  <div key={x.v} className="bg-void p-3 text-center">
                    <div className={`mx-auto flex h-6 w-6 items-center justify-center border ${x.ok ? "border-volt/50 text-volt" : "border-red-400/60 text-red-400"}`}>
                      {x.ok ? <Check size={10} /> : <X size={10} />}
                    </div>
                    <div className="mt-2 font-mono text-[8px] tracking-[0.1em] text-mute">{x.v}</div>
                    <div className={`mt-0.5 font-mono text-[8px] ${x.ok ? "text-volt" : "text-red-400"}`}>{x.ok ? "MATCH" : "MISMATCH"}</div>
                  </div>
                ))}
              </div>

              <button onClick={() => setStep(1)} className="mt-7 w-full border border-volt py-4 font-mono text-[10.5px] font-semibold tracking-[0.22em] text-volt transition-colors active:bg-volt active:text-void">
                PROCEED TO RULING →
              </button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="ru" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.4, ease: EASE }}>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center border border-volt/60 text-volt">
                  <Gavel size={15} />
                </span>
                <div>
                  <div className="font-display text-[19px] font-semibold">Rule on {a.amount} USDC</div>
                  <div className="mt-0.5 font-mono text-[9px] tracking-[0.18em] text-mute">YOUR SIGNATURE SETTLES THE ESCROW</div>
                </div>
              </div>

              <div className="mt-6 space-y-2.5">
                {RULINGS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRuling(r.id)}
                    className={`w-full border p-4 text-left transition-colors ${
                      ruling === r.id ? "border-volt bg-volt/[0.07]" : "border-edge2 bg-panel/40 active:border-mute"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-mono text-[11px] font-semibold tracking-[0.18em] ${ruling === r.id ? "text-volt" : "text-mist"}`}>
                        {r.label}
                      </span>
                      <span className={`flex h-5 w-5 items-center justify-center border ${ruling === r.id ? "border-volt bg-volt text-void" : "border-edge2"}`}>
                        {ruling === r.id && <Check size={11} strokeWidth={3} />}
                      </span>
                    </div>
                    <p className="mt-2 text-[11.5px] leading-[1.6] text-mute">{r.d}</p>
                  </button>
                ))}
              </div>

              <button
                onClick={() => ruling && setStep(2)}
                disabled={!ruling}
                className={`mt-7 w-full border py-4 font-mono text-[10.5px] font-semibold tracking-[0.22em] transition-colors ${
                  ruling ? "border-volt text-volt active:bg-volt active:text-void" : "cursor-not-allowed border-edge2 text-mute/40"
                }`}
              >
                REVIEW & SIGN →
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="sg" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.4, ease: EASE }}>
              {done ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 pt-10 text-center">
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    className="flex h-14 w-14 items-center justify-center border border-volt bg-volt/15"
                  >
                    <Check size={24} className="text-volt" />
                  </motion.span>
                  <div className="font-display text-[22px] font-semibold">Ruling signed & broadcast</div>
                  {sig && (
                    <div className="w-full max-w-[300px] border border-volt/40 bg-deepgreen p-3.5 text-left font-mono text-[9px] leading-[1.9]">
                      <div className="flex justify-between gap-4"><span className="text-mute">SIG</span><span className="truncate text-mist">{sig.sig.slice(0, 18)}…{sig.sig.slice(-6)}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-mute">KEY</span><span className="text-volt">{sig.fp}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-mute">ALG</span><span className="text-mist">{sig.algLabel}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-mute">TX</span><span className="text-mist">{sig.tx}</span></div>
                      <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-volt/25 pt-1.5">
                        <span className="text-mute">LOCAL VERIFY</span>
                        <span className="flex items-center gap-1 text-volt"><Check size={10} strokeWidth={3} /> VALID</span>
                      </div>
                    </div>
                  )}
                  <div className="font-mono text-[8.5px] tracking-[0.16em] text-mute/60">
                    ESCROW SETTLING IN &lt; 500MS · EPOCH 88421
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <div className="font-display text-[19px] font-semibold">Sign the ruling</div>
                  <div className="mt-1 font-mono text-[9px] tracking-[0.18em] text-mute">
                    {op.key ? `${op.key.algLabel} · ${op.key.fp} · NEVER LEAVES PHONE` : "GENERATING DEVICE KEY…"}
                  </div>

                  <Card className="mt-6 space-y-2.5 p-4 font-mono text-[10.5px]">
                    <div className="flex justify-between"><span className="tracking-[0.18em] text-mute">TASK</span><span className="text-mist">{a.ref}</span></div>
                    <div className="flex justify-between"><span className="tracking-[0.18em] text-mute">RULING</span><span className="text-volt">{ruling}</span></div>
                    <div className="flex justify-between"><span className="tracking-[0.18em] text-mute">ESCROW</span><span className="text-mist">{a.amount} USDC</span></div>
                    <div className="flex justify-between"><span className="tracking-[0.18em] text-mute">NETWORK FEE</span><span className="text-mist">0.0004 USDC</span></div>
                    <div className="flex justify-between"><span className="tracking-[0.18em] text-mute">KEY</span><span className="text-volt">{op.key?.fp ?? "…"}</span></div>
                  </Card>

                  <div className="mt-auto pt-8">
                    <HoldButton label={`HOLD TO SIGN — ${ruling}`} onDone={() => finish(`RULING SIGNED: ${ruling} ON ${a.ref}`)} />
                    <p className="mt-3 text-center font-mono text-[8px] tracking-[0.2em] text-mute/50">
                      THIS IS THE ONLY ACTION THAT CANNOT BE UNDONE
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

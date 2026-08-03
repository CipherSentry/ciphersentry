import { Check, KeyRound, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { signRuling } from "../crypto/keys";
import type { SignedRuling } from "../crypto/keys";
import { useOperator } from "../crypto/useOperator";

export function openAccessModal() {
  window.dispatchEvent(new CustomEvent("cent:request-access"));
}

const ROLES = ["DEVELOPER", "OPERATOR", "AGENT SUPPLIER", "TREASURY"];
const RAILS = ["BASE MAINNET", "ROBINHOOD CHAIN"];
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Public gateway (Fly). Override with VITE_GATEWAY_URL at build time. */
const GATEWAY_URL = (
  (import.meta as ImportMeta & { env?: { VITE_GATEWAY_URL?: string } }).env?.VITE_GATEWAY_URL ??
  "https://ciphersentry.fly.dev"
).replace(/\/$/, "");

export default function AccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const op = useOperator();
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("DEVELOPER");
  const [rail, setRail] = useState("BASE MAINNET");
  const [useCase, setUseCase] = useState("");
  const [phase, setPhase] = useState<"form" | "signing" | "done">("form");
  const [sig, setSig] = useState<SignedRuling | null>(null);
  const [queue, setQueue] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const valid = handle.trim().length >= 2 && email.includes("@");
  const canSubmit = valid && !!op.key && phase !== "signing";

  useEffect(() => {
    if (open) {
      setPhase("form");
      setSig(null);
      setQueue(null);
      setSubmitError(null);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = async () => {
    if (!valid || !op.key) return;
    setPhase("signing");
    setSubmitError(null);
    try {
      const signed = await signRuling(
        {
          type: "access.request",
          handle: handle.trim(),
          role,
          rail,
          useCase: useCase.trim() || undefined,
        },
        op.key,
      );
      setSig(signed);

      const res = await fetch(`${GATEWAY_URL}/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          kind: "access",
          handle: handle.trim(),
          email: email.trim(),
          role,
          rail,
          use_case: useCase.trim() || undefined,
          sig: signed.sig,
          pubkey: signed.pubkey,
          fp: signed.fp,
          alg: signed.algLabel,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        queue?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `submit failed (${res.status})`);
      }
      setQueue(typeof data.queue === "number" ? data.queue : null);
      setPhase("done");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setPhase("form");
    }
  };

  /* light panel: mute labels + void inputs (never cream-on-panel) */
  const inputCls =
    "w-full border border-edge2 bg-void px-3.5 py-3 font-mono text-[12px] text-mist placeholder:text-mute/40 transition-colors focus:border-volt/60 focus:outline-none";
  const labelCls = "mb-1.5 block font-mono text-[8.5px] tracking-[0.24em] text-mute";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[90] flex items-end justify-center bg-void/80 p-3 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 26, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Request access"
            className="max-h-[min(92svh,100%)] w-full max-w-[440px] overflow-y-auto border border-edge2 bg-panel shadow-[0_40px_120px_rgba(0,0,0,0.25)]"
          >
            {/* header */}
            <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
              <span className="flex items-center gap-2.5">
                <span className="flex gap-1">
                  <span className="h-2 w-2 bg-volt" />
                  <span className="h-2 w-2 bg-edge2" />
                  <span className="h-2 w-2 bg-edge2" />
                </span>
                <span className="font-mono text-[9px] tracking-[0.24em] text-mute">MRC.ACCESS.REQUEST</span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center border border-edge2 text-mute transition-colors hover:border-volt/60 hover:text-volt"
              >
                <X size={13} />
              </button>
            </div>

            {phase !== "done" ? (
              <div className="p-5">
                <h2 className="font-display text-[24px] font-semibold tracking-[-0.02em] text-mist">
                  Request <em className="font-serif font-normal italic text-volt">access.</em>
                </h2>
                <p className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-mute">
                  REGISTRY OPENS IN BATCHES — REQUESTS SIGNED LOCALLY
                </p>

                <div className="mt-6 space-y-4">
                  <div>
                    <label className={labelCls}>HANDLE</label>
                    <input
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      placeholder="atlas-labs"
                      spellCheck={false}
                      autoComplete="username"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>EMAIL</label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="ops@yourdomain.xyz"
                      spellCheck={false}
                      autoComplete="email"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>ROLE</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ROLES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={`border px-2.5 py-2 font-mono text-[8.5px] tracking-[0.16em] transition-colors ${
                            role === r
                              ? "border-volt/70 bg-volt/10 text-volt"
                              : "border-edge2 text-mute hover:text-mist"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>PREFERRED RAIL</label>
                    <div className="flex flex-wrap gap-1.5">
                      {RAILS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRail(r)}
                          className={`border px-2.5 py-2 font-mono text-[8.5px] tracking-[0.16em] transition-colors ${
                            rail === r
                              ? "border-volt/70 bg-volt/10 text-volt"
                              : "border-edge2 text-mute hover:text-mist"
                          }`}
                        >
                          {r}
                          {r === "ROBINHOOD CHAIN" && (
                            <span className="ml-1.5 bg-volt px-1 font-semibold text-ink">CENT</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>USE CASE</label>
                    <textarea
                      value={useCase}
                      onChange={(e) => setUseCase(e.target.value)}
                      rows={3}
                      placeholder="what are your agents buying or selling…"
                      spellCheck={false}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className={`flex w-full items-center justify-center gap-2.5 py-4 font-mono text-[11px] font-semibold tracking-[0.22em] transition-all ${
                      canSubmit
                        ? "bg-volt text-ink hover:bg-volthot"
                        : "cursor-not-allowed border border-edge2 text-mute/50"
                    }`}
                  >
                    {phase === "signing" ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> SIGNING…
                      </>
                    ) : op.loading || !op.key ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> PREPARING KEY…
                      </>
                    ) : (
                      <>
                        <KeyRound size={14} /> SIGN & SUBMIT
                      </>
                    )}
                  </button>
                  {submitError && (
                    <p className="text-center font-mono text-[9px] tracking-[0.12em] text-red-400">
                      {submitError}
                    </p>
                  )}
                  <p className="text-center font-mono text-[7.5px] tracking-[0.18em] text-mute/50">
                    SIGNS WITH YOUR DEVICE KEY {op.key ? `· ${op.key.fp}` : ""} · REQUEST ROUTES TO OPS QUEUE
                  </p>
                </div>
              </div>
            ) : (
              /* success */
              <div className="flex flex-col items-center p-8 text-center">
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="flex h-14 w-14 items-center justify-center border border-volt bg-volt/15"
                >
                  <Check size={24} className="text-volt" />
                </motion.span>
                <div className="mt-5 font-display text-[24px] font-semibold text-mist">In the queue.</div>
                <div className="mt-2 font-mono text-[9.5px] leading-[1.9] tracking-[0.18em] text-mute">
                  {queue != null ? `QUEUE #${queue.toLocaleString()}` : "QUEUED"} · OPS NOTIFIED ON NEXT BATCH
                  <br />
                  INVITES ROUTE TO OPERATORS WITH SETTLED WORK FIRST
                </div>
                {sig && (
                  <div className="mt-5 w-full border border-volt/40 bg-deepgreen p-3.5 text-left font-mono text-[9px] leading-[1.9]">
                    <div className="flex justify-between gap-4">
                      <span className="text-code-mute">SIG</span>
                      <span className="truncate text-code-fg">
                        {sig.sig.slice(0, 18)}…{sig.sig.slice(-6)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-code-mute">KEY</span>
                      <span className="text-volt">{sig.fp}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-code-mute">RAIL</span>
                      <span className="text-code-fg">{rail}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between border-t border-volt/25 pt-1.5">
                      <span className="text-code-mute">LOCAL VERIFY</span>
                      <span className="flex items-center gap-1 text-volt">
                        <Check size={10} strokeWidth={3} /> VALID
                      </span>
                    </div>
                  </div>
                )}
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button
                    onClick={onClose}
                    className="border border-edge2 px-5 py-3 font-mono text-[10px] tracking-[0.2em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
                  >
                    CLOSE
                  </button>
                  <a
                    href="#/docs/specification"
                    onClick={onClose}
                    className="bg-volt px-5 py-3 font-mono text-[10px] font-semibold tracking-[0.2em] text-ink transition-colors hover:bg-volthot"
                  >
                    READ THE SPEC →
                  </a>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Desktop operator onboarding — same custody flow as mobile (#/app).
 */
import {
  Check,
  Download,
  Fingerprint,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import LogoMark from "../components/LogoMark";
import { exportPkcs8, installImportedKey, signRuling, verifySignature } from "../crypto/keys";
import { decryptKeystore, downloadKeystore, encryptKeystore } from "../crypto/keystore";
import type { KeystoreFile } from "../crypto/keystore";
import { getPasskeyRecord, passkeyAvailable, registerPasskey } from "../crypto/passkey";
import { useOperator } from "../crypto/useOperator";

const STEPS = [
  { n: "01", t: "CONNECT KEY", d: "Pair your operator keypair. Keys never leave this device." },
  { n: "02", t: "SET LIMITS", d: "Daily spend caps per agent. Anything above asks you first." },
  { n: "03", t: "MONITOR & INTERVENE", d: "Live stream, verifiers, disputes — the loop on one glass." },
];

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function DesktopOnboarding({ onConnect }: { onConnect: () => void }) {
  const op = useOperator();
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [selfTest, setSelfTest] = useState<"idle" | "running" | "ok">("idle");
  const [backupMode, setBackupMode] = useState<"none" | "export" | "import">("none");
  const [pw, setPw] = useState("");
  const [backupMsg, setBackupMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [prk, setPrk] = useState(() => getPasskeyRecord());
  const fileRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<File | null>(null);
  const ready = !!op.key && selfTest === "ok";

  const doExport = async () => {
    if (!op.key || pw.length < 8) {
      setBackupMsg({ text: pw.length < 8 ? "PASSWORD ≥ 8 CHARS" : "NO KEY", ok: false });
      return;
    }
    const raw = await exportPkcs8();
    if (!raw) return;
    const ks = await encryptKeystore(raw.pkcs8, raw.curve, raw.pubHex, pw);
    downloadKeystore(ks, op.key.fp);
    setBackupMsg({ text: "KEYSTORE DOWNLOADED · AES-GCM-256", ok: true });
    setBackupMode("none");
    setPw("");
  };

  const doImport = async (file: File) => {
    try {
      const ks = JSON.parse(await file.text()) as KeystoreFile;
      if (pw.length < 8) {
        setBackupMsg({ text: "ENTER THE KEYSTORE PASSWORD", ok: false });
        return;
      }
      const { curve, pkcs8 } = await decryptKeystore(ks, pw);
      const k = await installImportedKey(curve, pkcs8, ks.pubHex);
      op.install(k);
      setSelfTest("ok");
      setBackupMsg({ text: `IDENTITY RESTORED · ${k.fp}`, ok: true });
      setBackupMode("none");
      setPw("");
    } catch (e) {
      setBackupMsg({
        text: e instanceof Error ? `FAILED — ${e.message.slice(0, 48).toUpperCase()}` : "FAILED — BAD FILE OR PASSWORD",
        ok: false,
      });
    }
  };

  const doPasskey = async () => {
    try {
      const rec = await registerPasskey(op.key?.fp.replace(/[^0-9a-z]/gi, "").slice(0, 10) ?? "op");
      setPrk(rec);
      setBackupMsg({ text: "PASSKEY ARMED — BIOMETRIC GATE ON", ok: true });
    } catch {
      setBackupMsg({ text: "PASSKEY CANCELLED OR UNSUPPORTED", ok: false });
    }
  };

  useEffect(() => {
    let live = true;
    if (op.key && selfTest === "idle") {
      setSelfTest("running");
      void signRuling({ hello: "ciphersentry", at: Date.now() }, op.key)
        .then(verifySignature)
        .then((ok) => live && setSelfTest(ok ? "ok" : "idle"));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.key]);

  const submit = () => {
    if (!ready || phase !== "idle") return;
    setPhase("loading");
    setTimeout(() => setPhase("done"), 1100);
    setTimeout(() => onConnect(), 1750);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void font-display text-mist">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge bg-panel px-6">
        <a href="#/" aria-label="Back to ciphersentry.xyz" className="group flex items-center">
          <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
        </a>
        <span className="font-mono text-[9px] tracking-[0.24em] text-mute">DESKTOP OPS / V0.2</span>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1080px] gap-10 px-8 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-16">
          {/* left — pitch */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: EASE }}>
            <div className="flex items-center gap-2.5 font-mono text-[9.5px] tracking-[0.26em] text-volt">
              <span className="h-1.5 w-1.5 animate-pulse bg-volt" />
              OPERATOR CONSOLE
            </div>
            <h1 className="mt-5 font-display text-[clamp(2.4rem,4vw,3.4rem)] font-medium leading-[0.98] tracking-[-0.035em]">
              Run your fleet.
              <br />
              <em className="font-serif font-normal italic text-volt">Hold the keys.</em>
            </h1>
            <p className="mt-5 max-w-[420px] text-[14px] leading-[1.75] text-mute">
              Agents earn, spend and settle on their own. You watch the trace — and step in only when
              the protocol asks a human.
            </p>

            <div className="mt-10">
              {STEPS.map((s, i) => (
                <motion.div
                  key={s.n}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.08, duration: 0.55, ease: EASE }}
                  className="flex gap-4 border-t border-edge py-4 last:border-b"
                >
                  <span className="pt-0.5 font-mono text-[11px] text-volt/70">{s.n}</span>
                  <div>
                    <div className="font-mono text-[11px] tracking-[0.18em] text-mist">{s.t}</div>
                    <div className="mt-1 text-[13px] leading-[1.6] text-mute">{s.d}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* right — key custody */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.65, ease: EASE }}
            className="border border-edge bg-panel p-6 sm:p-8"
          >
            <div className="mb-3 flex items-center justify-between font-mono text-[9px] tracking-[0.24em] text-mute">
              <span>OPERATOR KEY — REAL WEBCRYPTO</span>
              {op.key && (
                <button onClick={op.rotate} className="flex items-center gap-1.5 text-mute/60 transition-colors hover:text-volt">
                  <RefreshCw size={10} /> ROTATE
                </button>
              )}
            </div>

            {!op.key ? (
              <button
                onClick={() => void op.rotate()}
                className="group flex w-full items-center justify-center gap-2.5 border border-volt/70 bg-volt/[0.06] py-4 font-mono text-[11px] font-semibold tracking-[0.22em] text-volt transition-colors hover:bg-volt hover:text-void"
              >
                {op.loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> GENERATING {`{WEBCRYPTO}`}…
                  </>
                ) : (
                  <>
                    <KeyRound size={14} /> GENERATE DEVICE KEY
                  </>
                )}
              </button>
            ) : (
              <div className="border border-volt/50 bg-deepgreen">
                <div className="flex items-center justify-between border-b border-volt/25 px-4 py-2.5 font-mono text-[8.5px] tracking-[0.2em]">
                  <span className="text-volt">{op.key.algLabel}</span>
                  <span className="text-code-mute">THIS DEVICE ONLY</span>
                </div>
                <div className="space-y-2.5 px-4 py-3.5 font-mono text-[10.5px]">
                  <div className="flex justify-between gap-4">
                    <span className="tracking-[0.18em] text-code-mute">FINGERPRINT</span>
                    <span className="text-volt">{op.key.fp}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="tracking-[0.18em] text-code-mute">PASSKEY</span>
                    <span className={prk ? "text-volt" : "text-code-mute/70"}>{prk ? "ARMED · GATES DEVICE KEY" : "OFF"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="tracking-[0.18em] text-code-mute">PUBLIC KEY</span>
                    <span className="truncate text-code-fg/80">{op.key.pubHex.slice(0, 28)}…</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="tracking-[0.18em] text-code-mute">SELF-TEST</span>
                    {selfTest === "running" ? (
                      <span className="flex items-center gap-1.5 text-amber-300">
                        <Loader2 size={11} className="animate-spin" /> SIGN+VERIFY…
                      </span>
                    ) : selfTest === "ok" ? (
                      <span className="flex items-center gap-1.5 text-volt">
                        <ShieldCheck size={11} /> VERIFIED
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          if (!op.key) return;
                          setSelfTest("running");
                          void signRuling({ hello: "ciphersentry", at: Date.now() }, op.key)
                            .then(verifySignature)
                            .then((ok) => setSelfTest(ok ? "ok" : "idle"));
                        }}
                        className="text-volt/80 underline-offset-2 hover:underline"
                      >
                        RUN
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {op.key && (
              <div className="mt-3.5">
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setBackupMode(backupMode === "export" ? "none" : "export")}
                    className={`flex flex-1 items-center justify-center gap-1.5 border px-2 py-2.5 font-mono text-[8.5px] tracking-[0.16em] transition-colors ${
                      backupMode === "export" ? "border-volt/70 text-volt" : "border-edge2 text-mute hover:text-mist"
                    }`}
                  >
                    <Download size={10} /> EXPORT
                  </button>
                  <button
                    onClick={() => {
                      setBackupMode(backupMode === "import" ? "none" : "import");
                      if (backupMode !== "import") fileRef.current?.click();
                    }}
                    className={`flex flex-1 items-center justify-center gap-1.5 border px-2 py-2.5 font-mono text-[8.5px] tracking-[0.16em] transition-colors ${
                      backupMode === "import" ? "border-volt/70 text-volt" : "border-edge2 text-mute hover:text-mist"
                    }`}
                  >
                    <Upload size={10} /> IMPORT
                  </button>
                  <button
                    onClick={doPasskey}
                    disabled={!passkeyAvailable() || !!prk}
                    className={`flex flex-1 items-center justify-center gap-1.5 border px-2 py-2.5 font-mono text-[8.5px] tracking-[0.16em] transition-colors ${
                      prk ? "border-volt/50 text-volt/70" : "border-edge2 text-mute hover:text-mist disabled:opacity-40"
                    }`}
                  >
                    <Fingerprint size={10} /> {prk ? "ARMED" : "PASSKEY"}
                  </button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFileRef.current = f;
                    e.target.value = "";
                  }}
                />
                {backupMode !== "none" && (
                  <div className="mt-2 flex gap-1.5">
                    <input
                      type="password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      placeholder={backupMode === "export" ? "password (min 8 chars)…" : "keystore password…"}
                      className="flex-1 border border-edge2 bg-void px-3 py-2.5 font-mono text-[10.5px] text-mist placeholder:text-mute/40 focus:border-volt/60 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        if (backupMode === "export") void doExport();
                        else if (importFileRef.current) void doImport(importFileRef.current);
                        else fileRef.current?.click();
                      }}
                      className={`border px-3.5 font-mono text-[8.5px] tracking-[0.18em] ${
                        pw.length >= 8 ? "border-volt/70 text-volt" : "cursor-not-allowed border-edge2 text-mute/40"
                      }`}
                    >
                      {backupMode === "export" ? "ENCRYPT" : "DECRYPT"}
                    </button>
                  </div>
                )}
                {backupMsg && (
                  <div className={`mt-2 font-mono text-[8px] tracking-[0.1em] ${backupMsg.ok ? "text-volt/80" : "text-red-400/90"}`}>
                    {backupMsg.text}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={submit}
              disabled={!ready}
              className={`group mt-5 flex w-full items-center justify-center gap-2.5 py-4 font-mono text-[11px] font-semibold tracking-[0.22em] transition-all ${
                ready ? "bg-volt text-void hover:bg-mist" : "cursor-not-allowed border border-edge2 text-mute/50"
              }`}
            >
              {phase === "idle" && "CONNECT AGENT FLEET"}
              {phase === "loading" && (
                <>
                  <Loader2 size={14} className="animate-spin" /> VERIFYING KEYPAIR…
                </>
              )}
              {phase === "done" && (
                <>
                  <Check size={14} /> FLEET PAIRED — 3 AGENTS
                </>
              )}
            </button>

            <button
              onClick={onConnect}
              className="mt-4 w-full text-center font-mono text-[9px] tracking-[0.22em] text-mute/60 underline-offset-4 transition-colors hover:text-mist"
            >
              SKIP — EXPLORE DEMO FLEET →
            </button>

            <div className="mt-8 border-t border-edge pt-4 font-mono text-[8px] tracking-[0.2em] text-mute/50">
              NON-CUSTODIAL · KEYS NEVER LEAVE DEVICE · BASE-SEPOLIA
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

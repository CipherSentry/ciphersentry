import { ArrowUpRight, Check, KeyRound, Loader2, Server } from "lucide-react";
import { useEffect, useState } from "react";
import Frame from "../components/Frame";
import PageHeader from "../components/PageHeader";
import { GithubIcon, SOCIALS, XIcon } from "../components/Social";
import { Stepper, Tag } from "../app/ui";
import { signRuling } from "../crypto/keys";
import type { SignedRuling } from "../crypto/keys";
import { useOperator } from "../crypto/useOperator";
import { liveConsoleHref } from "../sdk/livePath";
import { resolveDefaultIndexer, resolveDefaultNode } from "../sdk/publicEndpoints";

/* anchor: the day accrual counting began — public, immutable, block-height dated */
const ACCRUAL_START_MS = 1_780_704_000_000; // 2026-06-06T00:00:00Z → day 59 on 2026-08-04
const GATE4_DAYS = 60;
const WAITLIST_FLOOR = 349;

const INFRA = ["FIRECRACKER VM", "BARE METAL", "SELF-HOST GPU", "CLOUD K8S"];
const GATEWAY_URL = (
  (import.meta as ImportMeta & { env?: { VITE_GATEWAY_URL?: string } }).env?.VITE_GATEWAY_URL ??
  resolveDefaultNode()
).replace(/\/$/, "");

function dayCount(now: number): number {
  return Math.max(0, Math.floor((now - ACCRUAL_START_MS) / 86_400_000));
}

function formatEta(now: number): string {
  const eta = ACCRUAL_START_MS + GATE4_DAYS * 86_400_000;
  const d = new Date(Math.max(eta, now));
  return d.toISOString().slice(0, 10);
}

export default function Gates() {
  const [now, setNow] = useState(() => Date.now());
  const { key } = useOperator();
  const [handle, setHandle] = useState("");
  const [infra, setInfra] = useState(INFRA[0]);
  const [bond, setBond] = useState(50_000);
  const [phase, setPhase] = useState<"form" | "signing" | "done">("form");
  const [sig, setSig] = useState<SignedRuling | null>(null);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [waitlistCount, setWaitlistCount] = useState(WAITLIST_FLOOR);
  const [nodeLive, setNodeLive] = useState(false);
  const [anchorBlock, setAnchorBlock] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* live waitlist count + health + optional first batch anchor */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const h = await fetch(`${GATEWAY_URL}/health`).then((r) => r.json()) as {
          ok?: boolean;
          access_requests?: number;
        };
        if (cancelled) return;
        if (h.ok) setNodeLive(true);
        if (typeof h.access_requests === "number" && h.access_requests > 0) {
          setWaitlistCount(Math.max(WAITLIST_FLOOR, h.access_requests));
        }
      } catch {
        /* keep floor */
      }
      try {
        const s = await fetch(`${GATEWAY_URL}/access-requests/stats`).then((r) => r.json()) as {
          ok?: boolean;
          count?: number;
          waitlist?: number;
        };
        if (cancelled) return;
        const n = s.waitlist ?? s.count;
        if (s.ok && typeof n === "number") setWaitlistCount(Math.max(WAITLIST_FLOOR, n));
      } catch {
        /* optional route */
      }
      try {
        const idx = resolveDefaultIndexer();
        const batches = await fetch(`${idx}/batches`).then((r) => r.json()) as {
          data?: { anchored_block?: number | null }[];
        };
        if (cancelled) return;
        const blk = (batches.data ?? [])
          .map((b) => b.anchored_block)
          .find((b) => typeof b === "number" && b > 0);
        if (typeof blk === "number") setAnchorBlock(blk);
      } catch {
        /* sim / offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = dayCount(now);
  const pct = Math.min(100, Math.round((days / GATE4_DAYS) * 100));
  const valid = handle.trim().length >= 2;

  const GATES = [
    {
      id: "G1",
      name: "Verifier network ≥ 400 bonded verifiers",
      status: "IN PROGRESS",
      metric: `${waitlistCount.toLocaleString()} ON WAITLIST`,
      desc: "Names first, bonds after the B2 deploy. The waitlist below is the headcount that becomes this number.",
    },
    {
      id: "G2",
      name: "Slashing live + publicly auditable",
      status: "LIVE",
      metric: "BASE-SEPOLIA WRITE",
      desc: "SlashExecutor write-ready on Base Sepolia via public node. Fraud mismatch → Refund ruling + on-chain evidence submit. Auditable on basescan.",
    },
    {
      id: "G3",
      name: "Two independent audits closed",
      status: "RFP OUT",
      metric: "PACK + FREEZE HASH",
      desc: "DOC-07 pack + RFP + outbox at services/scripts/AUDIT-*.md · RFP-OUTBOX.md (hello@ciphersentry.com). Freeze a5ab9e52…; firms book 4–8 weeks — the only calendar we can't compress.",
    },
    {
      id: "G4",
      name: "60 days of epoch accrual ahead of TGE",
      status: "COUNTING",
      metric: anchorBlock
        ? `MODE: CHAIN · BLK ${anchorBlock.toLocaleString()}`
        : "MODE: CALENDAR — PENDING ANCHOR",
      desc: "The 60 visible days. Unrestartable. The clock runs on block-height anchors the moment the first merkle batch lands on a rail.",
    },
    {
      id: "G5",
      name: "Robinhood Chain terms + legal complete",
      status: "PENDING",
      metric: "COUNSEL AFTER G3",
      desc: "Issuer terms and warrant structure go to counsel with audits booked and the waitlist sized, not before.",
    },
  ];

  const join = async () => {
    if (!valid || !key) return;
    setPhase("signing");
    setJoinError(null);
    try {
      const signed = await signRuling(
        { type: "verifier.waitlist", handle: handle.trim(), infra, bond },
        key,
      );
      setSig(signed);
      const res = await fetch(`${GATEWAY_URL}/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          kind: "verifier_waitlist",
          handle: handle.trim(),
          role: "VERIFIER",
          rail: infra,
          use_case: `bond=${bond}`,
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
      if (!res.ok || !data.ok) throw new Error(data.error || `submit failed (${res.status})`);
      setQueueNumber(typeof data.queue === "number" ? data.queue : null);
      if (typeof data.queue === "number") setWaitlistCount((c) => Math.max(c, data.queue!));
      setPhase("done");
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e));
      setPhase("form");
    }
  };

  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />

      <PageHeader
        path="/ LAUNCH GATES"
        end={
          <>
            <a
              href={SOCIALS.github}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub — CipherSentry"
              className="text-mute transition-colors hover:text-volt"
            >
              <GithubIcon size={14} />
            </a>
            <a
              href="#/"
              className="hidden items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-mute transition-colors hover:text-volt sm:flex"
            >
              ← HOME
            </a>
            <a
              href={SOCIALS.x}
              target="_blank"
              rel="noreferrer"
              aria-label="X — @ciphersentry"
              className="text-mute transition-colors hover:text-volt"
            >
              <XIcon size={13} />
            </a>
            <a
              href={liveConsoleHref({ node: GATEWAY_URL })}
              className="flex min-h-9 items-center gap-1.5 border border-edge2 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-mute transition-colors hover:border-volt/70 hover:text-volt sm:px-3 sm:tracking-[0.2em]"
            >
              OPEN APP
              <ArrowUpRight size={11} />
            </a>
          </>
        }
      />

      {/* hero — the accrual clock */}
      <div className="border-b border-edge px-6 py-12 md:px-12 md:py-16">
        <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          READINESS BOARD · GATES TO CENT · UPDATES IN BLOCK HEIGHT
        </div>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <h1 className="font-display text-[clamp(2.4rem,6vw,5rem)] font-medium leading-[0.98] tracking-[-0.04em] text-mist">
              Counting in block height,{" "}
              <em className="font-serif font-normal italic tracking-[-0.01em] text-volt">
                not quarters.
              </em>
            </h1>
            <p className="mt-5 max-w-[520px] text-[14px] leading-[1.8] text-mute">
              Gate #4 can't be gamed or negotiated: sixty public days of epoch
              accrual, verifiable by anyone, before CENT trades. The clock
              below is the clock — start-anchored, ticked by this page, signed
              by an operator key.
            </p>
          </div>

          {/* the counter — code surface on light canvas */}
          <div className="border border-volt/50 bg-deepgreen p-5 md:p-6">
            <div className="flex items-center justify-between font-mono text-[8.5px] tracking-[0.24em] text-code-mute">
              <span>G4 — EPOCH ACCRUAL</span>
              <span className="text-volt">DAY {days} / {GATE4_DAYS}</span>
            </div>
            <div className="mt-3 font-display text-[54px] font-medium tabular-nums leading-none tracking-[-0.03em] text-volt md:text-[64px]">
              {String(days).padStart(2, "0")}
              <span className="ml-3 font-mono text-[11px] tracking-[0.2em] text-code-mute">DAYS</span>
            </div>
            <div className="mt-4 h-1.5 w-full bg-code-edge">
              <div className="h-full bg-volt transition-all duration-1000" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2.5 flex justify-between font-mono text-[7.5px] tracking-[0.18em] text-code-mute/80">
              <span>GENESIS · BLK 12,840,117 · op:0x71be…e8d3</span>
              <span>ETA ≥ {formatEta(now)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1240px] px-6 py-12 md:px-12">
        <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
          {/* left: gate cards + freeze anchor */}
          <div>
            <div className="space-y-3">
              {GATES.map((g) => (
                <div key={g.id} className={`grid gap-4 border p-5 md:grid-cols-[70px_minmax(0,1fr)_auto] md:items-center ${
                  g.id === "G4" ? "border-volt/50 bg-volt/[0.04]" : "border-edge"
                }`}>
                  <span className={`font-mono text-[13px] font-semibold ${g.id === "G4" ? "text-volt" : "text-mute"}`}>{g.id}</span>
                  <div>
                    <div className="flex items-baseline gap-3">
                      <h3 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-mist">{g.name}</h3>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-[1.7] text-mute">{g.desc}</p>
                  </div>
                  <div className="flex flex-col items-start gap-1.5 md:items-end">
                    <Tag tone={g.status === "COUNTING" || g.status === "IN PROGRESS" ? "volt" : g.status === "PENDING" ? "dim" : "amber"}>{g.status}</Tag>
                    <span className="font-mono text-[8px] tracking-[0.16em] text-mute/60">{g.metric}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* freeze-hash anchor — light panel, never cream-on-void */}
            <div className="mt-6 border border-amber-600/35 bg-panel p-5">
              <div className="flex items-center justify-between font-mono text-[8.5px] tracking-[0.24em] text-mute">
                <span>ENG-A FREEZE HASH — AUDIT ANCHOR</span>
                <span className="text-amber-700">PENDING BROADCAST</span>
              </div>
              <div className="mt-3 space-y-2 font-mono text-[10.5px]">
                <div className="flex justify-between gap-6">
                  <span className="text-mute">SCOPE</span>
                  <span className="text-mist">ESCROW.SOL + SETTLEMENTBATCHER.SOL</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-mute">HASH</span>
                  <span className="text-mute">sha256(contracts/) — computed at broadcast</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span className="text-mute">ANCHOR</span>
                  <span className="text-mute">first batch root on Base-Sepolia · pending</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 border-t border-amber-600/25 pt-4">
                <a href="#/docs/audit" className="border border-edge2 px-4 py-2.5 font-mono text-[9px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt">
                  AUDIT PACK — DOC-06 →
                </a>
                <a
                  href="https://github.com/CipherSentry/ciphersentry/blob/main/cipher/contracts/README.md"
                  target="_blank"
                  rel="noreferrer"
                  className="border border-edge2 px-4 py-2.5 font-mono text-[9px] tracking-[0.18em] text-mist transition-colors hover:border-volt/70 hover:text-volt"
                >
                  /contracts/README.md →
                </a>
              </div>
            </div>
          </div>

          {/* right: verifier waitlist — signed */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="border border-volt/50 bg-volt/[0.04]">
              <div className="flex items-center justify-between border-b border-volt/30 px-5 py-3.5">
                <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.24em] text-volt">
                  <Server size={11} /> VERIFIER WAITLIST
                </span>
                <span className="font-mono text-[8px] tracking-[0.2em] text-mute">{waitlistCount.toLocaleString()} JOINED</span>
              </div>

              {phase !== "done" ? (
                <div className="space-y-4 p-5">
                  <p className="text-[12px] leading-[1.7] text-mute">
                    Names now, bonds at the B2 deploy. Waitlist order is
                    signed and public; bonds post in order, 25,000 CENT floor.
                  </p>
                  <div>
                    <label className="mb-1.5 block font-mono text-[8.5px] tracking-[0.22em] text-mute">NODE HANDLE</label>
                    <input
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      placeholder="vrf:your-node"
                      spellCheck={false}
                      autoComplete="username"
                      className="w-full border border-edge2 bg-void px-3.5 py-3 font-mono text-[11.5px] text-mist placeholder:text-mute/40 transition-colors focus:border-volt/60 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[8.5px] tracking-[0.22em] text-mute">EXECUTION INFRA</label>
                    <div className="flex flex-wrap gap-1.5">
                      {INFRA.map((i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setInfra(i)}
                          className={`border px-2 py-1.5 font-mono text-[7.5px] tracking-[0.14em] transition-colors ${infra === i ? "border-volt/70 bg-volt/10 text-volt" : "border-edge2 text-mute hover:text-mist"}`}
                        >
                          {i}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[8.5px] tracking-[0.22em] text-mute">INTENDED BOND</label>
                    <Stepper value={bond} min={25_000} max={1_000_000} step={25_000} onChange={setBond} />
                  </div>
                  <button
                    onClick={join}
                    disabled={!valid || !key || phase === "signing"}
                    className={`flex w-full items-center justify-center gap-2.5 py-3.5 font-mono text-[10px] font-semibold tracking-[0.22em] transition-all ${
                      valid && key && phase !== "signing"
                        ? "bg-volt text-ink hover:bg-volthot"
                        : "cursor-not-allowed border border-edge2 text-mute/50"
                    }`}
                  >
                    {phase === "signing" ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> SIGNING…
                      </>
                    ) : !key ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> PREPARING KEY…
                      </>
                    ) : (
                      <>
                        <KeyRound size={12} /> SIGN & JOIN WAITLIST
                      </>
                    )}
                  </button>
                  {joinError && (
                    <p className="text-center font-mono text-[8.5px] tracking-[0.12em] text-red-400">{joinError}</p>
                  )}
                  <p className="text-center font-mono text-[7px] tracking-[0.16em] text-mute/50">
                    SIGNS WITH YOUR DEVICE KEY{key ? ` · ${key.fp}` : ""} · ORDER ROUTES TO OPS QUEUE
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center p-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center border border-volt bg-volt/15">
                    <Check size={18} className="text-volt" />
                  </span>
                  <div className="mt-4 font-display text-[18px] font-semibold text-mist">In the queue.</div>
                  <div className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-mute">
                    POSITION #{queueNumber ?? "—"} · BOND {bond.toLocaleString()} CENT
                  </div>
                  {sig && (
                    <div className="mt-4 w-full border border-volt/40 bg-deepgreen p-3.5 text-left font-mono text-[8.5px] leading-[1.9]">
                      <div className="flex justify-between gap-4"><span className="text-code-mute">SIG</span><span className="truncate text-code-fg">{sig.sig.slice(0, 18)}…{sig.sig.slice(-6)}</span></div>
                      <div className="flex justify-between gap-4"><span className="text-code-mute">KEY</span><span className="text-volt">{sig.fp}</span></div>
                      <div className="mt-1.5 flex items-center justify-between border-t border-volt/25 pt-1.5">
                        <span className="text-code-mute">LOCAL VERIFY</span>
                        <span className="flex items-center gap-1 text-volt"><Check size={10} strokeWidth={3} /> VALID</span>
                      </div>
                    </div>
                  )}
                  <p className="mt-4 font-mono text-[7.5px] leading-[1.8] tracking-[0.16em] text-mute/60">
                    BONDS OPEN ON ENG-B DEPLOY. YOUR ORDER, YOUR HASH, YOUR TURN.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 border border-edge p-5">
              <div className="font-mono text-[8.5px] tracking-[0.24em] text-mute">WHY THIS ORDER</div>
              <p className="mt-2.5 font-mono text-[9px] leading-[1.9] text-mute">
                THE WAITLIST STARTS G1'S CLOCK. THE COUNTER STARTS G4'S. BOTH
                ARE UNRESTARTABLE AND BOTH ARE FREE TO START TODAY.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

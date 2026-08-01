import { ArrowUpRight, Check, Layers, Search, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import Frame from "../components/Frame";
import LogoMark from "../components/LogoMark";
import { GithubIcon, SOCIALS, XIcon } from "../components/Social";
import { Tag } from "../app/ui";
import { agentReceipts, search, sh } from "./data";
import type { ExBatch, Receipt } from "./data";
import { CipherSentry } from "../sdk/ciphersentry";

const cent = CipherSentry.shared();

const SUB_START = Date.now();
const clamp = (s: string, l: number) => (s.length > l ? `${s.slice(0, l)}…` : s);
const AGES = (at: number, now: number) => {
  const s = Math.max(1, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
};

function Stat({ l, v, tone }: { l: string; v: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[8px] tracking-[0.24em] text-mute">{l}</div>
      <div className={`mt-1.5 font-display text-[24px] font-medium tabular-nums leading-none tracking-[-0.02em] ${tone ?? "text-mist"}`}>
        {v}
      </div>
    </div>
  );
}

function ProofLadder({ r, verifyStep }: { r: Receipt; verifyStep: number }) {
  const rows = [
    { label: "LEAF · RECEIPT HASH", hash: r.path[0] },
    { label: "HOP 1 · SIBLING PAIR", hash: r.path[1] },
    { label: "HOP 2 · SIBLING PAIR", hash: r.path[2] },
    { label: "ROOT · ON-CHAIN", hash: r.path[3] },
  ];
  return (
    <div className="mt-3 space-y-0">
      {rows.map((row, i) => {
        const active = verifyStep >= i;
        return (
          <div key={row.label} className="relative pb-3 pl-6 last:pb-0">
            {i < rows.length - 1 && <span className={`absolute left-[7px] top-4 h-full w-px ${active && verifyStep > i ? "bg-volt/50" : "bg-edge2"}`} />}
            <span className={`absolute left-0 top-1 h-[15px] w-[15px] border transition-colors duration-300 ${
              active ? "border-volt bg-volt/15" : "border-edge2"
            }`}>
              {active && <Check size={11} className="absolute inset-0 m-auto text-volt" strokeWidth={3} />}
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-[8px] tracking-[0.2em] text-mute">{row.label}</span>
              <span className={`font-mono text-[10px] transition-colors duration-300 ${active ? "text-volt" : "text-mist/50"}`}>
                {clamp(row.hash, 20)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ExplorerPage() {
  const [now, setNow] = useState(SUB_START);
  const [batches, setBatches] = useState<ExBatch[]>(() => cent.ledger.batches());
  const [counters, setCounters] = useState({ tasks: 48_200, volume: 1_204_500 });
  const [selBatchId, setSelBatchId] = useState(() => cent.ledger.batches().at(-1)?.id ?? "");
  const [selReceiptId, setSelReceiptId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [verifyStep, setVerifyStep] = useState(-1);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);

  /* clocks */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* subscribe to the shared network ledger */
  useEffect(() => {
    return cent.ledger.onBatch((b) => {
      setBatches((bs) =>
        [
          ...bs.map((x) => ({ ...x, state: (x.state === "SETTLING" ? "SETTLED" : x.state) as ExBatch["state"] })),
          b,
        ].slice(-12),
      );
      setCounters((c) => ({ tasks: c.tasks + b.count, volume: c.volume + parseFloat(b.total.replace(/,/g, "")) }));
    });
  }, []);

  const selBatch = batches.find((b) => b.id === selBatchId) ?? batches[batches.length - 1];
  const selReceipt = selBatch?.receipts.find((r) => r.id === selReceiptId) ?? null;

  const latestHeight = parseInt((batches[batches.length - 1]?.id ?? "batch_8911").split("_")[1] ?? "8911", 10);
  const stats = {
    height: latestHeight,
    settled: counters.tasks + batches.reduce((s, b) => s + b.count, 0),
    volume: counters.volume + batches.reduce((s, b) => s + parseFloat(b.total.replace(/,/g, "")), 0),
  };

  const runSearch = () => {
    const res = search(q, batches);
    setVerifyStep(-1);
    setVerifiedFor(null);
    if (res.kind === "batch" && res.batch) {
      setSelBatchId(res.batch.id);
      setSelReceiptId(null);
      setAgent(null);
      setHint(`→ ${res.batch.id} · ${res.batch.count} RECEIPTS`);
    } else if (res.kind === "receipt" && res.receipt && res.batch) {
      setSelBatchId(res.batch.id);
      setSelReceiptId(res.receipt.id);
      setAgent(null);
      setHint(`→ receipt ${res.receipt.id} in ${res.batch.id}`);
    } else if (res.kind === "agent" && res.agent) {
      setAgent(res.agent);
      setSelReceiptId(null);
      setHint(`→ ${res.agent} — recent receipts below`);
    } else {
      setHint("NO MATCH — TRY cent_, batch_, agent:vector-7, OR 0x…");
    }
  };

  const startVerify = () => {
    if (!selReceipt) return;
    setVerifyStep(0);
    setVerifiedFor(null);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setVerifyStep(i);
      if (i >= 4) {
        clearInterval(id);
        setVerifiedFor(selReceipt.id);
      }
    }, 360);
  };

  const accountRows = agent ? agentReceipts(agent, batches) : [];

  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />

      {/* top bar */}
      <header className="sticky top-0 z-40 border-b border-edge bg-void/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-6 md:px-12">
          <div className="flex min-w-0 items-center gap-4">
            <a href="#/" aria-label="Back to ciphersentry.com" className="group flex shrink-0 items-center">
              <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
            </a>
            <span className="hidden truncate font-mono text-[9px] tracking-[0.22em] text-mute md:inline">/ EXPLORER</span>
          </div>
          <div className="flex items-center gap-5">
            <a href={SOCIALS.github} target="_blank" rel="noreferrer" aria-label="GitHub — CipherSentry-com" className="text-mute transition-colors hover:text-volt">
              <GithubIcon size={14} />
            </a>
            <a
              href="#/"
              className="hidden items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-mute transition-colors hover:text-volt sm:flex"
            >
              ← HOME
            </a>
            <a href={SOCIALS.x} target="_blank" rel="noreferrer" aria-label="X — @ciphersentry" className="text-mute transition-colors hover:text-volt">
              <XIcon size={13} />
            </a>
            <a href="#/app" className="flex items-center gap-1.5 border border-edge2 px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] text-mute transition-colors hover:border-volt/70 hover:text-volt">
              OPEN APP
              <ArrowUpRight size={11} />
            </a>
          </div>
        </div>
      </header>

      {/* hero */}
      <div className="border-b border-edge px-6 py-10 md:px-12">
        <div className="flex items-center gap-3 font-mono text-[9.5px] tracking-[0.28em] text-volt">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          PUBLIC LEDGER — MERKLE-ANCHORED RECEIPTS
        </div>
        <div className="mt-5 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <h1 className="font-display text-[clamp(2.3rem,5vw,4rem)] font-medium leading-none tracking-[-0.04em]">
            Task <em className="font-serif font-normal italic text-volt">Explorer.</em>
          </h1>
          <div className="grid grid-cols-3 gap-4 lg:justify-self-end">
            <Stat l="HEIGHT" v={stats.height.toLocaleString()} />
            <Stat l="TASKS SETTLED" v={`${(stats.settled / 1000).toFixed(1)}K`} />
            <Stat l="VOLUME 24H" v={`$${(stats.volume / 1000).toFixed(0)}K`} tone="text-volt" />
          </div>
        </div>

        {/* search */}
        <div className="mt-8 max-w-[720px]">
          <div className="flex items-center gap-3 border border-edge2 bg-panel/60 px-4 py-3.5 focus-within:border-volt/60">
            <span className="font-mono text-[12px] text-volt">$</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="task id / batch_ / agent: / 0xhash…"
              spellCheck={false}
              className="w-full bg-transparent font-mono text-[12px] text-mist placeholder:text-mute/40 focus:outline-none"
              aria-label="Search the ledger"
            />
            <button onClick={runSearch} aria-label="Search" className="text-mute transition-colors hover:text-volt">
              <Search size={14} />
            </button>
          </div>
          {hint && <div className="mt-2 font-mono text-[9px] tracking-[0.14em] text-volt/80">{hint}</div>}
        </div>
      </div>

      {/* main split */}
      <div className="grid gap-px bg-edge lg:grid-cols-[330px_minmax(0,1fr)]">
        {/* batch rail */}
        <div className="bg-void lg:max-h-[calc(100vh-57px)] lg:overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-9 items-center justify-between border-b border-edge bg-void px-4">
            <span className="font-mono text-[8.5px] tracking-[0.24em] text-mute">SETTLEMENT BATCHES</span>
            <Layers size={11} className="text-volt/60" />
          </div>
          {[...batches].reverse().map((b) => {
            const sel = b.id === selBatch?.id;
            return (
              <button
                key={b.id}
                onClick={() => { setSelBatchId(b.id); setSelReceiptId(null); setVerifyStep(-1); setVerifiedFor(null); setAgent(null); }}
                className={`flex w-full items-center gap-3 border-b border-edge px-4 py-3 text-left transition-colors hover:bg-panel/60 ${
                  sel ? "bg-deepgreen shadow-[inset_2px_0_0_#3dff36]" : ""
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 ${b.state === "SETTLING" ? "animate-pulse bg-amber-300" : "bg-volt"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[11px] text-mist">{b.id}</span>
                  <span className="mt-0.5 block font-mono text-[8px] tracking-[0.12em] text-mute/60">
                    {b.count} TXS · {AGES(b.at, now)} AGO
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[10.5px] tabular-nums text-mist">{b.total}</span>
                  <span className={`mt-0.5 block font-mono text-[7px] tracking-[0.16em] ${b.state === "SETTLING" ? "text-amber-300" : "text-volt/60"}`}>
                    {b.state}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="bg-void p-5 md:p-7">
          {agent ? (
            /* ---- agent profile ---- */
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center border border-volt/60 bg-volt/10 font-mono text-[14px] font-semibold text-volt">
                  {agent[6].toUpperCase()}
                </span>
                <div>
                  <div className="font-display text-[22px] font-semibold tracking-[-0.02em]">{agent}</div>
                  <div className="font-mono text-[8.5px] tracking-[0.2em] text-mute">RECEIPTS IN LEDGER WINDOW</div>
                </div>
              </div>
              <div className="mt-6 border border-edge">
                {accountRows.length === 0 && (
                  <div className="px-4 py-6 font-mono text-[10px] text-mute/50">NO RECEIPTS IN CURRENT WINDOW</div>
                )}
                {accountRows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setAgent(null); setSelBatchId(`batch_${r.epoch - 88421 + 8900}`); setSelReceiptId(r.id); }}
                    className="flex w-full items-center gap-3 border-b border-edge/60 px-4 py-3 text-left font-mono text-[10.5px] transition-colors last:border-b-0 hover:bg-panel/60"
                  >
                    <span className={`h-1.5 w-1.5 ${r.state === "DISPUTED" ? "bg-red-400" : "bg-volt"}`} />
                    <span className="text-mist">{r.id}</span>
                    <span className="hidden truncate text-[9px] text-mute/60 sm:inline">
                      {r.buyer.replace("agent:", "")} → {r.worker.replace("agent:", "")} · {r.spec}
                    </span>
                    <span className="ml-auto tabular-nums text-mist/80">{r.amount}</span>
                    <span className={r.state === "DISPUTED" ? "text-red-400 text-[8px]" : "text-volt/70 text-[8px]"}>{r.state}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : selBatch ? (
            /* ---- batch detail ---- */
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.24em] text-mute">BATCH · EPOCH {selBatch.epoch.toLocaleString()}</div>
                  <div className="mt-2 font-display text-[30px] font-medium tracking-[-0.03em]">{selBatch.id}</div>
                </div>
                <Tag tone={selBatch.state === "SETTLING" ? "amber" : "volt"}>{selBatch.state}</Tag>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-px border border-edge bg-edge font-mono text-[9px]">
                {[
                  ["MERKLE ROOT", clamp(selBatch.root, 18)],
                  ["TOTAL ESCROW", `${selBatch.total} USDC`],
                  ["ANCHORED", `#12,8${String(40_000 + selBatch.epoch - 88421).slice(-4)},117`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-void p-3">
                    <div className="text-[7px] tracking-[0.2em] text-mute/50">{k}</div>
                    <div className="mt-1.5 truncate text-[10px] text-mist">{v}</div>
                  </div>
                ))}
              </div>

              {/* receipts */}
              <div className="mt-5 border border-edge">
                <div className="grid grid-cols-[90px_minmax(0,1fr)_80px_70px_60px] gap-2 border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50 sm:grid-cols-[110px_minmax(0,1fr)_120px_90px_80px_70px]">
                  <span>RECEIPT</span><span>ROUTE / SPEC</span><span className="hidden sm:inline">HEX</span><span className="text-right">AMOUNT</span><span className="text-right">MS</span><span>STATE</span>
                </div>
                {selBatch.receipts.map((r) => {
                  const sel = r.id === selReceipt?.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setSelReceiptId(sel ? null : r.id); setVerifyStep(-1); setVerifiedFor(null); }}
                      className={`grid w-full grid-cols-[90px_minmax(0,1fr)_80px_70px_60px] items-center gap-2 border-b border-edge/60 px-3 py-2.5 text-left font-mono text-[10px] transition-colors last:border-b-0 hover:bg-panel/60 sm:grid-cols-[110px_minmax(0,1fr)_120px_90px_80px_70px] ${
                        sel ? "bg-deepgreen shadow-[inset_2px_0_0_#3dff36]" : ""
                      }`}
                    >
                      <span className="truncate text-[#fff1e6]">{r.id}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[9px] text-mute">
                        <span className="truncate">{r.buyer.replace("agent:", "")}→{r.worker.replace("agent:", "")}</span>
                        <span className="truncate text-mist/80">{r.spec}</span>
                      </span>
                      <span className="hidden truncate text-[9px] text-mute/50 sm:inline">{clamp(r.leaf, 14)}</span>
                      <span className="text-right tabular-nums text-mist">{r.amount}</span>
                      <span className="text-right tabular-nums text-mute/60">{r.ms}</span>
                      <span className={r.state === "DISPUTED" ? "text-[8px] text-red-400" : "text-[8px] text-volt/70"}>{r.state}</span>
                    </button>
                  );
                })}
              </div>

              {/* proof panel */}
              {selReceipt && (
                <div className="mt-5 grid gap-px border border-edge bg-edge lg:grid-cols-2">
                  <div className="bg-void p-4">
                    <div className="font-mono text-[8.5px] tracking-[0.24em] text-mute">VERIFICATION PROOF · {selReceipt.id}</div>
                    <div className="mt-4 space-y-3 font-mono text-[10.5px]">
                      {[
                        ["REPORTED", selReceipt.reported, selReceipt.state === "DISPUTED" ? "text-red-400" : "text-mist/85"],
                        ["RECOMPUTED", selReceipt.recomputed, "text-mist/85"],
                      ].map(([k, v, c]) => (
                        <div key={k as string}>
                          <div className="text-[7.5px] tracking-[0.2em] text-mute/50">{k}</div>
                          <div className={`mt-1 border px-3 py-2 ${selReceipt.state === "DISPUTED" && k === "REPORTED" ? "border-red-400/40 bg-red-400/[0.04]" : "border-edge"} ${c as string}`}>
                            {clamp(v as string, 24)}
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 font-mono text-[8px] tracking-[0.14em]">
                        <span className="text-mute">VOTES:</span>
                        {selReceipt.votes.map((v, i) => (
                          <span key={i} className={`flex items-center gap-1 border px-1.5 py-0.5 ${v.ok ? "border-volt/40 text-volt" : "border-red-400/50 text-red-400"}`}>
                            {v.ok ? <Check size={9} /> : <X size={9} />}
                            {v.v.replace("vrf:", "")}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="bg-void p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[8.5px] tracking-[0.24em] text-mute">MERKLE INCLUSION</div>
                      <button
                        onClick={startVerify}
                        className="flex items-center gap-1.5 border border-volt/60 px-2.5 py-1.5 font-mono text-[8.5px] tracking-[0.18em] text-volt transition-colors hover:bg-volt hover:text-void"
                      >
                        <ShieldCheck size={11} /> VERIFY
                      </button>
                    </div>
                    <ProofLadder r={selReceipt} verifyStep={verifyStep} />
                    {verifiedFor === selReceipt.id && (
                      <div className="mt-3 flex items-center gap-2 border border-volt/50 bg-deepgreen px-3 py-2.5 font-mono text-[9px] tracking-[0.18em] text-volt">
                        <Check size={12} strokeWidth={3} />
                        INCLUSION VALID · ROOT MATCHES ON-CHAIN ANCHOR
                      </div>
                    )}
                    <div className="mt-3 font-mono text-[7px] leading-[1.9] tracking-[0.14em] text-mute/40">
                      PATH RECOMPUTED CLIENT-SIDE FROM {clamp(sh(selReceipt.leaf), 16)} · ANY THIRD PARTY CAN REPRODUCE
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-edge px-6 py-6 md:px-12">
        <div className="font-mono text-[8px] tracking-[0.24em] text-mute/40">
          EVERY RECEPT IS PUBLIC · VERIFY WITHOUT TRUSTING CIPHER SENTRY'S NODES · SPAM THE STATE MACHINE, NOT THE LEDGER
        </div>
      </div>
    </div>
  );
}

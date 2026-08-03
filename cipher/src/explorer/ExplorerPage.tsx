import { ArrowUpRight, Check, Layers, Search, ShieldCheck, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Frame from "../components/Frame";
import LogoMark from "../components/LogoMark";
import { GithubIcon, SOCIALS, XIcon } from "../components/Social";
import { Tag } from "../app/ui";
import { agentReceipts, proofRows, search, searchFromIndexer } from "./data";
import type { ExBatch, Receipt } from "./data";
import {
  connectIndexer,
  readIndexerUrl,
  type FraudRow,
  type IndexerClient,
  type ProofResult,
  type TrustPoint,
} from "./indexer";
import { CipherSentry } from "../sdk/ciphersentry";
import { liveConsoleHref } from "../sdk/livePath";
import { verifyInclusionEitherOrder } from "../sdk/merkle";

const cent = CipherSentry.shared();

const SUB_START = Date.now();
/** Indexer poll interval — raised from 8s; pause when tab hidden. */
const POLL_MS = 30_000;
const clamp = (s: string, l: number) => (s.length > l ? `${s.slice(0, l)}…` : s);
const AGES = (at: number, now: number) => {
  const s = Math.max(1, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
};

/** Read `q` from `#/explorer?q=` or `?q=` (deep-link). */
export function readExplorerQ(): string {
  try {
    const hash = window.location.hash.replace(/^#/, "");
    const qi = hash.indexOf("?");
    if (qi >= 0) {
      const fromHash = new URLSearchParams(hash.slice(qi + 1)).get("q");
      if (fromHash) return fromHash;
    }
    return new URLSearchParams(window.location.search).get("q") ?? "";
  } catch {
    return "";
  }
}

/** Persist search into hash; keep node/indexer (and other) query params. */
export function writeExplorerQ(q: string): void {
  try {
    const hash = window.location.hash.replace(/^#/, "");
    const qi = hash.indexOf("?");
    const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
    if (q.trim()) params.set("q", q.trim());
    else params.delete("q");
    const qs = params.toString();
    const next = `#/explorer${qs ? `?${qs}` : ""}`;
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
  } catch {
    /* ignore */
  }
}

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

/** Sparkline for /trust/:agent series (product surface). */
function TrustChart({ series }: { series: TrustPoint[] }) {
  if (!series.length) {
    return <div className="mt-3 font-mono text-[10px] text-mute/50">NO TRUST SERIES YET</div>;
  }
  const scores = series.map((p) => Number(p.trust_score));
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const span = Math.max(1e-6, max - min);
  const w = 320;
  const h = 64;
  const pad = 4;
  const pts = scores
    .map((s, i) => {
      const x = pad + (i / Math.max(1, scores.length - 1)) * (w - pad * 2);
      const y = h - pad - ((s - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = scores[scores.length - 1]!;
  const firstEpoch = series[0]!.epoch;
  const lastEpoch = series[series.length - 1]!.epoch;
  const lastPt = series[series.length - 1]!;
  const stake = lastPt.stake != null ? Number(lastPt.stake) : null;
  const success = lastPt.success != null ? Number(lastPt.success) : null;
  return (
    <div className="mt-4 border border-edge bg-void p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[8.5px] tracking-[0.24em] text-mute">TRUST SERIES · /trust/:agent</span>
        <span className="font-mono text-[14px] tabular-nums text-volt">{last.toFixed(1)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full" preserveAspectRatio="none" aria-label="Trust over epochs">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" className="text-volt" points={pts} />
      </svg>
      <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-[7.5px] tracking-[0.14em] text-mute/50">
        <span>E{firstEpoch}</span>
        <span>
          {series.length} PTS · E{lastEpoch}
        </span>
        {(stake != null || success != null) && (
          <span className="w-full text-mute/70">
            {stake != null ? `STAKE ${stake.toLocaleString()}` : ""}
            {stake != null && success != null ? " · " : ""}
            {success != null ? `Q ${(success <= 1 ? success * 100 : success).toFixed(1)}%` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function ProofLadder({
  r,
  verifyStep,
  remoteValid,
}: {
  r: Receipt;
  verifyStep: number;
  remoteValid: boolean | null;
}) {
  const rows = proofRows(r);
  return (
    <div className="mt-3 space-y-0">
      {rows.map((row, i) => {
        const active = verifyStep >= i;
        return (
          <div key={`${row.label}-${i}`} className="relative pb-3 pl-6 last:pb-0">
            {i < rows.length - 1 && (
              <span className={`absolute left-[7px] top-4 h-full w-px ${active && verifyStep > i ? "bg-volt/50" : "bg-edge2"}`} />
            )}
            <span
              className={`absolute left-0 top-1 h-[15px] w-[15px] border transition-colors duration-300 ${
                active ? "border-volt bg-volt/15" : "border-edge2"
              }`}
            >
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
      {remoteValid === false && (
        <div className="mt-2 font-mono text-[8px] tracking-[0.14em] text-red-400">INDEXER REPORTED INVALID PATH</div>
      )}
    </div>
  );
}

export default function ExplorerPage() {
  const [now, setNow] = useState(SUB_START);
  const [batches, setBatches] = useState<ExBatch[]>(() => cent.ledger.batches());
  const [fraud, setFraud] = useState<FraudRow[]>([]);
  const [counters, setCounters] = useState({ tasks: 0, volume: 0, fraud: 0 });
  const [selBatchId, setSelBatchId] = useState(() => cent.ledger.batches().at(-1)?.id ?? "");
  const [selReceiptId, setSelReceiptId] = useState<string | null>(null);
  const [selFraudId, setSelFraudId] = useState<string | null>(null);
  const [q, setQ] = useState(() => readExplorerQ());
  const [hint, setHint] = useState<string | null>(null);
  const deepLinked = useState(() => Boolean(readExplorerQ().trim()))[0];
  const [agent, setAgent] = useState<string | null>(null);
  const [verifyStep, setVerifyStep] = useState(-1);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [remoteValid, setRemoteValid] = useState<boolean | null>(null);
  const [source, setSource] = useState<"indexer" | "sim" | "connecting">("connecting");
  const [indexerUrl, setIndexerUrl] = useState(readIndexerUrl());
  const [client, setClient] = useState<IndexerClient | null>(null);
  const [lastProof, setLastProof] = useState<ProofResult | null>(null);
  const [trustSeries, setTrustSeries] = useState<TrustPoint[]>([]);
  const [agentMeta, setAgentMeta] = useState<{ trust?: number; stake?: number; success?: number } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const hydrateIndexer = useCallback(async (c: IndexerClient) => {
    const [ledger, fraudRows, st] = await Promise.all([
      c.loadLedger(12),
      c.listFraud(24),
      c.stats(),
    ]);
    if (ledger.length) {
      setBatches(ledger);
      setSelBatchId(ledger[ledger.length - 1]!.id);
      const vol = ledger.reduce((s, b) => s + parseFloat(b.total.replace(/,/g, "") || "0"), 0);
      const tasks = ledger.reduce((s, b) => s + b.count, 0);
      setCounters({
        tasks: st.tasksIn ?? tasks,
        volume: vol,
        fraud: st.fraudIn ?? fraudRows.length,
      });
    }
    setFraud(fraudRows);
    setSource("indexer");
    setIndexerUrl(c.base);
  }, []);

  /* prefer live indexer; fall back to sim ledger stream */
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const startPoll = (c: IndexerClient) => {
      if (poll) clearInterval(poll);
      poll = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void hydrateIndexer(c).catch(() => {});
      }, POLL_MS);
    };

    (async () => {
      const c = await connectIndexer();
      if (cancelled) return;
      if (c) {
        setClient(c);
        try {
          await hydrateIndexer(c);
        } catch {
          /* fall through to sim */
        }
        startPoll(c);
        const onVis = () => {
          if (document.visibilityState === "visible") void hydrateIndexer(c).catch(() => {});
        };
        document.addEventListener("visibilitychange", onVis);
        unsub = () => document.removeEventListener("visibilitychange", onVis);
        return;
      }
      setSource("sim");
      setBatches(cent.ledger.batches());
      unsub = cent.ledger.onBatch((b) => {
        setBatches((bs) =>
          [
            ...bs.map((x) => ({
              ...x,
              state: (x.state === "SETTLING" ? "SETTLED" : x.state) as ExBatch["state"],
            })),
            b,
          ].slice(-12),
        );
        setCounters((c0) => ({
          tasks: c0.tasks + b.count,
          volume: c0.volume + parseFloat(b.total.replace(/,/g, "") || "0"),
          fraud: c0.fraud,
        }));
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
      if (poll) clearInterval(poll);
    };
  }, [hydrateIndexer]);

  /* deep-link: run search once after first ledger hydrate when ?q= present */
  useEffect(() => {
    if (!deepLinked || !q.trim()) return;
    if (source === "connecting") return;
    void runSearch();
    // only on initial source settle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  /* load /trust/:agent series when agent panel opens */
  useEffect(() => {
    if (!agent) {
      setTrustSeries([]);
      setAgentMeta(null);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!client) {
        setTrustSeries([]);
        setAgentMeta(null);
        return;
      }
      try {
        const [series, meta] = await Promise.all([
          client.getTrust(agent, { limit: 64 }),
          client.getAgent(agent),
        ]);
        if (cancelled) return;
        setTrustSeries(series);
        setAgentMeta(meta ? { trust: meta.trust, stake: meta.stake, success: meta.success } : null);
      } catch {
        if (!cancelled) {
          setTrustSeries([]);
          setAgentMeta(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, client]);

  /** Open agent trust panel (chart + receipts). */
  const openAgent = useCallback((id: string) => {
    const agentId = id.startsWith("agent:") ? id : `agent:${id}`;
    setAgent(agentId);
    setSelReceiptId(null);
    setSelFraudId(null);
    setVerifyStep(-1);
    setVerifiedFor(null);
    setQ(agentId);
    writeExplorerQ(agentId);
  }, []);

  const selBatch = batches.find((b) => b.id === selBatchId) ?? batches[batches.length - 1];
  const selReceipt = selBatch?.receipts.find((r) => r.id === selReceiptId) ?? null;
  const selFraud = fraud.find((f) => f.task_id === selFraudId) ?? null;

  const latestHeight = (() => {
    const id = batches[batches.length - 1]?.id ?? "batch_0";
    const n = parseInt(id.replace(/^batch_/, ""), 10);
    return Number.isFinite(n) ? n : batches.length;
  })();

  const stats = {
    height: latestHeight,
    settled: counters.tasks || batches.reduce((s, b) => s + b.count, 0),
    volume: counters.volume || batches.reduce((s, b) => s + parseFloat(b.total.replace(/,/g, "") || "0"), 0),
    fraud: counters.fraud || fraud.length,
  };

  const runSearch = async () => {
    setVerifyStep(-1);
    setVerifiedFor(null);
    setRemoteValid(null);
    setLastProof(null);
    setSelFraudId(null);
    writeExplorerQ(q);

    let res = search(q, batches, fraud);
    if (res.kind === "none" && client) {
      try {
        const remote = await client.search(q.trim());
        res = searchFromIndexer(q, remote, batches, fraud);
        // load missing batch on hit
        if (res.kind === "none" && remote.batches[0]) {
          const full = await client.getBatch(remote.batches[0].batch_id);
          if (full) {
            setBatches((bs) => {
              if (bs.some((b) => b.id === full.id)) return bs;
              return [...bs, full].slice(-16);
            });
            res = { kind: "batch", batch: full, query: q };
          }
        }
        if (res.kind === "none" && remote.fraud[0]) {
          const f = await client.getFraud(remote.fraud[0].task_id);
          if (f) {
            setFraud((fs) => (fs.some((x) => x.task_id === f.task_id) ? fs : [f, ...fs]));
            res = { kind: "fraud", fraud: f, query: q };
          }
        }
        if (res.kind === "none" && remote.receipts[0]) {
          const bid = remote.receipts[0].batch_id;
          const full = await client.getBatch(bid);
          if (full) {
            setBatches((bs) => (bs.some((b) => b.id === full.id) ? bs : [...bs, full].slice(-16)));
            const r = full.receipts.find((x) => x.id === remote.receipts[0]!.receipt_id);
            if (r) res = { kind: "receipt", batch: full, receipt: r, query: q };
          }
        }
        // Pre-batch: task indexed on commit (no receipt yet)
        if (res.kind === "none" && remote.tasks[0]) {
          const t = (await client.getTask(remote.tasks[0].task_id)) ?? remote.tasks[0];
          res = { kind: "task", task: t, query: q };
        }
        if (res.kind === "task" && res.task && remote.receipts[0]) {
          const bid = remote.receipts[0].batch_id;
          const full = await client.getBatch(bid);
          if (full) {
            setBatches((bs) => (bs.some((b) => b.id === full.id) ? bs : [...bs, full].slice(-16)));
            const r = full.receipts.find(
              (x) => x.id === remote.receipts[0]!.receipt_id || x.id === res.task!.task_id,
            );
            if (r) res = { kind: "receipt", batch: full, receipt: r, query: q };
          }
        }
      } catch {
        /* local only */
      }
    }

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
    } else if (res.kind === "fraud" && res.fraud) {
      setSelFraudId(res.fraud.task_id);
      setAgent(null);
      setSelReceiptId(null);
      setHint(`→ fraud ${res.fraud.task_id} · ${res.fraud.status} ${res.fraud.ruling ?? ""}`.trim());
    } else if (res.kind === "task" && res.task) {
      setAgent(null);
      setSelReceiptId(null);
      setSelFraudId(null);
      const t = res.task;
      setHint(
        `→ ${t.task_id} · ${t.state}${t.worker ? ` · ${t.worker}` : ""}${t.amount != null ? ` · ${t.amount}` : ""} (pre-batch)`,
      );
    } else if (res.kind === "agent" && res.agent) {
      setAgent(res.agent);
      setSelReceiptId(null);
      setHint(`→ ${res.agent} — recent receipts below`);
    } else {
      setHint("NO MATCH — TRY cent_, batch_, fraud task id, agent:vector-7, OR 0x…");
    }
  };

  const startVerify = async () => {
    if (!selReceipt) return;
    setVerifyStep(0);
    setVerifiedFor(null);
    setRemoteValid(null);
    setLastProof(null);

    const rows = proofRows(selReceipt);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setVerifyStep(i);
      if (i >= rows.length) clearInterval(id);
    }, 280);

    if (client) {
      try {
        const p = await client.proof(selReceipt.id);
        if (p) {
          setLastProof(p);
          // Client fold — do not trust indexer `valid` alone
          const root = p.root || selReceipt.path?.[selReceipt.path.length - 1] || "";
          const localOk =
            Boolean(p.leaf && root) &&
            verifyInclusionEitherOrder(p.leaf, Array.isArray(p.path) ? p.path : [], root);
          const ok = localOk && (p.valid !== false);
          setRemoteValid(ok);
          if (ok) setVerifiedFor(selReceipt.id);
        } else {
          // no indexer row — fold receipt path if sim-shaped path ends with root
          const path = selReceipt.path ?? [];
          if (path.length >= 2) {
            const leaf = path[0] ?? selReceipt.leaf;
            const root = path[path.length - 1]!;
            const sibs = path.slice(1, -1);
            const ok = verifyInclusionEitherOrder(leaf, sibs, root);
            setRemoteValid(ok);
            if (ok) setVerifiedFor(selReceipt.id);
          } else {
            setVerifiedFor(selReceipt.id);
            setRemoteValid(null);
          }
        }
      } catch {
        setVerifiedFor(selReceipt.id);
        setRemoteValid(null);
      }
    } else {
      // sim: cosmetic verify complete
      setTimeout(() => setVerifiedFor(selReceipt.id), rows.length * 280 + 40);
    }
  };

  const accountRows = agent ? agentReceipts(agent, batches) : [];

  return (
    <div className="relative isolate min-h-screen bg-void font-display text-mist">
      <Frame />

      <header className="sticky top-0 z-40 border-b border-edge bg-void/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
        <div className="flex h-12 items-center justify-between gap-3 px-4 sm:h-14 sm:px-6 md:px-12">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <a href="#/" aria-label="Back to ciphersentry.xyz" className="group flex shrink-0 items-center">
              <LogoMark size={15} className="text-volt transition-transform duration-300 group-hover:scale-105" />
            </a>
            <span className="hidden truncate font-mono text-[9px] tracking-[0.22em] text-mute md:inline">/ EXPLORER</span>
            <span
              className={`hidden font-mono text-[8px] tracking-[0.18em] sm:inline ${
                source === "indexer" ? "text-volt" : source === "connecting" ? "text-amber-300" : "text-mute"
              }`}
              title={source === "indexer" ? indexerUrl : "sim ledger"}
            >
              {source === "indexer" ? "INDEXER LIVE" : source === "connecting" ? "CONNECTING…" : "SIM LEDGER"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-5">
            <a href={SOCIALS.github} target="_blank" rel="noreferrer" aria-label="GitHub" className="text-mute transition-colors hover:text-volt">
              <GithubIcon size={14} />
            </a>
            <a href="#/" className="hidden items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-mute transition-colors hover:text-volt sm:flex">
              ← HOME
            </a>
            <a href={SOCIALS.x} target="_blank" rel="noreferrer" aria-label="X" className="text-mute transition-colors hover:text-volt">
              <XIcon size={13} />
            </a>
            <a
              href={liveConsoleHref({ indexer: indexerUrl || readIndexerUrl() || undefined })}
              className="flex min-h-9 items-center gap-1.5 border border-edge2 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-mute transition-colors hover:border-volt/70 hover:text-volt sm:px-3 sm:tracking-[0.2em]"
            >
              OPEN APP
              <ArrowUpRight size={11} />
            </a>
          </div>
        </div>
      </header>

      <div className="border-b border-edge px-4 py-8 sm:px-6 sm:py-10 md:px-12">
        <div className="flex items-start gap-2.5 font-mono text-[8.5px] tracking-[0.16em] text-volt sm:items-center sm:gap-3 sm:text-[9.5px] sm:tracking-[0.28em]">
          <span className="relative mt-0.5 flex h-1.5 w-1.5 shrink-0 sm:mt-0">
            <span className="absolute h-full w-full animate-ping bg-volt opacity-60" />
            <span className="relative h-1.5 w-1.5 bg-volt" />
          </span>
          <span className="min-w-0 leading-relaxed">
            <span className="sm:hidden">PUBLIC LEDGER · MERKLE + FRAUD</span>
            <span className="hidden sm:inline">
              PUBLIC LEDGER — MERKLE RECEIPTS
              {source === "indexer" ? " · INDEXER PROOFS" : " · SIM STREAM"}
            </span>
          </span>
        </div>
        <div className="mt-5 grid gap-6 sm:gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <h1 className="font-display text-[clamp(2.1rem,7vw,4rem)] font-medium leading-none tracking-[-0.04em]">
            Task <em className="font-serif font-normal italic text-volt">Explorer.</em>
          </h1>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 lg:justify-self-end">
            <Stat l="HEIGHT" v={stats.height.toLocaleString()} />
            <Stat l="TASKS" v={stats.settled >= 1000 ? `${(stats.settled / 1000).toFixed(1)}K` : String(stats.settled)} />
            <Stat l="VOLUME" v={`$${stats.volume >= 1000 ? `${(stats.volume / 1000).toFixed(1)}K` : stats.volume.toFixed(0)}`} tone="text-volt" />
            <Stat l="FRAUD" v={String(stats.fraud)} tone={stats.fraud > 0 ? "text-amber-300" : undefined} />
          </div>
        </div>

        <div className="mt-6 max-w-[720px] sm:mt-8">
          <div className="flex items-center gap-2 border border-edge2 bg-panel/60 px-3 py-3 focus-within:border-volt/60 sm:gap-3 sm:px-4 sm:py-3.5">
            <span className="font-mono text-[12px] text-volt">$</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runSearch()}
              placeholder="task / batch_ / fraud / agent: / 0x…"
              spellCheck={false}
              className="min-w-0 w-full bg-transparent font-mono text-[12px] text-mist placeholder:text-mute/40 focus:outline-none"
              aria-label="Search the ledger"
            />
            <button onClick={() => void runSearch()} aria-label="Search" className="shrink-0 text-mute transition-colors hover:text-volt">
              <Search size={14} />
            </button>
          </div>
          {hint && <div className="mt-2 break-all font-mono text-[9px] tracking-[0.14em] text-volt/80">{hint}</div>}
          {source === "indexer" && (
            <div className="mt-2 font-mono text-[8px] tracking-[0.16em] text-mute/50">SOURCE {indexerUrl}</div>
          )}
        </div>
      </div>

      <div className="grid gap-px bg-edge lg:grid-cols-[330px_minmax(0,1fr)]">
        {/* left rail: batches + fraud */}
        <div className="bg-void lg:max-h-[calc(100vh-57px)] lg:overflow-y-auto">
          <div className="sticky top-0 z-10 flex h-9 items-center justify-between border-b border-edge bg-void px-4">
            <span className="font-mono text-[8.5px] tracking-[0.24em] text-mute">SETTLEMENT BATCHES</span>
            <Layers size={11} className="text-volt/60" />
          </div>
          {batches.length === 0 && (
            <div className="px-4 py-6 font-mono text-[10px] text-mute/50">
              {source === "connecting" ? "CONNECTING INDEXER…" : "NO BATCHES YET"}
            </div>
          )}
          {[...batches].reverse().map((b) => {
            const sel = b.id === selBatch?.id && !selFraudId && !agent;
            return (
              <button
                key={b.id}
                onClick={() => {
                  setSelBatchId(b.id);
                  setSelReceiptId(null);
                  setVerifyStep(-1);
                  setVerifiedFor(null);
                  setAgent(null);
                  setSelFraudId(null);
                  setRemoteValid(null);
                }}
                className={`flex w-full items-center gap-3 border-b border-edge px-4 py-3 text-left transition-colors hover:bg-panel/70 ${
                  sel ? "bg-volt/[0.08] shadow-[inset_2px_0_0_var(--color-volt)]" : ""
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

          <div className="sticky top-9 z-10 flex h-9 items-center justify-between border-b border-t border-edge bg-void px-4">
            <span className="font-mono text-[8.5px] tracking-[0.24em] text-mute">FRAUD CASES</span>
            <ShieldAlert size={11} className="text-amber-300/70" />
          </div>
          {fraud.length === 0 && (
            <div className="px-4 py-5 font-mono text-[10px] text-mute/50">NO FRAUD CASES INDEXED</div>
          )}
          {fraud.map((f) => {
            const sel = f.task_id === selFraudId;
            return (
              <button
                key={f.task_id}
                onClick={() => {
                  setSelFraudId(f.task_id);
                  setAgent(null);
                  setSelReceiptId(null);
                  setVerifyStep(-1);
                  setVerifiedFor(null);
                }}
                className={`flex w-full items-center gap-3 border-b border-edge px-4 py-3 text-left transition-colors hover:bg-panel/70 ${
                  sel ? "bg-volt/[0.08] shadow-[inset_2px_0_0_var(--color-volt)]" : ""
                }`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 ${f.status === "RESOLVED" || f.status === "DEFAULTED" ? "bg-amber-300" : "animate-pulse bg-red-400"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] text-mist">{f.task_id}</span>
                  <span className="mt-0.5 block font-mono text-[8px] tracking-[0.12em] text-mute/60">
                    {(f.worker || "").replace("agent:", "")} · {f.status}
                  </span>
                </span>
                <span className={`font-mono text-[8px] tracking-[0.14em] ${f.ruling === "Refund" ? "text-red-400" : "text-volt"}`}>
                  {f.ruling ?? "—"}
                </span>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="bg-void p-4 sm:p-5 md:p-7">
          {agent ? (
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center border border-volt/60 bg-volt/10 font-mono text-[14px] font-semibold text-volt">
                  {agent.replace("agent:", "")[0]?.toUpperCase() ?? "A"}
                </span>
                <div>
                  <div className="font-display text-[22px] font-semibold tracking-[-0.02em]">{agent}</div>
                  <div className="font-mono text-[8.5px] tracking-[0.2em] text-mute">
                    {agentMeta?.trust != null
                      ? `T=${Number(agentMeta.trust).toFixed(1)} · S=${Number(agentMeta.stake ?? 0).toLocaleString()}`
                      : "RECEIPTS + TRUST SERIES"}
                  </div>
                </div>
              </div>
              <TrustChart series={trustSeries} />
              <div className="mt-6 border border-edge">
                {accountRows.length === 0 && (
                  <div className="px-4 py-6 font-mono text-[10px] text-mute/50">NO RECEIPTS IN CURRENT WINDOW</div>
                )}
                {accountRows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      const b = batches.find((x) => x.receipts.some((rr) => rr.id === r.id));
                      setAgent(null);
                      if (b) setSelBatchId(b.id);
                      setSelReceiptId(r.id);
                    }}
                    className="flex w-full items-center gap-3 border-b border-edge/60 px-4 py-3 text-left font-mono text-[10.5px] transition-colors last:border-b-0 hover:bg-panel/60"
                  >
                    <span className={`h-1.5 w-1.5 ${r.state === "DISPUTED" ? "bg-red-400" : "bg-volt"}`} />
                    <span className="text-mist">{r.id}</span>
                    <span className="hidden truncate text-[9px] text-mute/60 sm:inline">
                      {r.buyer.replace("agent:", "")} → {r.worker.replace("agent:", "")} · {r.spec}
                    </span>
                    <span className="ml-auto tabular-nums text-mist/80">{r.amount}</span>
                    <span className={r.state === "DISPUTED" ? "text-[8px] text-red-400" : "text-[8px] text-volt/70"}>{r.state}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : selFraud ? (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.24em] text-mute">FRAUD CASE · B5</div>
                  <div className="mt-2 font-display text-[28px] font-medium tracking-[-0.03em]">{selFraud.task_id}</div>
                </div>
                <Tag tone={selFraud.ruling === "Refund" ? "red" : selFraud.status === "RESOLVED" ? "volt" : "amber"}>
                  {selFraud.ruling ?? selFraud.status}
                </Tag>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-px border border-edge bg-edge font-mono text-[9px] sm:grid-cols-3">
                {[
                  ["STATUS", selFraud.status, false],
                  ["RULING", selFraud.ruling ?? "—", false],
                  ["AMOUNT", `${selFraud.amount} USDC`, false],
                  ["BUYER", selFraud.buyer || "—", Boolean(selFraud.buyer)],
                  ["WORKER", selFraud.worker || "—", Boolean(selFraud.worker)],
                  ["CHAIN", selFraud.chain_mode ?? "offline", false],
                ].map(([k, v, click]) => (
                  <div key={k as string} className="bg-void p-3">
                    <div className="text-[7px] tracking-[0.2em] text-mute/50">{k as string}</div>
                    {click && typeof v === "string" && v !== "—" ? (
                      <button
                        type="button"
                        onClick={() => openAgent(v)}
                        className="mt-1.5 truncate text-[10px] text-volt underline-offset-2 hover:underline"
                      >
                        {v}
                      </button>
                    ) : (
                      <div className="mt-1.5 truncate text-[10px] text-mist">{v as string}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-px border border-edge bg-edge lg:grid-cols-2">
                <div className="bg-void p-4">
                  <div className="font-mono text-[8.5px] tracking-[0.24em] text-mute">HASHES</div>
                  <div className="mt-3 space-y-3 font-mono text-[10.5px]">
                    <div>
                      <div className="text-[7.5px] tracking-[0.2em] text-mute/50">REPORTED</div>
                      <div className="mt-1 border border-red-400/40 bg-red-400/[0.04] px-3 py-2 text-red-400">
                        {clamp(selFraud.reported || "—", 28)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[7.5px] tracking-[0.2em] text-mute/50">RECOMPUTED</div>
                      <div className="mt-1 border border-edge px-3 py-2 text-mist/85">
                        {clamp(selFraud.recomputed || "—", 28)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-void p-4">
                  <div className="font-mono text-[8.5px] tracking-[0.24em] text-mute">REASON</div>
                  <p className="mt-3 font-mono text-[11px] leading-relaxed text-mist/80">
                    {selFraud.reason || "—"}
                  </p>
                  {(selFraud.challenge_votes?.length ?? 0) > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[8px] tracking-[0.14em]">
                      <span className="text-mute">CHALLENGE:</span>
                      {selFraud.challenge_votes!.map((v, i) => (
                        <span
                          key={i}
                          className={`flex items-center gap-1 border px-1.5 py-0.5 ${
                            v.ok ? "border-volt/40 text-volt" : "border-red-400/50 text-red-400"
                          }`}
                        >
                          {v.ok ? <Check size={9} /> : <X size={9} />}
                          {String(v.v).replace("vrf:", "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : selBatch ? (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.24em] text-mute">BATCH · EPOCH {selBatch.epoch.toLocaleString()}</div>
                  <div className="mt-2 font-display text-[30px] font-medium tracking-[-0.03em]">{selBatch.id}</div>
                </div>
                <Tag tone={selBatch.state === "SETTLING" ? "amber" : "volt"}>{selBatch.state}</Tag>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-px border border-edge bg-edge font-mono text-[9px] sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["MERKLE ROOT", clamp(selBatch.root, 18)],
                  ["TOTAL ESCROW", `${selBatch.total} USDC`],
                  ["RECEIPTS", String(selBatch.count)],
                  [
                    "ANCHORED TX",
                    selBatch.anchored_tx
                      ? clamp(selBatch.anchored_tx, 18)
                      : selBatch.state === "SETTLING"
                        ? "PENDING"
                        : "—",
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="bg-void p-3">
                    <div className="text-[7px] tracking-[0.2em] text-mute/50">{k}</div>
                    <div
                      className={`mt-1.5 truncate text-[10px] ${
                        k === "ANCHORED TX" && selBatch.anchored_tx ? "text-volt" : "text-mist"
                      }`}
                      title={
                        k === "ANCHORED TX" && selBatch.anchored_tx
                          ? `${selBatch.anchored_tx}${
                              selBatch.anchored_block != null ? ` · block ${selBatch.anchored_block}` : ""
                            }`
                          : undefined
                      }
                    >
                      {v}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 overflow-x-auto border border-edge">
                <div className="min-w-[520px]">
                  <div className="grid grid-cols-[100px_minmax(0,1fr)_70px_55px_70px] gap-2 border-b border-edge px-3 py-2 font-mono text-[7.5px] tracking-[0.18em] text-mute/50 sm:grid-cols-[110px_minmax(0,1fr)_120px_90px_80px_70px]">
                    <span>RECEIPT</span>
                    <span>ROUTE / SPEC</span>
                    <span className="hidden sm:inline">HEX</span>
                    <span className="text-right">AMOUNT</span>
                    <span className="text-right">MS</span>
                    <span>STATE</span>
                  </div>
                  {selBatch.receipts.length === 0 && (
                    <div className="px-3 py-5 font-mono text-[10px] text-mute/50">NO RECEIPTS IN BATCH</div>
                  )}
                  {selBatch.receipts.map((r) => {
                    const sel = r.id === selReceipt?.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelReceiptId(sel ? null : r.id);
                          setVerifyStep(-1);
                          setVerifiedFor(null);
                          setRemoteValid(null);
                          setLastProof(null);
                        }}
                        className={`grid w-full grid-cols-[100px_minmax(0,1fr)_70px_55px_70px] items-center gap-2 border-b border-edge/60 px-3 py-2.5 text-left font-mono text-[10px] transition-colors last:border-b-0 hover:bg-panel/70 sm:grid-cols-[110px_minmax(0,1fr)_120px_90px_80px_70px] ${
                          sel ? "bg-volt/[0.08] shadow-[inset_2px_0_0_var(--color-volt)]" : ""
                        }`}
                      >
                        <span className={`truncate ${sel ? "text-volt" : "text-mist"}`}>{r.id}</span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[9px] text-mute">
                          <span className="truncate">
                            <span
                              role="link"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                openAgent(r.buyer);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  openAgent(r.buyer);
                                }
                              }}
                              className="cursor-pointer text-mist hover:text-volt"
                            >
                              {r.buyer.replace("agent:", "")}
                            </span>
                            →
                            <span
                              role="link"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                openAgent(r.worker);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  openAgent(r.worker);
                                }
                              }}
                              className="cursor-pointer text-mist hover:text-volt"
                            >
                              {r.worker.replace("agent:", "")}
                            </span>
                          </span>
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
              </div>

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
                          <div
                            className={`mt-1 border px-3 py-2 ${
                              selReceipt.state === "DISPUTED" && k === "REPORTED"
                                ? "border-red-400/40 bg-red-400/[0.04]"
                                : "border-edge"
                            } ${c as string}`}
                          >
                            {clamp(v as string, 24)}
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-3 font-mono text-[8px] tracking-[0.14em]">
                        <button type="button" onClick={() => openAgent(selReceipt.buyer)} className="text-mute hover:text-volt">
                          BUYER {selReceipt.buyer.replace("agent:", "")}
                        </button>
                        <button type="button" onClick={() => openAgent(selReceipt.worker)} className="text-mute hover:text-volt">
                          WORKER {selReceipt.worker.replace("agent:", "")} · TRUST
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[8px] tracking-[0.14em]">
                        <span className="text-mute">VOTES:</span>
                        {selReceipt.votes.length === 0 && <span className="text-mute/50">—</span>}
                        {selReceipt.votes.map((v, i) => (
                          <span
                            key={i}
                            className={`flex items-center gap-1 border px-1.5 py-0.5 ${
                              v.ok ? "border-volt/40 text-volt" : "border-red-400/50 text-red-400"
                            }`}
                          >
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
                        onClick={() => void startVerify()}
                        className="flex items-center gap-1.5 border border-volt/60 px-2.5 py-1.5 font-mono text-[8.5px] tracking-[0.18em] text-volt transition-colors hover:bg-volt hover:text-void"
                      >
                        <ShieldCheck size={11} /> VERIFY
                      </button>
                    </div>
                    <ProofLadder r={selReceipt} verifyStep={verifyStep} remoteValid={remoteValid} />
                    {verifiedFor === selReceipt.id && remoteValid !== false && (
                      <div className="mt-3 flex items-center gap-2 border border-volt/40 bg-volt/[0.08] px-3 py-2.5 font-mono text-[9px] tracking-[0.18em] text-volt">
                        <Check size={12} strokeWidth={3} />
                        {source === "indexer" && remoteValid
                          ? "INDEXER VALID · ROOT MATCHES ANCHOR"
                          : "INCLUSION DISPLAYED · PATH FOLDED"}
                      </div>
                    )}
                    {remoteValid === false && (
                      <div className="mt-3 flex items-center gap-2 border border-red-400/50 bg-red-400/[0.06] px-3 py-2.5 font-mono text-[9px] tracking-[0.18em] text-red-400">
                        <X size={12} strokeWidth={3} />
                        PROOF INVALID AT INDEXER
                      </div>
                    )}
                    <div className="mt-3 font-mono text-[7px] leading-[1.9] tracking-[0.14em] text-mute/40">
                      {lastProof?.root
                        ? `ANCHOR ROOT ${clamp(lastProof.root, 20)} · ${source === "indexer" ? "SERVER-SIDE VERIFY" : "CLIENT DISPLAY"}`
                        : `PATH FROM ${clamp(selReceipt.leaf, 16)} · REPRODUCIBLE`}
                      {lastProof?.anchored_tx
                        ? ` · TX ${clamp(lastProof.anchored_tx, 16)}`
                        : selBatch.anchored_tx
                          ? ` · TX ${clamp(selBatch.anchored_tx, 16)}`
                          : ""}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="font-mono text-[11px] text-mute/50">SELECT A BATCH OR FRAUD CASE</div>
          )}
        </div>
      </div>

      <div className="border-t border-edge px-6 py-6 md:px-12">
        <div className="font-mono text-[8px] tracking-[0.24em] text-mute/40">
          EVERY RECEIPT IS PUBLIC · VERIFY WITHOUT TRUSTING CIPHER SENTRY&apos;S NODES · INDEXER :8081 · GATEWAY :8080
        </div>
      </div>
    </div>
  );
}

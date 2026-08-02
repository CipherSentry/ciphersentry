/**
 * Indexer HTTP client — public receipt graph (B6).
 *
 * URL resolution:
 *   ?indexer=http://host:8081   explicit
 *   ?node=http://host:8080      → same host :8081
 *   default                     http://127.0.0.1:8081
 */

import type { ExBatch, Receipt, Vote } from "../sdk/ledger";

export const DEFAULT_INDEXER = "http://127.0.0.1:8081";

export function readIndexerUrl(): string {
  try {
    const sp = new URLSearchParams(window.location.search);
    const explicit = sp.get("indexer");
    if (explicit) return explicit.replace(/\/$/, "");
    const node = sp.get("node");
    if (node) {
      const u = new URL(node);
      // gateway :8080 → indexer :8081 by convention
      if (u.port === "8080" || u.port === "") u.port = "8081";
      else if (u.port === "18080") u.port = "18081";
      return u.origin;
    }
  } catch {
    /* SSR / offline */
  }
  return DEFAULT_INDEXER;
}

/* ------------------------------ raw types --------------------------------- */

interface BatchSummary {
  batch_id: string;
  epoch: number | string;
  root: string;
  count: number | string;
  total: string | number;
  state: string;
  at?: string;
  anchored_block?: number | string | null;
  anchored_tx?: string | null;
}

interface ReceiptRow {
  receipt_id: string;
  task_id: string;
  reported: string;
  recomputed: string;
  votes?: Vote[] | string;
  ms?: number;
  epoch?: number | string;
  leaf: string;
  path?: string[] | string;
  batch_id?: string;
  buyer?: string;
  worker?: string;
  spec?: string;
  amount?: string;
}

export interface FraudRow {
  task_id: string;
  status: string;
  reported: string;
  recomputed?: string | null;
  buyer: string;
  worker: string;
  amount: string | number;
  ruling?: string | null;
  reason?: string | null;
  open_at?: string;
  resolved_at?: string | null;
  original_votes?: Vote[];
  challenge_votes?: Vote[];
  chain_mode?: string | null;
}

export interface ProofResult {
  leaf: string;
  path: string[];
  root: string;
  valid: boolean;
  anchored_block?: number | null;
  anchored_tx?: string | null;
}

export interface IndexerSearch {
  receipts: { receipt_id: string; batch_id: string }[];
  batches: { batch_id: string; epoch: number }[];
  agents: { agent_id: string; tier?: string; trust?: number }[];
  fraud: { task_id: string; status: string; ruling?: string }[];
}

/* ------------------------------ helpers ----------------------------------- */

function parseJsonField<T>(v: T | string | undefined | null, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v;
}

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Build explorer Receipt; path display = [leaf, ...siblings, root]. */
export function toReceipt(r: ReceiptRow, root: string, batchAt?: number): Receipt {
  const siblings = parseJsonField<string[]>(r.path, []);
  const votes = parseJsonField<Vote[]>(r.votes as Vote[] | string | undefined, []);
  const reported = r.reported || "";
  const recomputed = r.recomputed || reported;
  return {
    id: r.receipt_id || r.task_id,
    spec: r.spec || "unknown",
    buyer: r.buyer || "agent:unknown",
    worker: r.worker || "agent:unknown",
    amount: String(r.amount ?? "0"),
    state: reported && recomputed && reported !== recomputed ? "DISPUTED" : "SETTLED",
    reported,
    recomputed,
    votes: votes.map((v) => ({ v: v.v, ok: Boolean(v.ok) })),
    epoch: num(r.epoch),
    ms: num(r.ms),
    at: batchAt ?? Date.now(),
    leaf: r.leaf,
    path: [r.leaf, ...siblings, root].filter(Boolean),
  };
}

export function toBatch(
  b: BatchSummary,
  receipts: ReceiptRow[],
): ExBatch {
  const root = b.root || "";
  const at = b.at ? Date.parse(b.at) || Date.now() : Date.now();
  const rs = receipts.map((r) => toReceipt(r, root, at));
  const total = String(b.total ?? "0");
  return {
    id: b.batch_id,
    epoch: num(b.epoch),
    at,
    root,
    count: num(b.count, rs.length),
    total: total.includes(",")
      ? total
      : Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    state: b.state === "SETTLING" ? "SETTLING" : "SETTLED",
    receipts: rs,
  };
}

/* ------------------------------ client ------------------------------------ */

export class IndexerClient {
  constructor(public base: string) {}

  async health(): Promise<{ ok: boolean; phase?: string }> {
    const res = await fetch(`${this.base}/health`);
    if (!res.ok) throw new Error(`health ${res.status}`);
    return (await res.json()) as { ok: boolean; phase?: string };
  }

  async stats(): Promise<{ tasksIn?: number; batchesIn?: number; fraudIn?: number }> {
    const res = await fetch(`${this.base}/stats`);
    if (!res.ok) return {};
    return (await res.json()) as { tasksIn?: number; batchesIn?: number; fraudIn?: number };
  }

  async listBatches(): Promise<BatchSummary[]> {
    const res = await fetch(`${this.base}/batches`);
    if (!res.ok) throw new Error(`batches ${res.status}`);
    const body = (await res.json()) as { data: BatchSummary[] };
    return body.data ?? [];
  }

  async getBatch(id: string): Promise<ExBatch | null> {
    const res = await fetch(`${this.base}/batches/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`batch ${res.status}`);
    const body = (await res.json()) as { data: { batch: BatchSummary; receipts: ReceiptRow[] } };
    if (!body.data?.batch) return null;
    return toBatch(body.data.batch, body.data.receipts ?? []);
  }

  /** Hydrate top N batches with receipts (newest first). */
  async loadLedger(limit = 12): Promise<ExBatch[]> {
    const summaries = await this.listBatches();
    const slice = summaries.slice(0, limit);
    const out: ExBatch[] = [];
    for (const s of slice) {
      const full = await this.getBatch(s.batch_id);
      if (full) out.push(full);
      else out.push(toBatch(s, []));
    }
    // oldest → newest (matches sim ledger direction)
    return out.reverse();
  }

  async proof(receiptId: string): Promise<ProofResult | null> {
    const res = await fetch(`${this.base}/receipts/${encodeURIComponent(receiptId)}/proof`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`proof ${res.status}`);
    const body = (await res.json()) as {
      data: {
        leaf: string;
        path: string[] | string;
        valid: boolean;
        anchor: { root?: string; anchored_block?: number | null; anchored_tx?: string | null } | null;
      };
    };
    const d = body.data;
    if (!d) return null;
    return {
      leaf: d.leaf,
      path: parseJsonField(d.path, []),
      root: d.anchor?.root ?? "",
      valid: Boolean(d.valid),
      anchored_block: d.anchor?.anchored_block ?? null,
      anchored_tx: d.anchor?.anchored_tx ?? null,
    };
  }

  async listFraud(limit = 20): Promise<FraudRow[]> {
    const res = await fetch(`${this.base}/fraud`);
    if (!res.ok) return [];
    const body = (await res.json()) as { data: FraudRow[] };
    return (body.data ?? []).slice(0, limit);
  }

  async getFraud(taskId: string): Promise<FraudRow | null> {
    const res = await fetch(`${this.base}/fraud/${encodeURIComponent(taskId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fraud ${res.status}`);
    const body = (await res.json()) as { data: FraudRow };
    return body.data ?? null;
  }

  async search(q: string): Promise<IndexerSearch> {
    const res = await fetch(`${this.base}/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return { receipts: [], batches: [], agents: [], fraud: [] };
    const body = (await res.json()) as {
      data: {
        receipts?: IndexerSearch["receipts"];
        batches?: IndexerSearch["batches"];
        agents?: IndexerSearch["agents"];
        fraud?: IndexerSearch["fraud"];
      };
    };
    return {
      receipts: body.data?.receipts ?? [],
      batches: body.data?.batches ?? [],
      agents: body.data?.agents ?? [],
      fraud: body.data?.fraud ?? [],
    };
  }
}

/** Probe indexer; returns client if healthy, else null. */
export async function connectIndexer(base = readIndexerUrl()): Promise<IndexerClient | null> {
  const c = new IndexerClient(base);
  try {
    const h = await c.health();
    if (h.ok) return c;
  } catch {
    /* offline */
  }
  return null;
}

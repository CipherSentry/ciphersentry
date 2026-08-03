/**
 * Indexer HTTP client — public receipt graph (B6).
 *
 * URL resolution:
 *   ?indexer=http://host:8081   explicit
 *   ?node=http://host:8080      → same host :8081
 *   default                     http://127.0.0.1:8081
 */

import type { ExBatch, Receipt, Vote } from "../sdk/ledger";
import { indexerFromNode, LOCAL_INDEXER, resolveDefaultIndexer } from "../sdk/publicEndpoints";

export const DEFAULT_INDEXER = LOCAL_INDEXER;

function readParams(): URLSearchParams {
  try {
    const sp = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, "");
    const qi = hash.indexOf("?");
    if (qi >= 0) {
      const hp = new URLSearchParams(hash.slice(qi + 1));
      hp.forEach((v, k) => {
        if (!sp.has(k)) sp.set(k, v);
      });
    }
    return sp;
  } catch {
    return new URLSearchParams();
  }
}

export function readIndexerUrl(): string {
  try {
    const sp = readParams();
    const explicit = sp.get("indexer");
    if (explicit) return explicit.replace(/\/$/, "");
    const node = sp.get("node");
    if (node) return indexerFromNode(node);
  } catch {
    /* SSR / offline */
  }
  return resolveDefaultIndexer();
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
  reconciled?: boolean;
  receipt_id?: string;
  task_id?: string;
  batch_id?: string;
  anchored_block?: number | null;
  anchored_tx?: string | null;
}

export interface BatchProofsSummary {
  batch_id: string;
  root: string;
  count: number;
  all_valid: boolean;
  valid_count: number;
  proofs: Array<{ receipt_id: string; task_id: string; leaf: string; valid: boolean }>;
}

export interface IndexerTaskHit {
  task_id: string;
  state: string;
  worker?: string;
  buyer?: string;
  amount?: string | number;
  spec?: string;
  reported_hash?: string | null;
}

export interface IndexerSearch {
  receipts: { receipt_id: string; batch_id: string }[];
  batches: { batch_id: string; epoch: number }[];
  agents: { agent_id: string; tier?: string; trust?: number }[];
  fraud: { task_id: string; status: string; ruling?: string }[];
  /** Pre-batch task rows (available as soon as task.event is indexed). */
  tasks: IndexerTaskHit[];
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
    anchored_tx: b.anchored_tx ?? null,
    anchored_block: b.anchored_block != null ? num(b.anchored_block) : null,
  };
}

/* ------------------------------ client ------------------------------------ */

export class IndexerClient {
  constructor(public base: string) {}

  async health(): Promise<{ ok: boolean; phase?: string; service?: string }> {
    // Co-located Fly: indexer is under /indexer/health; bare /health is gateway.
    for (const path of ["/indexer/health", "/health"]) {
      try {
        const res = await fetch(`${this.base}${path}`);
        if (!res.ok) continue;
        const h = (await res.json()) as { ok?: boolean; phase?: string; service?: string };
        if (!h.ok) continue;
        if (path === "/indexer/health") return h as { ok: boolean; phase?: string; service?: string };
        if (h.service?.includes("indexer")) return h as { ok: boolean; phase?: string; service?: string };
        // Gateway ok on same origin still means path-proxy is up; accept last.
        if (path === "/health") return { ok: true, phase: h.phase, service: h.service };
      } catch {
        /* try next */
      }
    }
    throw new Error("health unreachable");
  }

  async stats(): Promise<{ tasksIn?: number; batchesIn?: number; fraudIn?: number }> {
    for (const path of ["/stats", "/indexer/stats"]) {
      try {
        const res = await fetch(`${this.base}${path}`);
        if (!res.ok) continue;
        // gateway may 404 or JSON-RPC on unknown path
        const body = (await res.json()) as { tasksIn?: number; batchesIn?: number; fraudIn?: number; error?: unknown };
        if (body && typeof body === "object" && !("error" in body && body.error)) return body;
      } catch {
        /* try next */
      }
    }
    return {};
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
        reconciled?: boolean;
        receipt_id?: string;
        task_id?: string;
        batch_id?: string;
        anchor: {
          root?: string;
          anchored_block?: number | null;
          anchored_tx?: string | null;
        } | null;
      };
    };
    const d = body.data;
    if (!d) return null;
    return {
      leaf: d.leaf,
      path: parseJsonField(d.path, []),
      root: (d.anchor as { root?: string } | null)?.root ?? "",
      valid: Boolean(d.valid),
      reconciled: d.reconciled ?? Boolean(d.valid),
      receipt_id: d.receipt_id,
      task_id: d.task_id,
      batch_id: d.batch_id,
      anchored_block: d.anchor?.anchored_block ?? null,
      anchored_tx: d.anchor?.anchored_tx ?? null,
    };
  }

  async batchProofs(batchId: string): Promise<BatchProofsSummary | null> {
    const res = await fetch(`${this.base}/batches/${encodeURIComponent(batchId)}/proofs`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`batch proofs ${res.status}`);
    const body = (await res.json()) as { data: BatchProofsSummary };
    return body.data ?? null;
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
    if (!res.ok) return { receipts: [], batches: [], agents: [], fraud: [], tasks: [] };
    const body = (await res.json()) as {
      data: {
        receipts?: IndexerSearch["receipts"];
        batches?: IndexerSearch["batches"];
        agents?: IndexerSearch["agents"];
        fraud?: IndexerSearch["fraud"];
        tasks?: IndexerSearch["tasks"];
      };
    };
    return {
      receipts: body.data?.receipts ?? [],
      batches: body.data?.batches ?? [],
      agents: body.data?.agents ?? [],
      fraud: body.data?.fraud ?? [],
      tasks: body.data?.tasks ?? [],
    };
  }

  async getTask(taskId: string): Promise<IndexerTaskHit | null> {
    const res = await fetch(`${this.base}/tasks/${encodeURIComponent(taskId)}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as { data: IndexerTaskHit };
    return body.data ?? null;
  }

  /** Whitepaper §5 trust series — GET /trust/:agent?limit=&since_epoch= */
  async getTrust(
    agentId: string,
    opts?: { limit?: number; sinceEpoch?: number },
  ): Promise<TrustPoint[]> {
    const q = new URLSearchParams();
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    if (opts?.sinceEpoch != null) q.set("since_epoch", String(opts.sinceEpoch));
    const qs = q.toString();
    const res = await fetch(
      `${this.base}/trust/${encodeURIComponent(agentId)}${qs ? `?${qs}` : ""}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { data: TrustPoint[] };
    const rows = body.data ?? [];
    // API returns newest-first; chart wants chronological
    return [...rows].sort((a, b) => num(a.epoch) - num(b.epoch));
  }

  async getAgent(agentId: string): Promise<{ agent_id: string; trust?: number; stake?: number; success?: number } | null> {
    const res = await fetch(`${this.base}/agents/${encodeURIComponent(agentId)}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as { data: { agent_id: string; trust?: number; stake?: number; success?: number } };
    return body.data ?? null;
  }
}

export interface TrustPoint {
  agent_id?: string;
  epoch: number;
  trust_score: number;
  stake?: number;
  success?: number;
  settled_count?: number;
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

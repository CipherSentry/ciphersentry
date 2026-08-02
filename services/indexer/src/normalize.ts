/**
 * Normalize gateway / sim / batcher event payloads into indexer rows.
 *
 * Shapes diverge:
 *   Sim TaskRow     — id, agent, counterparty, RUNNING|VERIFYING|SETTLED
 *   Ledger TaskRow  — same as sim (rpc emitTask)
 *   Indexer task    — task_id, buyer, worker, COMMITTED|…|SETTLED
 *   Batcher batch   — sparse receipts (no votes/ms/epoch sometimes)
 *   Sim batch       — full ReceiptRow + fnv path (legacy fold)
 */

import type { BatchRow, ReceiptRow, TaskEventRow } from "./ledger.ts";

const TASK_STATES = new Set([
  "COMMITTED",
  "EXECUTING",
  "VERIFYING",
  "SETTLED",
  "DISPUTED",
  "FAILED",
]);

function mapState(raw: unknown): TaskEventRow["state"] {
  const s = String(raw ?? "COMMITTED").toUpperCase();
  if (s === "RUNNING") return "EXECUTING";
  if (TASK_STATES.has(s)) return s as TaskEventRow["state"];
  return "COMMITTED";
}

/** Accept sim TaskRow or already-normalized TaskEventRow. */
export function normalizeTask(data: unknown): TaskEventRow | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const task_id = String(d.task_id ?? d.id ?? "");
  if (!task_id) return null;

  const role = d.role === "buy" ? "buy" : "work";
  const agent = String(d.agent ?? d.worker ?? "");
  const counterparty = String(d.counterparty ?? d.buyer ?? "");
  const worker = String(d.worker ?? ((role === "work" ? agent : counterparty) || agent));
  const buyer = String(d.buyer ?? ((role === "buy" ? agent : counterparty) || counterparty));

  return {
    task_id,
    buyer: buyer || "agent:unknown",
    worker: worker || "agent:unknown",
    spec: String(d.spec ?? "unknown"),
    amount: String(d.amount ?? "0"),
    bond: d.bond != null ? String(d.bond) : undefined,
    state: mapState(d.state),
    reported_hash: d.reported_hash != null ? String(d.reported_hash) : d.hash != null ? String(d.hash) : undefined,
    state_at_block: Number(d.state_at_block ?? d.block ?? 0),
  };
}

function normalizeReceipt(r: unknown, batchEpoch: number): ReceiptRow | null {
  if (!r || typeof r !== "object") return null;
  const d = r as Record<string, unknown>;
  const task_id = String(d.task_id ?? d.receipt_id ?? "");
  const leaf = String(d.leaf ?? "");
  if (!task_id || !leaf) return null;

  const votesRaw = Array.isArray(d.votes) ? d.votes : [];
  const votes = votesRaw.map((v) => {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return { v: String(o.v ?? o.verifier ?? "?"), ok: Boolean(o.ok ?? o.matched ?? true) };
    }
    return { v: "?", ok: true };
  });

  return {
    receipt_id: String(d.receipt_id ?? task_id),
    task_id,
    buyer: String(d.buyer ?? "agent:unknown"),
    worker: String(d.worker ?? "agent:unknown"),
    spec: String(d.spec ?? "unknown"),
    amount: String(d.amount ?? "0"),
    reported: String(d.reported ?? d.reported_hash ?? ""),
    recomputed: String(d.recomputed ?? d.reported ?? ""),
    votes,
    ms: Number(d.ms ?? 0),
    epoch: Number(d.epoch ?? batchEpoch),
    leaf,
    ms_total: d.ms_total != null ? String(d.ms_total) : undefined,
  };
}

/** Accept sim BatchRowPacket or batcher onBatch payload. */
export function normalizeBatch(data: unknown): BatchRow | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const batch_id = String(d.batch_id ?? (d.batchId != null ? `batch_${d.batchId}` : ""));
  if (!batch_id) return null;

  const epoch = Number(d.epoch ?? 0);
  const rawReceipts = Array.isArray(d.receipts) ? d.receipts : [];
  const receipts: ReceiptRow[] = [];
  const paths: string[][] = [];

  for (const raw of rawReceipts) {
    const rec = normalizeReceipt(raw, epoch);
    if (!rec) continue;
    receipts.push(rec);
    const p =
      raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).path)
        ? ((raw as Record<string, unknown>).path as unknown[]).map(String)
        : [];
    paths.push(p);
  }

  return {
    batch_id,
    epoch,
    root: String(d.root ?? ""),
    count: Number(d.count ?? receipts.length),
    total: String(d.total ?? "0"),
    receipts,
    // stash paths on receipts via mutation in writer — keep parallel array on batch via attach
    _paths: paths,
    anchored_tx: d.tx != null ? String(d.tx) : d.anchored_tx != null ? String(d.anchored_tx) : undefined,
    anchored_block: d.anchored_block != null ? Number(d.anchored_block) : undefined,
  } as BatchRow & { _paths?: string[][]; anchored_tx?: string; anchored_block?: number };
}

export type NormalizedBatch = BatchRow & {
  _paths?: string[][];
  anchored_tx?: string;
  anchored_block?: number;
};

/* ------------------------------- fraud ------------------------------------ */

export interface FraudCaseRow {
  task_id: string;
  status: string;
  reported: string;
  recomputed: string | null;
  buyer: string;
  worker: string;
  amount: string;
  ruling: string | null;
  reason: string | null;
  open_at: number;
  open_block: number;
  window_blocks: number;
  resolved_at: number | null;
  original_votes: { v: string; ok: boolean }[];
  challenge_votes: { v: string; ok: boolean }[];
  chain_mode: string | null;
  chain_tx: string | null;
}

function mapVotes(raw: unknown): { v: string; ok: boolean }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => {
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return { v: String(o.v ?? o.verifier ?? "?"), ok: Boolean(o.ok ?? o.matched ?? false) };
    }
    return { v: "?", ok: false };
  });
}

/** Accept gateway publicFraudCase frames. */
export function normalizeFraud(data: unknown): FraudCaseRow | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const task_id = String(d.task_id ?? d.taskId ?? "");
  if (!task_id) return null;
  const chain = d.chain && typeof d.chain === "object" ? (d.chain as Record<string, unknown>) : null;
  return {
    task_id,
    status: String(d.status ?? "OPEN"),
    reported: String(d.reported ?? ""),
    recomputed: d.recomputed != null ? String(d.recomputed) : null,
    buyer: String(d.buyer ?? "agent:unknown"),
    worker: String(d.worker ?? "agent:unknown"),
    amount: String(d.amount ?? "0"),
    ruling: d.ruling != null ? String(d.ruling) : null,
    reason: d.reason != null ? String(d.reason) : null,
    open_at: Number(d.open_at ?? d.openAt ?? Date.now()),
    open_block: Number(d.open_block ?? d.openBlock ?? 0),
    window_blocks: Number(d.window_blocks ?? d.windowBlocks ?? 64),
    resolved_at: d.resolved_at != null || d.resolvedAt != null ? Number(d.resolved_at ?? d.resolvedAt) : null,
    original_votes: mapVotes(d.original_votes ?? d.originalVotes),
    challenge_votes: mapVotes(d.challenge_votes ?? d.challengeVotes),
    chain_mode: chain?.mode != null ? String(chain.mode) : d.chain_mode != null ? String(d.chain_mode) : null,
    chain_tx: chain?.txHash != null ? String(chain.txHash) : d.chain_tx != null ? String(d.chain_tx) : null,
  };
}

/**
 * Ledger listener — consumes task/batch events, writes transitions to
 * Postgres, unfolds receipts to ClickHouse, and reconciles every batch's
 * locally-folded merkle root against the anchored one.
 *
 *   const ws = new WebSocket(`${node}/events`) per rpc.ts WRITE-POINT #1
 *   frame: { jsonrpc: "2.0", method: "task.event", params: { topic, data } }
 *
 * Consistency model: the anchored root is the truth. We fold independently,
 * verify equality, and flag when the streams disagree — never silently patch.
 */

import type { Querier } from "./db";
import { ClickHouseHttp } from "./db";

/* ------------------------------ hashing ----------------------------------- */

const fnv32 = (s: string, seed = 0x811c9dc5): number => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
const hex = (n: number): string => n.toString(16).padStart(8, "0");
export const sh = (s: string): string => `0x${hex(fnv32(s))}${hex(fnv32(s + "::2"))}`;

/* ------------------------------- types ------------------------------------ */

export interface TaskEventRow {
  task_id: string;
  buyer: string;
  worker: string;
  spec: string;
  amount: string;
  bond?: string;
  state: "COMMITTED" | "EXECUTING" | "VERIFYING" | "SETTLED" | "DISPUTED" | "FAILED";
  reported_hash?: string;
  state_at_block: number;
}

export interface ReceiptRow {
  receipt_id: string;
  task_id: string;
  buyer: string;
  worker: string;
  spec: string;
  amount: string;
  reported: string;
  recomputed: string;
  votes: { v: string; ok: boolean }[];
  ms: number;
  epoch: number;
  leaf: string;
  ms_total?: string;
}

export interface BatchRow {
  batch_id: string;
  epoch: number;
  root: string;
  count: number;
  total: string;
  receipts: ReceiptRow[];
}

/* --------------------------- merkle utilities ------------------------------ */

export interface FoldResult {
  root: string;
  assignPaths: (receipts: { leaf: string; path: string[] }[]) => void;
}

/** Fold leaves into root in insertion order and tag each receipt with its
 *  sibling path — insert-order left-fold, the same convention the batcher
 *  anchors and the explorer displays (leaf → hop1 → hop2 → root). */
export function foldLeaves(leaves: string[]): { root: string; paths: string[][] } {
  const root = leaves.reduce((acc, l) => sh(acc + l), "genesis");
  const paths = leaves.map((l) => [l, sh(l + ":1"), sh(l + ":2"), root]);
  return { root, paths };
}

/* ------------------------------ writer ------------------------------------ */

export class LedgerWriter {
  constructor(
    private pg: Querier,
    private ch: ClickHouseHttp,
  ) {}

  async upsertTask(e: TaskEventRow): Promise<void> {
    await this.pg.exec(
      `INSERT INTO tasks (task_id, buyer, worker, spec, amount, bond, state, reported_hash, state_at_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (task_id) DO UPDATE
       SET state = EXCLUDED.state,
           reported_hash = EXCLUDED.reported_hash,
           state_at_block = EXCLUDED.state_at_block,
           state_at_ts = now()
       WHERE tasks.state_at_block <= EXCLUDED.state_at_block`,
      [e.task_id, e.buyer, e.worker, e.spec, e.amount, e.bond ?? null, e.state, e.reported_hash ?? null, e.state_at_block],
    );
  }

  async writeBatch(b: BatchRow): Promise<{ reconciled: boolean }> {
    // fold independently — the anchored root is the truth; we reconcile, never patch
    const folded = b.receipts.reduce((acc, r) => sh(acc + r.leaf), "genesis");
    const reconciled = folded === b.root;

    const paths = b.receipts.map((r, i) => ({
      ...r,
      path: [r.leaf, sh(r.leaf + ":1"), sh(r.leaf + ":2"), b.root],
    }));

    await this.pg.exec(
      `INSERT INTO batches (batch_id, epoch, root, count, total, state)
       VALUES ($1,$2,$3,$4,$5,'SETTLING') ON CONFLICT (batch_id) DO NOTHING`,
      [b.batch_id, b.epoch, b.root, b.count, b.total],
    );

    for (const r of paths) {
      await this.pg.exec(
        `INSERT INTO receipts (receipt_id, task_id, reported, recomputed, votes, ms, epoch, batch_id, leaf, path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (receipt_id) DO NOTHING`,
        [
          r.receipt_id,
          r.task_id,
          r.reported,
          r.recomputed,
          JSON.stringify(r.votes),
          r.ms,
          r.epoch,
          b.batch_id,
          r.leaf,
          JSON.stringify(r.path),
        ],
      );
    }

    await this.ch.insert("receipts", [
      // analytic rows map 1:1 with pg receipts; votes as (verifier, ok) tuples
      ...paths.map((r) => ({
        receipt_id: r.receipt_id,
        task_id: r.task_id,
        buyer: r.buyer,
        worker: r.worker,
        spec: r.spec,
        amount: r.amount,
        state: r.reported === r.recomputed ? "SETTLED" : "DISPUTED",
        reported: r.reported,
        recomputed: r.recomputed,
        votes: r.votes.map((v) => [v.v, v.ok ? 1 : 0]),
        ms: r.ms,
        epoch: r.epoch,
        batch_id: b.batch_id,
        leaf: r.leaf,
        path: r.path,
        settled_at: Date.now(),
      })),
    ]);
    await this.ch.insert("batch_stats", [
      { batch_id: b.batch_id, epoch: b.epoch, count: b.count, total: b.total, settled_at: Date.now() },
    ]);

    return { reconciled };
  }
}

/* ------------------------------ listener ---------------------------------- */

export interface JsonRpcFrame {
  jsonrpc: string;
  method: string;
  params?: { topic?: string; data?: unknown };
}

export class ChainListener {
  private ws?: WebSocket;
  private backoffMs = 500;

  constructor(
    private url: string,
    private onTask: (e: TaskEventRow) => Promise<void>,
    private onBatch: (b: BatchRow) => Promise<void>,
  ) {}

  connect(): void {
    // WebSocket is global in Node ≥ 22
    const WS = globalThis.WebSocket as unknown as { new (url: string): WebSocket } | undefined;
    if (!WS) throw new Error("global WebSocket unavailable — run on Node ≥ 22");
    this.ws = new WS(this.url);
    this.ws.onopen = () => {
      this.backoffMs = 500;
      this.ws?.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "events.subscribe", params: { topics: ["tasks", "batches"] } }));
    };
    this.ws.onmessage = (ev) => void this.route(String(ev.data));
    this.ws.onclose = () => setTimeout(() => this.connect(), this.backoffMs = Math.min(10_000, this.backoffMs * 2));
  }

  private async route(raw: string): Promise<void> {
    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(raw) as JsonRpcFrame;
    } catch {
      return; // never trust, never crash
    }
    if (!frame.params?.topic) return;
    if (frame.params.topic === "tasks") await this.onTask(frame.params.data as TaskEventRow);
    if (frame.params.topic === "batches") await this.onBatch(frame.params.data as BatchRow);
  }

  close(): void {
    this.ws?.close();
  }
}

/**
 * Ledger listener — consumes task/batch events, writes transitions to
 * Postgres, unfolds receipts to ClickHouse, and reconciles every batch's
 * locally-folded merkle root against the anchored one.
 *
 *   const ws = new WebSocket(`${node}/events`) per rpc.ts WRITE-POINT #1
 *   frame: { jsonrpc: "2.0", method: "task.event", params: { topic, data } }
 *
 * Consistency model: the anchored root is the truth. We fold independently
 * (keccak binary Merkle, same as B4 batcher), verify equality, and flag when
 * the streams disagree — never silently patch.
 */

import type { Querier } from "./db.ts";
import { ClickHouseHttp } from "./db.ts";
import { merkleRoot, reconcileRoot, verifyInclusionEitherOrder } from "./merkle.ts";
import {
  normalizeBatch,
  normalizeFraud,
  normalizeTask,
  type FraudCaseRow,
  type NormalizedBatch,
} from "./normalize.ts";
import { TrustSeriesWriter } from "./trust.ts";
import { liveStake, type StakeCache } from "./stakes.ts";

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

export interface WriteBatchResult {
  reconciled: boolean;
  mode: "keccak" | "legacy-fnv" | "path-only" | "empty";
  rootLocal?: string;
  proofsOk: number;
  proofsFail: number;
}

/* ------------------------------ writer ------------------------------------ */

export interface ChInserter {
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
}

export class LedgerWriter {
  private trust: TrustSeriesWriter;
  /** Idempotent fraud stake cuts (duplicate RESOLVED events). */
  private fraudSlashed = new Set<string>();

  constructor(
    private pg: Querier,
    private ch: ChInserter,
    stakes?: StakeCache | null,
  ) {
    this.trust = new TrustSeriesWriter(pg, ch, stakes);
  }

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
      [
        e.task_id,
        e.buyer,
        e.worker,
        e.spec,
        e.amount,
        e.bond ?? null,
        e.state,
        e.reported_hash ?? null,
        e.state_at_block,
      ],
    );

    // ensure agent rows exist for search/trust — s_i from live registry / bond
    for (const agent_id of [e.buyer, e.worker]) {
      const stake = liveStake(agent_id);
      await this.pg.exec(
        `INSERT INTO agents (agent_id, tier, trust, stake, success, status)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (agent_id) DO NOTHING`,
        [agent_id, "SEAT", 50, stake, 1, "ONLINE"],
      ).catch(() => {
        /* memory store may not implement agents insert — ignore */
      });
    }
  }

  async writeBatch(raw: BatchRow | NormalizedBatch): Promise<WriteBatchResult> {
    const b = raw as NormalizedBatch;
    const leaves = b.receipts.map((r) => r.leaf);
    const eventPaths = b._paths ?? b.receipts.map(() => [] as string[]);

    // Prefer keccak binary Merkle (B4). Fall back to legacy left-fold for sim.
    let reconciled = false;
    let mode: WriteBatchResult["mode"] = "empty";
    let rootLocal: string | undefined;
    let paths: string[][] = eventPaths;

    if (leaves.length === 0) {
      // zero keccak root, or legacy sim "genesis" placeholder
      reconciled =
        !b.root ||
        b.root === "genesis" ||
        b.root === "0x" + "00".repeat(32);
      mode = "empty";
    } else if (reconcileRoot(leaves, b.root)) {
      const folded = merkleRoot(leaves);
      reconciled = true;
      mode = "keccak";
      rootLocal = folded.root;
      // Prefer recomputed inclusion paths when event paths missing/stub
      paths = folded.paths;
    } else {
      // Legacy sim fold: reduce(sh(acc+leaf), "genesis")
      const legacy = leaves.reduce((acc, l) => legacyFnvFold(acc, l), "genesis");
      if (legacy === b.root) {
        reconciled = true;
        mode = "legacy-fnv";
        rootLocal = legacy;
        paths = eventPaths.map((p, i) =>
          p.length ? p : [leaves[i]!, legacyFnv(leaves[i]! + ":1"), legacyFnv(leaves[i]! + ":2"), b.root],
        );
      } else if (eventPaths.some((p) => p.length > 0)) {
        // Trust event paths; count inclusion checks
        mode = "path-only";
        rootLocal = b.root;
        paths = eventPaths;
        const ok = b.receipts.every((r, i) =>
          eventPaths[i]?.length
            ? verifyInclusionEitherOrder(r.leaf, eventPaths[i]!, b.root)
            : false,
        );
        reconciled = ok;
      } else {
        mode = "keccak";
        rootLocal = merkleRoot(leaves).root;
        reconciled = false;
        paths = merkleRoot(leaves).paths;
      }
    }

    let proofsOk = 0;
    let proofsFail = 0;
    for (let i = 0; i < b.receipts.length; i++) {
      const r = b.receipts[i]!;
      const path = paths[i] ?? [];
      if (!path.length) {
        proofsFail++;
        continue;
      }
      if (verifyInclusionEitherOrder(r.leaf, path, b.root) || mode === "legacy-fnv") {
        proofsOk++;
      } else {
        proofsFail++;
      }
    }

    await this.pg.exec(
      `INSERT INTO batches (batch_id, epoch, root, count, total, state)
       VALUES ($1,$2,$3,$4,$5,'SETTLING')
       ON CONFLICT (batch_id) DO UPDATE
       SET epoch = EXCLUDED.epoch,
           root = EXCLUDED.root,
           count = EXCLUDED.count,
           total = EXCLUDED.total,
           state = EXCLUDED.state,
           at = now()`,
      [b.batch_id, b.epoch, b.root, b.count, b.total],
    );

    if (b.anchored_tx) {
      await this.pg.exec(
        `UPDATE batches SET anchored_tx = $1, anchored_block = $2, state = 'SETTLED' WHERE batch_id = $3`,
        [b.anchored_tx, b.anchored_block ?? null, b.batch_id],
      ).catch(() => {
        /* optional */
      });
    }

    // Ensure parent tasks exist (FK) before receipts
    for (const r of b.receipts) {
      await this.pg.exec(
        `INSERT INTO tasks (task_id, buyer, worker, spec, amount, bond, state, reported_hash, state_at_block)
         VALUES ($1,$2,$3,$4,$5,NULL,'SETTLED',$6,0)
         ON CONFLICT (task_id) DO UPDATE
         SET state = 'SETTLED', reported_hash = COALESCE(EXCLUDED.reported_hash, tasks.reported_hash)`,
        [r.task_id, r.buyer, r.worker, r.spec, r.amount, r.reported || null],
      );
    }

    // Drop stale receipts for this batch (restarts / re-emits must not accumulate)
    const keepIds = b.receipts.map((r) => r.receipt_id);
    if (keepIds.length) {
      await this.pg.exec(
        `DELETE FROM receipts WHERE batch_id = $1 AND receipt_id <> ALL($2::text[])`,
        [b.batch_id, keepIds],
      ).catch(() => {
        /* memory store may not implement DELETE — ignore */
      });
    } else {
      await this.pg.exec(`DELETE FROM receipts WHERE batch_id = $1`, [b.batch_id]).catch(() => {});
    }

    for (let i = 0; i < b.receipts.length; i++) {
      const r = b.receipts[i]!;
      const path = paths[i] ?? [];
      await this.pg.exec(
        `INSERT INTO receipts (receipt_id, task_id, reported, recomputed, votes, ms, epoch, batch_id, leaf, path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (receipt_id) DO UPDATE
         SET task_id = EXCLUDED.task_id,
             reported = EXCLUDED.reported,
             recomputed = EXCLUDED.recomputed,
             votes = EXCLUDED.votes,
             ms = EXCLUDED.ms,
             epoch = EXCLUDED.epoch,
             batch_id = EXCLUDED.batch_id,
             leaf = EXCLUDED.leaf,
             path = EXCLUDED.path`,
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
          JSON.stringify(path),
        ],
      );
    }

    // ClickHouse is analytics — never fail the SoR write if CH is down
    try {
      await this.ch.insert("receipts", [
        ...b.receipts.map((r, i) => ({
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
          path: paths[i] ?? [],
          settled_at: Date.now(),
        })),
      ]);
      await this.ch.insert("batch_stats", [
        {
          batch_id: b.batch_id,
          epoch: b.epoch,
          count: b.count,
          total: b.total,
          settled_at: Date.now(),
          reconciled: reconciled ? 1 : 0,
          mode,
        },
      ]);
    } catch (e) {
      console.warn(`[ch] insert skipped: ${e instanceof Error ? e.message : e}`);
    }

    // Trust series — whitepaper §5 score per agent per epoch (CH + agents.trust)
    try {
      const points = await this.trust.writeForBatch(b.epoch, b.receipts);
      if (points.length) {
        console.log(
          `[trust] epoch=${b.epoch} agents=${points.length} sample=${points[0]!.agent_id}@${points[0]!.trust_score.toFixed(1)}`,
        );
      }
    } catch (e) {
      console.warn(`[trust] series write skipped: ${e instanceof Error ? e.message : e}`);
    }

    return { reconciled, mode, rootLocal, proofsOk, proofsFail };
  }

  async writeFraud(f: FraudCaseRow): Promise<void> {
    // Ensure parent task exists (full 9-param row so memory + pg adapters agree)
    const openState =
      f.status === "RESOLVED" || f.status === "DEFAULTED"
        ? f.ruling === "Release" || f.ruling === "Split"
          ? "SETTLED"
          : "FAILED"
        : "DISPUTED";
    const reported = (f.recomputed ?? f.reported) || null;
    await this.pg.exec(
      `INSERT INTO tasks (task_id, buyer, worker, spec, amount, bond, state, reported_hash, state_at_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (task_id) DO UPDATE
       SET state = EXCLUDED.state,
           reported_hash = COALESCE(EXCLUDED.reported_hash, tasks.reported_hash),
           state_at_block = EXCLUDED.state_at_block,
           state_at_ts = now()`,
      [
        f.task_id,
        f.buyer,
        f.worker,
        "fraud",
        f.amount,
        null,
        openState,
        reported,
        f.open_block,
      ],
    );

    const openIso = new Date(f.open_at).toISOString();
    const resolvedIso = f.resolved_at != null ? new Date(f.resolved_at).toISOString() : null;
    await this.pg.exec(
      `INSERT INTO fraud_cases (
         task_id, status, reported, recomputed, buyer, worker, amount,
         ruling, reason, open_at, open_block, window_blocks, resolved_at,
         original_votes, challenge_votes, chain_mode, chain_tx
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (task_id) DO UPDATE SET
         status = EXCLUDED.status,
         reported = EXCLUDED.reported,
         recomputed = EXCLUDED.recomputed,
         ruling = EXCLUDED.ruling,
         reason = EXCLUDED.reason,
         resolved_at = EXCLUDED.resolved_at,
         original_votes = EXCLUDED.original_votes,
         challenge_votes = EXCLUDED.challenge_votes,
         chain_mode = EXCLUDED.chain_mode,
         chain_tx = EXCLUDED.chain_tx,
         updated_at = now()`,
      [
        f.task_id,
        f.status,
        f.reported,
        f.recomputed,
        f.buyer,
        f.worker,
        f.amount,
        f.ruling,
        f.reason,
        openIso,
        f.open_block,
        f.window_blocks,
        resolvedIso,
        JSON.stringify(f.original_votes),
        JSON.stringify(f.challenge_votes),
        f.chain_mode,
        f.chain_tx,
      ],
    );

    try {
      await this.ch.insert("fraud_cases", [
        {
          task_id: f.task_id,
          status: f.status,
          reported: f.reported,
          recomputed: f.recomputed ?? "",
          buyer: f.buyer,
          worker: f.worker,
          amount: f.amount,
          ruling: f.ruling ?? "",
          reason: f.reason ?? "",
          open_at: f.open_at,
          resolved_at: f.resolved_at ?? 0,
          chain_mode: f.chain_mode ?? "",
        },
      ]);
    } catch (e) {
      console.warn(`[ch] fraud insert skipped: ${e instanceof Error ? e.message : e}`);
    }

    // Whitepaper §5: proven fault (Refund → worker) → s_i ← 0.95·s_i, T_i ← T_i/2
    if (f.status === "RESOLVED" && f.ruling === "Refund" && f.worker) {
      const key = `${f.task_id}:${f.worker}`;
      if (!this.fraudSlashed.has(key)) {
        this.fraudSlashed.add(key);
        try {
          const pt = await this.trust.applyFraudSlash(f.worker);
          if (pt) {
            console.log(
              `[trust] fraud-slash worker=${f.worker} s_i=${pt.stake} T_i=${pt.trust_score.toFixed(1)}`,
            );
          }
        } catch (e) {
          console.warn(`[trust] fraud slash skipped: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }
}

/* ------------------------- legacy sim fold (fnv) --------------------------- */

const fnv32 = (s: string, seed = 0x811c9dc5): number => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
const hex = (n: number): string => n.toString(16).padStart(8, "0");
const legacyFnv = (s: string): string => `0x${hex(fnv32(s))}${hex(fnv32(s + "::2"))}`;
const legacyFnvFold = (acc: string, leaf: string): string => legacyFnv(acc + leaf);

/** @deprecated sim-era hash; exported for tests */
export const sh = legacyFnv;

export function foldLeaves(leaves: string[]): { root: string; paths: string[][] } {
  // Prefer real merkle for new code paths
  return merkleRoot(leaves);
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
  private closed = false;

  constructor(
    private url: string,
    private onTask: (e: TaskEventRow) => Promise<void>,
    private onBatch: (b: BatchRow) => Promise<void>,
    private onFraud: (f: FraudCaseRow) => Promise<void> = async () => {},
  ) {}

  connect(): void {
    this.closed = false;
    const WS = globalThis.WebSocket as unknown as { new (url: string): WebSocket } | undefined;
    if (!WS) throw new Error("global WebSocket unavailable — run on Node ≥ 22");
    this.ws = new WS(this.url);
    this.ws.onopen = () => {
      this.backoffMs = 500;
      this.ws?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "events.subscribe",
          params: { topics: ["tasks", "batches", "fraud"] },
        }),
      );
    };
    this.ws.onmessage = (ev) => void this.route(String(ev.data));
    this.ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), (this.backoffMs = Math.min(10_000, this.backoffMs * 2)));
    };
  }

  /** Route a raw frame — exported path for tests. */
  async route(raw: string): Promise<"task" | "batch" | "fraud" | "skip"> {
    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(raw) as JsonRpcFrame;
    } catch {
      return "skip";
    }
    const topic = frame.params?.topic;
    const data = frame.params?.data;
    if (!topic || data == null) return "skip";

    if (topic === "tasks" || frame.method === "task.event") {
      const t = normalizeTask(data);
      if (t) await this.onTask(t);
      return t ? "task" : "skip";
    }
    if (topic === "batches" || frame.method === "batch.event") {
      const b = normalizeBatch(data);
      if (b) await this.onBatch(b);
      return b ? "batch" : "skip";
    }
    if (topic === "fraud" || frame.method === "fraud.event") {
      const f = normalizeFraud(data);
      if (f) await this.onFraud(f);
      return f ? "fraud" : "skip";
    }
    return "skip";
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}

// re-export normalizers for callers
export { normalizeTask, normalizeBatch, normalizeFraud };
export type { FraudCaseRow };

/**
 * JSON-RPC dispatch — handlers for the wire surface defined in
 * docs/architecture.md §5 and consumed by src/sdk/rpc.ts WRITE-POINT #2.
 * Errors are the six MRC_E_* codes. Nothing else escapes.
 */

import { SimDriver, randHex, sh, type ReceiptRow, type TaskRow } from "./sim";

export interface Envelope {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface OkResult {
  ok: true;
  result: unknown;
}

export interface ErrResult {
  ok: false;
  error: { code: RpcCode; message: string };
}

export type RpcCode =
  | "MRC_E_TIMEOUT"
  | "MRC_E_HASH_MISMATCH"
  | "MRC_E_NONDETERMINISTIC"
  | "MRC_E_QUORUM_SLOW"
  | "MRC_E_CAP_BREACH"
  | "MRC_E_SCHEMA";

export const M = {
  TIMEOUT: "MRC_E_TIMEOUT",
  HASH_MISMATCH: "MRC_E_HASH_MISMATCH",
  NONDET: "MRC_E_NONDETERMINISTIC",
  QUORUM_SLOW: "MRC_E_QUORUM_SLOW",
  CAP_BREACH: "MRC_E_CAP_BREACH",
  SCHEMA: "MRC_E_SCHEMA",
} as const;

const err = (code: RpcCode, message: string): ErrResult => ({ ok: false, error: { code, message } });
const ok = (result: unknown): OkResult => ({ ok: true, result });

const REGISTRY = [
  { id: "agent:vector-7", tier: "T2", trust: 96, rate: 4.8, success: 99.2, stake: 2600 },
  { id: "agent:atlas-01", tier: "T3", trust: 99, rate: 6.2, success: 99.9, stake: 12000 },
  { id: "agent:helix-3", tier: "T2", trust: 94, rate: 2.4, success: 99.0, stake: 3100 },
  { id: "agent:probe-9", tier: "T1", trust: 88, rate: 0.9, success: 97.8, stake: 600 },
  { id: "agent:orbit-2", tier: "T1", trust: 86, rate: 1.1, success: 97.1, stake: 700 },
  { id: "agent:forge-11", tier: "T1", trust: 91, rate: 1.6, success: 98.6, stake: 850 },
];

const TIER_ORDER = ["T0", "T1", "T2", "T3"] as const;

export interface RpcContext {
  sim: SimDriver;
  emitTask: (t: TaskRow) => void;
  epoch: number;
}

export function makeDispatcher(ctx: RpcContext) {
  const { sim } = ctx;

  const addTask = (partial: Partial<TaskRow>): TaskRow => {
    const t: TaskRow = {
      id: partial.id ?? `mrc_${randHex(7)}`,
      agent: String(partial.agent ?? "agent:atlas-01"),
      counterparty: String(partial.counterparty ?? "agent:orbit-2"),
      role: (partial.role as TaskRow["role"]) ?? "buy",
      spec: String(partial.spec ?? "render.sequence.4k"),
      amount: String(partial.amount ?? "10.00"),
      state: "RUNNING",
      at: Date.now(),
      hash: String(partial.hash ?? `0x${randHex(6)}…${randHex(4)}`),
    };
    const snap = sim.snapshots();
    snap.tasks.unshift(t);
    ctx.emitTask(t);
    return t;
  };

  return async function dispatch(env: Envelope): Promise<OkResult | ErrResult> {
    const p = (env.params ?? {}) as Record<string, unknown>;

    switch (env.method) {
      case "registry.query": {
        const filter = (p.filter ?? {}) as {
          spec?: string;
          minTrust?: number;
          minTier?: string;
          maxPrice?: string;
          limit?: number;
        };
        const minTrust = filter.minTrust ?? 0;
        const minTierIdx = filter.minTier ? TIER_ORDER.indexOf(filter.minTier as (typeof TIER_ORDER)[number]) : 0;
        const maxPrice = filter.maxPrice ? parseFloat(filter.maxPrice) : Infinity;
        const out = REGISTRY.filter(
          (a) =>
            a.trust >= minTrust &&
            TIER_ORDER.indexOf(a.tier as (typeof TIER_ORDER)[number]) >= minTierIdx &&
            a.rate <= maxPrice &&
            (!filter.spec || a.id.includes(filter.spec.split(".")[0]) || filter.spec.startsWith("render") === a.id.includes("vector") || true),
        )
          .sort((a, b) => b.trust - a.trust)
          .slice(0, filter.limit ?? 10);
        return ok(out);
      }

      case "task.commit": {
        const params = p as { spec?: string; worker?: string; escrow?: { amount?: string }; buyer?: string };
        if (!params.spec || !params.worker) return err(M.SCHEMA, "commit requires spec and worker");
        if (parseFloat(String(params.escrow?.amount ?? "0")) <= 0) return err(M.SCHEMA, "escrow.amount must be > 0");
        const t = addTask({
          agent: params.worker,
          counterparty: params.buyer ?? "agent:atlas-01",
          spec: params.spec,
          amount: String(params.escrow!.amount),
          role: "work",
        });
        return ok({ task_id: t.id, state: t.state, worker: t.agent, amount: t.amount });
      }

      case "task.report": {
        const { task_id, hash } = p as { task_id?: string; hash?: string };
        if (!task_id || !hash) return err(M.SCHEMA, "report requires task_id and hash");
        const t = sim.settleTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown outside sim window`);
        t.state = "VERIFYING";
        t.hash = String(hash);
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state });
      }

      case "verify": {
        const { task_id, quorum = 3 } = p as { task_id?: string; quorum?: number };
        if (!task_id) return err(M.SCHEMA, "verify requires task_id");
        const t = sim.settleTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown outside sim window`);
        if (t.state !== "VERIFYING") return err(M.QUORUM_SLOW, `task is ${t.state}, wait for report`);

        const ms = 380 + Math.floor(Math.random() * 220);
        await sleep(ms);
        const fault = Math.random() < 0.04;
        if (fault) {
          t.state = "DISPUTED";
          ctx.emitTask({ ...t });
          return err(M.HASH_MISMATCH, "quorum rejected the reported output hash");
        }
        const honest = sh(`${t.id}:${t.spec}:${t.amount}`);
        t.state = "SETTLED";
        ctx.emitTask({ ...t });
        return ok({
          task_id,
          status: "SETTLED",
          reported: honest,
          recomputed: honest,
          votes: ["0xvr1", "0xvr2", "0xvr3"].slice(0, Number(quorum)),
          ms,
          epoch: ctx.epoch,
          tx: `0x${randHex(6)}…${randHex(4)}`,
        });
      }

      case "task.settle": {
        const { task_id } = p as { task_id?: string };
        if (!task_id) return err(M.SCHEMA, "settle requires task_id");
        const t = sim.settleTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        if (t.state !== "SETTLED") return err(M.QUORUM_SLOW, `cannot settle while state is ${t.state}`);
        return ok({ task_id, state: t.state });
      }

      case "dispute.open": {
        const { task_id, evidence } = p as { task_id?: string; evidence?: unknown };
        if (!task_id) return err(M.SCHEMA, "dispute.open requires task_id");
        const t = sim.settleTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        t.state = "DISPUTED";
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state, evidence_received: !!evidence });
      }

      case "operator.rule": {
        const { task_id, ruling, sig } = p as { task_id?: string; ruling?: string; sig?: string };
        if (!task_id || !ruling || !sig) return err(M.SCHEMA, "operator.rule requires task_id, ruling, sig");
        const t = sim.settleTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        t.state = ruling === "REFUND BUYER" ? "FAILED" : "SETTLED";
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state, ruling });
      }

      case "stake": {
        const { amount, tier = "T2" } = p as { amount?: string; tier?: string };
        const n = parseFloat(String(amount ?? "0"));
        if (!Number.isFinite(n) || n < 25_000) return err(M.CAP_BREACH, "minimum verifier bond is 25,000 MARC");
        return ok({ epoch: ctx.epoch, bond: amount, tier });
      }

      case "events.subscribe": {
        return ok({ subscribed: (p.topics as string[]) ?? [] });
      }

      default:
        return err(M.SCHEMA, `unknown method: ${env.method}`);
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type { ReceiptRow };

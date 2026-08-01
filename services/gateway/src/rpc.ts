/**
 * JSON-RPC dispatch — handlers for the wire surface defined in
 * docs/architecture.md §5 and consumed by src/sdk/rpc.ts.
 * Errors are the six CEN_E_* codes. Nothing else escapes.
 */

import { SimDriver, randHex, sh, type TaskRow } from "./sim.ts";
import type { EscrowGateway } from "./escrow.ts";

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
  | "CEN_E_TIMEOUT"
  | "CEN_E_HASH_MISMATCH"
  | "CEN_E_NONDETERMINISTIC"
  | "CEN_E_QUORUM_SLOW"
  | "CEN_E_CAP_BREACH"
  | "CEN_E_SCHEMA";

export const M = {
  TIMEOUT: "CEN_E_TIMEOUT",
  HASH_MISMATCH: "CEN_E_HASH_MISMATCH",
  NONDET: "CEN_E_NONDETERMINISTIC",
  QUORUM_SLOW: "CEN_E_QUORUM_SLOW",
  CAP_BREACH: "CEN_E_CAP_BREACH",
  SCHEMA: "CEN_E_SCHEMA",
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

/** B0 ledger — committed tasks keyed by id (system of record for RPC path). */
export class TaskLedger {
  private byId = new Map<string, TaskRow & { reportedHash?: string; buyer?: string }>();

  put(t: TaskRow & { reportedHash?: string; buyer?: string }): void {
    this.byId.set(t.id, t);
  }

  get(id: string): (TaskRow & { reportedHash?: string; buyer?: string }) | undefined {
    return this.byId.get(id);
  }

  update(id: string, patch: Partial<TaskRow & { reportedHash?: string }>): TaskRow | undefined {
    const cur = this.byId.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.byId.set(id, next);
    return next;
  }

  all(): TaskRow[] {
    return [...this.byId.values()];
  }
}

export interface RpcContext {
  sim: SimDriver;
  ledger: TaskLedger;
  escrow: EscrowGateway;
  emitTask: (t: TaskRow) => void;
  epoch: number;
}

export function makeDispatcher(ctx: RpcContext) {
  const { sim, ledger, escrow } = ctx;

  const addTask = (partial: Partial<TaskRow> & { buyer?: string }): TaskRow => {
    const t: TaskRow = {
      id: partial.id ?? `cent_${randHex(7)}`,
      agent: String(partial.agent ?? "agent:atlas-01"),
      counterparty: String(partial.counterparty ?? partial.buyer ?? "agent:orbit-2"),
      role: (partial.role as TaskRow["role"]) ?? "buy",
      spec: String(partial.spec ?? "render.sequence.4k"),
      amount: String(partial.amount ?? "10.00"),
      state: (partial.state as TaskRow["state"]) ?? "RUNNING",
      at: Date.now(),
      hash: String(partial.hash ?? `0x${randHex(6)}…${randHex(4)}`),
    };
    const snap = sim.snapshots();
    snap.tasks.unshift(t);
    // also park on sim's live list
    sim.state.tasks = [t, ...sim.state.tasks].slice(0, 48);
    ledger.put({ ...t, buyer: partial.buyer });
    ctx.emitTask(t);
    return t;
  };

  const findTask = (id: string): TaskRow | undefined => {
    return ledger.get(id) ?? sim.settleTask(id);
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
            a.rate <= maxPrice,
        )
          .sort((a, b) => b.trust - a.trust)
          .slice(0, filter.limit ?? 10);
        return ok(out);
      }

      case "task.commit": {
        const params = p as {
          spec?: string;
          worker?: string;
          escrow?: { amount?: string; asset?: string };
          buyer?: string;
          input?: Record<string, unknown>;
        };
        if (!params.spec || !params.worker) return err(M.SCHEMA, "commit requires spec and worker");
        if (parseFloat(String(params.escrow?.amount ?? "0")) <= 0) return err(M.SCHEMA, "escrow.amount must be > 0");

        const amount = String(params.escrow!.amount);
        const t = addTask({
          agent: params.worker,
          counterparty: params.buyer ?? "agent:atlas-01",
          buyer: params.buyer ?? "agent:atlas-01",
          spec: params.spec,
          amount,
          role: "work",
          state: "RUNNING",
        });

        // Optional on-chain escrow lock (B0 write path)
        const chain = await escrow.commit({
          taskIdHint: t.id,
          worker: params.worker,
          buyer: params.buyer,
          amountUsdc: amount,
          spec: params.spec,
        });

        return ok({
          task_id: t.id,
          state: "COMMITTED",
          worker: t.agent,
          amount: t.amount,
          chain: {
            mode: chain.mode,
            tx: chain.txHash ?? null,
            error: chain.error ?? null,
            escrow: escrow.mode,
          },
        });
      }

      case "task.report": {
        const { task_id, hash } = p as { task_id?: string; hash?: string };
        if (!task_id || !hash) return err(M.SCHEMA, "report requires task_id and hash");
        const t = findTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        if (t.state === "SETTLED" || t.state === "FAILED") return err(M.QUORUM_SLOW, `task is terminal (${t.state})`);
        t.state = "VERIFYING";
        t.hash = String(hash);
        ledger.put({ ...t, reportedHash: String(hash) });
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state, hash: t.hash });
      }

      case "verify": {
        const { task_id, quorum = 3 } = p as { task_id?: string; quorum?: number };
        if (!task_id) return err(M.SCHEMA, "verify requires task_id");
        const t = findTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        if (t.state !== "VERIFYING") return err(M.QUORUM_SLOW, `task is ${t.state}, wait for report`);

        const ms = 380 + Math.floor(Math.random() * 220);
        await sleep(ms);
        const fault = Math.random() < 0.04;
        if (fault) {
          t.state = "DISPUTED";
          ledger.put(t);
          ctx.emitTask({ ...t });
          return err(M.HASH_MISMATCH, "quorum rejected the reported output hash");
        }
        const honest = sh(`${t.id}:${t.spec}:${t.amount}`);
        t.state = "SETTLED";
        t.hash = honest;
        ledger.put(t);
        sim.state.pending.push(t);
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
        const t = findTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        if (t.state !== "SETTLED") return err(M.QUORUM_SLOW, `cannot settle while state is ${t.state}`);
        return ok({ task_id, state: t.state });
      }

      case "dispute.open": {
        const { task_id, evidence } = p as { task_id?: string; evidence?: unknown };
        if (!task_id) return err(M.SCHEMA, "dispute.open requires task_id");
        const t = findTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        t.state = "DISPUTED";
        ledger.put(t);
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state, evidence_received: !!evidence });
      }

      case "operator.rule": {
        const { task_id, ruling, sig } = p as { task_id?: string; ruling?: string; sig?: string };
        if (!task_id || !ruling || !sig) return err(M.SCHEMA, "operator.rule requires task_id, ruling, sig");
        const t = findTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        t.state = ruling === "REFUND BUYER" || ruling === "REFUND" ? "FAILED" : "SETTLED";
        ledger.put(t);
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state, ruling });
      }

      case "stake": {
        const { amount, tier = "T2" } = p as { amount?: string; tier?: string };
        const n = parseFloat(String(amount ?? "0"));
        if (!Number.isFinite(n) || n < 25_000) return err(M.CAP_BREACH, "minimum verifier bond is 25,000 CENT");
        return ok({ epoch: ctx.epoch, bond: amount, tier });
      }

      case "events.subscribe": {
        return ok({ subscribed: (p.topics as string[]) ?? [] });
      }

      case "node.info": {
        return ok({
          service: "ciphersentry-gateway",
          epoch: ctx.epoch,
          escrow: escrow.mode,
          ledger_tasks: ledger.all().length,
        });
      }

      default:
        return err(M.SCHEMA, `unknown method: ${env.method}`);
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

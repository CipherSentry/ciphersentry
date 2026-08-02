/**
 * JSON-RPC dispatch — handlers for the wire surface defined in
 * docs/architecture.md §5 and consumed by src/sdk/rpc.ts.
 * Errors are the six CEN_E_* codes. Nothing else escapes.
 */

import { SimDriver, randHex, type TaskRow } from "./sim.ts";
import type { EscrowGateway } from "./escrow.ts";
import type { SlashExecutorGateway } from "./slash-executor.ts";
import {
  expectedPureHash,
  type VerifierPool,
} from "@ciphersentry/verifier-daemon";

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

/** Task row extended with commit-time input used for pure recompute. */
export type LedgerTask = TaskRow & {
  reportedHash?: string;
  buyer?: string;
  input?: Record<string, unknown>;
};

/** B0/B1 ledger — committed tasks keyed by id (system of record for RPC path). */
export class TaskLedger {
  private byId = new Map<string, LedgerTask>();

  put(t: LedgerTask): void {
    this.byId.set(t.id, t);
  }

  get(id: string): LedgerTask | undefined {
    return this.byId.get(id);
  }

  update(id: string, patch: Partial<LedgerTask>): LedgerTask | undefined {
    const cur = this.byId.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.byId.set(id, next);
    return next;
  }

  all(): LedgerTask[] {
    return [...this.byId.values()];
  }
}

export interface RpcContext {
  sim: SimDriver;
  ledger: TaskLedger;
  escrow: EscrowGateway;
  /** B2/B3 verifier pool — elected quorum, slashes, accrual. */
  pool: VerifierPool;
  /** Optional on-chain SlashExecutor writer (B3). */
  slashChain: SlashExecutorGateway;
  emitTask: (t: TaskRow) => void;
  epoch: number;
}

export function makeDispatcher(ctx: RpcContext) {
  const { sim, ledger, escrow, pool, slashChain } = ctx;

  const addTask = (partial: Partial<LedgerTask> & { buyer?: string }): LedgerTask => {
    const t: LedgerTask = {
      id: partial.id ?? `cent_${randHex(7)}`,
      agent: String(partial.agent ?? "agent:atlas-01"),
      counterparty: String(partial.counterparty ?? partial.buyer ?? "agent:orbit-2"),
      role: (partial.role as TaskRow["role"]) ?? "buy",
      spec: String(partial.spec ?? "render.sequence.4k"),
      amount: String(partial.amount ?? "10.00"),
      state: (partial.state as TaskRow["state"]) ?? "RUNNING",
      at: Date.now(),
      hash: String(partial.hash ?? `0x${randHex(6)}…${randHex(4)}`),
      input: partial.input,
      buyer: partial.buyer,
    };
    const snap = sim.snapshots();
    snap.tasks.unshift(t);
    // also park on sim's live list
    sim.state.tasks = [t, ...sim.state.tasks].slice(0, 48);
    ledger.put(t);
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
        const input = params.input ?? { spec: params.spec, amount, worker: params.worker };
        const t = addTask({
          agent: params.worker,
          counterparty: params.buyer ?? "agent:atlas-01",
          buyer: params.buyer ?? "agent:atlas-01",
          spec: params.spec,
          amount,
          role: "work",
          state: "RUNNING",
          input,
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
          /** Honest pure-mode hash — clients may report this to pass B1 verify. */
          expected_hash: expectedPureHash(t.id, input),
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
        const t = findTask(task_id) as LedgerTask | undefined;
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        if (t.state === "SETTLED" || t.state === "FAILED") return err(M.QUORUM_SLOW, `task is terminal (${t.state})`);
        t.state = "VERIFYING";
        t.hash = String(hash);
        ledger.put({ ...t, reportedHash: String(hash) });
        ctx.emitTask({ ...t });
        return ok({ task_id, state: t.state, hash: t.hash });
      }

      case "verify": {
        const { task_id } = p as { task_id?: string; quorum?: number };
        if (!task_id) return err(M.SCHEMA, "verify requires task_id");
        const t = findTask(task_id) as LedgerTask | undefined;
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        if (t.state !== "VERIFYING") return err(M.QUORUM_SLOW, `task is ${t.state}, wait for report`);

        const input = t.input ?? { spec: t.spec, amount: t.amount, worker: t.agent };
        const reported = String(t.reportedHash ?? t.hash);
        const outcome = await pool.verify({
          taskId: t.id,
          mode: "pure",
          inputJson: input,
          reportedHash: reported,
          buyer: t.buyer ?? t.counterparty,
          worker: t.agent,
          amount: t.amount,
        });

        if (!outcome.settled) {
          t.state = "DISPUTED";
          ledger.put(t);
          ctx.emitTask({ ...t });
          // B3: attempt on-chain evidence posts (offline when no SLASH_EXECUTOR_ADDRESS)
          if (outcome.evidence) {
            for (const s of outcome.slashes) {
              void slashChain.submit({
                evidenceHash: outcome.evidence.sig,
                target: s.target,
                severity: s.severity,
              });
            }
          }
          return err(M.HASH_MISMATCH, "quorum rejected the reported output hash");
        }

        const recomputed = outcome.votes[0]?.recomputed ?? reported;
        t.state = "SETTLED";
        t.hash = recomputed;
        ledger.put(t);
        sim.state.pending.push(t);
        ctx.emitTask({ ...t });
        return ok({
          task_id,
          status: "SETTLED",
          reported,
          recomputed,
          votes: outcome.votes.map((v) => ({ v: v.verifier, ok: v.ok, ms: v.ms })),
          ms: outcome.ms,
          epoch: ctx.epoch,
          mode: outcome.mode,
          quorum: outcome.quorum,
          verifiers: outcome.verifiers,
          slash_dry_runs: outcome.slashDryRuns,
          slashes: outcome.slashes,
          accrual: outcome.accrual
            ? {
                id: outcome.accrual.id,
                fee_usdc: outcome.accrual.feeUsdc,
                treasury_usdc: outcome.accrual.treasuryUsdc,
                verifier_pool_usdc: outcome.accrual.verifierPoolUsdc,
                lines: outcome.accrual.lines,
                proof: outcome.accrual.proof,
                weight_variance: outcome.accrual.weightVariance,
              }
            : null,
          election: {
            epoch: outcome.epoch,
            members: outcome.election?.members ?? outcome.verifiers,
            scores: outcome.election?.scores ?? [],
          },
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
        const {
          amount,
          tier = "T2",
          verifier,
          accuracy_bps,
        } = p as { amount?: string; tier?: string; verifier?: string; accuracy_bps?: number };
        const n = parseFloat(String(amount ?? "0"));
        if (!Number.isFinite(n) || n < 25_000) return err(M.CAP_BREACH, "minimum verifier bond is 25,000 CENT");
        const id = String(verifier ?? `vrf:ext-${randHex(4)}`);
        try {
          const seat = pool.registry.stake(id, n, {
            accuracyBps: typeof accuracy_bps === "number" ? accuracy_bps : undefined,
          });
          pool.slash.setBond(id, seat.bond);
          // new stake may change next election; clear only if same epoch re-elect forced
          return ok({
            epoch: pool.currentEpoch,
            verifier: seat.id,
            bond: seat.bond,
            accuracy_bps: seat.accuracyBps,
            status: seat.status,
            external: seat.external,
            tier,
          });
        } catch (e) {
          return err(M.CAP_BREACH, (e as Error).message);
        }
      }

      case "registry.list": {
        const { eligible_only = false } = p as { eligible_only?: boolean };
        const seats = eligible_only ? pool.registry.eligible() : pool.registry.all();
        return ok({
          count: seats.length,
          verifiers: seats.map((s) => ({
            id: s.id,
            bond: s.bond,
            accuracy_bps: s.accuracyBps,
            status: s.status,
            external: s.external,
          })),
        });
      }

      case "epoch.elect": {
        const epoch = Number((p as { epoch?: number }).epoch ?? pool.currentEpoch);
        try {
          const el = pool.elect(epoch);
          return ok({
            epoch: el.epoch,
            seed: el.seed,
            members: el.members,
            scores: el.scores,
            candidates: el.candidates,
            finalized: el.finalized,
          });
        } catch (e) {
          return err(M.QUORUM_SLOW, (e as Error).message);
        }
      }

      case "epoch.info": {
        const epoch = Number((p as { epoch?: number }).epoch ?? pool.currentEpoch);
        const el = pool.election.of(epoch) ?? pool.ensureElection(epoch);
        return ok({
          epoch: el.epoch,
          seed: el.seed,
          members: el.members,
          scores: el.scores,
          candidates: el.candidates,
          eligible: pool.registry.eligible().length,
        });
      }

      case "accrual.balance": {
        const { verifier } = p as { verifier?: string };
        if (!verifier) return err(M.SCHEMA, "accrual.balance requires verifier");
        return ok({
          verifier,
          unclaimed: pool.accrual.balanceOf(verifier),
          claimed: pool.accrual.claimedOf(verifier),
        });
      }

      case "accrual.claim": {
        const { verifier } = p as { verifier?: string };
        if (!verifier) return err(M.SCHEMA, "accrual.claim requires verifier");
        const c = pool.accrual.claim(verifier);
        return ok(c);
      }

      case "accrual.summary": {
        const epoch = (p as { epoch?: number }).epoch;
        const entries =
          typeof epoch === "number" ? pool.accrual.byEpoch(epoch) : pool.accrual.all();
        return ok({
          ...pool.accrual.summary(),
          treasury: pool.accrual.treasuryBalance,
          recent: entries.slice(-8).map((e) => ({
            id: e.id,
            task_id: e.taskId,
            fee_usdc: e.feeUsdc,
            proof: e.proof,
            lines: e.lines.length,
          })),
        });
      }

      case "accuracy.of": {
        const { verifier } = p as { verifier?: string };
        if (!verifier) return err(M.SCHEMA, "accuracy.of requires verifier");
        return ok(pool.accuracy.of(verifier));
      }

      case "accuracy.list": {
        return ok({ verifiers: pool.accuracy.all() });
      }

      case "slash.submit": {
        const { evidence_hash, target, severity = "FalseVote" } = p as {
          evidence_hash?: string;
          target?: string;
          severity?: "FalseVote" | "Collusion";
        };
        if (!evidence_hash || !target) return err(M.SCHEMA, "slash.submit requires evidence_hash and target");
        const result = await slashChain.submit({
          evidenceHash: evidence_hash,
          target,
          severity,
        });
        return ok({ ...result, slash_mode: slashChain.mode });
      }

      case "events.subscribe": {
        return ok({ subscribed: (p.topics as string[]) ?? [] });
      }

      case "node.info": {
        const el = pool.ensureElection();
        const acc = pool.accrual.summary();
        return ok({
          service: "ciphersentry-gateway",
          epoch: pool.currentEpoch,
          escrow: escrow.mode,
          slash_executor: slashChain.mode,
          ledger_tasks: ledger.all().length,
          verifiers: el.members,
          registry_size: pool.registry.all().length,
          eligible: pool.registry.eligible().length,
          slash_dry_runs: pool.slash.all().length,
          accrual: acc,
          election: { seed: el.seed, scores: el.scores, members: el.members },
          phase: "B3",
        });
      }

      default:
        return err(M.SCHEMA, `unknown method: ${env.method}`);
    }
  };
}

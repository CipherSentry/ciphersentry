/**
 * JSON-RPC dispatch — handlers for the wire surface defined in
 * docs/architecture.md §5 and consumed by src/sdk/rpc.ts.
 * Errors are the six CEN_E_* codes. Nothing else escapes.
 */

import { SimDriver, randHex, type TaskRow } from "./sim.ts";
import type { EscrowGateway } from "./escrow.ts";
import type { SlashExecutorGateway } from "./slash-executor.ts";
import type { SettlementBatcherGateway } from "./batcher.ts";
import type { FraudProofWorker } from "./fraud-proof.ts";
import type { AuthService, Session } from "./auth.ts";
import { authMessage } from "./auth.ts";
import {
  expectedPureHash,
  type VerifierPool,
} from "@ciphersentry/verifier-daemon";
import {
  liveRank,
  liveScore,
  TRUST_FORMULA,
} from "./reputation.ts";

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

export const REGISTRY = [
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
  /** On-chain Escrow taskId (Committed event) — not the ledger cent_* id */
  chainTaskId?: string;
  chainWorker?: string;
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
  /** B4 settlement batcher — Merkle roots + 2-of-3 anchor. */
  batcher: SettlementBatcherGateway;
  /** B5 fraud-proof worker — challenge window + ruling. */
  fraud: FraudProofWorker;
  /** B7 auth service (ed25519 sessions). */
  auth: AuthService;
  emitTask: (t: TaskRow) => void;
  epoch: number;
}

export interface RpcMeta {
  session: Session | null;
}

export function makeDispatcher(ctx: RpcContext) {
  const { sim, ledger, escrow, pool, slashChain, batcher, fraud, auth } = ctx;

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

  return async function dispatch(env: Envelope, meta: RpcMeta = { session: null }): Promise<OkResult | ErrResult> {
    const p = (env.params ?? {}) as Record<string, unknown>;

    switch (env.method) {
      case "auth.challenge": {
        const pubkey = String((p as { pubkey?: string }).pubkey ?? "");
        if (!pubkey) return err(M.SCHEMA, "auth.challenge requires pubkey");
        const ch = await auth.issueChallenge(pubkey);
        if ("error" in ch) return err(M.SCHEMA, ch.error);
        return ok({
          challenge_id: ch.id,
          nonce: ch.nonce,
          expires_at: ch.expiresAt,
          message: authMessage(ch.id, ch.nonce, ch.pubkey),
          algo: "ed25519",
        });
      }

      case "auth.session": {
        const params = p as {
          challenge_id?: string;
          pubkey?: string;
          signature?: string;
          agent_id?: string;
        };
        if (!params.challenge_id || !params.pubkey || !params.signature) {
          return err(M.SCHEMA, "auth.session requires challenge_id, pubkey, signature");
        }
        const sess = await auth.openSession({
          challenge_id: params.challenge_id,
          pubkey: params.pubkey,
          signature: params.signature,
          agent_id: params.agent_id,
        });
        if ("error" in sess) return err(M.CAP_BREACH, sess.error);
        return ok({
          token: sess.token,
          agent_id: sess.agentId,
          stake: sess.stake,
          rpm: sess.rpm,
          expires_at: sess.expiresAt,
        });
      }

      case "auth.whoami": {
        if (!meta.session) return err(M.CAP_BREACH, "no session — Authorization: Bearer <token>");
        return ok({
          agent_id: meta.session.agentId,
          stake: meta.session.stake,
          rpm: meta.session.rpm,
          pubkey: meta.session.pubkey,
          expires_at: meta.session.expiresAt,
        });
      }

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
        const limit = filter.limit ?? 10;

        // V0.3: overlay live T_i from indexer when available
        const live = await liveRank({ minTrust, limit: 100 });
        if (live && live.length) {
          const seedById = new Map(REGISTRY.map((a) => [a.id, a]));
          const out = live
            .map((a) => {
              const seed = seedById.get(a.id);
              const tier = (seed?.tier ?? a.tier) as string;
              return {
                id: a.id,
                tier,
                trust: a.T_i,
                rate: seed?.rate ?? a.rate ?? 1,
                success: a.q_i > 1 ? a.q_i : a.q_i * 100, // wire success as 0..100 for SDK parity
                stake: a.s_i,
                T_i: a.T_i,
                s_i: a.s_i,
                q_i: a.q_i,
                live: true,
                formula: TRUST_FORMULA,
              };
            })
            .filter(
              (a) =>
                a.trust >= minTrust &&
                TIER_ORDER.indexOf(a.tier as (typeof TIER_ORDER)[number]) >= minTierIdx &&
                a.rate <= maxPrice,
            )
            .sort((a, b) => b.trust - a.trust)
            .slice(0, limit);
          if (out.length) return ok(out);
        }

        const out = REGISTRY.filter(
          (a) =>
            a.trust >= minTrust &&
            TIER_ORDER.indexOf(a.tier as (typeof TIER_ORDER)[number]) >= minTierIdx &&
            a.rate <= maxPrice,
        )
          .sort((a, b) => b.trust - a.trust)
          .slice(0, limit)
          .map((a) => ({
            ...a,
            T_i: a.trust,
            s_i: a.stake,
            q_i: a.success / 100,
            live: false,
            formula: TRUST_FORMULA,
          }));
        return ok(out);
      }

      /** V0.3 — portable score for one agent. */
      case "trust.of": {
        const agentId = String((p as { agent_id?: string; id?: string }).agent_id ?? (p as { id?: string }).id ?? "");
        if (!agentId) return err(M.SCHEMA, "trust.of requires agent_id");
        const live = await liveScore(agentId);
        if (live) {
          return ok({
            agent_id: live.id,
            T_i: live.T_i,
            s_i: live.s_i,
            q_i: live.q_i,
            trust: live.T_i,
            stake: live.s_i,
            success: live.q_i,
            tier: live.tier,
            status: live.status,
            live: true,
            formula: TRUST_FORMULA,
          });
        }
        const seed = REGISTRY.find((a) => a.id === agentId);
        if (!seed) return err(M.SCHEMA, `unknown agent ${agentId}`);
        return ok({
          agent_id: seed.id,
          T_i: seed.trust,
          s_i: seed.stake,
          q_i: seed.success / 100,
          trust: seed.trust,
          stake: seed.stake,
          success: seed.success / 100,
          tier: seed.tier,
          live: false,
          formula: TRUST_FORMULA,
        });
      }

      /** V0.3 — ranked public reputation board. */
      case "trust.rank": {
        const filter = p as { minTrust?: number; limit?: number };
        const minTrust = filter.minTrust ?? 0;
        const limit = Math.min(100, filter.limit ?? 20);
        const live = await liveRank({ minTrust, limit });
        if (live && live.length) {
          return ok({
            data: live.map((a) => ({
              agent_id: a.id,
              T_i: a.T_i,
              s_i: a.s_i,
              q_i: a.q_i,
              tier: a.tier,
              status: a.status,
              live: true,
            })),
            formula: TRUST_FORMULA,
            phase: "V0.3",
          });
        }
        return ok({
          data: REGISTRY.filter((a) => a.trust >= minTrust)
            .sort((a, b) => b.trust - a.trust)
            .slice(0, limit)
            .map((a) => ({
              agent_id: a.id,
              T_i: a.trust,
              s_i: a.stake,
              q_i: a.success / 100,
              tier: a.tier,
              live: false,
            })),
          formula: TRUST_FORMULA,
          phase: "V0.3",
        });
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
        if (chain.chainTaskId) {
          ledger.put({
            ...t,
            chainTaskId: chain.chainTaskId,
            chainWorker: chain.workerAddress,
          });
        }

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
            chain_task_id: chain.chainTaskId ?? null,
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

          // On-chain: drive commit→Disputed so Escrow.rule can move capital
          let chainTaskId = t.chainTaskId;
          if (escrow.mode === "write-ready" && !chainTaskId) {
            // no prior commit — full drive creates chain task
            const driven = await escrow.driveToDisputed({
              amountUsdc: t.amount,
              spec: t.spec,
              reportedHash: reported.startsWith("0x")
                ? (reported as `0x${string}`)
                : undefined,
            });
            if (driven.chainTaskId) {
              chainTaskId = driven.chainTaskId;
              t.chainTaskId = chainTaskId;
              ledger.put(t);
            }
          } else if (escrow.mode === "write-ready" && chainTaskId) {
            const driven = await escrow.driveToDisputed({
              chainTaskId,
              reportedHash: reported.startsWith("0x")
                ? (reported as `0x${string}`)
                : undefined,
            });
            if (driven.mode !== "submitted" && driven.error) {
              // keep off-chain fraud path; surface drive error on case later
              t.chainTaskId = chainTaskId;
            }
          }

          // B5: open fraud case (auto-challenge when FRAUD_AUTO≠0); slash posts inside worker
          let fraudCase = await fraud.open({
            taskId: t.id,
            chainTaskId,
            reported,
            inputJson: input,
            buyer: t.buyer ?? t.counterparty,
            worker: t.agent,
            amount: t.amount,
            votes: outcome.votes,
            evidence: outcome.evidence,
            slashes: outcome.slashes,
          });
          // Retry on-chain rule if auto-rule soft-failed (drive race / first attempt)
          if (
            fraudCase.status === "RESOLVED" &&
            fraudCase.chainTaskId &&
            escrow.mode === "write-ready" &&
            fraudCase.chain?.mode !== "submitted"
          ) {
            try {
              await fraud.submitRule(t.id);
              fraudCase = fraud.of(t.id) ?? fraudCase;
            } catch {
              /* keep soft mode */
            }
          }
          // Terminal ledger state when auto-challenge already ruled
          if (fraudCase.status === "RESOLVED" && fraudCase.ruling) {
            if (fraudCase.ruling === "Refund") t.state = "FAILED";
            else t.state = "SETTLED";
            ledger.put(t);
            ctx.emitTask({ ...t });
          }
          // Surface chain rule mode on mismatch (auto-rule may have submitted)
          const chainMode = fraudCase.chain?.mode;
          return err(
            M.HASH_MISMATCH,
            chainMode
              ? `quorum rejected the reported output hash (rule:${chainMode})`
              : "quorum rejected the reported output hash",
          );
        }

        const recomputed = outcome.votes[0]?.recomputed ?? reported;
        t.state = "SETTLED";
        t.hash = recomputed;
        ledger.put(t);
        sim.state.pending.push(t);
        ctx.emitTask({ ...t });

        // B4: enqueue receipt leaf for next Merkle batch
        const leaf = batcher.enqueue({
          taskId: t.id,
          recomputed,
          reported,
          amount: t.amount,
          worker: t.agent,
          buyer: t.counterparty,
          spec: t.spec,
        });

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
          batch: {
            leaf: leaf.leaf,
            pending: batcher.pendingCount,
            mode: batcher.mode,
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
        const fraudCase = await fraud.open({
          taskId: t.id,
          reported: String(t.reportedHash ?? t.hash),
          inputJson: t.input ?? { spec: t.spec, amount: t.amount, worker: t.agent },
          buyer: t.buyer ?? t.counterparty,
          worker: t.agent,
          amount: t.amount,
          votes: [],
          evidence: evidence
            ? {
                type: "evidence.recompute",
                taskId: t.id,
                reported: String(t.reportedHash ?? t.hash),
                digests: {},
                votes: [],
                quorum: "0/0",
                at: Date.now(),
                canonical: JSON.stringify(evidence),
                sig: `0x${randHex(16)}`,
              }
            : undefined,
        });
        return ok({
          task_id,
          state: t.state,
          evidence_received: !!evidence,
          fraud: {
            status: fraudCase.status,
            ruling: fraudCase.ruling ?? null,
            reason: fraudCase.reason ?? null,
          },
        });
      }

      case "operator.rule": {
        const { task_id, ruling, sig } = p as { task_id?: string; ruling?: string; sig?: string };
        if (!task_id || !ruling) return err(M.SCHEMA, "operator.rule requires task_id and ruling");
        const t = findTask(task_id);
        if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
        // open case if missing
        if (!fraud.of(task_id)) {
          await fraud.open({
            taskId: t.id,
            reported: String(t.reportedHash ?? t.hash),
            inputJson: t.input ?? { spec: t.spec, amount: t.amount, worker: t.agent },
            buyer: t.buyer ?? t.counterparty,
            worker: t.agent,
            amount: t.amount,
            votes: [],
          });
        }
        const c = await fraud.manualRule(task_id, String(ruling), sig ? `signed:${sig.slice(0, 12)}` : undefined);
        const chain = await fraud.submitRule(task_id, c.ruling);
        t.state = c.ruling === "Refund" ? "FAILED" : "SETTLED";
        ledger.put(t);
        ctx.emitTask({ ...t });
        return ok({
          task_id,
          state: t.state,
          ruling: c.ruling,
          reason: c.reason,
          chain,
          fraud: fraud.of(task_id),
        });
      }

      case "fraud.list": {
        const status = (p as { status?: string }).status;
        const rows = fraud.list(status as never).map((c) => ({
          task_id: c.taskId,
          status: c.status,
          ruling: c.ruling ?? null,
          recomputed: c.recomputed ?? null,
          reason: c.reason ?? null,
          open_at: c.openAt,
        }));
        return ok({ count: rows.length, cases: rows });
      }

      case "fraud.of": {
        const { task_id } = p as { task_id?: string };
        if (!task_id) return err(M.SCHEMA, "fraud.of requires task_id");
        const c = fraud.of(task_id);
        if (!c) return err(M.TIMEOUT, `no fraud case for ${task_id}`);
        return ok({
          task_id: c.taskId,
          status: c.status,
          reported: c.reported,
          recomputed: c.recomputed ?? null,
          ruling: c.ruling ?? null,
          reason: c.reason ?? null,
          original_votes: c.originalVotes,
          challenge_votes: c.challengeVotes ?? [],
          slashes: c.slashes,
          chain: c.chain ?? null,
          window_blocks: c.windowBlocks,
          window_ms: c.windowMs,
          open_at: c.openAt,
          open_block: c.openBlock,
          resolved_at: c.resolvedAt ?? null,
        });
      }

      case "fraud.challenge": {
        const { task_id } = p as { task_id?: string };
        if (!task_id) return err(M.SCHEMA, "fraud.challenge requires task_id");
        try {
          if (!fraud.of(task_id)) {
            const t = findTask(task_id);
            if (!t) return err(M.TIMEOUT, `task ${task_id} unknown`);
            await fraud.open({
              taskId: t.id,
              reported: String(t.reportedHash ?? t.hash),
              inputJson: t.input ?? { spec: t.spec, amount: t.amount, worker: t.agent },
              buyer: t.buyer ?? t.counterparty,
              worker: t.agent,
              amount: t.amount,
              votes: [],
            });
            // open may have auto-challenged
          }
          // Force re-challenge only if still open
          const existing = fraud.of(task_id)!;
          if (existing.status === "OPEN" || existing.status === "CHALLENGING") {
            const r = await fraud.challenge(task_id);
            const t = findTask(task_id);
            if (t) {
              t.state = r.ruling === "Refund" ? "FAILED" : "SETTLED";
              ledger.put(t);
              ctx.emitTask({ ...t });
            }
            return ok({
              task_id,
              ruling: r.ruling,
              recomputed: r.recomputed,
              reason: r.reason,
              challenge_votes: r.challengeVotes,
              status: r.case.status,
            });
          }
          return ok({
            task_id,
            ruling: existing.ruling,
            recomputed: existing.recomputed,
            reason: existing.reason,
            challenge_votes: existing.challengeVotes ?? [],
            status: existing.status,
          });
        } catch (e) {
          return err(M.QUORUM_SLOW, (e as Error).message);
        }
      }

      case "fraud.rule": {
        const { task_id, ruling } = p as { task_id?: string; ruling?: string };
        if (!task_id) return err(M.SCHEMA, "fraud.rule requires task_id");
        try {
          const t = findTask(task_id) as LedgerTask | undefined;
          const existing = fraud.of(task_id);
          // attach ledger chainTaskId if fraud case opened before drive finished
          if (existing && t?.chainTaskId && !existing.chainTaskId) {
            existing.chainTaskId = t.chainTaskId;
          }
          if (ruling) await fraud.manualRule(task_id, ruling);
          const chain = await fraud.submitRule(task_id, ruling ? undefined : undefined);
          const c = fraud.of(task_id)!;
          if (t && c.ruling) {
            t.state = c.ruling === "Refund" ? "FAILED" : "SETTLED";
            ledger.put(t);
            ctx.emitTask({ ...t });
          }
          return ok({
            task_id,
            chain_task_id: c.chainTaskId ?? t?.chainTaskId ?? null,
            ruling: c.ruling,
            reason: c.reason,
            mode: chain.mode,
            txHash: chain.txHash ?? null,
            chain,
            status: c.status,
          });
        } catch (e) {
          return err(M.QUORUM_SLOW, (e as Error).message);
        }
      }

      case "fraud.default": {
        const { task_id } = p as { task_id?: string };
        if (!task_id) return err(M.SCHEMA, "fraud.default requires task_id");
        try {
          const r = await fraud.defaultRefund(task_id);
          const t = findTask(task_id);
          if (t) {
            t.state = "FAILED";
            ledger.put(t);
            ctx.emitTask({ ...t });
          }
          return ok({ task_id, ...r });
        } catch (e) {
          return err(M.QUORUM_SLOW, (e as Error).message);
        }
      }

      case "fraud.info": {
        return ok(fraud.info());
      }

      case "fraud.tick": {
        // test helper — advance simulated block height for window expiry
        const n = Number((p as { blocks?: number }).blocks ?? 1);
        const height = fraud.tickBlock(n);
        return ok({ block: height });
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

      case "batch.pending": {
        return ok({
          count: batcher.pendingCount,
          leaves: batcher.pendingLeaves.map((l) => ({
            task_id: l.taskId,
            leaf: l.leaf,
            amount: l.amount,
            worker: l.worker,
            at: l.at,
          })),
        });
      }

      case "batch.info": {
        return ok(batcher.info());
      }

      case "batch.anchor": {
        const emergency = Boolean((p as { emergency?: boolean }).emergency);
        const result = await batcher.anchor({ emergency });
        return ok(result);
      }

      case "batch.markMissed": {
        const result = await batcher.markMissed();
        return ok(result);
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
          batcher: batcher.info(),
          fraud: fraud.info(),
          ledger_tasks: ledger.all().length,
          verifiers: el.members,
          registry_size: pool.registry.all().length,
          eligible: pool.registry.eligible().length,
          slash_dry_runs: pool.slash.all().length,
          accrual: acc,
          election: { seed: el.seed, scores: el.scores, members: el.members },
          auth: {
            required: process.env.AUTH_REQUIRED === "1",
            kv: process.env.REDIS_URL ? "redis" : "memory",
          },
          phase: "B5",
        });
      }

      default:
        return err(M.SCHEMA, `unknown method: ${env.method}`);
    }
  };
}

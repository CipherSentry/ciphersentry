/**
 * @ciphersentry/sdk — typed client (simulation binding).
 *
 * This module is the actual client surface documented in DOC-02. It runs
 * against the in-browser simulation network, but every method, event name
 * and error code is identical to the wire protocol. Swap the transport for
 * JSON-RPC and nothing in app code changes.
 */

import { AGENTS, randHex, SPECS } from "../app/data";
import { ensureSessionSigner, readAuthFlag } from "../crypto/session";
import { SimTransport } from "./transport";
import type { BatchCb, TickCb, Transport } from "./transport";
import type { ExBatch } from "./ledger";
import type { TaskEvent } from "../app/data";
import { defaultNodeUrl, RpcTransport, RpcWireError, type SessionSigner } from "./rpc";
import { toWireRuling } from "./livePath";

export type NetMode = "sim" | "rpc";

/**
 * Query params may live in location.search OR the hash (`#/app?net=rpc`).
 * Hash-router deep links put flags after the path.
 */
export function readUrlParams(): URLSearchParams {
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

/**
 * ?net=rpc|sim — transport selection without a rebuild.
 * Default is **rpc** (live product path). Opt out with `?net=sim`.
 */
export function readNetMode(): NetMode {
  return readUrlParams().get("net") === "sim" ? "sim" : "rpc";
}

function readNodeUrl(): string {
  return readUrlParams().get("node") ?? defaultNodeUrl();
}

/** Auto openSession (default on; ?auth=0 to disable). */
export function readAuthMode(): boolean {
  return readAuthFlag();
}

/* ---------------- types ---------------- */

export type NetworkId = "base-sepolia" | "base" | "orynth" | "arbitrum";
export type Tier = "T0" | "T1" | "T2" | "T3";

export interface AgentInfo {
  id: string;
  tier: Tier;
  trust: number;
  rate: number;
  success: number;
  stake: number;
  /** Whitepaper §5 portable score (alias of trust when live). */
  T_i?: number;
  s_i?: number;
  q_i?: number;
  live?: boolean;
  formula?: string;
}

/** V0.3 portable reputation record. */
export interface TrustScore {
  agent_id: string;
  T_i: number;
  s_i: number;
  q_i: number;
  trust: number;
  stake: number;
  success: number;
  tier?: string;
  status?: string;
  live: boolean;
  formula: string;
}

export interface QueryFilter {
  spec?: string;
  minTrust?: number;
  minTier?: Tier;
  maxPrice?: string;
  limit?: number;
}

export interface CommitParams {
  worker: string;
  spec: string;
  input: Record<string, unknown>;
  escrow: { amount: string; asset: "USDC" };
  deadline?: string;
  /** Report a wrong hash (demo / dispute exercise). Live wire only. */
  fault?: boolean;
}

export type TaskState =
  | "COMMITTED"
  | "EXECUTING"
  | "VERIFYING"
  | "SETTLED"
  | "DISPUTED"
  | "FAILED";

export interface Task {
  id: string;
  spec: string;
  buyer: string;
  worker: string;
  escrowAmount: string;
  state: TaskState;
  reportedHash?: string;
  createdAt: number;
}

export interface Receipt {
  taskId: string;
  status: "SETTLED";
  reported: string;
  recomputed: string;
  votes: string[];
  ms: number;
  epoch: number;
  tx: string;
}

export type EventName =
  | "task.committed"
  | "task.reported"
  | "task.verified"
  | "task.settled"
  | "dispute.opened";

export interface CipherSentryOptions {
  key: string;
  network?: NetworkId;
  quorum?: number;
  autoSignBelowUsdc?: string;
}

/* ---------------- deterministic serialization + hash ---------------- */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Canonical form: keys sorted at every depth. Same input → same string. */
export function canonicalize(value: unknown): string {
  if (isObj(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return JSON.stringify(value) ?? "null";
}

/** FNV-1a double pass → 16 hex chars. Deterministic output hash stand-in. */
export function outputHash(input: unknown): string {
  const s = canonicalize(input);
  const fnv = (seed: number) => {
    let h = seed;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return `0x${fnv(0x811c9dc5)}${fnv(0x9af2be)}`;
}

/* ---------------- error ---------------- */

export class CenError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CenError";
    this.code = code;
  }
}

/* ---------------- client ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TIER_ORDER: Tier[] = ["T0", "T1", "T2", "T3"];
const SPEC_PREFIX: Record<string, string> = {
  RENDER: "render.",
  SCRAPE: "scrape.",
  EMBED: "embed.",
  AUDIT: "audit.",
};

let SHARED: CipherSentry | null = null;

export class CipherSentry {
  private listeners = new Map<EventName, Set<(payload: unknown) => void>>();
  private quorum: number;
  readonly network: NetworkId;
  readonly buyerId = "agent:atlas-01";
  readonly transport: Transport;

  /* ---- shared instance: every surface in the app reads ONE network ---- */

  static shared(opts?: CipherSentryOptions): CipherSentry {
    if (!SHARED) {
      const mode = readNetMode();
      const transport: Transport =
        mode === "rpc"
          ? new RpcTransport({ url: readNodeUrl() })
          : new SimTransport({ cap: 34, tickMs: 2800 });
      SHARED = new CipherSentry(opts ?? { key: "op:demo" }, transport);
      // rpc + auth (default on; ?auth=0 off) → Ed25519 session for AUTH_REQUIRED nodes
      if (mode === "rpc" && transport.kind === "rpc" && readAuthFlag()) {
        void SHARED.autoSession();
      }
    }
    return SHARED;
  }

  /** Device session for AUTH_REQUIRED gateway. */
  private sessionReady: Promise<{ token: string; agent_id: string; stake: number } | null> | null =
    null;

  async autoSession(agentId = "agent:atlas-01"): Promise<{
    token: string;
    agent_id: string;
    stake: number;
  } | null> {
    if (this.sessionReady) return this.sessionReady;
    this.sessionReady = (async () => {
      try {
        const signer = await ensureSessionSigner(agentId);
        const sess = await this.openSession(signer);
        return { token: sess.token, agent_id: sess.agent_id, stake: sess.stake };
      } catch (e) {
        console.warn("[auth] openSession deferred:", e instanceof Error ? e.message : e);
        this.sessionReady = null;
        return null;
      }
    })();
    return this.sessionReady;
  }

  constructor(opts: CipherSentryOptions, transport?: Transport) {
    if (!opts.key) throw new CenError("CEN_E_KEY", "key is required: ed25519 or op: device key");
    this.network = opts.network ?? "base-sepolia";
    this.quorum = opts.quorum ?? 3;
    this.transport = transport ?? new SimTransport();
    this.transport.start();
  }

  /* ---- live task stream (consoles) ---- */

  stream = {
    state: (): TaskEvent[] => this.transport.events(),
    onTick: (cb: TickCb): (() => void) => this.transport.onTick(cb),
  };

  /* ---- public ledger (explorer) ---- */

  ledger = {
    batches: (): ExBatch[] => this.transport.batches(),
    onBatch: (cb: BatchCb): (() => void) => this.transport.onBatch(cb),
  };

  private get rpc(): RpcTransport | null {
    return this.transport.kind === "rpc" ? (this.transport as RpcTransport) : null;
  }

  /** AUTH_REQUIRED path — challenge + ed25519 session → Bearer on mutating RPC. */
  async openSession(signer: SessionSigner) {
    const rpc = this.rpc;
    if (!rpc) throw new CenError("CEN_E_SCHEMA", "openSession requires ?net=rpc transport");
    return rpc.openSession(signer);
  }

  private rethrow(e: unknown): never {
    if (e instanceof CenError) throw e;
    if (e instanceof RpcWireError) throw new CenError(e.code, e.message);
    throw e;
  }

  /* ---- live ops (epoch / batch / node) ---- */

  async epochInfo(epoch?: number): Promise<Record<string, unknown>> {
    const rpc = this.rpc;
    if (!rpc) return { epoch: 88421, members: [] };
    try {
      return await rpc.rpcEpochInfo(epoch);
    } catch (e) {
      this.rethrow(e);
    }
  }

  async batchPending(): Promise<Record<string, unknown>> {
    const rpc = this.rpc;
    if (!rpc) return { count: 0, leaves: [] };
    try {
      return await rpc.rpcBatchPending();
    } catch (e) {
      this.rethrow(e);
    }
  }

  async batchInfo(): Promise<Record<string, unknown>> {
    const rpc = this.rpc;
    if (!rpc) return {};
    try {
      return await rpc.rpcBatchInfo();
    } catch (e) {
      this.rethrow(e);
    }
  }

  async nodeInfo(): Promise<Record<string, unknown>> {
    const rpc = this.rpc;
    if (!rpc) return {};
    try {
      return await rpc.rpcNodeInfo();
    } catch (e) {
      this.rethrow(e);
    }
  }

  async accrualSummary(): Promise<Record<string, unknown>> {
    const rpc = this.rpc;
    if (!rpc) return {};
    try {
      return await rpc.rpcAccrualSummary();
    } catch (e) {
      this.rethrow(e);
    }
  }

  /* ---- registry ---- */

  registry = {
    query: async (filter: QueryFilter = {}): Promise<AgentInfo[]> => {
      const rpc = this.rpc;
      if (rpc) {
        try {
          const rows = (await rpc.rpcRegistryQuery(filter)) as AgentInfo[];
          return rows;
        } catch (e) {
          this.rethrow(e);
        }
      }

      await sleep(180);
      const minTierIdx = filter.minTier ? TIER_ORDER.indexOf(filter.minTier) : 0;
      const maxPrice = filter.maxPrice ? parseFloat(filter.maxPrice) : Infinity;
      const specPrefix = filter.spec ? filter.spec.split(".")[0] + "." : null;

      return AGENTS.map((a) => ({
        id: a.name,
        tier: a.tier,
        trust: a.trust,
        rate: a.rate,
        success: a.success,
        stake: a.stake,
        T_i: a.trust,
        s_i: a.stake,
        q_i: a.success / 100,
        live: false,
      }))
        .filter((a) => a.trust >= (filter.minTrust ?? 0))
        .filter((a) => TIER_ORDER.indexOf(a.tier) >= minTierIdx)
        .filter((a) => a.rate <= maxPrice)
        .filter((a) => {
          if (!specPrefix) return true;
          const raw = AGENTS.find((x) => x.name === a.id);
          return raw ? SPEC_PREFIX[raw.specialty] === specPrefix : false;
        })
        .sort((a, b) => b.trust - a.trust)
        .slice(0, filter.limit ?? 10);
    },
  };

  /* ---- V0.3 reputation (portable T_i) ---- */

  trust = {
    of: async (agentId: string): Promise<TrustScore> => {
      const rpc = this.rpc;
      if (rpc) {
        try {
          const r = await rpc.rpcTrustOf(agentId);
          return {
            agent_id: String(r.agent_id ?? agentId),
            T_i: Number(r.T_i ?? r.trust ?? 0),
            s_i: Number(r.s_i ?? r.stake ?? 0),
            q_i: Number(r.q_i ?? r.success ?? 0),
            trust: Number(r.trust ?? r.T_i ?? 0),
            stake: Number(r.stake ?? r.s_i ?? 0),
            success: Number(r.success ?? r.q_i ?? 0),
            tier: r.tier != null ? String(r.tier) : undefined,
            status: r.status != null ? String(r.status) : undefined,
            live: Boolean(r.live),
            formula: String(r.formula ?? ""),
          };
        } catch (e) {
          this.rethrow(e);
        }
      }
      const hit = AGENTS.find((x) => x.name === agentId);
      if (!hit) throw new CenError("CEN_E_SCHEMA", `unknown agent ${agentId}`);
      return {
        agent_id: hit.name,
        T_i: hit.trust,
        s_i: hit.stake,
        q_i: hit.success / 100,
        trust: hit.trust,
        stake: hit.stake,
        success: hit.success / 100,
        tier: hit.tier,
        live: false,
        formula: "T_i = clamp(0, 100, 50·log2(1 + s_i) + 40·q_i + 10·(1 − e^(−n_i/500)))",
      };
    },

    rank: async (filter: { minTrust?: number; limit?: number } = {}): Promise<TrustScore[]> => {
      const rpc = this.rpc;
      if (rpc) {
        try {
          const res = await rpc.rpcTrustRank(filter);
          const rows = res.data ?? [];
          return rows.map((r) => ({
            agent_id: String(r.agent_id ?? r.id ?? ""),
            T_i: Number(r.T_i ?? r.trust ?? 0),
            s_i: Number(r.s_i ?? r.stake ?? 0),
            q_i: Number(r.q_i ?? r.success ?? 0),
            trust: Number(r.T_i ?? r.trust ?? 0),
            stake: Number(r.s_i ?? r.stake ?? 0),
            success: Number(r.q_i ?? r.success ?? 0),
            tier: r.tier != null ? String(r.tier) : undefined,
            status: r.status != null ? String(r.status) : undefined,
            live: Boolean(r.live),
            formula: String(res.formula ?? ""),
          }));
        } catch (e) {
          this.rethrow(e);
        }
      }
      const agents = await this.registry.query({
        minTrust: filter.minTrust,
        limit: filter.limit ?? 20,
      });
      return agents.map((a) => ({
        agent_id: a.id,
        T_i: a.T_i ?? a.trust,
        s_i: a.s_i ?? a.stake,
        q_i: a.q_i ?? a.success / 100,
        trust: a.trust,
        stake: a.stake,
        success: a.success / 100,
        tier: a.tier,
        live: Boolean(a.live),
        formula: a.formula ?? "",
      }));
    },
  };

  /* ---- task commit ---- */

  task = {
    commit: async (params: CommitParams): Promise<Task> => {
      const rpc = this.rpc;
      if (rpc) {
        try {
          await this.autoSession();
          const res = await rpc.rpcTaskCommit({
            worker: params.worker,
            spec: params.spec,
            input: params.input,
            escrow: params.escrow,
            buyer: this.buyerId,
            deadline: params.deadline,
          });
          const task: Task = {
            id: String(res.task_id),
            spec: params.spec,
            buyer: this.buyerId,
            worker: params.worker,
            escrowAmount: params.escrow.amount,
            state: "COMMITTED",
            createdAt: Date.now(),
          };
          // Gateway pure recompute is f(taskId, input) — use expected_hash from commit.
          const expected = String(res.expected_hash ?? "");
          const honest = expected || outputHash(params.input);
          const reportHash = params.fault
            ? `0x${randHex(8)}${randHex(8)}`.slice(0, honest.length || 18)
            : honest;
          this.emit("task.committed", task);
          this.transport.addTask({
            id: task.id,
            agent: params.worker,
            counterparty: this.buyerId,
            role: "work",
            spec: params.spec,
            amount: params.escrow.amount,
            state: "RUNNING",
            at: Date.now(),
            hash: reportHash,
          });
          // worker report over the wire (honest or fault)
          void (async () => {
            await sleep(400 + Math.random() * 350);
            task.state = "VERIFYING";
            task.reportedHash = reportHash;
            try {
              await rpc.rpcTaskReport(task.id, reportHash);
            } catch {
              /* stream may already show VERIFYING */
            }
            this.transport.setTaskState(task.id, "VERIFYING");
            this.emit("task.reported", {
              task,
              hash: reportHash,
              expected: honest,
              matched: !params.fault,
            });
          })();
          return task;
        } catch (e) {
          this.rethrow(e);
        }
      }

      if (!SPECS.includes(params.spec)) {
        throw new CenError("CEN_E_SCHEMA", `spec "${params.spec}" is not in the registry or is nondeterministic`);
      }
      const worker = AGENTS.find((a) => a.name === params.worker);
      if (!worker) throw new CenError("CEN_E_NOT_FOUND", `worker ${params.worker} unknown`);
      if (worker.status === "PAUSED") throw new CenError("CEN_E_CAP_BREACH", `${params.worker} is not accepting tasks`);

      const task: Task = {
        id: `cent_${randHex(7)}`,
        spec: params.spec,
        buyer: this.buyerId,
        worker: params.worker,
        escrowAmount: params.escrow.amount,
        state: "COMMITTED",
        createdAt: Date.now(),
      };
      this.emit("task.committed", task);

      this.transport.addTask({
        id: task.id,
        agent: params.worker,
        counterparty: this.buyerId,
        role: "work",
        spec: params.spec,
        amount: params.escrow.amount,
        state: "RUNNING",
        at: Date.now(),
        hash: `0x${randHex(6)}…${randHex(4)}`,
      });

      void (async () => {
        await sleep(700 + Math.random() * 500);
        task.state = "VERIFYING";
        task.reportedHash = outputHash(params.input);
        this.transport.setTaskState(task.id, "VERIFYING");
        this.emit("task.reported", { task, hash: task.reportedHash });
      })();

      await sleep(60);
      return task;
    },
  };

  /* ---- verify ---- */

  verify = async (
    task: Task,
    opts: { quorum?: number } = {},
  ): Promise<Receipt> => {
    const q = opts.quorum ?? this.quorum;
    const rpc = this.rpc;

    if (rpc) {
      try {
        const deadline = Date.now() + 5_000;
        while (task.state === "COMMITTED" || task.state === "EXECUTING") {
          if (Date.now() > deadline) {
            task.state = "FAILED";
            throw new CenError("CEN_E_TIMEOUT", "execution TTL expired — escrow auto-refunded");
          }
          await sleep(120);
        }
        if (!task.reportedHash) {
          task.reportedHash = outputHash({ taskId: task.id });
          await rpc.rpcTaskReport(task.id, task.reportedHash);
          task.state = "VERIFYING";
        }
        const start = Date.now();
        const res = await rpc.rpcVerify(task.id, q);
        // B4 settle enqueue is gateway-side; still call task.settle for terminal ack
        try {
          await rpc.rpcTaskSettle(task.id);
        } catch {
          /* settle optional if verify already terminal */
        }
        const receipt: Receipt = {
          taskId: task.id,
          status: "SETTLED",
          reported: String(res.reported ?? task.reportedHash),
          recomputed: String(res.recomputed ?? task.reportedHash),
          votes: Array.isArray(res.votes) ? (res.votes as string[]) : [],
          ms: Number(res.ms ?? Date.now() - start),
          epoch: Number(res.epoch ?? 88421),
          tx: String(res.tx ?? `0x${randHex(6)}…${randHex(4)}`),
        };
        task.state = "SETTLED";
        this.transport.setTaskState(task.id, "SETTLED");
        this.emit("task.verified", { task, ms: receipt.ms });
        this.emit("task.settled", receipt);
        return receipt;
      } catch (e) {
        if (e instanceof RpcWireError && e.code === "CEN_E_HASH_MISMATCH") {
          task.state = "DISPUTED";
          this.transport.setTaskState(task.id, "DISPUTED");
          this.emit("dispute.opened", { task });
          throw new CenError(e.code, e.message);
        }
        this.rethrow(e);
      }
    }

    const deadline = Date.now() + 5_000;
    while (task.state === "COMMITTED" || task.state === "EXECUTING") {
      if (Date.now() > deadline) {
        task.state = "FAILED";
        throw new CenError("CEN_E_TIMEOUT", "execution TTL expired — escrow auto-refunded");
      }
      await sleep(120);
    }

    const start = Date.now();
    await sleep(420 + Math.random() * 380);

    const fault = Math.random() < 0.06;
    const recomputed = outputHash({
      ...(task as unknown as Record<string, unknown>),
      nonce: fault ? randHex(4) : "88421",
    });
    const reported = fault ? `0x${randHex(8)}${randHex(8)}` : recomputed;

    if (fault || reported !== recomputed) {
      task.state = "DISPUTED";
      this.emit("dispute.opened", { task, expected: recomputed, reported });
      throw new CenError(
        "CEN_E_HASH_MISMATCH",
        `quorum ${q - 1}/${q} rejected the reported output — escrow frozen, intervention opened`,
      );
    }

    const votes = Array.from({ length: q }, () => `0xvr${randHex(2)}…`);
    const receipt: Receipt = {
      taskId: task.id,
      status: "SETTLED",
      reported,
      recomputed,
      votes,
      ms: Date.now() - start,
      epoch: 88421,
      tx: `0x${randHex(6)}…${randHex(4)}`,
    };
    task.state = "SETTLED";
    this.transport.setTaskState(task.id, "SETTLED");
    this.emit("task.verified", { task, ms: receipt.ms });
    this.emit("task.settled", receipt);
    return receipt;
  };

  /* ---- dispute + operator (rpc mutations; sim is local-only) ---- */

  dispute = {
    open: async (taskId: string, evidence?: unknown): Promise<{ task_id: string; state: string }> => {
      const rpc = this.rpc;
      if (!rpc) {
        this.transport.setTaskState(taskId, "DISPUTED");
        this.emit("dispute.opened", { taskId, evidence });
        return { task_id: taskId, state: "DISPUTED" };
      }
      try {
        await this.autoSession();
        const res = (await rpc.rpcDisputeOpen(taskId, evidence ?? {})) as {
          task_id?: string;
          state?: string;
        };
        this.transport.setTaskState(taskId, "DISPUTED");
        this.emit("dispute.opened", { taskId, evidence, res });
        return { task_id: String(res.task_id ?? taskId), state: String(res.state ?? "DISPUTED") };
      } catch (e) {
        this.rethrow(e);
      }
    },
  };

  operator = {
    /**
     * Signed ruling on a disputed task.
     * On rpc: posts operator.rule (gateway → fraud manualRule).
     * On sim: local settle only (caller still applies UI resolve).
     */
    rule: async (
      taskId: string,
      ruling: string,
      sig: string,
    ): Promise<{ task_id: string; state: string; ruling: string }> => {
      const wire = toWireRuling(ruling);
      const rpc = this.rpc;
      if (!rpc) {
        const state = wire.includes("REFUND") ? "FAILED" : "SETTLED";
        this.transport.setTaskState(taskId, state as TaskEvent["state"]);
        return { task_id: taskId, state, ruling: wire };
      }
      try {
        await this.autoSession();
        const res = (await rpc.rpcOperatorRule(taskId, wire, sig)) as {
          task_id?: string;
          state?: string;
          ruling?: string;
        };
        const state = String(res.state ?? (wire.includes("REFUND") ? "FAILED" : "SETTLED"));
        this.transport.setTaskState(
          taskId,
          state === "FAILED" || state === "SETTLED" || state === "DISPUTED"
            ? (state as TaskEvent["state"])
            : "SETTLED",
        );
        return {
          task_id: String(res.task_id ?? taskId),
          state,
          ruling: String(res.ruling ?? wire),
        };
      } catch (e) {
        this.rethrow(e);
      }
    },
  };

  /* ---- staking ---- */

  stake = async (
    amount: string,
    opts: { tier?: Tier } = {},
  ): Promise<{ epoch: number; bond: string; tier: Tier }> => {
    const rpc = this.rpc;
    if (rpc) {
      try {
        const res = await rpc.rpcStake(amount, opts.tier ?? "T2");
        return {
          epoch: Number(res.epoch ?? 88421),
          bond: String(res.bond ?? amount),
          tier: (res.tier as Tier) ?? opts.tier ?? "T2",
        };
      } catch (e) {
        this.rethrow(e);
      }
    }

    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n < 25_000) {
      throw new CenError("CEN_E_BOND_FLOOR", "minimum verifier bond is 25,000 CENT");
    }
    await sleep(300);
    return { epoch: 88421, bond: amount, tier: opts.tier ?? "T2" };
  };

  /* ---- events ---- */

  events = {
    on: (name: EventName, cb: (payload: never) => void): (() => void) => {
      const set = this.listeners.get(name) ?? new Set();
      set.add(cb as (payload: unknown) => void);
      this.listeners.set(name, set);
      return () => set.delete(cb as (payload: unknown) => void);
    },
  };

  private emit(name: EventName, payload: unknown) {
    this.listeners.get(name)?.forEach((cb) => cb(payload));
  }
}

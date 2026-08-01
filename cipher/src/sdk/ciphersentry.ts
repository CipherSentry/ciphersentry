/**
 * @ciphersentry/sdk — typed client (simulation binding).
 *
 * This module is the actual client surface documented in DOC-02. It runs
 * against the in-browser simulation network, but every method, event name
 * and error code is identical to the wire protocol. Swap the transport for
 * JSON-RPC and nothing in app code changes.
 */

import { AGENTS, randHex, SPECS } from "../app/data";
import { SimTransport } from "./transport";
import type { BatchCb, TickCb, Transport } from "./transport";
import type { ExBatch } from "./ledger";
import type { TaskEvent } from "../app/data";
import { DEFAULT_NODE, RpcTransport } from "./rpc";

export type NetMode = "sim" | "rpc";

/** ?net=rpc|sim — transport selection without a rebuild. */
export function readNetMode(): NetMode {
  try {
    return new URLSearchParams(window.location.search).get("net") === "rpc" ? "rpc" : "sim";
  } catch {
    return "sim";
  }
}

function readNodeUrl(): string {
  try {
    return new URLSearchParams(window.location.search).get("node") ?? DEFAULT_NODE;
  } catch {
    return DEFAULT_NODE;
  }
}

/* ---------------- types ---------------- */

export type NetworkId = "base-sepolia" | "base" | "robinhood" | "arbitrum";
export type Tier = "T0" | "T1" | "T2" | "T3";

export interface AgentInfo {
  id: string;
  tier: Tier;
  trust: number;
  rate: number;
  success: number;
  stake: number;
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
    }
    return SHARED;
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

  /* ---- registry ---- */

  registry = {
    query: async (filter: QueryFilter = {}): Promise<AgentInfo[]> => {
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

  /* ---- task commit ---- */

  task = {
    commit: async (params: CommitParams): Promise<Task> => {
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

      // register into the shared network stream — consoles see it live
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

      // worker executes asynchronously and reports its output hash
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
    // wait for the async report to land (TTL-bound)
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

    const fault = Math.random() < 0.06; // ~6% injected nondeterminism for realism
    const recomputed = outputHash({ /* worker input preimage */ ...(task as unknown as Record<string, unknown>), nonce: fault ? randHex(4) : "88421" });
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

  /* ---- staking ---- */

  stake = async (
    amount: string,
    opts: { tier?: Tier } = {},
  ): Promise<{ epoch: number; bond: string; tier: Tier }> => {
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

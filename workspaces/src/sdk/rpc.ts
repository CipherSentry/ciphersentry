/**
 * RpcTransport — the JSON-RPC twin of SimTransport.
 *
 * Same surface, same types, different wire. This is the skeleton: the full
 * request/response plumbing lives behind two clearly-marked WRITE-POINTS so
 * the day a node exists, this file ships the moment a socket does.
 * Wire surface per docs/architecture.md §5.
 */

import type { TaskEvent } from "../app/data";
import type { ExBatch } from "./ledger";
import type { BatchCb, TickCb, Transport } from "./transport";

export const DEFAULT_NODE = "wss://node.base-sepolia.machinarc.com";

/* ---------------- method map — docs/architecture.md §5 ---------------- */

export const RPC_METHODS = {
  REGISTRY_QUERY: "registry.query",
  TASK_COMMIT: "task.commit",
  TASK_REPORT: "task.report",
  VERIFY: "verify",
  TASK_SETTLE: "task.settle",
  DISPUTE_OPEN: "dispute.open",
  OPERATOR_RULE: "operator.rule",
  STAKE: "stake",
  EVENTS_SUBSCRIBE: "events.subscribe",
} as const;

export type RpcMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

/** Errors are the six MRC_E_* codes from the spec — nothing else escapes. */
export interface RpcErrorObject {
  code:
    | "MRC_E_TIMEOUT"
    | "MRC_E_HASH_MISMATCH"
    | "MRC_E_NONDETERMINISTIC"
    | "MRC_E_QUORUM_SLOW"
    | "MRC_E_CAP_BREACH"
    | "MRC_E_SCHEMA";
  message: string;
}

export type RpcStatus = "OFFLINE" | "CONNECTING" | "LIVE";

export interface RpcConfig {
  url: string;
  apiKey?: string;
}

export class RpcTransport implements Transport {
  kind = "rpc" as const;
  status: RpcStatus = "OFFLINE";

  private cfg: RpcConfig;
  private seq = 0;
  private tasks: TaskEvent[] = [];
  private ledger: ExBatch[] = [];
  private tickCbs = new Set<TickCb>();
  private batchCbs = new Set<BatchCb>();

  constructor(cfg: RpcConfig) {
    this.cfg = cfg;
  }

  /** node endpoint — surfaced in the console status bar */
  get nodeUrl(): string {
    try {
      return new URL(this.cfg.url).host;
    } catch {
      return this.cfg.url;
    }
  }

  start(): void {
    this.status = "CONNECTING";
    this.emit(null);
    this.connect();
  }

  stop(): void {
    this.status = "OFFLINE";
    this.emit(null);
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  setPaused(_on: boolean): void {
    /* halting is protocol-side (operator.rule), not a transport toggle */
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /* ===== WRITE-POINT #1 — stream subscription =====
   * const ws = new WebSocket(`${this.cfg.url}/events`);
   * ws.onopen      → this.rpcEventsSubscribe(["tasks", "batches"])
   * ws.onmessage   → route "task.*" envelopes → this.tickCbs,
   *                  route "batch.settled" → this.batchCbs,
   *                  update this.tasks / this.ledger snapshots
   * ws.onclose     → exponential-backoff reconnect here
   * Expected frame: { jsonrpc: "2.0", method: "task.event",
   *                   params: { topic: "tasks"|"batches", data: TaskEvent|ExBatch } }
   */
  private connect(): void {
    this.status = "OFFLINE"; // until WRITE-POINT #1 lands
  }

  /* ===== WRITE-POINT #2 — request/response =====
   * const res = await fetch(`${this.cfg.url}/rpc`, {
   *   method: "POST",
   *   headers: {
   *     "content-type": "application/json",
   *     ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
   *   },
   *   body: JSON.stringify(envelope),
   * });
   * const { result, error } = (await res.json()) as { result?: T; error?: RpcErrorObject };
   * if (error) throw new MrcError(error.code, error.message);
   * return result as T;
   */
  private buildEnvelope<T>(method: RpcMethod, params: T) {
    return { jsonrpc: "2.0" as const, id: ++this.seq, method, params };
  }

  private async send<T>(method: RpcMethod, params: unknown): Promise<T> {
    const envelope = this.buildEnvelope(method, params);
    void envelope; // kept for WRITE-POINT #2 introspection
    throw new Error(
      `MRC node unreachable — RpcTransport skeleton (open WRITE-POINT #2 in src/sdk/rpc.ts, method "${method}")`,
    );
  }

  /* ---------------- typed wire methods ---------------- */

  rpcRegistryQuery = (filter: unknown) => this.send<unknown>(RPC_METHODS.REGISTRY_QUERY, { filter });
  rpcTaskCommit = (params: unknown) => this.send<unknown>(RPC_METHODS.TASK_COMMIT, params);
  rpcTaskReport = (taskId: string, hash: string) => this.send<unknown>(RPC_METHODS.TASK_REPORT, { task_id: taskId, hash });
  rpcVerify = (taskId: string, quorum = 3) => this.send<unknown>(RPC_METHODS.VERIFY, { task_id: taskId, quorum });
  rpcTaskSettle = (taskId: string) => this.send<unknown>(RPC_METHODS.TASK_SETTLE, { task_id: taskId });
  rpcDisputeOpen = (taskId: string, evidence: unknown) => this.send<unknown>(RPC_METHODS.DISPUTE_OPEN, { task_id: taskId, evidence });
  rpcOperatorRule = (taskId: string, ruling: string, sig: string) => this.send<unknown>(RPC_METHODS.OPERATOR_RULE, { task_id: taskId, ruling, sig });
  rpcStake = (amount: string, tier: string) => this.send<unknown>(RPC_METHODS.STAKE, { amount, tier });
  rpcEventsSubscribe = (topics: string[]) => this.send<unknown>(RPC_METHODS.EVENTS_SUBSCRIBE, { topics });

  /* ---------------- Transport surface ---------------- */

  events(): TaskEvent[] {
    return [...this.tasks];
  }

  batches(): ExBatch[] {
    return [...this.ledger];
  }

  onTick(cb: TickCb): () => void {
    this.tickCbs.add(cb);
    cb([...this.tasks], null);
    return () => this.tickCbs.delete(cb);
  }

  onBatch(cb: BatchCb): () => void {
    this.batchCbs.add(cb);
    return () => this.batchCbs.delete(cb);
  }

  addTask(t: TaskEvent): void {
    // optimistic local entry — the node confirms and re-streams canonical state
    this.tasks = [t, ...this.tasks];
    this.poke();
  }

  setTaskState(id: string, state: TaskEvent["state"]): void {
    this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, state } : t));
    this.poke();
  }

  poke(): void {
    this.emit(null);
  }

  private emit(delta: Parameters<TickCb>[1]): void {
    this.tickCbs.forEach((cb) => cb([...this.tasks], delta));
  }
}

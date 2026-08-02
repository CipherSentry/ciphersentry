/**
 * RpcTransport — JSON-RPC + WebSocket twin of SimTransport.
 * Wire surface: docs/architecture.md §5 · services/gateway.
 *
 * Connect: ?net=rpc&node=http://127.0.0.1:8080
 *   (also accepts ws(s)://host/events)
 */

import type { TaskEvent, TaskState } from "../app/data";
import type { ExBatch, Receipt } from "./ledger";
import type { BatchCb, TickCb, Transport } from "./transport";

/** Wire error — same codes as CenError; kept here to avoid import cycles. */
export class RpcWireError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcWireError";
    this.code = code;
  }
}

export const DEFAULT_NODE = "http://127.0.0.1:8080";

/* ---------------- method map — docs/architecture.md §5 ---------------- */

export const RPC_METHODS = {
  AUTH_CHALLENGE: "auth.challenge",
  AUTH_SESSION: "auth.session",
  AUTH_WHOAMI: "auth.whoami",
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

/** ed25519 session signer for AUTH_REQUIRED=1. */
export interface SessionSigner {
  pubkey: string; // 32-byte hex
  sign: (message: string) => string | Promise<string>; // 64-byte hex sig
  agentId?: string;
}

export const EVENT_PREFIX = "cent.event.v1";

/** Sorted-key canonical JSON (matches gateway event-sign). */
export function canonicalizeEvent(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalizeEvent(o[k])}`)
      .join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeEvent).join(",")}]`;
  return JSON.stringify(value) ?? "null";
}

export function eventMessage(topic: string, data: unknown, ts: number): string {
  return `${EVENT_PREFIX}|${topic}|${canonicalizeEvent(data)}|${ts}`;
}

export type RpcMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

export interface RpcErrorObject {
  code:
    | "CEN_E_TIMEOUT"
    | "CEN_E_HASH_MISMATCH"
    | "CEN_E_NONDETERMINISTIC"
    | "CEN_E_QUORUM_SLOW"
    | "CEN_E_CAP_BREACH"
    | "CEN_E_SCHEMA";
  message: string;
}

export type RpcStatus = "OFFLINE" | "CONNECTING" | "LIVE";

export interface RpcConfig {
  url: string;
  apiKey?: string;
  /** When set, openSession() is used before mutating RPC under AUTH_REQUIRED. */
  session?: SessionSigner;
}

/* ---------------- URL helpers ---------------- */

export function resolveNodeEndpoints(raw: string): { httpBase: string; wsUrl: string; display: string } {
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    u = new URL(DEFAULT_NODE);
  }

  const httpProto = u.protocol === "wss:" || u.protocol === "https:" ? "https:" : "http:";
  const wsProto = httpProto === "https:" ? "wss:" : "ws:";

  const origin = `${httpProto}//${u.host}`;
  const path = u.pathname.replace(/\/$/, "");
  const basePath = path.endsWith("/events") || path.endsWith("/rpc") ? path.replace(/\/(events|rpc)$/, "") : path;

  const httpBase = `${origin}${basePath}`;
  const wsUrl = `${wsProto}//${u.host}${basePath}/events`;
  return { httpBase, wsUrl, display: u.host };
}

const UI_STATES = new Set<TaskState>(["RUNNING", "VERIFYING", "SETTLED", "DISPUTED", "FAILED"]);

/** Map protocol / chain states onto the console TaskState set. */
export function mapTaskState(raw: unknown): TaskState {
  const s = String(raw ?? "RUNNING").toUpperCase();
  if (s === "COMMITTED" || s === "EXECUTING" || s === "LOCKED" || s === "MATCHED") return "RUNNING";
  if (s === "PROVEN" || s === "VERIFYING") return "VERIFYING";
  if (UI_STATES.has(s as TaskState)) return s as TaskState;
  return "RUNNING";
}

function asTaskEvent(data: Record<string, unknown>): TaskEvent {
  return {
    id: String(data.id ?? data.task_id ?? `cent_unknown`),
    agent: String(data.agent ?? data.worker ?? "agent:unknown"),
    counterparty: String(data.counterparty ?? data.buyer ?? "agent:unknown"),
    role: data.role === "buy" ? "buy" : "work",
    spec: String(data.spec ?? "on-chain"),
    amount: String(data.amount ?? data.escrowAmount ?? "0"),
    state: mapTaskState(data.state),
    at: typeof data.at === "number" ? data.at : Date.now(),
    hash: String(data.hash ?? data.reportedHash ?? "0x…"),
  };
}

function asBatch(data: Record<string, unknown>): ExBatch {
  const receiptsRaw = Array.isArray(data.receipts) ? data.receipts : [];
  const receipts: Receipt[] = receiptsRaw.map((r) => {
    const row = r as Record<string, unknown>;
    const id = String(row.receipt_id ?? row.task_id ?? row.id ?? "cent_x");
    return {
      id,
      spec: String(row.spec ?? ""),
      buyer: String(row.buyer ?? ""),
      worker: String(row.worker ?? ""),
      amount: String(row.amount ?? "0"),
      state: String(row.state ?? "SETTLED") === "DISPUTED" ? "DISPUTED" : "SETTLED",
      reported: String(row.reported ?? ""),
      recomputed: String(row.recomputed ?? ""),
      votes: Array.isArray(row.votes)
        ? (row.votes as { v?: string; ok?: boolean }[]).map((v) => ({ v: String(v.v ?? ""), ok: v.ok !== false }))
        : [],
      epoch: Number(row.epoch ?? 0),
      ms: Number(row.ms ?? 0),
      at: Number(row.at ?? Date.now()),
      leaf: String(row.leaf ?? ""),
      path: Array.isArray(row.path) ? (row.path as string[]) : [],
    };
  });

  return {
    id: String(data.batch_id ?? data.id ?? `batch_${Date.now()}`),
    epoch: Number(data.epoch ?? 0),
    at: Number(data.at ?? Date.now()),
    root: String(data.root ?? "0x"),
    count: Number(data.count ?? receipts.length),
    total: String(data.total ?? "0"),
    state: String(data.state ?? "SETTLED") === "SETTLING" ? "SETTLING" : "SETTLED",
    receipts,
  };
}

/* ---------------- transport ---------------- */

export class RpcTransport implements Transport {
  kind = "rpc" as const;
  status: RpcStatus = "OFFLINE";

  private cfg: RpcConfig;
  private seq = 0;
  private tasks: TaskEvent[] = [];
  private ledger: ExBatch[] = [];
  private tickCbs = new Set<TickCb>();
  private batchCbs = new Set<BatchCb>();
  private ws: WebSocket | null = null;
  private closed = false;
  private backoffMs = 500;
  private readonly httpBase: string;
  private readonly wsUrl: string;
  private readonly display: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionToken: string | null = null;
  private sessionExpires = 0;
  /** Last verified WS event signature (architecture §6). */
  lastEventSigned: boolean | null = null;
  eventPubkey: string | null = null;
  private signedCount = 0;
  private unsignedCount = 0;

  constructor(cfg: RpcConfig) {
    this.cfg = cfg;
    if (cfg.apiKey) this.sessionToken = cfg.apiKey.replace(/^Bearer\s+/i, "");
    const ends = resolveNodeEndpoints(cfg.url);
    this.httpBase = ends.httpBase;
    this.wsUrl = ends.wsUrl;
    this.display = ends.display;
  }

  get nodeUrl(): string {
    return this.display;
  }

  get endpoints(): { httpBase: string; wsUrl: string } {
    return { httpBase: this.httpBase, wsUrl: this.wsUrl };
  }

  get sessionActive(): boolean {
    return Boolean(this.sessionToken && Date.now() < this.sessionExpires);
  }

  get eventSignStats(): { signed: number; unsigned: number; last: boolean | null } {
    return { signed: this.signedCount, unsigned: this.unsignedCount, last: this.lastEventSigned };
  }

  /**
   * AUTH_REQUIRED path: challenge → sign → session → Bearer on subsequent RPC.
   */
  async openSession(signer?: SessionSigner): Promise<{
    token: string;
    agent_id: string;
    stake: number;
    rpm: number;
    expires_at: number;
  }> {
    const s = signer ?? this.cfg.session;
    if (!s) throw new RpcWireError("CEN_E_SCHEMA", "session signer required (pubkey + sign)");
    const ch = await this.sendRaw<{
      challenge_id: string;
      nonce: string;
      message: string;
      expires_at: number;
    }>(RPC_METHODS.AUTH_CHALLENGE, { pubkey: s.pubkey }, { skipAuth: true });
    const signature = await s.sign(ch.message);
    const sess = await this.sendRaw<{
      token: string;
      agent_id: string;
      stake: number;
      rpm: number;
      expires_at: number;
    }>(
      RPC_METHODS.AUTH_SESSION,
      {
        challenge_id: ch.challenge_id,
        pubkey: s.pubkey,
        signature,
        agent_id: s.agentId,
      },
      { skipAuth: true },
    );
    this.sessionToken = sess.token;
    this.sessionExpires = Number(sess.expires_at) || Date.now() + 3_600_000;
    this.cfg.apiKey = sess.token;
    return sess;
  }

  /** Ensure live session when signer configured; no-op if token still valid. */
  async ensureSession(): Promise<void> {
    if (this.sessionActive) return;
    if (!this.cfg.session && !this.sessionToken) return;
    if (this.cfg.session) await this.openSession(this.cfg.session);
  }

  start(): void {
    this.closed = false;
    this.status = "CONNECTING";
    this.emit(null);
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.status = "OFFLINE";
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.emit(null);
  }

  setPaused(_on: boolean): void {
    /* protocol-side halt via operator.rule — not a transport toggle */
  }

  /* ===== stream subscription ===== */

  private connect(): void {
    if (this.closed) return;
    if (typeof WebSocket === "undefined") {
      this.status = "OFFLINE";
      this.emit(null);
      return;
    }

    this.status = "CONNECTING";
    this.emit(null);

    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }

    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = 500;
      this.status = "LIVE";
      this.emit(null);
      const sub = {
        jsonrpc: "2.0" as const,
        id: ++this.seq,
        method: RPC_METHODS.EVENTS_SUBSCRIBE,
        params: { topics: ["tasks", "batches"] },
      };
      try {
        ws.send(JSON.stringify(sub));
      } catch {
        /* half-open */
      }
    };

    ws.onmessage = (ev) => {
      let frame: {
        jsonrpc?: string;
        id?: number | string;
        method?: string;
        result?: unknown;
        error?: RpcErrorObject;
        params?: {
          topic?: string;
          data?: Record<string, unknown>;
          ts?: number;
          sig?: string;
          pubkey?: string;
        };
      };
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      if (frame.error) return;
      if (frame.result && !frame.method) return; // subscribe ack

      const method = frame.method ?? "";
      const data = frame.params?.data;
      if (!data || typeof data !== "object") return;

      // architecture §6 — track signed fan-out (verify is optional; presence is product signal)
      const p = frame.params;
      if (p?.sig && p.pubkey && p.ts != null && p.topic) {
        this.eventPubkey = String(p.pubkey);
        this.lastEventSigned = true;
        this.signedCount++;
      } else if (method.endsWith(".event")) {
        this.lastEventSigned = false;
        this.unsignedCount++;
      }

      if (method === "task.event" || frame.params?.topic === "tasks") {
        const t = asTaskEvent(data as Record<string, unknown>);
        this.upsertTask(t);
        this.emit(null);
        return;
      }

      if (method === "batch.event" || frame.params?.topic === "batches") {
        const b = asBatch(data as Record<string, unknown>);
        this.ledger = [...this.ledger.filter((x) => x.id !== b.id), b].slice(-24);
        this.batchCbs.forEach((cb) => cb(b));
      }
    };

    ws.onerror = () => {
      /* onclose handles reconnect */
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closed) {
        this.status = "OFFLINE";
        this.emit(null);
        return;
      }
      this.status = "CONNECTING";
      this.emit(null);
      const wait = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 8_000);
      this.reconnectTimer = setTimeout(() => this.connect(), wait);
    };
  }

  private upsertTask(t: TaskEvent): void {
    const i = this.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) {
      this.tasks = this.tasks.map((x, idx) => (idx === i ? { ...x, ...t } : x));
    } else {
      this.tasks = [t, ...this.tasks].slice(0, 48);
    }
  }

  /* ===== request/response ===== */

  private buildEnvelope(method: RpcMethod, params: unknown) {
    return { jsonrpc: "2.0" as const, id: ++this.seq, method, params };
  }

  private async sendRaw<T>(
    method: RpcMethod,
    params: unknown,
    opts: { skipAuth?: boolean; retried?: boolean } = {},
  ): Promise<T> {
    if (!opts.skipAuth) {
      try {
        await this.ensureSession();
      } catch {
        /* optional until AUTH_REQUIRED */
      }
    }

    const envelope = this.buildEnvelope(method, params);
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = this.sessionToken ?? this.cfg.apiKey;
    if (token && !opts.skipAuth) headers.authorization = `Bearer ${token.replace(/^Bearer\s+/i, "")}`;

    let res: Response;
    try {
      res = await fetch(`${this.httpBase}/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify(envelope),
      });
    } catch (e) {
      throw new RpcWireError("CEN_E_TIMEOUT", `gateway unreachable (${this.httpBase}): ${(e as Error).message}`);
    }

    let body: { result?: T; error?: RpcErrorObject };
    try {
      body = (await res.json()) as { result?: T; error?: RpcErrorObject };
    } catch {
      throw new RpcWireError("CEN_E_SCHEMA", `invalid JSON-RPC response (HTTP ${res.status})`);
    }

    if (body.error) {
      // one retry after fresh session when AUTH_REQUIRED rejected us
      if (
        !opts.retried &&
        !opts.skipAuth &&
        this.cfg.session &&
        body.error.code === "CEN_E_CAP_BREACH" &&
        /auth required/i.test(body.error.message)
      ) {
        this.sessionToken = null;
        this.sessionExpires = 0;
        await this.openSession(this.cfg.session);
        return this.sendRaw(method, params, { retried: true });
      }
      throw new RpcWireError(body.error.code, body.error.message);
    }
    return body.result as T;
  }

  private async send<T>(method: RpcMethod, params: unknown): Promise<T> {
    return this.sendRaw<T>(method, params);
  }

  /* ---------------- typed wire methods ---------------- */

  rpcAuthChallenge = (pubkey: string) =>
    this.sendRaw<Record<string, unknown>>(RPC_METHODS.AUTH_CHALLENGE, { pubkey }, { skipAuth: true });
  rpcAuthSession = (params: {
    challenge_id: string;
    pubkey: string;
    signature: string;
    agent_id?: string;
  }) => this.sendRaw<Record<string, unknown>>(RPC_METHODS.AUTH_SESSION, params, { skipAuth: true });
  rpcAuthWhoami = () => this.send<Record<string, unknown>>(RPC_METHODS.AUTH_WHOAMI, {});
  rpcRegistryQuery = (filter: unknown) => this.send<unknown>(RPC_METHODS.REGISTRY_QUERY, { filter });
  rpcTaskCommit = (params: unknown) => this.send<Record<string, unknown>>(RPC_METHODS.TASK_COMMIT, params);
  rpcTaskReport = (taskId: string, hash: string) =>
    this.send<Record<string, unknown>>(RPC_METHODS.TASK_REPORT, { task_id: taskId, hash });
  rpcVerify = (taskId: string, quorum = 3) =>
    this.send<Record<string, unknown>>(RPC_METHODS.VERIFY, { task_id: taskId, quorum });
  rpcTaskSettle = (taskId: string) => this.send<Record<string, unknown>>(RPC_METHODS.TASK_SETTLE, { task_id: taskId });
  rpcDisputeOpen = (taskId: string, evidence: unknown) =>
    this.send<unknown>(RPC_METHODS.DISPUTE_OPEN, { task_id: taskId, evidence });
  rpcOperatorRule = (taskId: string, ruling: string, sig: string) =>
    this.send<unknown>(RPC_METHODS.OPERATOR_RULE, { task_id: taskId, ruling, sig });
  rpcStake = (amount: string, tier: string) => this.send<Record<string, unknown>>(RPC_METHODS.STAKE, { amount, tier });
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
    this.upsertTask(t);
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

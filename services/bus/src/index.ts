/**
 * Event bus — domain events between gateway, indexer, and future services.
 *
 * Architecture.md §3: every domain event on NATS; consumers include console
 * WS fan-out and the indexer. Wire topics match WS subscribe surface:
 *   tasks | batches | fraud
 *
 * Modes:
 *   memory — in-process (tests / NATS down)
 *   nats   — compose `nats:4222` or managed NATS
 */

import {
  connect,
  StringCodec,
  type NatsConnection,
  type Subscription,
} from "nats";

export type Topic = "tasks" | "batches" | "fraud";

export const TOPICS: readonly Topic[] = ["tasks", "batches", "fraud"] as const;

/** NATS subject prefix. Full: `cs.events.tasks` etc. */
export const SUBJECT_PREFIX = "cs.events";

export function subjectFor(topic: Topic): string {
  return `${SUBJECT_PREFIX}.${topic}`;
}

export function topicFromSubject(subject: string): Topic | null {
  if (!subject.startsWith(`${SUBJECT_PREFIX}.`)) return null;
  const t = subject.slice(SUBJECT_PREFIX.length + 1);
  return TOPICS.includes(t as Topic) ? (t as Topic) : null;
}

export interface BusEnvelope {
  v: 1;
  topic: Topic;
  data: unknown;
  ts: number;
}

export type BusHandler = (topic: Topic, data: unknown, env: BusEnvelope) => void | Promise<void>;

export interface EventBus {
  readonly mode: "memory" | "nats";
  publish(topic: Topic, data: unknown): Promise<void>;
  subscribe(topics: Topic[], handler: BusHandler): Promise<() => void>;
  close(): Promise<void>;
}

/* ------------------------------ memory ------------------------------------ */

export class MemoryBus implements EventBus {
  readonly mode = "memory" as const;
  private handlers = new Set<BusHandler>();
  private filter = new Map<BusHandler, Set<Topic>>();

  async publish(topic: Topic, data: unknown): Promise<void> {
    const env: BusEnvelope = { v: 1, topic, data, ts: Date.now() };
    const snaps = [...this.handlers];
    for (const h of snaps) {
      const allowed = this.filter.get(h);
      if (allowed && !allowed.has(topic)) continue;
      try {
        await h(topic, data, env);
      } catch {
        /* never break publish for a bad consumer */
      }
    }
  }

  async subscribe(topics: Topic[], handler: BusHandler): Promise<() => void> {
    this.handlers.add(handler);
    this.filter.set(handler, new Set(topics));
    return () => {
      this.handlers.delete(handler);
      this.filter.delete(handler);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.filter.clear();
  }
}

/* -------------------------------- nats ------------------------------------ */

const sc = StringCodec();

export class NatsBus implements EventBus {
  readonly mode = "nats" as const;
  private subs: Subscription[] = [];

  constructor(private nc: NatsConnection) {}

  async publish(topic: Topic, data: unknown): Promise<void> {
    const env: BusEnvelope = { v: 1, topic, data, ts: Date.now() };
    this.nc.publish(subjectFor(topic), sc.encode(JSON.stringify(env)));
  }

  async subscribe(topics: Topic[], handler: BusHandler): Promise<() => void> {
    const unsubs: (() => void)[] = [];
    for (const topic of topics) {
      const sub = this.nc.subscribe(subjectFor(topic));
      this.subs.push(sub);
      unsubs.push(() => {
        try {
          sub.unsubscribe();
        } catch {
          /* already drained */
        }
      });
      void (async () => {
        for await (const m of sub) {
          try {
            const raw = sc.decode(m.data);
            const env = JSON.parse(raw) as BusEnvelope;
            if (env?.v !== 1 || !env.topic) continue;
            await handler(env.topic, env.data, env);
          } catch {
            /* drop poison */
          }
        }
      })();
    }
    return () => {
      for (const u of unsubs) u();
    };
  }

  async close(): Promise<void> {
    for (const s of this.subs) {
      try {
        s.unsubscribe();
      } catch {
        /* */
      }
    }
    this.subs = [];
    await this.nc.drain().catch(() => this.nc.close());
  }
}

/* ----------------------------- factory ------------------------------------ */

export interface CreateBusOpts {
  /** e.g. nats://127.0.0.1:4222 — empty/unset → memory */
  url?: string | null;
  /** connection name for nats monitoring */
  name?: string;
  /** ms to wait for connect (default 1500) */
  timeoutMs?: number;
  /** if true and NATS fails, throw; else fall back to MemoryBus */
  requireNats?: boolean;
}

/**
 * Prefer NATS when `url` is set; fall back to memory on connect failure
 * unless `requireNats`.
 */
export async function createEventBus(opts: CreateBusOpts = {}): Promise<EventBus> {
  const url = (opts.url ?? process.env.NATS_URL ?? "").trim();
  if (!url) return new MemoryBus();

  const timeoutMs = opts.timeoutMs ?? 1500;
  try {
    const nc = await connect({
      servers: url,
      name: opts.name ?? process.env.NATS_NAME ?? "ciphersentry",
      timeout: timeoutMs,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 500,
    });
    return new NatsBus(nc);
  } catch (e) {
    if (opts.requireNats) throw e;
    console.warn(
      `[bus] NATS unavailable (${url}): ${e instanceof Error ? e.message : e} — using memory bus`,
    );
    return new MemoryBus();
  }
}

/** Build WS/JSON-RPC event frame from a bus topic+data. */
export function toWsFrame(topic: Topic, data: unknown): {
  jsonrpc: "2.0";
  method: string;
  params: { topic: Topic; data: unknown };
} {
  const method =
    topic === "tasks" ? "task.event" : topic === "batches" ? "batch.event" : "fraud.event";
  return { jsonrpc: "2.0", method, params: { topic, data } };
}

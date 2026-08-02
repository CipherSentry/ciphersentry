/**
 * WebSocket subscription hub — the endpoint RpcTransport subscribes to via
 * `events.subscribe`. Frames match src/sdk/rpc.ts frame routing:
 *   { jsonrpc: "2.0", method: "task.event",  params: { topic: "tasks",   data } }
 *   { jsonrpc: "2.0", method: "batch.event", params: { topic: "batches", data } }
 *   { jsonrpc: "2.0", method: "fraud.event", params: { topic: "fraud",   data } }
 *
 * Domain events arrive via the EventBus (NATS/memory). This hub is only the
 * console fan-out consumer — producers never call broadcast for live traffic.
 */

import type { EventBus, Topic } from "@ciphersentry/bus";
import { toWsFrame } from "@ciphersentry/bus";
import type { SimDriver } from "./sim.ts";
import type { ChallengeCase } from "./fraud-proof.ts";
import { publicFraudCase } from "./fraud-proof.ts";

export interface SocketLike {
  send(payload: string): void;
  close(): void;
  on?(event: string, cb: (data: string) => void): void;
  onclose?: () => void;
  readyState?: number;
}

const ALLOWED = new Set<string>(["tasks", "batches", "fraud"]);

export class SubscriptionHub {
  private clients = new Map<SocketLike, Set<string>>();
  private fraudSnapshot: () => ChallengeCase[] = () => [];
  private unsubBus?: () => void;

  get clientCount(): number {
    return this.clients.size;
  }

  /** Optional hydrate source for fraud topic. */
  setFraudSnapshot(fn: () => ChallengeCase[]): void {
    this.fraudSnapshot = fn;
  }

  /**
   * Subscribe hub to the bus for live fan-out. Call once at boot after bus is ready.
   * Returns unsubscribe for shutdown.
   */
  async attachBus(bus: EventBus): Promise<() => void> {
    this.unsubBus?.();
    this.unsubBus = await bus.subscribe(["tasks", "batches", "fraud"], (topic, data) => {
      this.broadcast(topic, toWsFrame(topic, data));
    });
    return this.unsubBus;
  }

  /**
   * Wire sim → bus (not hub). Keeps WS a pure bus consumer.
   * When bus is omitted (tests), falls back to direct broadcast.
   */
  attachEvents(sim: SimDriver, bus?: EventBus): void {
    const emit = (topic: Topic, data: unknown) => {
      if (bus) void bus.publish(topic, data);
      else this.broadcast(topic, toWsFrame(topic, data));
    };
    sim.onTask = (t) => emit("tasks", t);
    sim.onBatch = (b) => emit("batches", b);
  }

  register(ws: SocketLike, sim: SimDriver): void {
    this.clients.set(ws, new Set());

    ws.on?.("message", (raw: string) => {
      let env: { jsonrpc?: string; id: number | string; method?: string; params?: { topics?: string[] } };
      try {
        env = JSON.parse(raw);
      } catch {
        this.send(ws, frame("error", { code: "CEN_E_SCHEMA", message: "invalid frame" }));
        return;
      }
      if (env.method !== "events.subscribe" || !env.params?.topics?.length) {
        this.send(ws, {
          jsonrpc: "2.0",
          id: env.id ?? 0,
          error: { code: "CEN_E_SCHEMA", message: "expected events.subscribe" },
        });
        return;
      }
      const topics = env.params.topics.filter((t) => ALLOWED.has(t));
      topics.forEach((t) => this.clients.get(ws)?.add(t));
      this.send(ws, { jsonrpc: "2.0", id: env.id, result: { subscribed: topics } });
      this.hydrate(ws, sim, topics);
    });

    ws.onclose = () => this.clients.delete(ws);
  }

  private hydrate(ws: SocketLike, sim: SimDriver, topics: string[]): void {
    const { tasks, batches } = sim.snapshots();
    if (topics.includes("tasks")) {
      for (const t of tasks.slice(0, 8)) {
        this.send(ws, { jsonrpc: "2.0", method: "task.event", params: { topic: "tasks", data: t } });
      }
    }
    if (topics.includes("batches")) {
      for (const b of batches.slice(-2)) {
        this.send(ws, { jsonrpc: "2.0", method: "batch.event", params: { topic: "batches", data: b } });
      }
    }
    if (topics.includes("fraud")) {
      for (const c of this.fraudSnapshot().slice(-8)) {
        this.send(ws, {
          jsonrpc: "2.0",
          method: "fraud.event",
          params: { topic: "fraud", data: publicFraudCase(c) },
        });
      }
    }
  }

  broadcast(topic: string, payload: unknown): void {
    for (const [ws, topics] of this.clients) {
      if (topics.has(topic)) this.send(ws, payload);
    }
  }

  private send(ws: SocketLike, payload: unknown): void {
    try {
      ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    } catch {
      this.clients.delete(ws);
    }
  }
}

function frame(method: string, params: unknown): unknown {
  return { jsonrpc: "2.0", method, params };
}

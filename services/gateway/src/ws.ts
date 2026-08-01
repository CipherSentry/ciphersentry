/**
 * WebSocket subscription hub — the endpoint RpcTransport subscribes to via
 * `events.subscribe`. Frames match src/sdk/rpc.ts frame routing:
 *   { jsonrpc: "2.0", method: "task.event",  params: { topic: "tasks",   data } }
 *   { jsonrpc: "2.0", method: "batch.event", params: { topic: "batches", data } }
 */

import type { SimDriver, BatchRowPacket, TaskRow } from "./sim";

export interface SocketLike {
  send(payload: string): void;
  close(): void;
  on?(event: string, cb: (data: string) => void): void;
  onclose?: () => void;
  readyState?: number;
}

export class SubscriptionHub {
  private clients = new Map<SocketLike, Set<string>>();

  attachEvents(sim: SimDriver): void {
    sim.onTask = (t: TaskRow) => this.broadcast("tasks", { jsonrpc: "2.0", method: "task.event", params: { topic: "tasks", data: t } });
    sim.onBatch = (b: BatchRowPacket) => this.broadcast("batches", { jsonrpc: "2.0", method: "batch.event", params: { topic: "batches", data: b } });
  }

  register(ws: SocketLike, sim: SimDriver): void {
    this.clients.set(ws, new Set());

    ws.on?.("message", (raw: string) => {
      let env: { jsonrpc?: string; id: number | string; method?: string; params?: { topics?: string[] } };
      try {
        env = JSON.parse(raw);
      } catch {
        this.send(ws, frame("error", { code: "MRC_E_SCHEMA", message: "invalid frame" }));
        return;
      }
      if (env.method !== "events.subscribe" || !env.params?.topics?.length) {
        this.send(ws, { jsonrpc: "2.0", id: env.id ?? 0, error: { code: "MRC_E_SCHEMA", message: "expected events.subscribe" } });
        return;
      }
      const topics = env.params.topics.filter((t) => t === "tasks" || t === "batches");
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

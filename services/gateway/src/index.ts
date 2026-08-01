/**
 * CipherSentry Edge Gateway — B0.
 *
 *   POST /rpc    — JSON-RPC 2.0 over the §5 method map (dispatch in rpc.ts)
 *   GET  /events — WebSocket hub (task.event / batch.event frames)
 *   GET  /health — liveness
 *
 * Until a chain exists, the wire truth is the SimDriver — same cadence,
 * same bytes, same invariants the frontend was built to trust.
 */

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { SimDriver } from "./sim";
import { makeDispatcher } from "./rpc";
import { SubscriptionHub, type SocketLike } from "./ws";
import { ChainWatcher, makeChainConfigFromEnv } from "./chain";

const HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
const PORT = Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? 8080);

const EPOCH = 88421;

async function boot(): Promise<void> {
  const fastify = Fastify({ logger: false });

  // permissive CORS — consoles may render from any vanity origin during dev
  fastify.addHook("preHandler", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization");
    if (req.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  await fastify.register(websocket, {
    // @fastify/websocket defaults degrade gracefully on plain HTTP GET
    options: { maxPayload: 1 << 20 },
  });

  const sim = new SimDriver({ tickMs: 2800 });
  const hub = new SubscriptionHub();
  hub.attachEvents(sim);
  sim.start();

  /* ------------------------- chain binding (optional) ----------------------
   * If ESCROW_ADDRESS / BATCHER_ADDRESS are set, chain events flow into the
   * same hub, tagged _src:"chain", winning over sim frames per task family.  */
  await registerChainBinding(hub, sim);

  const dispatch = makeDispatcher({ sim, emitTask: (t) => sim.onTask?.(t), epoch: EPOCH });

  /* --------------------------------- API --------------------------------- */

  fastify.get("/health", async () => ({ ok: true, service: "ciphersentry-gateway", epoch: EPOCH, clients: undefined }));

  fastify.post("/rpc", async (req, reply) => {
    const env = req.body as { jsonrpc?: string; id: number | string; method?: string; params?: Record<string, unknown> };
    if (!env?.jsonrpc || typeof env.method !== "string") {
      reply.code(400);
      return { jsonrpc: "2.0", id: null, error: { code: "CEN_E_SCHEMA", message: "not a JSON-RPC 2.0 envelope" } };
    }
    const out = await dispatch({
      jsonrpc: "2.0",
      id: env.id ?? 0,
      method: env.method,
      params: env.params ?? {},
    });
    if (!out.ok) return { jsonrpc: "2.0", id: env.id, error: out.error };
    return { jsonrpc: "2.0", id: env.id, result: out.result };
  });

  fastify.get("/events", { websocket: true }, (connection) => {
    try {
      // v11: connection exposes the ws socket under .socket
      const ws = (connection as unknown as { socket?: SocketLike }).socket ?? (connection as unknown as SocketLike);
      hub.register(ws, sim);
    } catch {
      try {
        (connection as unknown as { close?: () => void }).close?.();
      } catch {
        /* half-open */
      }
    }
  });

  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ jsonrpc: "2.0", id: null, error: { code: "CEN_E_SCHEMA", message: "unknown route" } });
  });

  await fastify.listen({ host: HOST, port: PORT });

  console.log("ciphersentry-gateway");
  console.log(`  rpc      → http://${HOST}:${PORT}/rpc`);
  console.log(`  events   → ws://${HOST}:${PORT}/events  (subscribe: ["tasks","batches"])`);
  console.log(`  epoch    → ${EPOCH}`);
  console.log("");
  console.log(`  connect the console: ?net=rpc&node=ws://${HOST}:${PORT}/events`);
}

/* ------------------------- chain watcher wiring ---------------------------- */

async function registerChainBinding(hub: SubscriptionHub, sim: SimDriver): Promise<void> {
  const cfg = makeChainConfigFromEnv();
  if (!cfg.escrowAddress && !cfg.batcherAddress) {
    console.log("  chain     → OFFLINE (ESCROW_ADDRESS / BATCHER_ADDRESS unset)");
    return;
  }

  const watcher = new ChainWatcher(cfg, {
    onTaskFrame: (t) => {
      // sim and chain never collide on ids: on-chain tasks are bytes32 hex
      // and the sim's live feed reads cent_* strings.
      hubBroadcast(hub, "tasks", t);
    },
    onBatchFrame: (b) => {
      hubBroadcast(hub, "batches", b);
    },
  });

  await watcher.start();
}

function hubBroadcast(hub: SubscriptionHub, topic: "tasks" | "batches", data: unknown): void {
  (hub as unknown as { broadcast(topic: string, payload: unknown): void }).broadcast(topic, {
    jsonrpc: "2.0",
    method: `${topic === "tasks" ? "task" : "batch"}.event`,
    params: { topic, data },
  });
}

process.on("SIGINT", () => process.exit(0));

const isEntry = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isEntry) {
  void boot().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

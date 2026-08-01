/**
 * CipherSentry Edge Gateway — B0 Ledger.
 *
 *   POST /rpc    — JSON-RPC 2.0 over the §5 method map (dispatch in rpc.ts)
 *   GET  /events — WebSocket hub (task.event / batch.event frames)
 *   GET  /health — liveness + escrow mode
 *
 * Default truth is the in-memory TaskLedger + SimDriver.
 * Set ESCROW_ADDRESS (+ PROTOCOL_FROM) for Base-Sepolia writes;
 * ChainWatcher fans out on-chain logs into the same WS hub.
 */

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { SimDriver } from "./sim.ts";
import { makeDispatcher, TaskLedger } from "./rpc.ts";
import { SubscriptionHub, type SocketLike } from "./ws.ts";
import { ChainWatcher, makeChainConfigFromEnv } from "./chain.ts";
import { EscrowGateway, makeEscrowConfigFromEnv } from "./escrow.ts";

const HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
const PORT = Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? 8080);
const EPOCH = Number(process.env.EPOCH ?? 88421);

async function boot(): Promise<void> {
  const fastify = Fastify({ logger: false });

  fastify.addHook("preHandler", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type,authorization");
    if (req.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  await fastify.register(websocket, {
    options: { maxPayload: 1 << 20 },
  });

  const sim = new SimDriver({ tickMs: Number(process.env.TICK_MS ?? 2800) });
  const ledger = new TaskLedger();
  const escrow = new EscrowGateway(makeEscrowConfigFromEnv());
  const hub = new SubscriptionHub();
  hub.attachEvents(sim);
  sim.start();

  await registerChainBinding(hub);

  const dispatch = makeDispatcher({
    sim,
    ledger,
    escrow,
    emitTask: (t) => {
      sim.onTask?.(t);
    },
    epoch: EPOCH,
  });

  fastify.get("/health", async () => ({
    ok: true,
    service: "ciphersentry-gateway",
    epoch: EPOCH,
    escrow: escrow.mode,
    clients: hub.clientCount,
  }));

  fastify.post("/rpc", async (req, reply) => {
    const env = req.body as {
      jsonrpc?: string;
      id: number | string;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (!env?.jsonrpc || typeof env.method !== "string") {
      reply.code(400);
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: "CEN_E_SCHEMA", message: "not a JSON-RPC 2.0 envelope" },
      };
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
      const ws =
        (connection as unknown as { socket?: SocketLike }).socket ??
        (connection as unknown as SocketLike);
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
    reply.code(404).send({
      jsonrpc: "2.0",
      id: null,
      error: { code: "CEN_E_SCHEMA", message: "unknown route" },
    });
  });

  await fastify.listen({ host: HOST, port: PORT });

  console.log("ciphersentry-gateway  [B0]");
  console.log(`  rpc      → http://${HOST}:${PORT}/rpc`);
  console.log(`  events   → ws://${HOST}:${PORT}/events`);
  console.log(`  health   → http://${HOST}:${PORT}/health`);
  console.log(`  epoch    → ${EPOCH}`);
  console.log(`  escrow   → ${escrow.mode}`);
  console.log("");
  console.log(`  console  → ?net=rpc&node=http://${HOST}:${PORT}`);
}

async function registerChainBinding(hub: SubscriptionHub): Promise<void> {
  const cfg = makeChainConfigFromEnv();
  if (!cfg.escrowAddress && !cfg.batcherAddress) {
    console.log("  chain     → OFFLINE (set ESCROW_ADDRESS / BATCHER_ADDRESS)");
    return;
  }

  const watcher = new ChainWatcher(cfg, {
    onTaskFrame: (t) => hubBroadcast(hub, "tasks", t),
    onBatchFrame: (b) => hubBroadcast(hub, "batches", b),
  });

  await watcher.start();
}

function hubBroadcast(hub: SubscriptionHub, topic: "tasks" | "batches", data: unknown): void {
  hub.broadcast(topic, {
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

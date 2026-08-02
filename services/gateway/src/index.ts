/**
 * CipherSentry Edge Gateway — B0–B3 CENT-ready.
 *
 *   POST /rpc    — JSON-RPC 2.0 over the §5 method map (dispatch in rpc.ts)
 *   GET  /events — WebSocket hub (task.event / batch.event frames)
 *   GET  /health — liveness + escrow + elected quorum + accrual
 *
 * Default truth is TaskLedger + SimDriver + VerifierPool
 * (registry, election, accuracy, accrual). Optional chain writers:
 * ESCROW_ADDRESS, SLASH_EXECUTOR_ADDRESS.
 */

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { VerifierPool } from "@ciphersentry/verifier-daemon";
import { SimDriver } from "./sim.ts";
import { makeDispatcher, TaskLedger } from "./rpc.ts";
import { SubscriptionHub, type SocketLike } from "./ws.ts";
import { ChainWatcher, makeChainConfigFromEnv } from "./chain.ts";
import { EscrowGateway, makeEscrowConfigFromEnv } from "./escrow.ts";
import { SlashExecutorGateway, makeSlashConfigFromEnv } from "./slash-executor.ts";

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
  const slashChain = new SlashExecutorGateway(makeSlashConfigFromEnv());
  const pool = new VerifierPool({ epoch: EPOCH });
  pool.ensureElection(EPOCH);
  const hub = new SubscriptionHub();
  hub.attachEvents(sim);
  sim.start();

  await registerChainBinding(hub);

  const dispatch = makeDispatcher({
    sim,
    ledger,
    escrow,
    pool,
    slashChain,
    emitTask: (t) => {
      sim.onTask?.(t);
    },
    epoch: EPOCH,
  });

  fastify.get("/health", async () => {
    const el = pool.ensureElection();
    return {
      ok: true,
      service: "ciphersentry-gateway",
      epoch: pool.currentEpoch,
      escrow: escrow.mode,
      slash_executor: slashChain.mode,
      clients: hub.clientCount,
      phase: "B3",
      verifiers: el.members,
      eligible: pool.registry.eligible().length,
      slash_dry_runs: pool.slash.all().length,
      accrual: pool.accrual.summary(),
    };
  });

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

  const el = pool.ensureElection();
  console.log("ciphersentry-gateway  [B3]");
  console.log(`  rpc      → http://${HOST}:${PORT}/rpc`);
  console.log(`  events   → ws://${HOST}:${PORT}/events`);
  console.log(`  health   → http://${HOST}:${PORT}/health`);
  console.log(`  epoch    → ${pool.currentEpoch}`);
  console.log(`  quorum   → ${el.members.join(", ")}`);
  console.log(`  escrow   → ${escrow.mode}`);
  console.log(`  slash    → ${slashChain.mode}`);
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

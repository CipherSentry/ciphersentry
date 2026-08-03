/**
 * CipherSentry Edge Gateway — B0–B5 CENT-ready + batcher + fraud-proof worker.
 *
 *   POST /rpc    — JSON-RPC 2.0 over the §5 method map (dispatch in rpc.ts)
 *   GET  /events — WebSocket hub (task.event / batch.event / fraud.event)
 *   GET  /health — liveness + escrow + batcher + fraud + bus + elected quorum
 *   POST /access-requests — landing access + waitlist collector (public)
 *   GET  /access-requests — list requests (Bearer ACCESS_OPS_TOKEN)
 *
 * Domain events publish on the EventBus (NATS when NATS_URL set). The WS hub
 * is a bus consumer for console fan-out — indexer and other services subscribe
 * independently (no longer piggyback on gateway WS alone).
 */

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { VerifierPool } from "@ciphersentry/verifier-daemon";
import { createEventBus, type EventBus, type Topic } from "@ciphersentry/bus";
import { SimDriver } from "./sim.ts";
import { makeDispatcher, TaskLedger, REGISTRY } from "./rpc.ts";
import { SubscriptionHub, type SocketLike } from "./ws.ts";
import { ChainWatcher, makeChainConfigFromEnv } from "./chain.ts";
import { EscrowGateway, makeEscrowConfigFromEnv } from "./escrow.ts";
import { SlashExecutorGateway, makeSlashConfigFromEnv } from "./slash-executor.ts";
import { SettlementBatcherGateway, makeBatcherConfigFromEnv } from "./batcher.ts";
import { FraudProofWorker, makeFraudConfigFromEnv, publicFraudCase } from "./fraud-proof.ts";
import { createKv } from "./kv.ts";
import {
  AuthService,
  RateLimiter,
  isPublicMethod,
  makeStakeLookup,
  rpmForStake,
} from "./auth.ts";
import { isProdOps } from "./keys.ts";
import { AccessRequestStore, opsTokenOk } from "./access-requests.ts";

const HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
const PORT = Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? 8080);
const EPOCH = Number(process.env.EPOCH ?? 88421);
const PROD = isProdOps();
/** Default to local compose NATS; falls back to memory if unreachable (unless prod). */
// Fly public demo has no sidecar NATS/Redis — empty URL → memory bus/kv.
// Local defaults still point at compose ports when unset and not on Fly.
const ON_FLY = Boolean(process.env.FLY_APP_NAME || process.env.FLY_MACHINE_ID);
const NATS_URL =
  process.env.NATS_URL !== undefined
    ? process.env.NATS_URL
    : ON_FLY
      ? ""
      : "nats://127.0.0.1:4222";
const REDIS_URL =
  process.env.REDIS_URL !== undefined
    ? process.env.REDIS_URL
    : ON_FLY
      ? ""
      : "redis://127.0.0.1:6379";
/** B7 prod forces AUTH_REQUIRED. */
const AUTH_REQUIRED = PROD || process.env.AUTH_REQUIRED === "1";
const ANON_RPM = Number(process.env.ANON_RPM ?? 20);

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

  const REQUIRE_NATS =
    PROD || process.env.NATS_REQUIRE === "1" || process.env.B7 === "1";
  if (PROD) {
    process.env.REDIS_REQUIRE = process.env.REDIS_REQUIRE ?? "1";
    process.env.NATS_REQUIRE = "1";
  }
  const bus = await createEventBus({
    url: NATS_URL,
    name: "gateway",
    requireNats: REQUIRE_NATS,
  });
  const publish = (topic: Topic, data: unknown) => void bus.publish(topic, data);
  const kv = await createKv(REDIS_URL);

  if (PROD) {
    if (bus.mode !== "nats") {
      throw new Error("[B7] CS_ENV=production requires NATS bus (set NATS_URL, NATS_REQUIRE=1)");
    }
    if (kv.mode !== "redis") {
      throw new Error("[B7] CS_ENV=production requires Redis sessions (set REDIS_URL, REDIS_REQUIRE=1)");
    }
  }

  const sim = new SimDriver({ tickMs: Number(process.env.TICK_MS ?? 2800) });
  const ledger = new TaskLedger();
  const escrow = new EscrowGateway(makeEscrowConfigFromEnv());
  const slashChain = new SlashExecutorGateway(makeSlashConfigFromEnv());
  const batcher = new SettlementBatcherGateway(makeBatcherConfigFromEnv());
  const fraud = new FraudProofWorker(makeFraudConfigFromEnv(), slashChain, kv);
  await fraud.hydrate();
  const pool = new VerifierPool({ epoch: EPOCH });
  pool.ensureElection(EPOCH);

  const stakeOf = makeStakeLookup(REGISTRY, (id) => {
    const seat = pool.registry.all().find((s) => s.id === id);
    return seat?.bond;
  });
  const auth = new AuthService(kv, stakeOf);
  const rateLimit = new RateLimiter(kv);
  const accessStore = new AccessRequestStore(kv);
  const ACCESS_OPS_TOKEN = (process.env.ACCESS_OPS_TOKEN ?? "").trim();
  const ACCESS_RPM = Number(process.env.ACCESS_RPM ?? 10);

  const hub = new SubscriptionHub();
  await hub.attachBus(bus);
  hub.attachEvents(sim, bus);
  hub.setFraudSnapshot(() => fraud.list());
  fraud.onCase = (c) => publish("fraud", publicFraudCase(c));
  sim.start();
  // hub.eventPubkey exposed on /health for console verify

  batcher.onBatch = (b) => publish("batches", b);
  batcher.start();

  await registerChainBinding(publish);

  const dispatch = makeDispatcher({
    sim,
    ledger,
    escrow,
    pool,
    slashChain,
    batcher,
    fraud,
    auth,
    emitTask: (t) => {
      sim.onTask?.(t);
    },
    epoch: EPOCH,
  });

  fastify.get("/health", async () => {
    const el = pool.ensureElection();
    const fi = fraud.info();
    return {
      ok: true,
      service: "ciphersentry-gateway",
      epoch: pool.currentEpoch,
      escrow: escrow.mode,
      slash_executor: slashChain.mode,
      batcher: batcher.mode,
      batch_pending: batcher.pendingCount,
      fraud: fraud.mode,
      fraud_open: fi.open,
      fraud_durable: fi.durable,
      fraud_store: fi.store,
      fraud_total: fi.total,
      bus: bus.mode,
      kv: kv.mode,
      auth_required: AUTH_REQUIRED,
      b7: PROD,
      clients: hub.clientCount,
      event_pubkey: hub.eventPubkey,
      phase: PROD ? "B7" : "B5",
      verifiers: el.members,
      eligible: pool.registry.eligible().length,
      slash_dry_runs: pool.slash.all().length,
      accrual: pool.accrual.summary(),
      access_requests: await accessStore.count(),
      access_ops: Boolean(ACCESS_OPS_TOKEN),
    };
  });

  /** Landing "Request Access" + gates waitlist — public write, ops read. */
  fastify.post("/access-requests", async (req, reply) => {
    const ip =
      req.ip ||
      (typeof req.headers["x-forwarded-for"] === "string"
        ? req.headers["x-forwarded-for"].split(",")[0]!.trim()
        : "unknown");
    const limited = await rateLimit.check({ key: `access:${ip}`, rpm: ACCESS_RPM });
    if (limited) {
      reply.code(429);
      return { ok: false, error: limited };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const row = await accessStore.submit(body, { ip });
    if ("error" in row) {
      reply.code(400);
      return { ok: false, error: row.error };
    }
    reply.code(201);
    return {
      ok: true,
      id: row.id,
      queue: row.queue,
      kind: row.kind,
      at: row.at,
    };
  });

  /** Public waitlist headcount — no PII (gates board). */
  fastify.get("/access-requests/stats", async () => {
    const total = await accessStore.count();
    const items = await accessStore.list(500);
    const waitlist = items.filter((r) => r.kind === "verifier_waitlist").length;
    return {
      ok: true,
      count: total,
      waitlist: waitlist || total,
      access: items.filter((r) => r.kind === "access").length,
    };
  });

  fastify.get("/access-requests", async (req, reply) => {
    if (!ACCESS_OPS_TOKEN) {
      reply.code(503);
      return {
        ok: false,
        error: "ACCESS_OPS_TOKEN not configured — set fly secret / env to list requests",
      };
    }
    const authz =
      (typeof req.headers.authorization === "string" ? req.headers.authorization : null) ??
      (typeof req.headers["x-ops-token"] === "string" ? `Bearer ${req.headers["x-ops-token"]}` : null);
    if (!opsTokenOk(authz, ACCESS_OPS_TOKEN)) {
      reply.code(401);
      return { ok: false, error: "unauthorized — Authorization: Bearer $ACCESS_OPS_TOKEN" };
    }
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    const items = await accessStore.list(Number.isFinite(limit) ? limit : 100);
    return { ok: true, count: items.length, total: await accessStore.count(), items };
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

    const authHeader = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
    const session = await auth.sessionOf(authHeader);
    const ip = req.ip || (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || "unknown";
    const rlKey = session ? `sess:${session.token}` : `ip:${ip}`;
    const rpm = session ? session.rpm : ANON_RPM;
    const limited = await rateLimit.check({ key: rlKey, rpm });
    if (limited) {
      reply.code(429);
      return {
        jsonrpc: "2.0",
        id: env.id ?? 0,
        error: { code: "CEN_E_CAP_BREACH", message: limited },
      };
    }

    if (AUTH_REQUIRED && !isPublicMethod(env.method) && !session) {
      reply.code(401);
      return {
        jsonrpc: "2.0",
        id: env.id ?? 0,
        error: { code: "CEN_E_CAP_BREACH", message: "auth required — call auth.challenge + auth.session" },
      };
    }

    const out = await dispatch(
      {
        jsonrpc: "2.0",
        id: env.id ?? 0,
        method: env.method,
        params: env.params ?? {},
      },
      { session },
    );
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

  // Optional path proxy → co-located memory indexer (Fly public node)
  const INDEXER_UPSTREAM = (process.env.INDEXER_UPSTREAM ?? "").replace(/\/$/, "");
  if (INDEXER_UPSTREAM) {
    const prefixes = ["/batches", "/receipts", "/agents", "/trust", "/fraud", "/search", "/stats", "/tasks"];
    const proxyIndexer = async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      try {
        const target = `${INDEXER_UPSTREAM}${req.url}`;
        const headers: Record<string, string> = { accept: "application/json" };
        if (req.headers["content-type"]) headers["content-type"] = String(req.headers["content-type"]);
        const init: RequestInit = { method: req.method, headers };
        if (req.method !== "GET" && req.method !== "HEAD" && req.body != null) {
          init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        }
        const res = await fetch(target, init);
        const text = await res.text();
        reply.code(res.status);
        const ct = res.headers.get("content-type");
        if (ct) reply.header("content-type", ct);
        return reply.send(text);
      } catch (e) {
        reply.code(502);
        return {
          error: "indexer_upstream",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    };
    for (const p of prefixes) {
      fastify.all(p, proxyIndexer);
      fastify.all(`${p}/*`, proxyIndexer);
    }
    // dedicated indexer health (gateway keeps /health)
    fastify.get("/indexer/health", async (_req, reply) => {
      try {
        const res = await fetch(`${INDEXER_UPSTREAM}/health`);
        const body = await res.json();
        reply.code(res.status);
        return body;
      } catch (e) {
        reply.code(502);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({
      jsonrpc: "2.0",
      id: null,
      error: { code: "CEN_E_SCHEMA", message: "unknown route" },
    });
  });

  await fastify.listen({ host: HOST, port: PORT });

  const el = pool.ensureElection();
  console.log(`ciphersentry-gateway  [${PROD ? "B7" : "B5"}]`);
  console.log(`  rpc      → http://${HOST}:${PORT}/rpc`);
  console.log(`  events   → ws://${HOST}:${PORT}/events`);
  console.log(`  health   → http://${HOST}:${PORT}/health`);
  console.log(`  access   → POST/GET http://${HOST}:${PORT}/access-requests (ops=${ACCESS_OPS_TOKEN ? "token set" : "token MISSING"})`);
  if (INDEXER_UPSTREAM) {
    console.log(`  indexer  → proxy ${INDEXER_UPSTREAM} (/batches… /indexer/health)`);
  }
  console.log(`  bus      → ${bus.mode}${bus.mode === "nats" ? ` (${NATS_URL})` : ""}`);
  console.log(`  kv       → ${kv.mode}${kv.mode === "redis" ? ` (${REDIS_URL})` : ""}`);
  console.log(`  auth     → ${AUTH_REQUIRED ? "REQUIRED" : "optional"} (ed25519 · stake rpm base=${rpmForStake(0)} anon=${ANON_RPM})`);
  if (PROD) console.log(`  ops      → prod (redis+nats+auth; keys via *_FILE or env)`);
  console.log(`  eventsig → ${hub.eventPubkey.slice(0, 16)}… (cent.event.v1)`);
  console.log(`  epoch    → ${pool.currentEpoch}`);
  console.log(`  quorum   → ${el.members.join(", ")}`);
  console.log(`  escrow   → ${escrow.mode}`);
  console.log(`  slash    → ${slashChain.mode}`);
  console.log(`  batcher  → ${batcher.mode} (keys=${makeBatcherConfigFromEnv().signerKeys.length})`);
  console.log(`  fraud    → ${fraud.mode} (auto=${fraud.autoChallenge})`);
  console.log("");
  console.log(`  console  → ?net=rpc&node=http://${HOST}:${PORT}`);
}

async function registerChainBinding(publish: (topic: Topic, data: unknown) => void): Promise<void> {
  const cfg = makeChainConfigFromEnv();
  if (!cfg.escrowAddress && !cfg.batcherAddress) {
    console.log("  chain     → OFFLINE (set ESCROW_ADDRESS / BATCHER_ADDRESS)");
    return;
  }

  const watcher = new ChainWatcher(cfg, {
    onTaskFrame: (t) => publish("tasks", t),
    onBatchFrame: (b) => publish("batches", b),
  });

  await watcher.start();
}

// re-export for tests that may still import hub path
export type { EventBus };

process.on("SIGINT", () => process.exit(0));

const isEntry = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isEntry) {
  void boot().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

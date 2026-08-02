/**
 * Indexer service main — listener + public read API. (B6)
 *
 *   chain events ──▶ Postgres (state, events are the record)
 *                └─▶ ClickHouse (receipt graph + trust series)
 *   http           ──▶ /batches /receipts /agents /search /proofs /trust /health
 *
 * Trust score per the whitepaper §5:
 *   T_i = clamp(0, 100, 50·log2(1 + s_i) + 40·q_i + 10·(1 − e^(−n_i/500)))
 */

import { createServer } from "node:http";
import { createEventBus, type EventBus } from "@ciphersentry/bus";
import { ClickHouseHttp, applyChSchema, createPgQuerier, type Querier } from "./db.ts";
import {
  ChainListener,
  LedgerWriter,
  type BatchRow,
  type FraudCaseRow,
  type TaskEventRow,
} from "./ledger.ts";
import { normalizeTask, normalizeBatch, normalizeFraud } from "./normalize.ts";
import { verifyInclusionEitherOrder } from "./merkle.ts";
import { StakeCache, setStakeCache } from "./stakes.ts";

/* ------------------------------- config ------------------------------------ */

// 127.0.0.1 not localhost — Node resolves localhost to ::1 (IPv6) on many
// setups while compose binds IPv4; that's the #1 first-run connection error.
const PG_DSN = process.env.PG_DSN ?? "postgres://cent:cent@127.0.0.1:5432/ciphersentry";
const CH_URL = process.env.CH_URL ?? "http://127.0.0.1:8123";
const CH_DB = process.env.CH_DB ?? "ciphersentry";
const NODE_EVENTS =
  process.env.NODE_EVENTS ??
  process.env.GATEWAY_EVENTS ??
  "ws://127.0.0.1:8080/events";
/** Prefer NATS when set (default compose). Empty string disables bus path. */
const NATS_URL = process.env.NATS_URL ?? "nats://127.0.0.1:4222";
/** Force WS even when NATS is up (debug). */
const FORCE_WS = process.env.INDEXER_FORCE_WS === "1";
/** Fail boot if NATS missing — no WS fallback (CI full e2e). */
const REQUIRE_NATS =
  process.env.INDEXER_REQUIRE_NATS === "1" || process.env.NATS_REQUIRE === "1";
const PORT = Number(process.env.PORT ?? process.env.INDEXER_PORT ?? 8081);
const MEMORY = process.env.INDEXER_MEMORY === "1";
const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
/** Set at boot — exposed on /health + /stats. */
let activeBusMode: "nats" | "ws" | "memory" | null = null;

/* ----------------------------- trust score --------------------------------- */

export { trustScore } from "./trust.ts";

/* ------------------------------- router ------------------------------------ */

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "content-length": Buffer.byteLength(s),
  });
  res.end(s);
}

async function handle(pg: Querier, ch: ClickHouseHttp, url: URL): Promise<{ status: number; body: unknown }> {
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (p === "/health") {
    return {
      status: 200,
      body: {
        ok: true,
        service: "ciphersentry-indexer",
        phase: "B6",
        events: NODE_EVENTS,
        nats: NATS_URL || null,
        bus: activeBusMode,
        memory: MEMORY,
        gateway: GATEWAY_URL,
      },
    };
  }

  if (p === "/batches") {
    const rows = await pg.exec(
      `SELECT batch_id, epoch, root, count, total, state, at, anchored_tx, anchored_block FROM batches ORDER BY at DESC LIMIT 50`,
    );
    return { status: 200, body: { data: rows } };
  }

  const mb = p.match(/^\/batches\/([^/]+)$/);
  if (mb) {
    const batch = await pg.exec(`SELECT * FROM batches WHERE batch_id = $1`, [mb[1]]);
    const receipts = await pg.exec(
      `SELECT receipt_id, task_id, reported, recomputed, ms, epoch, leaf, path FROM receipts WHERE batch_id = $1 ORDER BY settled_at`,
      [mb[1]],
    );
    if (!batch.length) return { status: 404, body: { error: "batch_not_found" } };
    return { status: 200, body: { data: { batch: batch[0], receipts } } };
  }

  const mr = p.match(/^\/receipts\/([^/]+)$/);
  if (mr) {
    const rows = await pg.exec(`SELECT * FROM receipts WHERE receipt_id = $1 OR task_id = $1 LIMIT 1`, [mr[1]]);
    if (!rows.length) return { status: 404, body: { error: "receipt_not_found" } };
    return { status: 200, body: { data: rows[0] } };
  }

  const mp = p.match(/^\/receipts\/([^/]+)\/proof$/);
  if (mp) {
    const rows = await pg.exec(`SELECT * FROM receipts WHERE receipt_id = $1 LIMIT 1`, [mp[1]]);
    if (!rows.length) return { status: 404, body: { error: "receipt_not_found" } };
    const r = rows[0] as { leaf: string; path: string[] | string; batch_id: string };
    const path = typeof r.path === "string" ? (JSON.parse(r.path) as string[]) : r.path;
    const batch = await pg.exec(
      `SELECT root, anchored_block, anchored_tx FROM batches WHERE batch_id = $1`,
      [r.batch_id],
    );
    const root = batch[0] ? String((batch[0] as { root: string }).root) : "";
    const valid = root ? verifyInclusionEitherOrder(r.leaf, path ?? [], root) : false;
    return {
      status: 200,
      body: {
        data: {
          leaf: r.leaf,
          path,
          anchor: batch[0] ?? null,
          valid,
        },
      },
    };
  }

  const ma = p.match(/^\/agents\/([^/]+)$/);
  if (ma && !p.endsWith("/receipts")) {
    const rows = await pg.exec(`SELECT * FROM agents WHERE agent_id = $1`, [ma[1]]);
    if (!rows.length) return { status: 404, body: { error: "agent_not_found" } };
    return { status: 200, body: { data: rows[0] } };
  }

  const mar = p.match(/^\/agents\/([^/]+)\/receipts$/);
  if (mar) {
    const rows = await pg.exec(
      `SELECT r.receipt_id, r.task_id, r.ms, r.epoch, r.batch_id, t.spec, t.amount, t.worker, t.buyer
       FROM receipts r JOIN tasks t ON t.task_id = r.task_id
       WHERE t.worker = $1 OR t.buyer = $1 ORDER BY r.settled_at DESC LIMIT 25`,
      [mar[1]],
    );
    return { status: 200, body: { data: rows } };
  }

  const mt = p.match(/^\/trust\/([^/]+)$/);
  if (mt) {
    const agent = mt[1]!.replace(/'/g, "");
    try {
      const rows = await ch.exec<{ agent_id: string; epoch: number; trust_score: number }>(
        `SELECT agent_id, epoch, trust_score FROM trust_series WHERE agent_id = '${agent}' ORDER BY epoch DESC LIMIT 32 FORMAT JSON`,
      );
      return { status: 200, body: { data: rows } };
    } catch {
      return { status: 200, body: { data: [] } };
    }
  }

  if (p === "/fraud") {
    const rows = await pg.exec(
      `SELECT task_id, status, reported, recomputed, buyer, worker, amount, ruling, reason,
              open_at, open_block, resolved_at, chain_mode, chain_tx, updated_at
       FROM fraud_cases ORDER BY updated_at DESC LIMIT 50`,
    );
    return { status: 200, body: { data: rows } };
  }

  const mf = p.match(/^\/fraud\/([^/]+)$/);
  if (mf) {
    const rows = await pg.exec(`SELECT * FROM fraud_cases WHERE task_id = $1`, [mf[1]]);
    if (!rows.length) return { status: 404, body: { error: "fraud_not_found" } };
    return { status: 200, body: { data: rows[0] } };
  }

  if (p === "/search") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return { status: 400, body: { error: "missing q" } };
    const like = `%${q}%`;
    const [receipts, batches, agents, fraud] = await Promise.all([
      pg.exec(
        `SELECT receipt_id, batch_id FROM receipts WHERE receipt_id ILIKE $1 OR task_id ILIKE $1 OR leaf ILIKE $1 LIMIT 10`,
        [like],
      ),
      pg.exec(`SELECT batch_id, epoch FROM batches WHERE batch_id ILIKE $1 OR root ILIKE $1 LIMIT 5`, [like]),
      pg.exec(`SELECT agent_id, tier, trust FROM agents WHERE agent_id ILIKE $1 LIMIT 5`, [like]),
      pg.exec(
        `SELECT task_id, status, ruling FROM fraud_cases WHERE task_id ILIKE $1 OR worker ILIKE $1 OR buyer ILIKE $1 LIMIT 5`,
        [like],
      ).catch(() => [] as unknown[]),
    ]);
    return { status: 200, body: { data: { receipts, batches, agents, fraud } } };
  }

  return { status: 404, body: { error: "not_found" } };
}

/* -------------------------------- boot ------------------------------------- */

export async function boot(): Promise<void> {
  let pg: Querier;
  let ch: ClickHouseHttp | import("./memory.ts").MemoryClickHouse;

  if (MEMORY) {
    const { MemoryStore, MemoryClickHouse } = await import("./memory.ts");
    pg = new MemoryStore();
    ch = new MemoryClickHouse();
    console.log("  storage  → MEMORY (INDEXER_MEMORY=1)");
  } else {
    pg = await createPgQuerier(PG_DSN);
    ch = new ClickHouseHttp(CH_URL, CH_DB, process.env.CH_USER ?? "cent", process.env.CH_PASSWORD ?? "cent");
    try {
      await applyChSchema(ch as ClickHouseHttp);
    } catch (e) {
      console.warn(`  clickhouse schema: ${(e as Error).message?.slice(0, 120) ?? e}`);
    }
  }

  // live s_i from gateway registry / bonds (seed fallback while cold)
  const stakes = new StakeCache({ gatewayUrl: GATEWAY_URL });
  setStakeCache(stakes);
  const stakeRefresh = await stakes.refresh();
  console.log(
    `  stakes   → ${stakeRefresh.ok ? `live (${stakeRefresh.agents} ids)` : `seed fallback (${stakes.lastError ?? "rpc cold"})`} @ ${GATEWAY_URL}`,
  );

  const writer = new LedgerWriter(pg, ch as import("./ledger.ts").ChInserter, stakes);
  let tasksIn = 0;
  let batchesIn = 0;
  let fraudIn = 0;
  let reconcileMiss = 0;

  const onTask = async (e: TaskEventRow) => {
    await writer.upsertTask(e);
    tasksIn++;
  };
  const onBatch = async (b: BatchRow) => {
    try {
      const { reconciled, mode, rootLocal } = await writer.writeBatch(b);
      batchesIn++;
      if (!reconciled) {
        reconcileMiss++;
        console.warn(
          `[reconcile] batch ${b.batch_id} fold mismatch (mode=${mode} local=${rootLocal?.slice(0, 18) ?? "?"} anchored=${String(b.root).slice(0, 18)}) — flagged, not patched`,
        );
      } else {
        console.log(`[batch] ${b.batch_id} root ok mode=${mode} count=${b.count}`);
      }
    } catch (e) {
      console.warn(`[batch] write failed ${b.batch_id}: ${e instanceof Error ? e.message : e}`);
    }
  };
  const onFraud = async (f: FraudCaseRow) => {
    try {
      await writer.writeFraud(f);
      fraudIn++;
      console.log(`[fraud] ${f.task_id} status=${f.status} ruling=${f.ruling ?? "-"}`);
    } catch (e) {
      console.warn(`[fraud] write failed ${f.task_id}: ${e instanceof Error ? e.message : e}`);
    }
  };

  let bus: EventBus | undefined;
  let eventSource = `ws:${NODE_EVENTS}`;
  let busMode: "nats" | "ws" | "memory" = "ws";

  if (FORCE_WS && REQUIRE_NATS) {
    throw new Error("INDEXER_FORCE_WS=1 conflicts with INDEXER_REQUIRE_NATS/NATS_REQUIRE=1");
  }

  if (!FORCE_WS && NATS_URL) {
    bus = await createEventBus({
      url: NATS_URL,
      name: "indexer",
      timeoutMs: 1500,
      requireNats: REQUIRE_NATS,
    });
    if (bus.mode === "nats") {
      eventSource = `nats:${NATS_URL}`;
      busMode = "nats";
      await bus.subscribe(["tasks", "batches", "fraud"], async (topic, data) => {
        if (topic === "tasks") {
          const t = normalizeTask(data);
          if (t) await onTask(t);
        } else if (topic === "batches") {
          const b = normalizeBatch(data);
          if (b) await onBatch(b as BatchRow);
        } else if (topic === "fraud") {
          const f = normalizeFraud(data);
          if (f) await onFraud(f);
        }
      });
    } else {
      // NATS unreachable — close memory bus; fall back to gateway WS (unless required)
      await bus.close();
      bus = undefined;
      if (REQUIRE_NATS) {
        throw new Error(`NATS required but bus.mode=${busMode} (url=${NATS_URL})`);
      }
    }
  } else if (REQUIRE_NATS) {
    throw new Error("NATS required but NATS_URL empty or INDEXER_FORCE_WS=1");
  }

  if (!bus) {
    const listener = new ChainListener(NODE_EVENTS, onTask, onBatch, onFraud);
    try {
      listener.connect();
      eventSource = `ws:${NODE_EVENTS}`;
      busMode = "ws";
    } catch (e) {
      console.warn(`  events   → connect deferred: ${(e as Error).message}`);
    }
  }

  activeBusMode = busMode;

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }
      const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (u.pathname === "/stats") {
        json(res, 200, {
          tasksIn,
          batchesIn,
          fraudIn,
          reconcileMiss,
          phase: "B6",
          bus: busMode,
        });
        return;
      }
      const { status, body } = await handle(pg, ch as ClickHouseHttp, u);
      json(res, status, body);
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : "internal" });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`ciphersentry-indexer  [B6]`);
    console.log(`  api      → http://127.0.0.1:${PORT}`);
    console.log(`  events   → ${eventSource}`);
    if (!MEMORY) console.log(`  analytics→ ${CH_URL}/${CH_DB}`);
  });
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  void boot().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

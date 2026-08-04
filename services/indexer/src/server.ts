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
import { ClickHouseHttp, applyChSchema, applyPgSchema, createPgQuerier, type Querier } from "./db.ts";
import {
  ChainListener,
  LedgerWriter,
  type BatchRow,
  type FraudCaseRow,
  type TaskEventRow,
} from "./ledger.ts";
import { normalizeTask, normalizeBatch, normalizeFraud } from "./normalize.ts";
import { merkleRoot, proofValid, verifyInclusionEitherOrder } from "./merkle.ts";
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
/** Bind address — 127.0.0.1 local; 0.0.0.0 for Docker published ports (B7 compose). */
const HOST = process.env.INDEXER_HOST ?? process.env.HOST ?? "127.0.0.1";
const MEMORY = process.env.INDEXER_MEMORY === "1";
/**
 * ClickHouse mode when not fully in-memory:
 *   http   — real CH (default when CH_URL set and INDEXER_CH_MODE unset)
 *   memory — MemoryClickHouse analytics; Postgres remains SoR (Fly durable path)
 */
const CH_MODE = (process.env.INDEXER_CH_MODE ?? "").toLowerCase() || "http";
const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
/** Set at boot — exposed on /health + /stats. */
let activeBusMode: "nats" | "ws" | "memory" | null = null;
let activeStorage: "memory" | "pg" = MEMORY ? "memory" : "pg";
let activeCh: "memory" | "http" = MEMORY ? "memory" : "http";

/* ----------------------------- trust score --------------------------------- */

export { trustScore } from "./trust.ts";

/** Whitepaper §5 — portable reputation formula (agents can recompute offline). */
export const TRUST_FORMULA =
  "T_i = clamp(0, 100, 50·log2(1 + s_i) + 40·q_i + 10·(1 − e^(−n_i/500)))";

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
    const prodOps =
      process.env.CS_ENV === "production" ||
      process.env.B7 === "1" ||
      REQUIRE_NATS;
    return {
      status: 200,
      body: {
        ok: true,
        service: "ciphersentry-indexer",
        phase: prodOps ? "B7" : "B6",
        b7: prodOps,
        reputation: "V0.3",
        events: NODE_EVENTS,
        nats: NATS_URL || null,
        bus: activeBusMode,
        memory: MEMORY,
        storage: activeStorage,
        ch: activeCh,
        durable: activeStorage === "pg",
        gateway: GATEWAY_URL,
        formula: TRUST_FORMULA,
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
    // Accept receipt_id OR task_id (batcher often sets receipt_id === task_id)
    const rows = await pg.exec(
      `SELECT * FROM receipts WHERE receipt_id = $1 OR task_id = $1 LIMIT 1`,
      [mp[1]],
    );
    if (!rows.length) return { status: 404, body: { error: "receipt_not_found" } };
    const r = rows[0] as {
      leaf: string;
      path: string[] | string;
      batch_id: string;
      receipt_id: string;
      task_id: string;
    };
    let path = typeof r.path === "string" ? (JSON.parse(r.path) as string[]) : (r.path ?? []);
    // Column list must stay MemoryStore-compatible (see memory.ts SELECT root…)
    const batch = await pg.exec(
      `SELECT root, anchored_block, anchored_tx FROM batches WHERE batch_id = $1`,
      [r.batch_id],
    );
    const root = batch[0] ? String((batch[0] as { root: string }).root) : "";
    const siblings = await pg.exec(
      `SELECT leaf FROM receipts WHERE batch_id = $1 ORDER BY settled_at`,
      [r.batch_id],
    );
    const batchLeaves = siblings.map((x) => String((x as { leaf: string }).leaf));
    let valid = root ? proofValid(r.leaf, path ?? [], root, batchLeaves) : false;
    // Recompute keccak siblings when stored path is stale / decorative
    if (!valid && batchLeaves.length && root) {
      const folded = merkleRoot(batchLeaves);
      if (folded.root.replace(/^0x/i, "").toLowerCase() === root.replace(/^0x/i, "").toLowerCase().padStart(64, "0").slice(-64) ||
          folded.root === root) {
        const idx = batchLeaves.indexOf(r.leaf);
        if (idx >= 0 && folded.paths[idx]) {
          path = folded.paths[idx]!;
          valid = verifyInclusionEitherOrder(r.leaf, path, root);
        }
      } else if (proofValid(r.leaf, path ?? [], root, batchLeaves)) {
        valid = true;
      }
    }
    return {
      status: 200,
      body: {
        data: {
          leaf: r.leaf,
          path,
          receipt_id: r.receipt_id,
          task_id: r.task_id,
          batch_id: r.batch_id,
          anchor: batch[0] ?? null,
          valid,
          reconciled: valid,
        },
      },
    };
  }

  // Batch-level proof summary: all receipts + root validity
  const mbp = p.match(/^\/batches\/([^/]+)\/proofs$/);
  if (mbp) {
    const batchId = mbp[1]!;
    const batch = await pg.exec(
      `SELECT batch_id, root, count, state, anchored_block, anchored_tx FROM batches WHERE batch_id = $1`,
      [batchId],
    );
    if (!batch.length) return { status: 404, body: { error: "batch_not_found" } };
    const b = batch[0] as {
      batch_id: string;
      root: string;
      count: number;
      state: string;
      anchored_block?: number | null;
      anchored_tx?: string | null;
    };
    const receipts = await pg.exec<{
      receipt_id: string;
      task_id: string;
      leaf: string;
      path: string[] | string;
    }>(
      `SELECT receipt_id, task_id, leaf, path FROM receipts WHERE batch_id = $1 ORDER BY settled_at`,
      [batchId],
    );
    const root = String(b.root);
    const batchLeaves = receipts.map((r) => String(r.leaf));
    const proofs = receipts.map((r) => {
      const path = typeof r.path === "string" ? (JSON.parse(r.path) as string[]) : r.path ?? [];
      const valid = root ? proofValid(r.leaf, path, root, batchLeaves) : false;
      return {
        receipt_id: r.receipt_id,
        task_id: r.task_id,
        leaf: r.leaf,
        path,
        valid,
      };
    });
    const validCount = proofs.filter((x) => x.valid).length;
    return {
      status: 200,
      body: {
        data: {
          batch_id: b.batch_id,
          root,
          count: Number(b.count),
          state: b.state,
          anchored_block: b.anchored_block ?? null,
          anchored_tx: b.anchored_tx ?? null,
          proofs,
          valid_count: validCount,
          all_valid: proofs.length > 0 && validCount === proofs.length,
        },
      },
    };
  }

  /** V0.3 — ranked portable reputation (whitepaper §5 T_i). */
  if (p === "/agents") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const minTrust = Number(url.searchParams.get("minTrust") ?? 0) || 0;
    const rows = await pg.exec(
      `SELECT agent_id, tier, trust, stake, success, status, updated_at
       FROM agents WHERE trust >= $1 ORDER BY trust DESC, stake DESC LIMIT $2`,
      [minTrust, limit],
    );
    return {
      status: 200,
      body: {
        data: rows,
        formula: TRUST_FORMULA,
        phase: "V0.3",
      },
    };
  }

  const ma = p.match(/^\/agents\/([^/]+)$/);
  if (ma && !p.endsWith("/receipts")) {
    const rows = await pg.exec(`SELECT * FROM agents WHERE agent_id = $1`, [ma[1]]);
    if (!rows.length) return { status: 404, body: { error: "agent_not_found" } };
    const a = rows[0] as Record<string, unknown>;
    return {
      status: 200,
      body: {
        data: {
          ...a,
          formula: TRUST_FORMULA,
          // portable score fields for agents/SDK
          score: Number(a.trust),
          T_i: Number(a.trust),
          s_i: Number(a.stake),
          q_i: Number(a.success),
        },
      },
    };
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

  /** V0.3 — public trust graph (nodes = agents, edges = settled commerce). */
  if (p === "/graph") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40));
    const [nodes, edges] = await Promise.all([
      pg.exec(
        `SELECT agent_id, tier, trust, stake, success, status
         FROM agents ORDER BY trust DESC, stake DESC LIMIT $1`,
        [limit],
      ),
      pg.exec(
        `SELECT buyer AS source, worker AS target, COUNT(*)::int AS weight,
                COALESCE(SUM(amount), 0) AS volume
         FROM tasks
         WHERE state = 'SETTLED'
           AND buyer IS NOT NULL AND worker IS NOT NULL
           AND buyer <> worker
         GROUP BY buyer, worker
         ORDER BY weight DESC
         LIMIT $1`,
        [Math.min(200, limit * 4)],
      ),
    ]);
    return {
      status: 200,
      body: {
        data: { nodes, edges },
        formula: TRUST_FORMULA,
        phase: "V0.3",
      },
    };
  }

  const mt = p.match(/^\/trust\/([^/]+)$/);
  if (mt) {
    // Strict agent id — no raw SQL injection into CH
    const agent = decodeURIComponent(mt[1]!).slice(0, 128);
    if (!/^[\w.:@\-]+$/.test(agent)) {
      return { status: 400, body: { error: "invalid agent_id" } };
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? 64);
    const limit = Math.min(256, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 64));
    const since = Number(url.searchParams.get("since_epoch") ?? 0);
    // Prefer durable Postgres series (survives CH-memory restarts on Fly)
    try {
      const pgRows = await pg.exec<{
        agent_id: string;
        epoch: number | string;
        trust_score: number | string;
        stake?: number | string;
        success?: number | string;
        settled_count?: number | string;
      }>(
        `SELECT agent_id, epoch, trust_score, stake, success, settled_count
         FROM trust_series WHERE agent_id = $1 AND epoch >= $2
         ORDER BY epoch DESC LIMIT $3`,
        [agent, Number.isFinite(since) ? since : 0, limit],
      );
      if (pgRows.length) {
        return {
          status: 200,
          body: {
            data: pgRows.map((r) => ({
              agent_id: r.agent_id,
              epoch: Number(r.epoch),
              trust_score: Number(r.trust_score),
              stake: r.stake != null ? Number(r.stake) : undefined,
              success: r.success != null ? Number(r.success) : undefined,
              settled_count: r.settled_count != null ? Number(r.settled_count) : undefined,
            })),
            formula: TRUST_FORMULA,
          },
        };
      }
    } catch {
      /* fall through to CH */
    }
    try {
      // agent already regex-validated; still escape single quotes
      const safe = agent.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const rows = await ch.exec<{
        agent_id: string;
        epoch: number;
        trust_score: number;
        stake?: number;
        success?: number;
      }>(
        `SELECT agent_id, epoch, trust_score, stake, success FROM trust_series
         WHERE agent_id = '${safe}' AND epoch >= ${Number.isFinite(since) ? since : 0}
         ORDER BY epoch DESC LIMIT ${limit} FORMAT JSON`,
      );
      return { status: 200, body: { data: rows, formula: TRUST_FORMULA } };
    } catch {
      return { status: 200, body: { data: [], formula: TRUST_FORMULA } };
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

  // Pre-batch task lookup (search hits before receipts land)
  const mtId = p.match(/^\/tasks\/([^/]+)$/);
  if (mtId) {
    const rows = await pg.exec(
      `SELECT task_id, buyer, worker, spec, amount, state, reported_hash, state_at_block, state_at_ts
       FROM tasks WHERE task_id = $1 LIMIT 1`,
      [mtId[1]],
    );
    if (!rows.length) return { status: 404, body: { error: "task_not_found" } };
    return { status: 200, body: { data: rows[0] } };
  }

  if (p === "/search") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return { status: 400, body: { error: "missing q" } };
    const like = `%${q}%`;
    const [receipts, batches, agents, fraud, tasks] = await Promise.all([
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
      // Task IDs live here on commit — do not wait for batch receipts
      pg.exec(
        `SELECT task_id, state, worker, buyer, amount FROM tasks WHERE task_id ILIKE $1 LIMIT 10`,
        [like],
      ).catch(() => [] as unknown[]),
    ]);
    return { status: 200, body: { data: { receipts, batches, agents, fraud, tasks } } };
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
    activeStorage = "memory";
    activeCh = "memory";
    console.log("  storage  → MEMORY (INDEXER_MEMORY=1)");
  } else {
    pg = await createPgQuerier(PG_DSN);
    await applyPgSchema(pg);
    activeStorage = "pg";
    const wantMemCh = CH_MODE === "memory" || CH_MODE === "mem" || process.env.INDEXER_CH_MEMORY === "1";
    if (wantMemCh) {
      const { MemoryClickHouse } = await import("./memory.ts");
      ch = new MemoryClickHouse();
      activeCh = "memory";
      console.log("  storage  → PG + CH-memory (durable SoR, analytics ephemeral)");
    } else {
      ch = new ClickHouseHttp(CH_URL, CH_DB, process.env.CH_USER ?? "cent", process.env.CH_PASSWORD ?? "cent");
      try {
        await applyChSchema(ch as ClickHouseHttp);
        activeCh = "http";
        console.log(`  storage  → PG + CH-http (${CH_URL}/${CH_DB})`);
      } catch (e) {
        // Fly durable path without CH sidecar — fall back rather than fail boot
        console.warn(`  clickhouse unavailable — CH-memory fallback: ${(e as Error).message?.slice(0, 120) ?? e}`);
        const { MemoryClickHouse } = await import("./memory.ts");
        ch = new MemoryClickHouse();
        activeCh = "memory";
        console.log("  storage  → PG + CH-memory (CH schema failed)");
      }
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
          reputation: "V0.3",
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

  server.listen(PORT, HOST, () => {
    console.log(`ciphersentry-indexer  [B6 · V0.3 reputation]`);
    console.log(`  api      → http://${HOST}:${PORT}`);
    console.log(`  events   → ${eventSource}`);
    console.log(`  storage  → ${activeStorage} ch=${activeCh} durable=${activeStorage === "pg"}`);
    console.log(`  trust    → /agents · /graph · /trust/:agent`);
    if (!MEMORY && activeCh === "http") console.log(`  analytics→ ${CH_URL}/${CH_DB}`);
  });
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  void boot().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

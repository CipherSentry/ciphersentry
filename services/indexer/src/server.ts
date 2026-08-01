/**
 * Indexer service main — listener + public read API.
 *
 *   chain events ──▶ Postgres (state, events are the record)
 *                └─▶ ClickHouse (receipt graph + trust series)
 *   http           ──▶ /batches /receipts /agents /search /proofs /trust
 *
 * Trust score per the whitepaper §5:
 *   T_i = clamp(0, 100, 50·log2(1 + s_i) + 40·q_i + 10·(1 − e^(−n_i/500)))
 */

import { createServer } from "node:http";
import { ClickHouseHttp, applyChSchema, createPgQuerier, type Querier } from "./db";
import { ChainListener, LedgerWriter, type BatchRow, type TaskEventRow } from "./ledger";

/* ------------------------------- config ------------------------------------ */

// 127.0.0.1 not localhost — Node resolves localhost to ::1 (IPv6) on many
// setups while compose binds IPv4; that's the #1 first-run connection error.
const PG_DSN = process.env.PG_DSN ?? "postgres://cent:cent@127.0.0.1:5432/ciphersentry";
const CH_URL = process.env.CH_URL ?? "http://127.0.0.1:8123";
const CH_DB = process.env.CH_DB ?? "ciphersentry";
const NODE_EVENTS = process.env.NODE_EVENTS ?? "wss://node.base-sepolia.ciphersentry.com/events";
const PORT = Number(process.env.PORT ?? 8081);

/* ----------------------------- trust score --------------------------------- */

export function trustScore(stake: number, success: number, settledCount: number): number {
  const t = 50 * Math.log2(1 + stake) + 40 * success + 10 * (1 - Math.exp(-settledCount / 500));
  return Math.min(100, Math.max(0, t));
}

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

  if (p === "/health") return { status: 200, body: { ok: true, service: "ciphersentry-indexer" } };

  if (p === "/batches") {
    const rows = await pg.exec(
      `SELECT batch_id, epoch, root, count, total, state, at FROM batches ORDER BY at DESC LIMIT 50`,
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
    const r = rows[0] as { leaf: string; path: string[]; batch_id: string };
    const batch = await pg.exec(`SELECT root, anchored_block, anchored_tx FROM batches WHERE batch_id = $1`, [r.batch_id]);
    return { status: 200, body: { data: { leaf: r.leaf, path: r.path, anchor: batch[0] ?? null } } };
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
    const rows = await ch.exec<{ agent_id: string; epoch: number; trust_score: number }>(
      `SELECT agent_id, epoch, trust_score FROM trust_series WHERE agent_id = '${mt[1].replace(/'/g, "")}' ORDER BY epoch DESC LIMIT 32 FORMAT JSON`,
    );
    return { status: 200, body: { data: rows } };
  }

  if (p === "/search") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return { status: 400, body: { error: "missing q" } };
    const like = `%${q}%`;
    const [receipts, batches, agents] = await Promise.all([
      pg.exec(`SELECT receipt_id, batch_id FROM receipts WHERE receipt_id ILIKE $1 OR task_id ILIKE $1 OR leaf ILIKE $1 LIMIT 10`, [like]),
      pg.exec(`SELECT batch_id, epoch FROM batches WHERE batch_id ILIKE $1 OR root ILIKE $1 LIMIT 5`, [like]),
      pg.exec(`SELECT agent_id, tier, trust FROM agents WHERE agent_id ILIKE $1 LIMIT 5`, [like]),
    ]);
    return { status: 200, body: { data: { receipts, batches, agents } } };
  }

  return { status: 404, body: { error: "not_found" } };
}

/* -------------------------------- boot ------------------------------------- */

export async function boot(): Promise<void> {
  const pg = await createPgQuerier(PG_DSN);
  const ch = new ClickHouseHttp(CH_URL, CH_DB, process.env.CH_USER ?? "default", process.env.CH_PASSWORD ?? "");
  await applyChSchema(ch); // idempotent

  const writer = new LedgerWriter(pg, ch);

  const onTask = async (e: TaskEventRow) => writer.upsertTask(e);
  const onBatch = async (b: BatchRow) => {
    const { reconciled } = await writer.writeBatch(b);
    if (!reconciled) {
      console.warn(`[reconcile] batch ${b.batch_id} fold mismatch — flagged, not patched`);
    }
  };

  const listener = new ChainListener(NODE_EVENTS, onTask, onBatch);
  listener.connect();

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const { status, body } = await handle(pg, ch, u);
      json(res, status, body);
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : "internal" });
    }
  });

  server.listen(PORT, () => {
    console.log(`ciphersentry-indexer`);
    console.log(`  api      → http://localhost:${PORT}`);
    console.log(`  events   → ${NODE_EVENTS.replace(/\/events$/, "")}`);
    console.log(`  analytics→ ${CH_URL}/${CH_DB}`);
  });
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  void boot();
}

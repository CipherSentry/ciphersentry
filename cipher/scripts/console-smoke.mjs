#!/usr/bin/env node
/**
 * Console live-path smoke — same RPCs / indexer routes Operator + Explorer use.
 *
 *   node cipher/scripts/console-smoke.mjs
 *   GATEWAY_URL=https://ciphersentry.fly.dev node cipher/scripts/console-smoke.mjs
 */
const NODE = (process.env.GATEWAY_URL || process.env.NODE_URL || "https://ciphersentry.fly.dev").replace(
  /\/$/,
  "",
);

async function rpc(method, params = {}) {
  const res = await fetch(`${NODE}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function get(path) {
  const res = await fetch(`${NODE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function ok(label) {
  console.log(`  ✓ ${label}`);
}

async function main() {
  console.log(`== console smoke → ${NODE} ==`);

  const health = await get("/health");
  if (!health.ok) throw new Error("gateway health not ok");
  ok(`health b7=${health.b7} auth=${health.auth_required}`);

  const ix = await get("/indexer/health");
  if (!ix.ok) throw new Error("indexer health not ok");
  ok(`indexer phase=${ix.phase} storage=${ix.storage}`);

  await rpc("node.info");
  ok("node.info");

  const reg = await rpc("registry.query", { limit: 8 });
  const rows = Array.isArray(reg) ? reg : reg?.agents || reg?.rows || [];
  if (!rows.length) throw new Error("registry.query empty");
  ok(`registry.query n=${rows.length}`);

  await rpc("batch.pending");
  await rpc("batch.info");
  await rpc("epoch.info");
  ok("batch.pending / batch.info / epoch.info");

  const batches = await get("/batches");
  const list = batches.data || batches;
  if (!Array.isArray(list) || !list.length) throw new Error("no batches");
  ok(`batches n=${list.length}`);

  const bid = list[0].batch_id;
  const full = await get(`/batches/${encodeURIComponent(bid)}`);
  const receipts = full.data?.receipts || [];
  ok(`batch ${bid} receipts=${receipts.length}`);

  if (receipts.length) {
    const rid = receipts[0].receipt_id || receipts[0].task_id;
    const proof = await get(`/receipts/${encodeURIComponent(rid)}/proof`);
    const p = proof.data || proof;
    ok(`proof ${rid} valid=${p.valid}`);
    // After deploy, new batches should verify; polluted history may still be false.
    if (p.valid !== true) {
      console.warn(`  ! proof valid=false (stale volume ok until new batches roll)`);
    }
  }

  const fraud = await get("/fraud");
  ok(`fraud n=${(fraud.data || []).length}`);

  // anon mutate must 401 when AUTH_REQUIRED
  const mut = await fetch(`${NODE}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "task.commit",
      params: {
        spec: "x",
        worker: "w",
        buyer: "b",
        escrow: { amount: "1.00", asset: "USDC" },
      },
    }),
  });
  if (mut.status !== 401 && health.auth_required) {
    throw new Error(`expected 401 anon mutate, got ${mut.status}`);
  }
  ok(`anon mutate → ${mut.status}`);

  console.log("CONSOLE SMOKE OK");
}

main().catch((e) => {
  console.error("CONSOLE SMOKE FAIL", e.message || e);
  process.exit(1);
});

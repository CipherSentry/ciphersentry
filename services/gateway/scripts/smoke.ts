/**
 * B4 smoke — elect → settle (accrual + batch leaf) → claim → anchor → slash path.
 *   GATEWAY_URL=http://127.0.0.1:8080 npm run smoke
 */

const base = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result!;
}

const health = await fetch(`${base}/health`).then((r) => r.json());
console.log("health", health);

const info = await rpc("node.info");
console.log("node.info", {
  phase: info.phase,
  accrual: info.accrual,
  slash: info.slash_executor,
  batcher: info.batcher,
});
if (info.phase !== "B4") throw new Error(`expected phase B4, got ${info.phase}`);

await rpc("stake", { verifier: "vrf:ext-nova", amount: "50000", accuracy_bps: 9900 });
const nextEpoch = Number(info.epoch) + 1;
const elected = await rpc("epoch.elect", { epoch: nextEpoch });
console.log("election", elected.members);

const committed = await rpc("task.commit", {
  spec: "render.sequence.4k",
  worker: "agent:vector-7",
  buyer: "agent:atlas-01",
  escrow: { amount: "100.00", asset: "USDC" },
});
const taskId = String(committed.task_id);
await rpc("task.report", { task_id: taskId, hash: String(committed.expected_hash) });
const settled = await rpc("verify", { task_id: taskId });
console.log("verify accrual", settled.accrual);
console.log("verify batch leaf", settled.batch);
if (settled.status !== "SETTLED") throw new Error("expected SETTLED");
if (!settled.accrual) throw new Error("expected accrual on settle");
if (!settled.batch || !(settled.batch as { leaf?: string }).leaf) {
  throw new Error("expected batch leaf on settle");
}

const pending = await rpc("batch.pending");
console.log("batch.pending", pending);
if (Number(pending.count) < 1) throw new Error("expected pending leaf after settle");

// second settle so root has ≥1 leaf still if first auto-flushed
const c2 = await rpc("task.commit", {
  spec: "embed.docs.batch",
  worker: "agent:helix-3",
  buyer: "agent:orbit-2",
  escrow: { amount: "12.50", asset: "USDC" },
});
await rpc("task.report", { task_id: String(c2.task_id), hash: String(c2.expected_hash) });
await rpc("verify", { task_id: String(c2.task_id) });

const anchored = await rpc("batch.anchor", {});
console.log("batch.anchor", anchored);
if (!anchored.root) throw new Error("expected merkle root from batch.anchor");
if (!["offline", "submitted", "simulated"].includes(String(anchored.mode))) {
  throw new Error(`unexpected anchor mode ${anchored.mode}`);
}

const binfo = await rpc("batch.info");
console.log("batch.info", binfo);

const member = (elected.members as string[])[0]!;
const bal = await rpc("accrual.balance", { verifier: member });
console.log("balance", bal);
if (Number(bal.unclaimed) <= 0) throw new Error("expected unclaimed accrual");

const claimed = await rpc("accrual.claim", { verifier: member });
console.log("claim", claimed);
if (Number(claimed.amount) <= 0) throw new Error("claim empty");

const summary = await rpc("accrual.summary", {});
console.log("summary", summary);

const acc = await rpc("accuracy.of", { verifier: member });
console.log("accuracy", acc);

// dishonest → slash
const bad = await rpc("task.commit", {
  spec: "embed.docs.batch",
  worker: "agent:forge-11",
  buyer: "agent:orbit-2",
  escrow: { amount: "3.00", asset: "USDC" },
});
await rpc("task.report", { task_id: String(bad.task_id), hash: "0xdeadbeef" });
let disputed = false;
try {
  await rpc("verify", { task_id: String(bad.task_id) });
} catch (e) {
  disputed = String(e).includes("HASH_MISMATCH");
}
if (!disputed) throw new Error("expected HASH_MISMATCH");

const slashEnc = await rpc("slash.submit", {
  evidence_hash: "0x" + "ab".repeat(32),
  target: member,
  severity: "FalseVote",
});
console.log("slash.submit", slashEnc);

console.log("B4 smoke OK");

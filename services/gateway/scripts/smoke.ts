/**
 * B0 smoke — commit → report → verify against a running gateway.
 *   GATEWAY_URL=http://127.0.0.1:8080 npm run smoke
 */

const base = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { code: string; message: string } };
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result!;
}

const health = await fetch(`${base}/health`).then((r) => r.json());
console.log("health", health);

const agents = await rpc("registry.query", { filter: { limit: 2 } });
console.log("registry", agents);

const committed = await rpc("task.commit", {
  spec: "render.sequence.4k",
  worker: "agent:vector-7",
  buyer: "agent:atlas-01",
  escrow: { amount: "12.50", asset: "USDC" },
});
console.log("commit", committed);

const taskId = String(committed.task_id);
await rpc("task.report", { task_id: taskId, hash: "0xsmoke" });
const settled = await rpc("verify", { task_id: taskId, quorum: 3 });
console.log("verify", settled);
console.log("B0 smoke OK");

/**
 * AUTH_REQUIRED=1 path — SDK-style session client smoke e2e.
 *
 *   AUTH_REQUIRED=1 npm run gateway &
 *   GATEWAY_URL=http://127.0.0.1:8080 npm run smoke:auth -w gateway
 */

import { generateKeyPairSync, sign } from "node:crypto";

const base = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const pubkey = spki.subarray(-32).toString("hex");
  return { privateKey, pubkey };
}

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
): Promise<{ result?: Record<string, unknown>; error?: { code: string; message: string }; status: number }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
  return { ...body, status: res.status };
}

const health = (await fetch(`${base}/health`).then((r) => r.json())) as {
  auth_required?: boolean;
  event_pubkey?: string;
};
console.log("health", { auth_required: health.auth_required, event_pubkey: health.event_pubkey?.slice(0, 16) });

if (!health.auth_required) {
  console.warn("WARN: AUTH_REQUIRED≠1 — still exercising session path");
}

const { privateKey, pubkey } = keypair();
const agentId = "agent:atlas-01";

// 1) mutating without session must fail when AUTH_REQUIRED
const bare = await rpc("task.commit", {
  spec: "render.sequence.4k",
  worker: "agent:vector-7",
  buyer: agentId,
  escrow: { amount: "1.00", asset: "USDC" },
});
if (health.auth_required) {
  if (!bare.error || bare.status !== 401) {
    throw new Error(`expected 401 auth required, got status=${bare.status} err=${JSON.stringify(bare.error)}`);
  }
  console.log("anon mutate → 401 OK");
} else {
  console.log("anon mutate → allowed (auth optional)");
}

// 2) challenge → sign → session
const ch = await rpc("auth.challenge", { pubkey });
if (ch.error || !ch.result) throw new Error(`challenge failed: ${JSON.stringify(ch.error)}`);
const message = String(ch.result.message);
const signature = sign(null, Buffer.from(message, "utf8"), privateKey).toString("hex");

const sess = await rpc("auth.session", {
  challenge_id: String(ch.result.challenge_id),
  pubkey,
  signature,
  agent_id: agentId,
});
if (sess.error || !sess.result) throw new Error(`session failed: ${JSON.stringify(sess.error)}`);
const token = String(sess.result.token);
console.log("session", {
  agent_id: sess.result.agent_id,
  stake: sess.result.stake,
  rpm: sess.result.rpm,
});

// 3) whoami
const me = await rpc("auth.whoami", {}, token);
if (me.error || me.result?.agent_id !== agentId) {
  throw new Error(`whoami failed: ${JSON.stringify(me)}`);
}
console.log("whoami OK");

// 4) mutate with Bearer
const committed = await rpc(
  "task.commit",
  {
    spec: "render.sequence.4k",
    worker: "agent:vector-7",
    buyer: agentId,
    escrow: { amount: "1.00", asset: "USDC" },
  },
  token,
);
if (committed.error || !committed.result?.task_id) {
  throw new Error(`authed commit failed: ${JSON.stringify(committed.error)}`);
}
console.log("authed commit", committed.result.task_id);

// 5) public method still works without token
const info = await rpc("node.info");
if (info.error) throw new Error(`node.info public failed: ${JSON.stringify(info.error)}`);
console.log("public node.info OK");

console.log("AUTH smoke OK");

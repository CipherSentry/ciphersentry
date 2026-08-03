/**
 * AUTH_REQUIRED abuse path — session client + denial cases.
 *
 *   AUTH_REQUIRED=1 ANON_RPM=5 npm run gateway &
 *   GATEWAY_URL=http://127.0.0.1:8080 npm run smoke:auth -w gateway
 *
 * Set AUTH_STRICT=1 to fail when health.auth_required is false.
 */

import { generateKeyPairSync, sign } from "node:crypto";

const base = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const STRICT = process.env.AUTH_STRICT === "1" || process.env.AUTH_STRICT === "true";

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
): Promise<{
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  status: number;
}> {
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

function fail(msg: string): never {
  throw new Error(msg);
}

const health = (await fetch(`${base}/health`).then((r) => r.json())) as {
  auth_required?: boolean;
  event_pubkey?: string;
  ok?: boolean;
};
if (!health.ok) fail(`health not ok: ${JSON.stringify(health)}`);
console.log("health", {
  auth_required: health.auth_required,
  event_pubkey: health.event_pubkey?.slice(0, 16),
});

if (STRICT && !health.auth_required) {
  fail("AUTH_STRICT=1 but health.auth_required=false — start gateway with AUTH_REQUIRED=1");
}
if (!health.auth_required) {
  console.warn("WARN: AUTH_REQUIRED≠1 — session path only (no 401/429 abuse asserts)");
}

const { privateKey, pubkey } = keypair();
const agentId = "agent:atlas-01";
const commitParams = {
  spec: "render.sequence.4k",
  worker: "agent:vector-7",
  buyer: agentId,
  escrow: { amount: "1.00", asset: "USDC" },
};

// 1) anon mutating → 401 when required
const bare = await rpc("task.commit", commitParams);
if (health.auth_required) {
  if (!bare.error || bare.status !== 401) {
    fail(`expected 401 auth required, got status=${bare.status} err=${JSON.stringify(bare.error)}`);
  }
  console.log("anon mutate → 401 OK");
} else {
  console.log("anon mutate → allowed (auth optional)");
}

// 2) garbage bearer → anon (401) — before burning the IP window
const junk = await rpc("task.commit", commitParams, "not-a-real-token");
if (health.auth_required) {
  if (!junk.error || junk.status !== 401) {
    fail(`expected 401 for bad token, got status=${junk.status} err=${JSON.stringify(junk.error)}`);
  }
  console.log("bad bearer → 401 OK");
}

// 3) challenge → bad signature rejected
const chBad = await rpc("auth.challenge", { pubkey });
if (chBad.error || !chBad.result) fail(`challenge failed: ${JSON.stringify(chBad.error)}`);
const badSess = await rpc("auth.session", {
  challenge_id: String(chBad.result.challenge_id),
  pubkey,
  signature: "00".repeat(64),
  agent_id: agentId,
});
if (!badSess.error) fail("expected invalid signature rejection");
console.log("bad signature → reject OK");

// 4) challenge → sign → session
const ch = await rpc("auth.challenge", { pubkey });
if (ch.error || !ch.result) fail(`challenge failed: ${JSON.stringify(ch.error)}`);
const message = String(ch.result.message);
const signature = sign(null, Buffer.from(message, "utf8"), privateKey).toString("hex");

const sess = await rpc("auth.session", {
  challenge_id: String(ch.result.challenge_id),
  pubkey,
  signature,
  agent_id: agentId,
});
if (sess.error || !sess.result) fail(`session failed: ${JSON.stringify(sess.error)}`);
const token = String(sess.result.token);
console.log("session", {
  agent_id: sess.result.agent_id,
  stake: sess.result.stake,
  rpm: sess.result.rpm,
});

// 5) whoami
const me = await rpc("auth.whoami", {}, token);
if (me.error || me.result?.agent_id !== agentId) fail(`whoami failed: ${JSON.stringify(me)}`);
console.log("whoami OK");

// 6) authed mutate (session RPM, not anon window)
const committed = await rpc("task.commit", commitParams, token);
if (committed.error || !committed.result?.task_id) {
  fail(`authed commit failed: ${JSON.stringify(committed.error)}`);
}
console.log("authed commit", committed.result.task_id);

// 7) public method without token
const info = await rpc("node.info");
if (info.error && info.status !== 429) {
  fail(`node.info public failed: ${JSON.stringify(info.error)}`);
}
if (!info.error) console.log("public node.info OK");
else console.log("public node.info rate-limited (window warm) OK");

// 8) burn remaining anon window → 429
if (health.auth_required) {
  const anonRpm = Number(process.env.ANON_RPM ?? 20);
  let hit429 = false;
  for (let i = 0; i < anonRpm + 12; i++) {
    const r = await rpc("node.info");
    if (r.status === 429 || (r.error?.code === "CEN_E_CAP_BREACH" && /rate limit/i.test(r.error.message))) {
      hit429 = true;
      break;
    }
  }
  if (!hit429 && anonRpm <= 10) {
    fail(`expected 429 after anon burn (ANON_RPM=${anonRpm})`);
  }
  console.log(hit429 ? "anon rate limit → 429 OK" : `anon rate limit skip (ANON_RPM=${anonRpm} too high)`);
}

console.log("AUTH abuse e2e OK");

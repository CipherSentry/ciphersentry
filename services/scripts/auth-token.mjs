/**
 * Print a Bearer session token for AUTH_REQUIRED gateway.
 * Usage: GATEWAY_URL=http://127.0.0.1:8080 node scripts/auth-token.mjs
 */
import { generateKeyPairSync, sign } from "node:crypto";

const base = (process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const agentId = process.env.AGENT_ID ?? "agent:atlas-01";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
const pubkey = spki.subarray(-32).toString("hex");

async function rpc(method, params) {
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

const ch = await rpc("auth.challenge", { pubkey });
if (ch.error || !ch.result?.message) {
  console.error("challenge failed", ch);
  process.exit(1);
}
const signature = sign(null, Buffer.from(String(ch.result.message), "utf8"), privateKey).toString("hex");
const sess = await rpc("auth.session", {
  challenge_id: ch.result.challenge_id,
  pubkey,
  signature,
  agent_id: agentId,
});
if (sess.error || !sess.result?.token) {
  console.error("session failed", sess);
  process.exit(1);
}
process.stdout.write(String(sess.result.token));

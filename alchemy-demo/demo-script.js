/**
 * Minimal Alchemy JSON-RPC demo — eth_accounts
 *
 *   ALCHEMY_RPC=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY node demo-script.js
 *
 * Note: eth_accounts returns [] on public Alchemy HTTPS endpoints
 * (no unlocked local keys). Use eth_blockNumber / eth_getBalance for smoke.
 */

const RPC =
  process.env.ALCHEMY_RPC ||
  process.env.CHAIN_RPC ||
  "https://base-sepolia.publicnode.com";

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function main() {
  console.log("rpc:", RPC.replace(/\/v2\/.*/, "/v2/…"));

  const accounts = await rpc("eth_accounts");
  console.log(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_accounts", result: accounts }, null, 2));

  // prove the endpoint is live even when accounts is []
  const block = await rpc("eth_blockNumber");
  console.log("eth_blockNumber:", parseInt(block, 16), `(${block})`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

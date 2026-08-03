#!/usr/bin/env node
/** Tiny JSON-RPC client: rpc-call.mjs <url> <method> [paramsJson] */
const [url, method, paramsJson = "{}"] = process.argv.slice(2);
if (!url || !method) {
  console.error("usage: rpc-call.mjs <url> <method> [paramsJson]");
  process.exit(2);
}
const params = JSON.parse(paramsJson);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});
const body = await res.json();
if (body.error) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(body.result));

/**
 * B4 unit tests — pure merkle + EIP-712 digest + dry-run anchor.
 * Run: cd services && node --experimental-transform-types --test gateway/test/batcher.test.ts
 *   or: npm test -w gateway (if wired)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  leafHash,
  merkleRoot,
  domainSeparator,
  batchDigest,
  BATCH_TYPEHASH,
  SettlementBatcherGateway,
  normalizeHex32,
} from "../src/batcher.ts";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAddress, type Hex } from "viem";

describe("leafHash", () => {
  it("is deterministic and 32 bytes", () => {
    const a = leafHash("cent_abc", "0xdead");
    const b = leafHash("cent_abc", "0xdead");
    assert.equal(a, b);
    assert.match(a, /^0x[0-9a-f]{64}$/);
  });

  it("changes with either input", () => {
    assert.notEqual(leafHash("a", "1"), leafHash("b", "1"));
    assert.notEqual(leafHash("a", "1"), leafHash("a", "2"));
  });
});

describe("merkleRoot", () => {
  it("single leaf is the root", () => {
    const leaf = leafHash("t1", "h1");
    const { root, paths } = merkleRoot([leaf]);
    assert.equal(root, leaf);
    assert.equal(paths[0]!.length, 0);
  });

  it("two leaves hash as a pair", () => {
    const l0 = leafHash("t0", "h0");
    const l1 = leafHash("t1", "h1");
    const { root, paths } = merkleRoot([l0, l1]);
    assert.match(root, /^0x[0-9a-f]{64}$/);
    assert.notEqual(root, l0);
    assert.equal(paths[0]!.length, 1);
    assert.equal(paths[1]!.length, 1);
  });

  it("empty yields zero root", () => {
    const { root } = merkleRoot([]);
    assert.equal(root, normalizeHex32("0x0"));
  });
});

describe("EIP-712 batch digest", () => {
  it("domain + digest are stable for fixed inputs", () => {
    const domain = domainSeparator(31337, "0x66855FBa76034B04053E6C419c0af1FE55867669");
    const root = leafHash("x", "y");
    const d1 = batchDigest(domain, 0n, root, 3, false);
    const d2 = batchDigest(domain, 0n, root, 3, false);
    assert.equal(d1, d2);
    assert.match(d1, /^0x[0-9a-f]{64}$/);
    assert.match(BATCH_TYPEHASH, /^0x[0-9a-f]{64}$/);
  });

  it("emergency flag flips digest", () => {
    const domain = domainSeparator(31337, "0x00000000000000000000000000000000000000aa");
    const root = leafHash("x", "y");
    const a = batchDigest(domain, 1n, root, 1, false);
    const b = batchDigest(domain, 1n, root, 1, true);
    assert.notEqual(a, b);
  });

  it("viem raw sign recovers to signer address", async () => {
    const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const account = privateKeyToAccount(pk);
    const domain = domainSeparator(31337, "0x00000000000000000000000000000000000000bb");
    const digest = batchDigest(domain, 0n, leafHash("t", "h"), 1, false);
    const sig = await account.sign({ hash: digest });
    const recovered = await recoverAddress({ hash: digest, signature: sig as Hex });
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  });
});

describe("SettlementBatcherGateway offline", () => {
  it("enqueues and anchors offline with root", async () => {
    const g = SettlementBatcherGateway.fromKeys(null, [], { intervalMs: 0, chainId: 31337 });
    assert.equal(g.mode, "offline");
    g.enqueue({ taskId: "cent_1", recomputed: "0xaaa", amount: "1.00", worker: "agent:x" });
    g.enqueue({ taskId: "cent_2", recomputed: "0xbbb", amount: "2.00", worker: "agent:y" });
    assert.equal(g.pendingCount, 2);

    const res = await g.anchor();
    assert.equal(res.mode, "offline");
    assert.ok(res.root);
    assert.equal(res.count, 2);
    assert.equal(g.pendingCount, 0);
    assert.equal(g.anchored.length, 1);
  });

  it("simulated when address set but insufficient keys", async () => {
    const g = SettlementBatcherGateway.fromKeys(
      "0x66855FBa76034B04053E6C419c0af1FE55867669",
      ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"],
      { intervalMs: 0, chainId: 31337, rpcUrl: "http://127.0.0.1:1" },
    );
    assert.equal(g.mode, "watch-only");
    g.enqueue({ taskId: "cent_z", recomputed: "0xccc" });
    const res = await g.anchor();
    assert.equal(res.mode, "simulated");
    assert.ok(res.root);
    assert.match(String(res.error), /need 2/);
  });

  it("info reports B4 phase", () => {
    const g = SettlementBatcherGateway.fromKeys(null, [], { intervalMs: 0 });
    const info = g.info();
    assert.equal(info.phase, "B4");
    assert.equal(info.mode, "offline");
  });
});

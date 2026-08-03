import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AccessRequestStore, opsTokenOk } from "../src/access-requests.ts";
import { MemoryKv } from "../src/kv.ts";

describe("AccessRequestStore", () => {
  it("rejects short handle and bad email for access", async () => {
    const store = new AccessRequestStore(new MemoryKv());
    const a = await store.submit({ handle: "x", email: "ops@x.com" });
    assert.ok("error" in a);
    const b = await store.submit({ handle: "atlas", email: "not-an-email" });
    assert.ok("error" in b);
  });

  it("accepts access request and assigns queue", async () => {
    const store = new AccessRequestStore(new MemoryKv());
    const r1 = await store.submit({
      handle: "atlas-labs",
      email: "ops@atlas.xyz",
      role: "DEVELOPER",
      rail: "BASE MAINNET",
      use_case: "agent settlement",
    });
    assert.ok(!("error" in r1));
    assert.equal(r1.queue, 1);
    assert.equal(r1.kind, "access");
    assert.equal(r1.email, "ops@atlas.xyz");

    const r2 = await store.submit({
      handle: "node-2",
      email: "a@b.co",
      kind: "access",
    });
    assert.ok(!("error" in r2));
    assert.equal(r2.queue, 2);

    const list = await store.list(10);
    assert.equal(list.length, 2);
    assert.equal(list[0]!.queue, 2); // newest first
    assert.equal(await store.count(), 2);
  });

  it("allows waitlist without email", async () => {
    const store = new AccessRequestStore(new MemoryKv());
    const r = await store.submit({
      handle: "verifier-1",
      kind: "verifier_waitlist",
      role: "VERIFIER",
      rail: "BASE SEPOLIA",
    });
    assert.ok(!("error" in r));
    assert.equal(r.kind, "verifier_waitlist");
    assert.equal(r.email, "");
  });
});

describe("opsTokenOk", () => {
  it("matches bearer tokens", () => {
    assert.equal(opsTokenOk("Bearer secret123", "secret123"), true);
    assert.equal(opsTokenOk("secret123", "secret123"), true);
    assert.equal(opsTokenOk("Bearer wrong", "secret123"), false);
    assert.equal(opsTokenOk(null, "secret123"), false);
    assert.equal(opsTokenOk("Bearer secret123", ""), false);
  });
});

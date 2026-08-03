/**
 * Auth + rate-limit unit tests (memory kv, Node ed25519).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { MemoryKv } from "../src/kv.ts";
import {
  AuthService,
  RateLimiter,
  authMessage,
  rpmForStake,
  verifyEd25519,
  isPublicMethod,
  makeStakeLookup,
} from "../src/auth.ts";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // export raw 32-byte pubkey from SPKI
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const pubkey = spki.subarray(-32).toString("hex");
  return { publicKey, privateKey, pubkey };
}

describe("rpmForStake", () => {
  it("scales with stake and caps", () => {
    assert.equal(rpmForStake(0), 30);
    assert.equal(rpmForStake(400), 40);
    assert.ok(rpmForStake(100_000) <= 300);
  });
});

describe("ed25519 verify", () => {
  it("accepts valid signatures", () => {
    const { privateKey, pubkey } = keypair();
    const msg = authMessage("ch_1", "ab".repeat(16), pubkey);
    const sig = sign(null, Buffer.from(msg, "utf8"), privateKey).toString("hex");
    assert.equal(verifyEd25519(pubkey, msg, sig), true);
    assert.equal(verifyEd25519(pubkey, msg + "x", sig), false);
  });
});

describe("AuthService", () => {
  it("challenge → session round-trip", async () => {
    const kv = new MemoryKv();
    const auth = new AuthService(
      kv,
      makeStakeLookup([{ id: "agent:atlas-01", stake: 12000 }]),
    );
    const { privateKey, pubkey } = keypair();

    const ch = await auth.issueChallenge(pubkey);
    assert.ok(!("error" in ch));
    const msg = authMessage(ch.id, ch.nonce, pubkey);
    const signature = sign(null, Buffer.from(msg, "utf8"), privateKey).toString("hex");

    const sess = await auth.openSession({
      challenge_id: ch.id,
      pubkey,
      signature,
      agent_id: "agent:atlas-01",
    });
    assert.ok(!("error" in sess));
    assert.equal(sess.agentId, "agent:atlas-01");
    assert.equal(sess.stake, 12000);
    assert.ok(sess.rpm > 30);

    const loaded = await auth.sessionOf(sess.token);
    assert.ok(loaded);
    assert.equal(loaded!.token, sess.token);

    // challenge single-use
    const again = await auth.openSession({
      challenge_id: ch.id,
      pubkey,
      signature,
      agent_id: "agent:atlas-01",
    });
    assert.ok("error" in again);
  });

  it("rejects bad signature", async () => {
    const kv = new MemoryKv();
    const auth = new AuthService(kv, () => 0);
    const { pubkey } = keypair();
    const ch = await auth.issueChallenge(pubkey);
    assert.ok(!("error" in ch));
    const bad = await auth.openSession({
      challenge_id: ch.id,
      pubkey,
      signature: "00".repeat(64),
    });
    assert.ok("error" in bad);
  });
});

describe("RateLimiter", () => {
  it("caps after rpm", async () => {
    const kv = new MemoryKv();
    const rl = new RateLimiter(kv);
    for (let i = 0; i < 5; i++) {
      assert.equal(await rl.check({ key: "t", rpm: 5 }), null);
    }
    assert.match((await rl.check({ key: "t", rpm: 5 })) ?? "", /rate limit/);
  });
});

describe("isPublicMethod", () => {
  it("keeps registry public, commit private", () => {
    assert.equal(isPublicMethod("registry.query"), true);
    assert.equal(isPublicMethod("task.commit"), false);
    assert.equal(isPublicMethod("auth.challenge"), true);
  });
});

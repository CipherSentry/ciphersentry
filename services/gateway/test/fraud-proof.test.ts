/**
 * B5 unit tests — ruling decision, challenge quorum, EIP-712 digest, window.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideRuling,
  pickChallengeQuorum,
  runChallengeVotes,
  domainSeparatorEscrow,
  rulingDigest,
  taskIdToBytes32,
  normalizeRuling,
  FraudProofWorker,
} from "../src/fraud-proof.ts";
import { expectedPureHash, FOUNDATION_QUORUM } from "@ciphersentry/verifier-daemon";
import { privateKeyToAccount } from "viem/accounts";
import { recoverAddress, type Hex } from "viem";

describe("decideRuling", () => {
  it("Refunds when hashes differ", () => {
    const r = decideRuling("0xaaa", "0xbbb");
    assert.equal(r.ruling, "Refund");
  });

  it("Releases when challenge confirms report", () => {
    const r = decideRuling("0xdead", "0xDEAD");
    assert.equal(r.ruling, "Release");
  });
});

describe("pickChallengeQuorum", () => {
  it("returns 3 seats", () => {
    const q = pickChallengeQuorum(FOUNDATION_QUORUM.slice(0, 3));
    assert.equal(q.length, 3);
  });

  it("rotates when original is full foundation", () => {
    const orig = FOUNDATION_QUORUM.slice(0, 3);
    const q = pickChallengeQuorum(orig, FOUNDATION_QUORUM);
    assert.notDeepEqual(q, orig);
  });
});

describe("runChallengeVotes", () => {
  it("all challenge votes agree on pure recompute", () => {
    const taskId = "cent_test1";
    const input = { spec: "render.sequence.4k", amount: "1.00", worker: "agent:x" };
    const honest = expectedPureHash(taskId, input);
    const { votes, recomputed } = runChallengeVotes(taskId, input, "0xdeadbeef", [
      "vrf:a",
      "vrf:b",
      "vrf:c",
    ]);
    assert.equal(recomputed, honest);
    assert.equal(votes.every((v) => !v.ok), true);
    assert.equal(votes.every((v) => v.recomputed === honest), true);
  });
});

describe("EIP-712 ruling digest", () => {
  it("viem raw sign recovers ruler", async () => {
    const pk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const account = privateKeyToAccount(pk);
    const domain = domainSeparatorEscrow(31337, "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9");
    const tid = taskIdToBytes32("cent_abc");
    const digest = rulingDigest(domain, tid, "Refund", 1n);
    const sig = await account.sign({ hash: digest });
    const recovered = await recoverAddress({ hash: digest, signature: sig as Hex });
    assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  });
});

describe("normalizeRuling", () => {
  it("maps common strings", () => {
    assert.equal(normalizeRuling("REFUND BUYER"), "Refund");
    assert.equal(normalizeRuling("release"), "Release");
    assert.equal(normalizeRuling("SPLIT 50/50"), "Split");
  });
});

describe("FraudProofWorker offline", () => {
  it("auto-challenges bad report to Refund", async () => {
    const w = FraudProofWorker.forTest({ autoChallenge: true, fraudWindowMs: 60_000 });
    const taskId = "cent_bad";
    const input = { spec: "embed.docs.batch", amount: "3.00", worker: "agent:forge-11" };
    const c = await w.open({
      taskId,
      reported: "0xdeadbeef",
      inputJson: input,
      buyer: "agent:orbit-2",
      worker: "agent:forge-11",
      amount: "3.00",
      votes: [
        { verifier: "vrf:delta-4", recomputed: expectedPureHash(taskId, input), ok: false, ms: 1 },
        { verifier: "vrf:gamma-1", recomputed: expectedPureHash(taskId, input), ok: false, ms: 1 },
        { verifier: "vrf:sigma-2", recomputed: expectedPureHash(taskId, input), ok: false, ms: 1 },
      ],
    });
    assert.equal(c.status, "RESOLVED");
    assert.equal(c.ruling, "Refund");
    assert.ok(c.recomputed);
    assert.equal(c.recomputed, expectedPureHash(taskId, input));
  });

  it("submits offline rule", async () => {
    const w = FraudProofWorker.forTest({ autoChallenge: true });
    const taskId = "cent_rule";
    const input = { spec: "x", amount: "1", worker: "a" };
    await w.open({
      taskId,
      reported: "0xbad",
      inputJson: input,
      buyer: "b",
      worker: "a",
      amount: "1",
      votes: [],
    });
    const r = await w.submitRule(taskId);
    assert.equal(r.mode, "offline");
    assert.equal(r.ruling, "Refund");
  });

  it("expires after window via tickBlock", async () => {
    const w = FraudProofWorker.forTest({
      autoChallenge: false,
      fraudWindowBlocks: 2,
      fraudWindowMs: 999_999_999,
      escrowAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    });
    const taskId = "cent_expire";
    await w.open({
      taskId,
      reported: "0xbad",
      inputJson: {},
      buyer: "b",
      worker: "a",
      amount: "1",
      votes: [],
      openBlock: 0,
    });
    w.tickBlock(3);
    const r = await w.defaultRefund(taskId);
    assert.equal(r.ruling, "Refund");
    assert.equal(r.status, "DEFAULTED");
  });

  it("info reports B5", () => {
    const w = FraudProofWorker.forTest();
    assert.equal(w.info().phase, "B5");
    assert.equal(w.mode, "offline");
  });
});

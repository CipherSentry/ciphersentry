/**
 * Fraud durability — MemoryKv hydrate round-trip.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryKv } from "../src/kv.ts";
import { FraudProofWorker } from "../src/fraud-proof.ts";
import { expectedPureHash } from "@ciphersentry/verifier-daemon";

describe("FraudStore durability", () => {
  it("survives worker restart via shared MemoryKv", async () => {
    const kv = new MemoryKv();
    const w1 = FraudProofWorker.forTest({ autoChallenge: true }, undefined, kv);
    await w1.hydrate();

    const taskId = "cent_durable_1";
    const input = { spec: "embed.docs.batch", amount: "3.00", worker: "agent:forge-11" };
    await w1.open({
      taskId,
      reported: "0xdeadbeef",
      inputJson: input,
      buyer: "agent:orbit-2",
      worker: "agent:forge-11",
      amount: "3.00",
      votes: [
        { verifier: "vrf:delta-4", recomputed: expectedPureHash(taskId, input), ok: false, ms: 1 },
      ],
    });
    assert.equal(w1.of(taskId)?.status, "RESOLVED");
    assert.equal(w1.info().store, "memory");

    // new worker, same kv — simulate process restart
    const w2 = FraudProofWorker.forTest({ autoChallenge: false }, undefined, kv);
    await w2.hydrate();
    const c = w2.of(taskId);
    assert.ok(c, "case missing after hydrate");
    assert.equal(c!.status, "RESOLVED");
    assert.equal(c!.ruling, "Refund");
    assert.equal(w2.info().total, 1);
  });

  it("info marks durable only for redis mode", async () => {
    const w = FraudProofWorker.forTest({});
    await w.hydrate();
    assert.equal(w.info().durable, false);
    assert.equal(w.info().store, "none");
  });
});

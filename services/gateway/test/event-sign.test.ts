/**
 * WS event signing unit tests (architecture §6).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EventSigner,
  canonicalize,
  eventMessage,
  verifyEventSig,
  EVENT_PREFIX,
} from "../src/event-sign.ts";
import { toWsFrame } from "@ciphersentry/bus";

describe("canonicalize", () => {
  it("sorts keys", () => {
    assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });
});

describe("EventSigner", () => {
  it("signs and verifies frames", () => {
    const seed = "11".repeat(32);
    const signer = new EventSigner(seed);
    const data = { id: "cent_1", state: "SETTLED" };
    const signed = signer.sign("tasks", data, 1_700_000_000_000);
    assert.equal(signed.pubkey.length, 64);
    assert.equal(signed.sig.length, 128);
    assert.equal(
      verifyEventSig(signed.pubkey, "tasks", data, signed.ts, signed.sig),
      true,
    );
    assert.equal(
      verifyEventSig(signed.pubkey, "tasks", { ...data, x: 1 }, signed.ts, signed.sig),
      false,
    );
  });

  it("signFrame wraps bus frames", () => {
    const signer = new EventSigner("22".repeat(32));
    const frame = toWsFrame("batches", { batch_id: "batch_1" });
    const out = signer.signFrame(frame);
    assert.equal(out.method, "batch.event");
    assert.ok(out.params.sig);
    assert.ok(
      verifyEventSig(
        out.params.pubkey,
        out.params.topic,
        out.params.data,
        out.params.ts,
        out.params.sig,
      ),
    );
  });

  it("message prefix is stable", () => {
    assert.match(eventMessage("tasks", {}, 1), new RegExp(`^${EVENT_PREFIX}\\|tasks\\|`));
  });
});

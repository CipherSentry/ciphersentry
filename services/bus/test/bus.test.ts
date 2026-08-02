/**
 * Event bus unit tests — memory always; NATS when compose is up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MemoryBus,
  createEventBus,
  subjectFor,
  topicFromSubject,
  toWsFrame,
  type Topic,
} from "../src/index.ts";

describe("subjects", () => {
  it("round-trips topic ↔ subject", () => {
    for (const t of ["tasks", "batches", "fraud"] as Topic[]) {
      assert.equal(topicFromSubject(subjectFor(t)), t);
    }
    assert.equal(topicFromSubject("other.x"), null);
  });
});

describe("toWsFrame", () => {
  it("maps topics to rpc methods", () => {
    assert.equal(toWsFrame("tasks", { id: 1 }).method, "task.event");
    assert.equal(toWsFrame("batches", {}).method, "batch.event");
    assert.equal(toWsFrame("fraud", {}).method, "fraud.event");
  });
});

describe("MemoryBus", () => {
  it("delivers only subscribed topics", async () => {
    const bus = new MemoryBus();
    const got: string[] = [];
    await bus.subscribe(["tasks"], (t) => {
      got.push(t);
    });
    await bus.publish("tasks", { a: 1 });
    await bus.publish("batches", { b: 2 });
    await bus.publish("fraud", { c: 3 });
    assert.deepEqual(got, ["tasks"]);
    await bus.close();
  });

  it("unsubscribe stops delivery", async () => {
    const bus = new MemoryBus();
    let n = 0;
    const off = await bus.subscribe(["tasks", "batches"], () => {
      n++;
    });
    await bus.publish("tasks", 1);
    off();
    await bus.publish("tasks", 2);
    assert.equal(n, 1);
  });

  it("handler errors do not break publish", async () => {
    const bus = new MemoryBus();
    let ok = 0;
    await bus.subscribe(["tasks"], () => {
      throw new Error("boom");
    });
    await bus.subscribe(["tasks"], () => {
      ok++;
    });
    await bus.publish("tasks", {});
    assert.equal(ok, 1);
  });
});

describe("createEventBus", () => {
  it("defaults to memory when NATS_URL empty", async () => {
    const prev = process.env.NATS_URL;
    delete process.env.NATS_URL;
    const bus = await createEventBus({ url: "" });
    assert.equal(bus.mode, "memory");
    await bus.close();
    if (prev !== undefined) process.env.NATS_URL = prev;
  });

  it("connects to live NATS when available", async () => {
    const bus = await createEventBus({
      url: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
      name: "bus-test",
      timeoutMs: 800,
    });
    if (bus.mode !== "nats") {
      // compose not up — skip without failing CI
      await bus.close();
      return;
    }
    const got: unknown[] = [];
    await bus.subscribe(["tasks"], (_t, data) => {
      got.push(data);
    });
    // allow subscription loop to attach
    await new Promise((r) => setTimeout(r, 50));
    const payload = { task_id: `t_${Date.now()}`, probe: true };
    await bus.publish("tasks", payload);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(got.length, 1);
    assert.deepEqual(got[0], payload);
    await bus.close();
  });
});

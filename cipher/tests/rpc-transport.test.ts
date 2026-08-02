import { describe, expect, it } from "vitest";
import {
  mapTaskState,
  resolveNodeEndpoints,
  canonicalizeEvent,
  eventMessage,
  EVENT_PREFIX,
  verifyEventSig,
  RpcTransport,
} from "../src/sdk/rpc";

describe("resolveNodeEndpoints", () => {
  it("accepts http base", () => {
    const e = resolveNodeEndpoints("http://127.0.0.1:8080");
    expect(e.httpBase).toBe("http://127.0.0.1:8080");
    expect(e.wsUrl).toBe("ws://127.0.0.1:8080/events");
  });

  it("accepts ws events url", () => {
    const e = resolveNodeEndpoints("ws://127.0.0.1:8080/events");
    expect(e.httpBase).toBe("http://127.0.0.1:8080");
    expect(e.wsUrl).toBe("ws://127.0.0.1:8080/events");
  });

  it("maps wss to https", () => {
    const e = resolveNodeEndpoints("wss://node.example.com/events");
    expect(e.httpBase).toBe("https://node.example.com");
    expect(e.wsUrl).toBe("wss://node.example.com/events");
  });
});

describe("mapTaskState", () => {
  it("collapses protocol states onto UI set", () => {
    expect(mapTaskState("COMMITTED")).toBe("RUNNING");
    expect(mapTaskState("EXECUTING")).toBe("RUNNING");
    expect(mapTaskState("VERIFYING")).toBe("VERIFYING");
    expect(mapTaskState("SETTLED")).toBe("SETTLED");
    expect(mapTaskState("DISPUTED")).toBe("DISPUTED");
  });
});

describe("event canonicalize (WS sign parity)", () => {
  it("matches sorted-key form", () => {
    expect(canonicalizeEvent({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(eventMessage("tasks", { id: 1 }, 9)).toBe(`${EVENT_PREFIX}|tasks|{"id":1}|9`);
  });
});

describe("verifyEventSig", () => {
  it("rejects malformed pubkey/sig lengths", async () => {
    expect(await verifyEventSig("aa", "tasks", {}, 1, "bb")).toBe(false);
    expect(await verifyEventSig("11".repeat(32), "tasks", {}, 1, "22".repeat(32))).toBe(false);
  });
});

describe("RpcTransport.onWsMessage", () => {
  it("rejects frames with bad ed25519 sig", async () => {
    const t = new RpcTransport({ url: "http://127.0.0.1:9" });
    t.stop();
    const bad = await t.onWsMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "task.event",
        params: {
          topic: "tasks",
          data: { id: "cent_x", agent: "a", counterparty: "b", state: "SETTLED" },
          ts: 1,
          sig: "00".repeat(64),
          pubkey: "11".repeat(32),
        },
      }),
    );
    expect(bad).toBe("reject");
    expect(t.eventRejectStats.rejected).toBe(1);
    expect(t.events()).toHaveLength(0);
  });

  it("rejects frames signed by non-pinned pubkey", async () => {
    const t = new RpcTransport({ url: "http://127.0.0.1:9" });
    t.stop();
    t.pinnedPubkey = "aa".repeat(32);
    const r = await t.onWsMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "task.event",
        params: {
          topic: "tasks",
          data: { id: "cent_pin", agent: "a", counterparty: "b", state: "SETTLED" },
          ts: 1,
          sig: "00".repeat(64),
          pubkey: "bb".repeat(32),
        },
      }),
    );
    expect(r).toBe("reject");
    expect(t.eventRejectStats.pinMismatch).toBe(1);
    expect(t.events()).toHaveLength(0);
  });

  it("accepts unsigned event frames (dev) and marks unsigned", async () => {
    const t = new RpcTransport({ url: "http://127.0.0.1:9" });
    t.stop();
    const r = await t.onWsMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "task.event",
        params: {
          topic: "tasks",
          data: {
            id: "cent_u",
            agent: "agent:vector-7",
            counterparty: "agent:atlas-01",
            state: "SETTLED",
            amount: "1",
          },
        },
      }),
    );
    expect(r).toBe("ok");
    expect(t.lastEventSigned).toBe(false);
    expect(t.events()[0]?.id).toBe("cent_u");
  });
});

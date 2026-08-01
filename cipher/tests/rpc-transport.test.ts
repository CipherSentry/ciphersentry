import { describe, expect, it } from "vitest";
import { mapTaskState, resolveNodeEndpoints } from "../src/sdk/rpc";

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

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  describeTransport,
  formatWireError,
  liveConsoleHref,
  liveExplorerHref,
  toWireRuling,
} from "../src/sdk/livePath";
import { readNetMode, readUrlParams } from "../src/sdk/ciphersentry";
import { readAuthFlag } from "../src/crypto/session";
import {
  indexerFromNode,
  LOCAL_INDEXER,
  LOCAL_NODE,
  PUBLIC_INDEXER,
  PUBLIC_NODE,
  resolveDefaultIndexer,
  resolveDefaultNode,
} from "../src/sdk/publicEndpoints";
import { DEFAULT_NODE, RpcTransport, RpcWireError } from "../src/sdk/rpc";
import { SimTransport } from "../src/sdk/transport";

function mockLocation(href: string) {
  const u = new URL(href, "http://localhost/");
  const loc = {
    search: u.search,
    hash: u.hash,
    href: u.href,
    hostname: u.hostname,
    host: u.host,
    origin: u.origin,
    protocol: u.protocol,
  };
  vi.stubGlobal("location", loc);
  // code paths use window.location — node has no window by default
  vi.stubGlobal("window", { location: loc });
}

describe("liveConsoleHref", () => {
  it("builds hash rpc deep-link with auth", () => {
    const h = liveConsoleHref();
    expect(h.startsWith("#/app?")).toBe(true);
    expect(h).toContain("net=rpc");
    expect(h).toContain("auth=1");
    expect(h).toMatch(/node=http/);
    expect(DEFAULT_NODE).toContain("8080");
    expect(LOCAL_NODE).toContain("8080");
  });

  it("accepts custom node + demo path", () => {
    const h = liveConsoleHref({ node: "http://node.example:8080", path: "/demo" });
    expect(h.startsWith("#/demo?")).toBe(true);
    expect(h).toContain("node=http");
    expect(h).toContain("example");
  });
});

describe("liveExplorerHref", () => {
  it("embeds task id as q + default node/indexer", () => {
    mockLocation("http://127.0.0.1:5173/");
    const h = liveExplorerHref({ taskId: "cent_abc" });
    expect(h.startsWith("#/explorer?")).toBe(true);
    expect(h).toContain("q=cent_abc");
    expect(h).toContain("indexer=");
    expect(h).toContain("node=");
  });
});

describe("toWireRuling", () => {
  it("maps UI labels to gateway-friendly forms", () => {
    expect(toWireRuling("REFUND BUYER")).toBe("REFUND BUYER");
    expect(toWireRuling("RELEASE TO WORKER")).toBe("RELEASE");
    expect(toWireRuling("SPLIT 50/50")).toBe("SPLIT");
  });
});

describe("describeTransport", () => {
  it("labels sim", () => {
    const t = new SimTransport({ cap: 2, tickMs: 60_000 });
    t.stop();
    const h = describeTransport(t);
    expect(h.kind).toBe("sim");
    expect(h.primary).toContain("SIM");
  });

  it("labels rpc offline", () => {
    const t = new RpcTransport({ url: "http://127.0.0.1:9" });
    t.stop();
    const h = describeTransport(t);
    expect(h.kind).toBe("rpc");
    expect(h.node).toBeTruthy();
    expect(h.primary).toMatch(/RPC/);
  });
});

describe("formatWireError", () => {
  it("formats RpcWireError", () => {
    expect(formatWireError(new RpcWireError("CEN_E_SCHEMA", "bad"))).toBe("CEN_E_SCHEMA: bad");
  });
});

describe("publicEndpoints", () => {
  it("maps public node → public indexer (co-located path mode)", () => {
    expect(indexerFromNode(PUBLIC_NODE)).toBe(PUBLIC_INDEXER);
    expect(PUBLIC_NODE).toBe(PUBLIC_INDEXER);
  });

  it("maps local :8080 → :8090 (B7)", () => {
    expect(indexerFromNode(LOCAL_NODE)).toBe(LOCAL_INDEXER);
    expect(LOCAL_INDEXER).toContain("8090");
  });

  it("resolveDefaultNode is localhost under mock local host", () => {
    mockLocation("http://127.0.0.1:5173/");
    expect(resolveDefaultNode()).toBe(LOCAL_NODE);
    expect(resolveDefaultIndexer()).toBe(LOCAL_INDEXER);
  });

  it("resolveDefaultNode is public on product host", () => {
    mockLocation("https://ciphersentry.xyz/");
    expect(resolveDefaultNode()).toBe(PUBLIC_NODE);
    expect(resolveDefaultIndexer()).toBe(PUBLIC_INDEXER);
  });
});

describe("hash deep-link params", () => {
  it("reads net/auth/node from #/app?…", () => {
    mockLocation("http://localhost/#/app?net=rpc&auth=1&node=http://127.0.0.1:8080");
    expect(readNetMode()).toBe("rpc");
    expect(readAuthFlag()).toBe(true);
    expect(readUrlParams().get("node")).toBe("http://127.0.0.1:8080");
  });

  it("defaults product path to rpc + auth on", () => {
    mockLocation("http://localhost/#/app");
    expect(readNetMode()).toBe("rpc");
    expect(readAuthFlag()).toBe(true);
  });

  it("opt-out with net=sim and auth=0", () => {
    mockLocation("http://localhost/#/app?net=sim&auth=0");
    expect(readNetMode()).toBe("sim");
    expect(readAuthFlag()).toBe(false);
  });

  it("prefers location.search when both present", () => {
    mockLocation("http://localhost/?net=sim#/app?net=rpc");
    // search wins for keys already set
    expect(readNetMode()).toBe("sim");
  });
});

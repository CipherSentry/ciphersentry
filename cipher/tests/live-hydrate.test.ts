import { describe, expect, it } from "vitest";
import {
  batchesFromPending,
  mergeRegistryAgents,
  walletFromFeed,
} from "../src/sdk/liveHydrate";
import type { Agent, TaskEvent } from "../src/app/data";

describe("walletFromFeed", () => {
  it("sums settled work as earned and open buys as escrow", () => {
    const events: TaskEvent[] = [
      {
        id: "1",
        agent: "a",
        counterparty: "b",
        role: "work",
        spec: "x",
        amount: "10.00",
        state: "SETTLED",
        at: 1,
        hash: "0x1",
      },
      {
        id: "2",
        agent: "a",
        counterparty: "b",
        role: "buy",
        spec: "y",
        amount: "3.50",
        state: "VERIFYING",
        at: 2,
        hash: "0x2",
      },
    ];
    const w = walletFromFeed(events, 100);
    expect(w.earned).toBe(10);
    expect(w.escrow).toBe(3.5);
    expect(w.stake).toBe(100);
  });
});

describe("batchesFromPending", () => {
  it("folds leaves into one SETTLING batch", () => {
    const b = batchesFromPending({
      count: 2,
      leaves: [
        { task_id: "t1", amount: "1.00", at: 100 },
        { task_id: "t2", amount: "2.50", at: 200 },
      ],
    });
    expect(b).toHaveLength(1);
    expect(b[0]!.count).toBe(2);
    expect(b[0]!.state).toBe("SETTLING");
    expect(b[0]!.total).toContain("3.5");
  });
});

describe("mergeRegistryAgents", () => {
  it("overlays rpc rows onto seed shells", () => {
    const seed = [
      {
        id: "v7",
        name: "agent:vector-7",
        specialty: "RENDER",
        tier: "T1",
        trust: 50,
        success: 90,
        tasks24h: 1,
        earned30d: 1,
        rate: 1,
        stake: 100,
        status: "ONLINE",
        mine: true,
        spark: [1],
      },
    ] as Agent[];
    const out = mergeRegistryAgents(seed, [
      { id: "agent:vector-7", trust: 99, stake: 2600, tier: "T2", success: 98, rate: 1.2 },
    ]);
    expect(out[0]!.trust).toBe(99);
    expect(out[0]!.stake).toBe(2600);
    expect(out[0]!.name).toBe("agent:vector-7");
  });
});

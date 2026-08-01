import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimTransport } from "../src/sdk/transport";
import { sh } from "../src/sdk/ledger";
import type { TaskEvent } from "../src/app/data";

describe("sim transport", () => {
  let t: SimTransport;

  beforeEach(() => {
    t = new SimTransport({ cap: 34, tickMs: 1_000, batchEveryTicks: 2 });
  });

  it("seeds the disputed flagship task and ledger history on start", () => {
    t.start();
    const evts = t.events();
    expect(evts.length).toBeGreaterThan(10);
    expect(evts.some((e) => e.id === "cent_f81c2a0" && e.state === "DISPUTED")).toBe(true);
    expect(t.batches()).toHaveLength(4);
  });

  it("progresses tasks and reports earned deltas on settle", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5); // advance + settle + insert
    t.start();

    let lastDelta: { earned: number; spent: number; escrowDelta: number } | null = null;
    t.onTick((_evts, delta) => {
      if (delta) lastDelta = delta;
    });

    vi.advanceTimersByTime(1_000);
    expect(lastDelta).not.toBeNull();
    expect(lastDelta!.earned + lastDelta!.spent).toBeGreaterThan(0);
    expect(t.events().some((e) => e.state === "SETTLED")).toBe(true);
    expect(t.events()[0].state).toBe("RUNNING"); // fresh insert leads the window
    expect(lastDelta!.earned).toBeGreaterThan(0); // role RNG 0.5 ⇒ worker earns
  });

  it("flushes settled tasks into a merkle batch with consistent root", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    t.start();

    const batches: string[] = [];
    t.onBatch((b) => batches.push(b.root));

    vi.advanceTimersByTime(2_000); // two ticks → flush
    expect(batches).toHaveLength(1);

    const batch = t.batches().at(-1)!;
    expect(batch.state).toBe("SETTLING");
    expect(batch.receipts.length).toBeGreaterThan(0);

    // root folds receipts in order
    let acc = "genesis";
    for (const r of batch.receipts) acc = sh(acc + r.leaf);
    expect(batch.root).toBe(acc);
    for (const r of batch.receipts) expect(r.path[3]).toBe(batch.root);
  });

  it("pause freezes the state machine", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    t.start();
    vi.advanceTimersByTime(1_000);

    t.setPaused(true);
    const snapshot = JSON.stringify(t.events());
    vi.advanceTimersByTime(5_000);
    expect(JSON.stringify(t.events())).toBe(snapshot);
  });

  it("local task injection and state transitions poke subscribers", () => {
    t.start();
    let calls = 0;
    const off = t.onTick(() => calls++);
    const task: TaskEvent = {
      id: "cent_test001",
      agent: "agent:vector-7",
      counterparty: "agent:atlas-01",
      role: "work",
      spec: "render.sequence.4k",
      amount: "10.00",
      state: "RUNNING",
      at: Date.now(),
      hash: "0xdeadbeef",
    };
    t.addTask(task);
    expect(t.events()[0].id).toBe("cent_test001");

    t.setTaskState("cent_test001", "SETTLED");
    expect(t.getTask("cent_test001")?.state).toBe("SETTLED");
    expect(calls).toBeGreaterThanOrEqual(3); // hydrate + add + setState

    off();
    const before = calls;
    t.poke();
    expect(calls).toBe(before);
  });
});

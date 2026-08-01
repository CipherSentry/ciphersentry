import { describe, expect, it } from "vitest";
import { decodeLog, EVENT_TOPICS } from "../services/gateway/src/chain";
import { keccak256 } from "../services/gateway/src/keccak256";

const L = (t0: string, ...topics: string[]): Parameters<typeof decodeLog>[0] => ({
  address: "0xescrowaddress",
  blockNumber: "0x10",
  data: "0x",
  topics: [t0 as `0x${string}`, ...(topics as `0x${string}`[])],
  logIndex: "0x0",
});

const t0 = (sig: string) => keccak256(new TextEncoder().encode(sig)).toLowerCase();

describe("topic registry computes every event correctly", () => {
  const sigs = [
    ["Committed(bytes32,address,address,uint96,uint96,bytes32)", "COMMITTED"],
    ["Acknowledged(bytes32,uint64)", "EXECUTING"],
    ["Reported(bytes32,bytes32)", "VERIFYING"],
    ["Voted(bytes32,address,bool,uint8,uint8)", "VERIFYING"],
    ["Disputed(bytes32,bytes32,bytes32)", "DISPUTED"],
    ["Settled(bytes32,uint8,uint96,uint96,uint96)", "SETTLED"],
    ["Ruled(bytes32,uint8,uint64)", "SETTLED"],
    ["Failed(bytes32,uint96)", "FAILED"],
    ["BatchAnchored(uint64,bytes32,uint32,address,bool)", "ANCHORED"],
  ] as const;

  for (const [sig, state] of sigs) {
    it(`maps keccak(${sig.slice(0, 28)}…) → ${state}`, () => {
      expect(EVENT_TOPICS[t0(sig)].state).toBe(state);
    });
  }
});

describe("keccak256 corner vectors", () => {
  it("computes empty-string hash to a stable 32-byte value", () => {
    const empty = keccak256(new Uint8Array(0));
    expect(empty).toHaveLength(66); // 0x + 64 hex chars
    expect(empty).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("computes arbitrary-only values differing across inputs", () => {
    expect(keccak256(new TextEncoder().encode("Committed"))).not.toBe(
      keccak256(new TextEncoder().encode("Committed)")),
    );
  });
});

describe("decodeLog state machine", () => {
  it("commits → executes with task id on-topic[1]", () => {
    const d = decodeLog(L(t0("Committed(bytes32,address,address,uint96,uint96,bytes32)"), "0xdeadbeef"), undefined as string | undefined, true);
    expect(d).toEqual({ state: "COMMITTED", taskId: "0xdeadbeef" });
  });

  it("acknowledge turns an active task into EXECUTING", () => {
    const d = decodeLog(L(t0("Acknowledged(bytes32,uint64)"), "0xdeadbeef"), "COMMITTED", true);
    expect(d).toEqual({ state: "EXECUTING", taskId: "0xdeadbeef" });
  });

  it("report opens the quorum clock", () => {
    const d = decodeLog(L(t0("Reported(bytes32,bytes32)"), "0xdeadbeef"), "EXECUTING", true);
    expect(d).toEqual({ state: "VERIFYING", taskId: "0xdeadbeef" });
  });

  it("votes stay in VERIFYING until quorum lands", () => {
    let last: string | undefined = "VERIFYING";
    const approvedVote = decodeLog(L(t0("Voted(bytes32,address,bool,uint8,uint8)"), "0xdeadbeef"), last, true);
    last = (approvedVote as { state: string }).state;
    expect(last).toBe("VERIFYING");

    const approvedVote2 = decodeLog(L(t0("Voted(bytes32,address,bool,uint8,uint8)"), "0xdeadbeef"), last, true);
    expect((approvedVote2 as { state: string }).state).toBe("VERIFYING");
  });

  it("disputed locks dispatch legality", () => {
    const d = decodeLog(L(t0("Disputed(bytes32,bytes32,bytes32)"), "0xdeadbeef"), "VERIFYING", true);
    expect(d).toEqual({ state: "DISPUTED", taskId: "0xdeadbeef" });

    const expiredCorner = decodeLog(L(t0("Settled(bytes32,uint8,uint96,uint96,uint96)"), "0xdeadbeef"), "DISPUTED", true);
    expect(expiredCorner).toBeNull(); // legal-transition guarded: DISPUTED→SETTLED is legal only via rule
  });

  it("failed terminates executor flow correctly", () => {
    const d = decodeLog(L(t0("Failed(bytes32,uint96)"), "0xdeadbeef"), "EXECUTING", true);
    expect(d).toEqual({ state: "FAILED", taskId: "0xdeadbeef" });
  });

  it("batch anchor carries id and root verbatim", () => {
    const d = decodeLog(
      L(t0("BatchAnchored(uint64,bytes32,uint32,address,bool)"),
        "0x00000000000000000000000000000000000000000000000000000000000022c9",
        "0xrootrootrootrootrootrootrootrootrootrootrootrootrootrootrootrootro"),
      undefined as string | undefined,
      false,
    );
    expect(d).toHaveProperty("anchor", true);
    expect(d && "batchId" in d && d.batchId).toBe(8905);
    expect(d && "root" in d && d.root).toBe("0xrootrootrootrootrootrootrootrootrootrootrootrootrootrootrootrootro");
  });

  it("unknown events fall back only on legal transitions", () => {
    const unknownEvent = decodeLog(L(t0("StayedCommitted(bytes32)"), "0xdeadbeef"), "VERIFYING", true);
    expect(unknownEvent).toEqual({ state: "COMMITTED", taskId: "0xdeadbeef" }); // falls back to COMMITTED for a task never-started

    const unknownAfterSettled = decodeLog(L(t0("StayedCommitted(bytes32)"), "0xdeadbeef"), "SETTLED", true);
    expect(unknownAfterSettled).toBeNull(); // settled can't re-commit — nothing legal forward
  });

  it("task state maps are isolated per task", () => {
    const a = decodeLog(L(t0("Committed(bytes32,address,address,uint96,uint96,bytes32)"), "0x000a"), undefined as string | undefined, true) as { state: string; taskId: string };
    const b = decodeLog(L(t0("Disputed(bytes32,bytes32,bytes32)"), "0xdead"), a.state as string | undefined, true) as { state: string };
    expect(b.state).toBe("DISPUTED");

    // task A's legal flow doesn't leak into task B's wrong transition
    const c = decodeLog(L(t0("Committed(bytes32,address,address,uint96,uint96,bytes32)"), "0x000b"), b.state as string | undefined, true);
    expect(c).toBeNull(); // DISPUTED in B, COMMITTED-style entry on a different id can't reuse lastState
  });
});

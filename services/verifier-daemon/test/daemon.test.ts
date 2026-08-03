import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DeterministicSandbox,
  VerifierDaemon,
  VerifierPool,
  SlashDryRunLedger,
  BondRegistry,
  EpochElection,
  AccrualLedger,
  AccuracyOracle,
  FEE_BPS,
  VERIFIER_SHARE_BPS,
  expectedPureHash,
  FOUNDATION_QUORUM,
  BOND_FLOOR,
  canonicalize,
  outputHashOf,
  pureRecompute,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureWasm = new Uint8Array(readFileSync(join(here, "../fixtures/minimal.wasm")));

describe("pure recompute", () => {
  it("is stable across runs", () => {
    const a = pureRecompute({ frames: 240, seed: 1 }, "cent_a");
    const b = pureRecompute({ frames: 240, seed: 1 }, "cent_a");
    assert.equal(a.outputHash, b.outputHash);
    assert.equal(a.outputHash, expectedPureHash("cent_a", { frames: 240, seed: 1 }));
  });

  it("changes with task id or input", () => {
    const a = pureRecompute({ x: 1 }, "cent_a");
    const b = pureRecompute({ x: 2 }, "cent_a");
    const c = pureRecompute({ x: 1 }, "cent_b");
    assert.notEqual(a.outputHash, b.outputHash);
    assert.notEqual(a.outputHash, c.outputHash);
  });
});

describe("DeterministicSandbox pure mode", () => {
  it("returns matching hashes for identical assignments", async () => {
    const sb = new DeterministicSandbox();
    const r1 = await sb.run({ taskId: "t1", inputJson: { n: 7 }, mode: "pure" });
    const r2 = await sb.run({ taskId: "t1", inputJson: { n: 7 }, mode: "pure" });
    assert.equal(r1.ok, true);
    assert.equal(r1.outputHash, r2.outputHash);
    assert.equal(r1.mode, "pure");
  });
});

describe("DeterministicSandbox wasm fixture", () => {
  it("compiles and executes minimal.wasm without trap", async () => {
    const sb = new DeterministicSandbox();
    const r = await sb.run({
      taskId: "cent_wasm",
      inputJson: { frames: 10 },
      wasm: fixtureWasm,
      mode: "wasm",
    });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.outputHash?.startsWith("0x"));
    assert.equal(r.mode, "wasm");
  });
});

describe("VerifierDaemon quorum", () => {
  it("settles when reported hash matches pure recompute", async () => {
    const taskId = "cent_ok";
    const inputJson = { frames: 240, seed: 88421 };
    const daemon = new VerifierDaemon({
      verifierId: FOUNDATION_QUORUM[0],
      quorumVoices: [...FOUNDATION_QUORUM],
    });
    const out = await daemon.process({
      taskId,
      mode: "pure",
      inputJson,
      reportedHash: expectedPureHash(taskId, inputJson),
      buyer: "agent:atlas-01",
      worker: "agent:vector-7",
      amount: "12.50",
    });
    assert.equal(out.settled, true);
    assert.equal(out.votes.length, 3);
    assert.ok(out.votes.every((v) => v.ok));
  });

  it("emits evidence on hash mismatch", async () => {
    const daemon = new VerifierDaemon({
      verifierId: FOUNDATION_QUORUM[0],
      quorumVoices: [...FOUNDATION_QUORUM],
    });
    const out = await daemon.process({
      taskId: "cent_bad",
      mode: "pure",
      inputJson: { frames: 1 },
      reportedHash: "0xdeadbeefdeadbeef",
      buyer: "agent:atlas-01",
      worker: "agent:vector-7",
      amount: "1.00",
    });
    assert.equal(out.settled, false);
    assert.ok(out.evidence);
    assert.equal(out.evidence!.type, "evidence.recompute");
    assert.equal(out.votes.every((v) => !v.ok), true);
  });
});

describe("SlashDryRunLedger", () => {
  it("applies 10% FalseVote cut and splits proceeds", () => {
    const ledger = new SlashDryRunLedger({ defaultBond: 25_000 });
    const evidence = {
      type: "evidence.recompute" as const,
      taskId: "cent_x",
      reported: "0xbad",
      digests: { "vrf:gamma-1": "0x1", "vrf:delta-4": "0x1", "vrf:sigma-2": "0x1" },
      votes: [
        { verifier: "vrf:gamma-1", recomputed: "0x1", ok: false, ms: 1 },
        { verifier: "vrf:delta-4", recomputed: "0x1", ok: false, ms: 1 },
        { verifier: "vrf:sigma-2", recomputed: "0x1", ok: true, ms: 1 },
      ],
      quorum: "2/3",
      at: Date.now(),
      canonical: canonicalize({ t: "cent_x" }),
      sig: outputHashOf("x"),
    };
    const rows = ledger.applyEvidence(evidence, "FalseVote");
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.cut, 2_500); // 10% of 25k
    assert.equal(rows[0]!.burned, 1_250);
    assert.equal(rows[0]!.bounty + rows[0]!.treasury + rows[0]!.burned, rows[0]!.cut);
    assert.equal(rows[0]!.mode, "dry-run");
  });
});

describe("VerifierPool", () => {
  it("settles honest reports, accrues fees, and real-slashes dishonest ones", async () => {
    const pool = new VerifierPool({ epoch: 88421 });
    const taskId = "cent_pool";
    const inputJson = { spec: "render.sequence.4k", amount: "12.50" };

    const ok = await pool.verify({
      taskId,
      mode: "pure",
      inputJson,
      reportedHash: expectedPureHash(taskId, inputJson),
      buyer: "agent:atlas-01",
      worker: "agent:vector-7",
      amount: "12.50",
    });
    assert.equal(ok.settled, true);
    assert.equal(ok.slashDryRuns.length, 0);
    assert.equal(ok.slashes.length, 0);
    assert.equal(ok.verifiers.length, 3);
    assert.equal(ok.epoch, 88421);
    assert.ok(ok.accrual);
    assert.ok(ok.accrual!.feeUsdc > 0);
    assert.equal(ok.accrual!.lines.length, 3);
    // balances credited
    const sumBal = ok.verifiers.reduce((s, id) => s + pool.accrual.balanceOf(id), 0);
    assert.ok(Math.abs(sumBal - ok.accrual!.verifierPoolUsdc) < 1e-9);

    const beforeBond = pool.registry.bondOf(ok.verifiers[0]!);
    const bad = await pool.verify({
      taskId: "cent_pool_bad",
      mode: "pure",
      inputJson,
      reportedHash: "0x00",
      buyer: "agent:atlas-01",
      worker: "agent:vector-7",
      amount: "12.50",
    });
    assert.equal(bad.settled, false);
    assert.ok(bad.evidence);
    assert.equal(bad.slashDryRuns.length, 3);
    assert.equal(bad.slashes.length, 3);
    assert.ok(bad.slashes[0]!.cut > 0);
    assert.ok(pool.registry.bondOf(ok.verifiers[0]!) < beforeBond);
    assert.equal(bad.accrual, undefined);
  });
});

describe("AccrualLedger", () => {
  it("takes 0.35% fee and 85/15 split with accuracy² weights", () => {
    const reg = new BondRegistry(true);
    const ledger = new AccrualLedger();
    const escrow = 100;
    const entry = ledger.accrue({
      taskId: "cent_fee",
      epoch: 1,
      escrowUsdc: escrow,
      voters: [
        { id: "vrf:gamma-1", ok: true },
        { id: "vrf:delta-4", ok: true },
        { id: "vrf:sigma-2", ok: true },
      ],
      registry: reg,
    });
    const expectedFee = (escrow * FEE_BPS) / 10_000;
    assert.ok(Math.abs(entry.feeUsdc - expectedFee) < 1e-9);
    const treasuryShare = (expectedFee * 1500) / 10_000;
    assert.ok(Math.abs(entry.treasuryUsdc - treasuryShare) < 1e-9);
    assert.ok(Math.abs(entry.verifierPoolUsdc - (expectedFee - treasuryShare)) < 1e-9);
    assert.equal(entry.lines.length, 3);
    const lineSum = entry.lines.reduce((s, l) => s + l.amount, 0);
    assert.ok(Math.abs(lineSum - entry.verifierPoolUsdc) < 1e-9);
    // claim empties balance
    const v = entry.lines[0]!.verifier;
    const c = ledger.claim(v);
    assert.ok(c.amount > 0);
    assert.equal(ledger.balanceOf(v), 0);
    void VERIFIER_SHARE_BPS;
  });
});

describe("AccuracyOracle", () => {
  it("EMA-updates registry accuracy from votes", () => {
    const reg = new BondRegistry(true);
    const before = reg.get("vrf:gamma-1")!.accuracyBps;
    const oracle = new AccuracyOracle(reg);
    oracle.observe(
      [
        { verifier: "vrf:gamma-1", ok: false },
        { verifier: "vrf:gamma-1", ok: false },
      ],
      "t1",
    );
    const after = reg.get("vrf:gamma-1")!.accuracyBps;
    assert.ok(after < before);
    const snap = oracle.of("vrf:gamma-1");
    assert.equal(snap.total, 2);
    assert.equal(snap.correct, 0);
  });
});

describe("BondRegistry + EpochElection", () => {
  it("stakes external verifiers and elects top-3 deterministically", () => {
    const reg = new BondRegistry(true);
    reg.stake("vrf:ext-whale", 100_000, { accuracyBps: 9_500 });
    reg.stake("vrf:ext-small", 26_000, { accuracyBps: 9_900 });
    assert.equal(reg.eligible().length, 5);

    const el = new EpochElection({ salt: "test" });
    const a = el.elect(100, reg);
    const b = el.elect(100, reg); // idempotent
    assert.deepEqual(a.members, b.members);
    assert.deepEqual(a.scores, b.scores);
    assert.equal(a.members.length, 3);
    assert.equal(a.finalized, true);

    // different epoch → may reshuffle (seed changes) but still 3 seats
    const c = el.elect(101, reg);
    assert.equal(c.members.length, 3);
    assert.notEqual(c.seed, a.seed);
  });

  it("jails under-floor after slash", () => {
    const reg = new BondRegistry(false);
    reg.stake("vrf:thin", BOND_FLOOR);
    const r = reg.slash("vrf:thin", 1);
    assert.equal(r.jailed, true);
    assert.equal(reg.get("vrf:thin")!.status, "Jailed");
  });

  it("same candidates + epoch always same seats (I-E1)", () => {
    const reg = new BondRegistry(true);
    const e1 = new EpochElection({ salt: "fixed" });
    const e2 = new EpochElection({ salt: "fixed" });
    const a = e1.elect(7, reg);
    const b = e2.elect(7, reg);
    assert.deepEqual(a.members, b.members);
    assert.deepEqual(a.scores, b.scores);
  });
});

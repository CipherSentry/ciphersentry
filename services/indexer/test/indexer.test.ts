/**
 * B6 indexer unit tests — merkle parity with gateway batcher, event
 * normalization, ledger writer (memory), inclusion proofs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  leafHash,
  merkleRoot,
  reconcileRoot,
  verifyInclusionEitherOrder,
  normalizeHex32,
} from "../src/merkle.ts";
import { normalizeTask, normalizeBatch } from "../src/normalize.ts";
import { LedgerWriter, ChainListener, trustScoreImport } from "./_helpers.ts";
import { MemoryStore, MemoryClickHouse } from "../src/memory.ts";
import { trustScore } from "../src/server.ts";
import { TrustSeriesWriter } from "../src/trust.ts";
import { applyFraudStakeCut, seedStake, StakeCache } from "../src/stakes.ts";

void trustScoreImport;

describe("search pre-batch tasks", () => {
  it("ILIKE tasks returns task_id before receipts exist", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    const writer = new LedgerWriter(pg, ch);
    await writer.upsertTask({
      task_id: "cent_prebatch1",
      buyer: "agent:atlas-01",
      worker: "agent:vector-7",
      spec: "render.sequence.4k",
      amount: "12.00",
      state: "COMMITTED",
      state_at_block: 1,
    });
    const hits = await pg.exec(
      `SELECT task_id, state, worker, buyer, amount FROM tasks WHERE task_id ILIKE $1 LIMIT 10`,
      ["%cent_prebatch%"],
    );
    assert.equal(hits.length, 1);
    assert.equal((hits[0] as { task_id: string }).task_id, "cent_prebatch1");
    const exact = await pg.exec(
      `SELECT task_id, buyer, worker, spec, amount, state, reported_hash, state_at_block, state_at_ts
       FROM tasks WHERE task_id = $1 LIMIT 1`,
      ["cent_prebatch1"],
    );
    assert.equal(exact.length, 1);
    assert.equal((exact[0] as { state: string }).state, "COMMITTED");
    // receipts still empty — this is the lag fix
    const rec = await pg.exec(
      `SELECT receipt_id, batch_id FROM receipts WHERE receipt_id ILIKE $1 OR task_id ILIKE $1 OR leaf ILIKE $1 LIMIT 10`,
      ["%cent_prebatch%"],
    );
    assert.equal(rec.length, 0);
  });
});

describe("leafHash / merkleRoot (B4 parity)", () => {
  it("leafHash is deterministic 32-byte hex", () => {
    const a = leafHash("cent_abc", "0xdead");
    const b = leafHash("cent_abc", "0xdead");
    assert.equal(a, b);
    assert.equal(a.length, 66);
    assert.match(a, /^0x[0-9a-f]{64}$/);
  });

  it("leafHash changes with either input", () => {
    const a = leafHash("cent_a", "h1");
    const b = leafHash("cent_b", "h1");
    const c = leafHash("cent_a", "h2");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it("single leaf is the root", () => {
    const leaf = leafHash("t1", "out");
    const { root, paths } = merkleRoot([leaf]);
    assert.equal(root, normalizeHex32(leaf));
    assert.equal(paths[0]!.length, 0);
    assert.equal(verifyInclusionEitherOrder(leaf, [], root), true);
  });

  it("two leaves hash as a pair", () => {
    const l0 = leafHash("t0", "a");
    const l1 = leafHash("t1", "b");
    const { root, paths } = merkleRoot([l0, l1]);
    assert.equal(paths[0]!.length, 1);
    assert.equal(verifyInclusionEitherOrder(l0, paths[0]!, root), true);
    assert.equal(verifyInclusionEitherOrder(l1, paths[1]!, root), true);
    assert.equal(reconcileRoot([l0, l1], root), true);
  });

  it("empty yields zero root", () => {
    const { root } = merkleRoot([]);
    assert.equal(root, "0x" + "00".repeat(32));
  });

  it("odd leaf count duplicates last", () => {
    const leaves = [leafHash("a", "1"), leafHash("b", "2"), leafHash("c", "3")];
    const { root, paths } = merkleRoot(leaves);
    for (let i = 0; i < leaves.length; i++) {
      assert.equal(verifyInclusionEitherOrder(leaves[i]!, paths[i]!, root), true);
    }
  });
});

describe("normalizeTask / normalizeBatch", () => {
  it("maps sim TaskRow RUNNING → EXECUTING", () => {
    const t = normalizeTask({
      id: "cent_1",
      agent: "agent:vector-7",
      counterparty: "agent:atlas-01",
      role: "work",
      spec: "render.sequence.4k",
      amount: "10.00",
      state: "RUNNING",
      hash: "0xabc",
    });
    assert.ok(t);
    assert.equal(t!.task_id, "cent_1");
    assert.equal(t!.worker, "agent:vector-7");
    assert.equal(t!.buyer, "agent:atlas-01");
    assert.equal(t!.state, "EXECUTING");
  });

  it("maps already-normalized task", () => {
    const t = normalizeTask({
      task_id: "cent_2",
      buyer: "b",
      worker: "w",
      spec: "s",
      amount: "1",
      state: "SETTLED",
      state_at_block: 99,
    });
    assert.equal(t!.state, "SETTLED");
    assert.equal(t!.state_at_block, 99);
  });

  it("maps batcher onBatch payload", () => {
    const l0 = leafHash("cent_x", "0xre");
    const { root, paths } = merkleRoot([l0]);
    const b = normalizeBatch({
      batch_id: "batch_1",
      root,
      count: 1,
      total: "5.00",
      receipts: [
        {
          receipt_id: "cent_x",
          task_id: "cent_x",
          leaf: l0,
          path: paths[0],
          reported: "0xre",
          recomputed: "0xre",
        },
      ],
      tx: "0xtx",
    });
    assert.ok(b);
    assert.equal(b!.batch_id, "batch_1");
    assert.equal(b!.receipts.length, 1);
    assert.equal(b!._paths?.[0]?.length, paths[0]!.length);
    assert.equal(b!.anchored_tx, "0xtx");
  });
});

describe("LedgerWriter memory", () => {
  it("upserts tasks and writes reconciled keccak batch", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    const writer = new LedgerWriter(pg, ch);

    await writer.upsertTask({
      task_id: "cent_a",
      buyer: "agent:atlas-01",
      worker: "agent:vector-7",
      spec: "render.sequence.4k",
      amount: "42.00",
      state: "SETTLED",
      state_at_block: 1,
    });

    const leaves = [leafHash("cent_a", "0xout"), leafHash("cent_b", "0xout2")];
    const { root, paths } = merkleRoot(leaves);
    const result = await writer.writeBatch({
      batch_id: "batch_42",
      epoch: 88421,
      root,
      count: 2,
      total: "50.00",
      receipts: [
        {
          receipt_id: "cent_a",
          task_id: "cent_a",
          buyer: "agent:atlas-01",
          worker: "agent:vector-7",
          spec: "render.sequence.4k",
          amount: "42.00",
          reported: "0xout",
          recomputed: "0xout",
          votes: [{ v: "vrf:gamma-1", ok: true }],
          ms: 400,
          epoch: 88421,
          leaf: leaves[0]!,
        },
        {
          receipt_id: "cent_b",
          task_id: "cent_b",
          buyer: "agent:orbit-2",
          worker: "agent:forge-11",
          spec: "scrape.pricing.daily",
          amount: "8.00",
          reported: "0xout2",
          recomputed: "0xout2",
          votes: [{ v: "vrf:delta-4", ok: true }],
          ms: 410,
          epoch: 88421,
          leaf: leaves[1]!,
        },
      ],
      _paths: paths,
    });

    assert.equal(result.reconciled, true);
    assert.equal(result.mode, "keccak");
    assert.equal(result.proofsOk, 2);
    assert.equal(pg.batches.has("batch_42"), true);
    assert.equal(pg.receipts.size, 2);
    assert.ok((ch.tables.get("receipts")?.length ?? 0) >= 2);

    // trust_series populated for buyers/workers
    const series = ch.tables.get("trust_series") ?? [];
    assert.ok(series.length >= 2, `expected trust_series rows, got ${series.length}`);
    assert.ok(series.every((r) => Number(r.trust_score) >= 0 && Number(r.trust_score) <= 100));
    assert.ok(series.some((r) => r.agent_id === "agent:vector-7" && Number(r.epoch) === 88421));
    const agent = pg.agents.get("agent:vector-7");
    assert.ok(agent, "agents.trust updated");
    assert.ok(Number(agent!.trust) > 0);

    const proof = await pg.exec(`SELECT * FROM receipts WHERE receipt_id = $1 LIMIT 1`, ["cent_a"]);
    assert.equal(proof.length, 1);
    const path = (proof[0] as { path: string[] }).path;
    assert.equal(verifyInclusionEitherOrder(leaves[0]!, path, root), true);
  });

  it("flags mismatch without patching root", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    const writer = new LedgerWriter(pg, ch);
    const leaf = leafHash("cent_bad", "x");
    const result = await writer.writeBatch({
      batch_id: "batch_bad",
      epoch: 1,
      root: "0x" + "11".repeat(32),
      count: 1,
      total: "1",
      receipts: [
        {
          receipt_id: "cent_bad",
          task_id: "cent_bad",
          buyer: "b",
          worker: "w",
          spec: "s",
          amount: "1",
          reported: "x",
          recomputed: "x",
          votes: [],
          ms: 1,
          epoch: 1,
          leaf,
        },
      ],
    });
    assert.equal(result.reconciled, false);
    assert.equal(pg.batches.get("batch_bad")?.root, "0x" + "11".repeat(32));
  });
});

describe("ChainListener.route", () => {
  it("routes task.event and batch.event frames", async () => {
    const tasks: string[] = [];
    const batches: string[] = [];
    const listener = new ChainListener(
      "ws://127.0.0.1:9/events",
      async (t) => {
        tasks.push(t.task_id);
      },
      async (b) => {
        batches.push(b.batch_id);
      },
    );

    const leaf = leafHash("cent_r", "h");
    const { root, paths } = merkleRoot([leaf]);

    const r1 = await listener.route(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "task.event",
        params: {
          topic: "tasks",
          data: {
            id: "cent_r",
            agent: "agent:vector-7",
            counterparty: "agent:atlas-01",
            role: "work",
            spec: "s",
            amount: "1",
            state: "SETTLED",
          },
        },
      }),
    );
    const r2 = await listener.route(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "batch.event",
        params: {
          topic: "batches",
          data: {
            batch_id: "batch_9",
            root,
            count: 1,
            total: "1",
            receipts: [{ receipt_id: "cent_r", task_id: "cent_r", leaf, path: paths[0], reported: "h", recomputed: "h" }],
          },
        },
      }),
    );

    assert.equal(r1, "task");
    assert.equal(r2, "batch");
    assert.deepEqual(tasks, ["cent_r"]);
    assert.deepEqual(batches, ["batch_9"]);
  });
});

describe("trustScore", () => {
  it("clamps to 0..100", () => {
    assert.ok(trustScore(0, 0, 0) >= 0);
    assert.ok(trustScore(1e9, 1, 1e6) <= 100);
    assert.ok(trustScore(100, 0.9, 500) > 50);
  });

  it("s#0 stake term moves the score", () => {
    const bare = trustScore(0, 1, 0);
    const staked = trustScore(12_000, 1, 0);
    assert.ok(staked > bare, `expected stake to raise T (${staked} > ${bare})`);
  });
});

describe("stakes / fraud slash", () => {
  it("seedStake mirrors registry", () => {
    assert.equal(seedStake("agent:atlas-01"), 12_000);
    assert.equal(seedStake("vrf:gamma-1"), 40_000);
    assert.equal(seedStake("unknown"), 0);
  });

  it("applyFraudStakeCut is 0.95", () => {
    assert.equal(applyFraudStakeCut(1000), 950);
    assert.equal(applyFraudStakeCut(850), 807.5);
  });

  it("Refund fraud cuts worker s_i and halves T", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    const stakes = new StakeCache({ refreshMs: 0 });
    const writer = new LedgerWriter(pg, ch, stakes);
    await writer.upsertTask({
      task_id: "cent_f",
      buyer: "agent:orbit-2",
      worker: "agent:forge-11",
      spec: "s",
      amount: "3",
      state: "DISPUTED",
      state_at_block: 1,
    });
    const before = Number(pg.agents.get("agent:forge-11")!.stake);
    assert.equal(before, 850);
    await writer.writeFraud({
      task_id: "cent_f",
      status: "RESOLVED",
      reported: "0xbad",
      recomputed: "0xgood",
      buyer: "agent:orbit-2",
      worker: "agent:forge-11",
      amount: "3",
      ruling: "Refund",
      reason: "mismatch",
      open_at: Date.now(),
      open_block: 1,
      window_blocks: 64,
      resolved_at: Date.now(),
      original_votes: [],
      challenge_votes: [],
      chain_mode: "offline",
      chain_tx: null,
    });
    const after = Number(pg.agents.get("agent:forge-11")!.stake);
    assert.equal(after, applyFraudStakeCut(850));
    assert.ok(Number(pg.agents.get("agent:forge-11")!.trust) < 100);
  });
});

describe("TrustSeriesWriter", () => {
  it("seeds registry stake into score when agents.stake is 0", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    await pg.exec(
      `INSERT INTO agents (agent_id, tier, trust, stake, success, status) VALUES ($1,$2,$3,$4,$5,$6)`,
      ["agent:atlas-01", "T3", 50, 0, 1, "ONLINE"],
    );
    const w = new TrustSeriesWriter(pg, ch);
    const points = await w.writeForBatch(99, [
      {
        receipt_id: "cent_s",
        task_id: "cent_s",
        buyer: "agent:orbit-2",
        worker: "agent:atlas-01",
        spec: "s",
        amount: "1",
        reported: "h",
        recomputed: "h",
        votes: [],
        ms: 1,
        epoch: 99,
        leaf: "0x" + "ab".repeat(32),
      },
    ]);
    const atlas = points.find((p) => p.agent_id === "agent:atlas-01");
    assert.ok(atlas);
    assert.equal(atlas!.stake, 12_000);
    assert.ok(atlas!.trust_score > trustScore(0, 1, 0));
    assert.equal(Number(pg.agents.get("agent:atlas-01")!.stake), 12_000);
  });

  it("writes CH series and updates agents after batch", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    const writer = new LedgerWriter(pg, ch);
    const leaf = leafHash("cent_t", "0xok");
    const { root, paths } = merkleRoot([leaf]);
    await writer.writeBatch({
      batch_id: "batch_trust",
      epoch: 99,
      root,
      count: 1,
      total: "1",
      receipts: [
        {
          receipt_id: "cent_t",
          task_id: "cent_t",
          buyer: "agent:buyer",
          worker: "agent:worker",
          spec: "s",
          amount: "1",
          reported: "0xok",
          recomputed: "0xok",
          votes: [],
          ms: 1,
          epoch: 99,
          leaf,
        },
      ],
      _paths: paths,
    } as never);

    const tw = new TrustSeriesWriter(pg, ch);
    const stats = await tw.statsOf("agent:worker");
    assert.equal(stats.settled_count, 1);
    assert.equal(stats.success, 1);

    const rows = await ch.exec(
      `SELECT agent_id, epoch, trust_score FROM trust_series WHERE agent_id = 'agent:worker' ORDER BY epoch DESC LIMIT 32 FORMAT JSON`,
    );
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { epoch: number }).epoch, 99);
  });
});

describe("fraud cases", () => {
  it("normalizes and writes fraud.event frames", async () => {
    const pg = new MemoryStore();
    const ch = new MemoryClickHouse();
    const writer = new LedgerWriter(pg, ch);
    const frauds: string[] = [];
    const listener = new ChainListener(
      "ws://127.0.0.1:9/events",
      async () => {},
      async () => {},
      async (f) => {
        await writer.writeFraud(f);
        frauds.push(f.task_id);
      },
    );

    const r = await listener.route(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "fraud.event",
        params: {
          topic: "fraud",
          data: {
            task_id: "cent_bad1",
            status: "RESOLVED",
            reported: "0xdeadbeef",
            recomputed: "0xgood",
            buyer: "agent:orbit-2",
            worker: "agent:forge-11",
            amount: "3.00",
            ruling: "Refund",
            reason: "hash mismatch",
            open_at: Date.now(),
            open_block: 0,
            window_blocks: 64,
            resolved_at: Date.now(),
            original_votes: [{ v: "vrf:gamma-1", ok: false }],
            challenge_votes: [{ v: "vrf:delta-4", ok: false }],
            chain: { mode: "offline" },
          },
        },
      }),
    );
    assert.equal(r, "fraud");
    assert.deepEqual(frauds, ["cent_bad1"]);
    assert.equal(pg.fraud.get("cent_bad1")?.ruling, "Refund");
    assert.equal(pg.tasks.get("cent_bad1")?.state, "FAILED");
    assert.ok((ch.tables.get("fraud_cases")?.length ?? 0) >= 1);
  });
});

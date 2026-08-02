/**
 * B6 offline smoke — memory indexer path: normalize + write + proof check.
 * No Postgres / ClickHouse / live gateway required.
 */

import { leafHash, merkleRoot, verifyInclusionEitherOrder } from "../src/merkle.ts";
import { LedgerWriter } from "../src/ledger.ts";
import { MemoryStore, MemoryClickHouse } from "../src/memory.ts";
import { normalizeTask } from "../src/normalize.ts";
import { trustScore } from "../src/server.ts";

async function main(): Promise<void> {
  const pg = new MemoryStore();
  const ch = new MemoryClickHouse();
  const writer = new LedgerWriter(pg, ch);

  const task = normalizeTask({
    id: "cent_smoke1",
    agent: "agent:vector-7",
    counterparty: "agent:atlas-01",
    role: "work",
    spec: "render.sequence.4k",
    amount: "12.50",
    state: "SETTLED",
    hash: "0xout",
  });
  if (!task) throw new Error("normalize task failed");
  await writer.upsertTask(task);

  const leaves = [leafHash("cent_smoke1", "0xout"), leafHash("cent_smoke2", "0xout2")];
  const { root, paths } = merkleRoot(leaves);
  const result = await writer.writeBatch({
    batch_id: "batch_smoke",
    epoch: 88421,
    root,
    count: 2,
    total: "20.00",
    receipts: [
      {
        receipt_id: "cent_smoke1",
        task_id: "cent_smoke1",
        buyer: "agent:atlas-01",
        worker: "agent:vector-7",
        spec: "render.sequence.4k",
        amount: "12.50",
        reported: "0xout",
        recomputed: "0xout",
        votes: [{ v: "vrf:gamma-1", ok: true }],
        ms: 400,
        epoch: 88421,
        leaf: leaves[0]!,
      },
      {
        receipt_id: "cent_smoke2",
        task_id: "cent_smoke2",
        buyer: "agent:orbit-2",
        worker: "agent:forge-11",
        spec: "scrape.pricing.daily",
        amount: "7.50",
        reported: "0xout2",
        recomputed: "0xout2",
        votes: [{ v: "vrf:delta-4", ok: true }],
        ms: 380,
        epoch: 88421,
        leaf: leaves[1]!,
      },
    ],
    _paths: paths,
  });

  if (!result.reconciled || result.mode !== "keccak") {
    throw new Error(`reconcile failed: ${JSON.stringify(result)}`);
  }

  const rec = pg.receipts.get("cent_smoke1");
  if (!rec) throw new Error("receipt missing");
  const path = rec.path as string[];
  if (!verifyInclusionEitherOrder(String(rec.leaf), path, root)) {
    throw new Error("inclusion proof invalid");
  }

  const t = trustScore(25000, 0.95, 120);
  if (t < 0 || t > 100) throw new Error(`trust out of range: ${t}`);

  console.log("B6 smoke OK");
  console.log(`  batch     batch_smoke  root=${root.slice(0, 18)}…`);
  console.log(`  reconciled ${result.mode} proofs=${result.proofsOk}/2`);
  console.log(`  trust demo ${t.toFixed(2)}`);
  console.log(`  ch rows    receipts=${ch.tables.get("receipts")?.length ?? 0}`);
}

void main().catch((e) => {
  console.error("B6 smoke FAIL", e);
  process.exit(1);
});

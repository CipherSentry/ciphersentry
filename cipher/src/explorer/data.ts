/** Explorer helpers — types from SDK ledger; live data from indexer or sim. */

import type { ExBatch, Receipt } from "../sdk/ledger";
import { AGENTS } from "../app/data";
import type { FraudRow, IndexerSearch } from "./indexer";

export type { ExBatch, Receipt, Vote } from "../sdk/ledger";
export { VRF, sh } from "../sdk/ledger";

const NAMES = AGENTS.map((a) => a.name);

export interface ExplorerSearch {
  kind: "receipt" | "batch" | "agent" | "fraud" | "none";
  batch?: ExBatch;
  receipt?: Receipt;
  agent?: string;
  fraud?: FraudRow;
  query: string;
}

export function search(q0: string, batches: ExBatch[], fraud: FraudRow[] = []): ExplorerSearch {
  const q = q0.trim().toLowerCase();
  if (!q) return { kind: "none", query: q0 };

  for (const f of fraud) {
    if (f.task_id.toLowerCase().includes(q) || f.task_id.toLowerCase() === q) {
      return { kind: "fraud", fraud: f, query: q0 };
    }
  }

  for (const b of batches) {
    if (b.id.toLowerCase().includes(q)) return { kind: "batch", batch: b, query: q0 };
    for (const r of b.receipts) {
      if (
        r.id.toLowerCase().includes(q) ||
        r.leaf.toLowerCase().startsWith(q) ||
        r.reported.toLowerCase().startsWith(q)
      ) {
        return { kind: "receipt", batch: b, receipt: r, query: q0 };
      }
    }
  }
  const agent = NAMES.find((n) => n.toLowerCase().includes(q) || n.replace("agent:", "").includes(q));
  if (agent) return { kind: "agent", agent, query: q0 };
  // live deep-link: agent:vector-7 or exact agent-like id (word-digit)
  const raw = q0.trim();
  if (q.startsWith("agent:") && raw.length > 7) {
    return { kind: "agent", agent: raw, query: q0 };
  }
  if (/^[a-z][\w]*-\d+$/i.test(raw)) {
    return { kind: "agent", agent: `agent:${raw}`, query: q0 };
  }
  return { kind: "none", query: q0 };
}

/** Apply remote /search hits when local window misses. */
export function searchFromIndexer(
  q0: string,
  remote: IndexerSearch,
  batches: ExBatch[],
  fraud: FraudRow[],
): ExplorerSearch {
  const local = search(q0, batches, fraud);
  if (local.kind !== "none") return local;

  if (remote.fraud[0]) {
    const f = fraud.find((x) => x.task_id === remote.fraud[0]!.task_id);
    if (f) return { kind: "fraud", fraud: f, query: q0 };
    return {
      kind: "fraud",
      fraud: {
        task_id: remote.fraud[0].task_id,
        status: remote.fraud[0].status,
        reported: "",
        buyer: "",
        worker: "",
        amount: "0",
        ruling: remote.fraud[0].ruling,
      },
      query: q0,
    };
  }
  if (remote.batches[0]) {
    const b = batches.find((x) => x.id === remote.batches[0]!.batch_id);
    if (b) return { kind: "batch", batch: b, query: q0 };
  }
  if (remote.receipts[0]) {
    for (const b of batches) {
      const r = b.receipts.find((x) => x.id === remote.receipts[0]!.receipt_id);
      if (r) return { kind: "receipt", batch: b, receipt: r, query: q0 };
    }
  }
  if (remote.agents[0]) {
    return { kind: "agent", agent: remote.agents[0].agent_id, query: q0 };
  }
  return { kind: "none", query: q0 };
}

export function agentReceipts(agent: string, batches: ExBatch[]): Receipt[] {
  const out: Receipt[] = [];
  for (const b of batches)
    for (const r of b.receipts)
      if (r.buyer === agent || r.worker === agent) out.push(r);
  return out.slice(0, 8);
}

/** Display rows for merkle ladder: leaf → siblings → root. */
export function proofRows(r: Receipt): { label: string; hash: string }[] {
  const p = r.path;
  if (p.length === 0) return [{ label: "LEAF", hash: r.leaf }];
  // Convention A: [leaf, …siblings, root] (indexer adapter)
  // Convention B: legacy sim 4-tuple same shape
  if (p[0] === r.leaf || p[0]?.startsWith("0x")) {
    const mid = p.slice(1, -1);
    const root = p[p.length - 1] ?? r.leaf;
    return [
      { label: "LEAF · RECEIPT HASH", hash: p[0] ?? r.leaf },
      ...mid.map((h, i) => ({ label: `HOP ${i + 1} · SIBLING`, hash: h })),
      { label: "ROOT · ANCHORED", hash: root },
    ];
  }
  return p.map((h, i) => ({ label: i === 0 ? "LEAF" : i === p.length - 1 ? "ROOT" : `HOP ${i}`, hash: h }));
}

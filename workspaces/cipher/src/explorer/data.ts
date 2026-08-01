/** Explorer helpers — types come from the SDK ledger; the stream comes from the shared client. */

import type { ExBatch, Receipt } from "../sdk/ledger";
import { AGENTS } from "../app/data";

export type { ExBatch, Receipt, Vote } from "../sdk/ledger";
export { VRF, sh } from "../sdk/ledger";

const NAMES = AGENTS.map((a) => a.name);

export interface ExplorerSearch {
  kind: "receipt" | "batch" | "agent" | "none";
  batch?: ExBatch;
  receipt?: Receipt;
  agent?: string;
  query: string;
}

export function search(q0: string, batches: ExBatch[]): ExplorerSearch {
  const q = q0.trim().toLowerCase();
  if (!q) return { kind: "none", query: q0 };
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
  return { kind: "none", query: q0 };
}

export function agentReceipts(agent: string, batches: ExBatch[]): Receipt[] {
  const out: Receipt[] = [];
  for (const b of batches)
    for (const r of b.receipts)
      if (r.buyer === agent || r.worker === agent) out.push(r);
  return out.slice(0, 8);
}

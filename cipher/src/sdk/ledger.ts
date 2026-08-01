/** Public ledger surface — batch and receipt types shared by all clients. */

import { AGENTS, SPECS, randHex } from "../app/data";

export interface Vote {
  v: string;
  ok: boolean;
}

export interface Receipt {
  id: string;
  spec: string;
  buyer: string;
  worker: string;
  amount: string;
  state: "SETTLED" | "DISPUTED";
  reported: string;
  recomputed: string;
  votes: Vote[];
  epoch: number;
  ms: number;
  at: number;
  leaf: string;
  path: string[]; // [leaf, h1, h2, root]
}

export interface ExBatch {
  id: string;
  epoch: number;
  at: number;
  root: string;
  count: number;
  total: string;
  state: "SETTLING" | "SETTLED";
  receipts: Receipt[];
}

export const VRF = ["vrf:gamma-1", "vrf:delta-4", "vrf:sigma-2"];

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};
export const sh = (s: string) => `0x${fnv(s)}${fnv(s + "::2")}`;

const NAMES = AGENTS.map((a) => a.name);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export function makeReceipt(at: number): Receipt {
  const id = `cent_${randHex(7)}`;
  const disputed = Math.random() < 0.08;
  const spec = pick(SPECS);
  const buyer = pick(NAMES);
  let worker = pick(NAMES);
  while (worker === buyer) worker = pick(NAMES);
  const amount = (3 + Math.random() * 300).toFixed(2);
  const honest = sh(`${id}:${spec}:${amount}`);
  return {
    id,
    spec,
    buyer,
    worker,
    amount,
    state: disputed ? "DISPUTED" : "SETTLED",
    reported: disputed ? sh(`${id}:bogus`) : honest,
    recomputed: honest,
    votes: VRF.map((v, i) => ({ v, ok: !disputed || i !== 0 })),
    epoch: 0,
    ms: 360 + Math.floor(Math.random() * 180),
    at,
    leaf: sh(`${id}:leaf`),
    path: [],
  };
}

let batchSeq = 8911;

export function makeBatch(at: number, settling: boolean, receipts?: Receipt[]): ExBatch {
  const n = batchSeq++;
  const rs = receipts ?? Array.from({ length: 4 + Math.floor(Math.random() * 6) }, () =>
    makeReceipt(at - Math.floor(Math.random() * 20_000)),
  );
  let acc = "genesis";
  for (const r of rs) acc = sh(acc + r.leaf);
  const root = acc;
  for (const r of rs) {
    r.epoch = 88421 + n;
    r.path = [r.leaf, sh(r.leaf + `:${n}:1`), sh(r.leaf + `:${n}:2`), root];
  }
  const totalNum = rs.reduce((s, r) => s + parseFloat(r.amount), 0);
  return {
    id: `batch_${n}`,
    epoch: 88421 + n,
    at,
    root,
    count: rs.length,
    total: totalNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    state: settling ? "SETTLING" : "SETTLED",
    receipts: rs,
  };
}

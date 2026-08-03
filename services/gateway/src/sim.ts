/**
 * Sim driver — the transport-level network model the gateway serves until a
 * real chain exists. Same rules as the frontend's SimTransport, enforced in
 * one place on the server: a 2.8s task cadence, RUNNING → VERIFYING →
 * SETTLED, batch of settled receipts every 4th tick, merkle fold to root.
 */

export interface TaskRow {
  id: string;
  agent: string;
  counterparty: string;
  role: "work" | "buy";
  spec: string;
  amount: string;
  state: "RUNNING" | "VERIFYING" | "SETTLED" | "DISPUTED" | "FAILED";
  at: number;
  hash: string;
}

export interface Vote {
  v: string;
  ok: boolean;
}

export interface ReceiptRow {
  receipt_id: string;
  task_id: string;
  buyer: string;
  worker: string;
  spec: string;
  amount: string;
  reported: string;
  recomputed: string;
  votes: Vote[];
  ms: number;
  epoch: number;
  leaf: string;
}

export interface BatchRowPacket {
  batch_id: string;
  epoch: number;
  root: string;
  count: number;
  total: string;
  state: "SETTLING" | "SETTLED";
  receipts: (ReceiptRow & { path: string[] })[];
}

/* ------------------------------ hashing ---------------------------------- */

const fnv32 = (s: string, seed = 0x811c9dc5): number => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
const hex = (n: number): string => n.toString(16).padStart(8, "0");
export const sh = (s: string): string => `0x${hex(fnv32(s))}${hex(fnv32(s + "::2"))}`;
export const randHex = (n: number): string =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

/* ------------------------------ the sim ---------------------------------- */

const AGENTS = [
  "agent:vector-7",
  "agent:atlas-01",
  "agent:probe-9",
  "agent:helix-3",
  "agent:orbit-2",
  "agent:forge-11",
];
const SPECS = [
  "render.sequence.4k",
  "render.frames.1080",
  "scrape.pricing.daily",
  "scrape.news.hourly",
  "embed.docs.batch",
  "embed.kb.nightly",
  "audit.contract.fast",
];
const VRF = ["vrf:gamma-1", "vrf:delta-4", "vrf:sigma-2"];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export class SimDriver {
  state = {
    tasks: [] as TaskRow[],
    pending: [] as TaskRow[],
    /** Unique across restarts — reusing batch_8911… pollutes durable PG. */
    batchSeq: 9000 + (Date.now() % 1_000_000),
    epoch: 88421,
    tickCount: 0,
  };

  onTask?: (e: TaskRow) => void;
  onBatch?: (b: BatchRowPacket) => void;

  private timer?: NodeJS.Timeout;
  private interval: number;

  constructor(opts: { tickMs?: number } = {}) {
    this.interval = opts.tickMs ?? 2800;
  }

  start(): void {
    this.seed();
    this.emitFirstLoads();
    this.timer = setInterval(() => this.tick(), this.interval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  snapshots(): { tasks: TaskRow[]; batches: BatchRowPacket[] } {
    return { tasks: [...this.state.tasks], batches: this.batches.slice(-12) };
  }

  batches: BatchRowPacket[] = [];

  private seed(): void {
    const now = Date.now();
    for (let i = 12; i >= 1; i--) {
      const t = this.genTask(now - i * 47_000);
      t.state = i <= 2 ? "RUNNING" : i === 3 ? "VERIFYING" : "SETTLED";
      this.state.tasks.push(t);
      if (t.state === "SETTLED") this.state.pending.push(t);
    }
    const f81 = {
      id: "cent_f81c2a0",
      agent: "agent:forge-11",
      counterparty: "agent:orbit-2",
      role: "work" as const,
      spec: "embed.kb.nightly",
      amount: "310.50",
      state: "DISPUTED" as const,
      at: now - 12 * 60_000,
      hash: "0x9af2be…99d4",
    };
    this.state.tasks.unshift(f81);
    for (let i = 3; i >= 0; i--) this.flushBatch(now - (i + 1) * 45_000);
  }

  private emitFirstLoads(): void {
    for (const t of this.state.tasks.slice(0, 6)) this.onTask?.(t);
  }

  private genTask(at: number): TaskRow {
    return {
      id: `cent_${randHex(7)}`,
      agent: `${pick(AGENTS)}`,
      counterparty: `${pick(AGENTS)}`,
      role: Math.random() > 0.45 ? "work" : "buy",
      spec: pick(SPECS),
      amount: (3 + Math.random() * 300).toFixed(2),
      state: "RUNNING",
      at,
      hash: `0x${randHex(6)}…${randHex(4)}`,
    };
  }

  private tick(): void {
    const now = Date.now();
    this.state.tasks = this.state.tasks.map((t) => {
      if (t.state === "RUNNING" && now - t.at > 3_500 && Math.random() < 0.55) {
        const next = { ...t, state: "VERIFYING" as const };
        this.onTask?.(next);
        return next;
      }
      if (t.state === "VERIFYING" && now - t.at > 6_000 && Math.random() < 0.6) {
        const next = { ...t, state: "SETTLED" as const };
        this.state.pending.push(next);
        this.onTask?.(next);
        return next;
      }
      return t;
    });

    if (Math.random() < 0.72) {
      const ev = this.genTask(now);
      this.state.tasks = [ev, ...this.state.tasks].slice(0, 34);
      this.onTask?.(ev);
    }

    this.state.tickCount++;
    if (this.state.tickCount % 4 === 0) this.flushBatch(now);
  }

  private flushBatch(now: number): void {
    // Never emit empty batches — empty root "genesis" breaks indexer reconcile.
    if (this.state.pending.length === 0) return;
    const included = this.state.pending.splice(0, 9);
    const receipts = included.map<ReceiptRow>((t) => {
      const honest = sh(`${t.id}:${t.spec}:${t.amount}`);
      const disputed = false;
      return {
        receipt_id: t.id,
        task_id: t.id,
        buyer: t.counterparty,
        worker: t.agent,
        spec: t.spec,
        amount: t.amount,
        reported: honest,
        recomputed: honest,
        votes: VRF.map((v) => ({ v, ok: true })),
        ms: 360 + Math.floor(Math.random() * 180),
        epoch: this.state.epoch,
        leaf: sh(`${t.id}:leaf`),
      };
    });

    const root = receipts.reduce((acc, r) => sh(acc + r.leaf), "genesis");
    const batch: BatchRowPacket = {
      batch_id: `batch_${this.state.batchSeq++}`,
      epoch: this.state.epoch++,
      root,
      count: receipts.length,
      total: receipts.reduce((s, r) => s + parseFloat(r.amount), 0).toFixed(2),
      state: "SETTLING",
      receipts: receipts.map((r) => ({
        ...r,
        path: [r.leaf, sh(r.leaf + ":1"), sh(r.leaf + ":2"), root],
      })),
    };
    this.batches = [...this.batches.map((b) => ({ ...b, state: "SETTLED" as const })), batch].slice(-12);
    this.onBatch?.(batch);
  }

  settleTask(id: string): TaskRow | undefined {
    const t = this.state.tasks.find((x) => x.id === id);
    return t;
  }
}

/**
 * Transport abstraction — the seam between the typed client and the network.
 * Today: SimTransport (in-browser network). Tomorrow: RpcTransport speaking
 * JSON-RPC + WebSocket with the exact same surface. App code never changes.
 */

import { genEvent, randHash } from "../app/data";
import type { TaskEvent } from "../app/data";
import { makeBatch, VRF, sh } from "./ledger";
import type { ExBatch, Receipt } from "./ledger";

export interface TickDelta {
  earned: number;
  spent: number;
  escrowDelta: number;
}

export type TickCb = (events: TaskEvent[], delta: TickDelta | null) => void;
export type BatchCb = (batch: ExBatch) => void;

export interface Transport {
  kind: "sim" | "rpc";
  start(): void;
  stop(): void;
  setPaused(on: boolean): void;
  events(): TaskEvent[];
  batches(): ExBatch[];
  onTick(cb: TickCb): () => void;
  onBatch(cb: BatchCb): () => void;
  addTask(t: TaskEvent): void;
  setTaskState(id: string, state: TaskEvent["state"]): void;
  poke(): void;
}

const DISPUTED_SEED: Omit<TaskEvent, "at"> = {
  id: "mrc_f81c2a0",
  agent: "agent:forge-11",
  counterparty: "agent:orbit-2",
  role: "work",
  spec: "embed.kb.nightly",
  amount: "310.50",
  state: "DISPUTED",
  hash: "0x9af2be…99d4",
};

export class SimTransport implements Transport {
  kind = "sim" as const;
  private tasks: TaskEvent[] = [];
  private ledger: ExBatch[] = [];
  private pending: TaskEvent[] = []; // settled tasks awaiting batch inclusion
  private tickCbs = new Set<TickCb>();
  private batchCbs = new Set<BatchCb>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private batchEvery: number;
  private tickCount = 0;
  private cap: number;
  private tickMs: number;
  private paused = false;

  constructor(opts: { cap?: number; tickMs?: number; batchEveryTicks?: number } = {}) {
    this.cap = opts.cap ?? 34;
    this.tickMs = opts.tickMs ?? 2800;
    this.batchEvery = opts.batchEveryTicks ?? 4;
  }

  start(): void {
    if (this.timer) return;
    if (this.tasks.length === 0) this.seed();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(on: boolean): void {
    this.paused = on;
  }

  private seed(): void {
    const now = Date.now();
    const items: TaskEvent[] = [{ ...DISPUTED_SEED, at: now - 12 * 60_000 }];
    for (let i = 1; i <= 20; i++) {
      const ev = genEvent(now - i * 47_000);
      ev.at = now - i * 47_000;
      ev.state = i <= 2 ? "RUNNING" : i === 3 ? "VERIFYING" : "SETTLED";
      items.push(ev);
    }
    this.tasks = items.sort((a, b) => b.at - a.at).slice(0, this.cap);
    for (let i = 4; i >= 1; i--) {
      this.ledger.push(makeBatch(now - i * 45_000, false));
    }
  }

  private tick(): void {
    if (this.paused) return;
    const now = Date.now();
    const delta: TickDelta = { earned: 0, spent: 0, escrowDelta: 0 };

    this.tasks = this.tasks.map((t) => {
      if (t.state === "RUNNING" && now - t.at > 3_500 && Math.random() < 0.55) {
        return { ...t, state: "VERIFYING" };
      }
      if (t.state === "VERIFYING" && now - t.at > 6_000 && Math.random() < 0.6) {
        const amt = parseFloat(t.amount);
        if (t.role === "work") delta.earned += amt;
        else delta.spent += amt;
        delta.escrowDelta -= amt;
        const settled = { ...t, state: "SETTLED" as const };
        this.pending.push(settled);
        return settled;
      }
      return t;
    });

    if (Math.random() < 0.72) {
      const ev = genEvent(now);
      delta.escrowDelta += parseFloat(ev.amount);
      this.tasks = [ev, ...this.tasks];
    }
    this.tasks = this.tasks.slice(0, this.cap);

    this.tickCount++;
    if (this.tickCount % this.batchEvery === 0) this.flushBatch(now);
    this.emit(delta);
  }

  private flushBatch(now: number): void {
    if (this.pending.length === 0) return;
    const included = this.pending.slice(0, 9);
    this.pending = this.pending.slice(included.length);
    const receipts: Receipt[] = included.map((t) => {
      const honest = sh(`${t.id}:${t.spec}:${t.amount}`);
      const disputed = t.state === "DISPUTED";
      return {
        id: t.id,
        spec: t.spec,
        buyer: t.counterparty,
        worker: t.agent,
        amount: t.amount,
        state: disputed ? "DISPUTED" : "SETTLED",
        reported: disputed ? sh(`${t.id}:bogus`) : honest,
        recomputed: honest,
        votes: VRF.map((v, i) => ({ v, ok: !disputed || i !== 0 })),
        epoch: 0,
        ms: 360 + Math.floor(Math.random() * 180),
        at: t.at,
        leaf: sh(`${t.id}:leaf`),
        path: [],
      };
    });
    const batch = makeBatch(now, true, receipts);
    this.ledger = [
      ...this.ledger.map((b) => ({ ...b, state: (b.state === "SETTLING" ? "SETTLED" : b.state) as ExBatch["state"] })),
      batch,
    ].slice(-12);
    this.batchCbs.forEach((cb) => cb(batch));
  }

  private emit(delta: TickDelta | null): void {
    this.tickCbs.forEach((cb) => cb([...this.tasks], delta));
  }

  /* ---- public surface ---- */

  events(): TaskEvent[] {
    return [...this.tasks];
  }

  batches(): ExBatch[] {
    return [...this.ledger];
  }

  onTick(cb: TickCb): () => void {
    this.tickCbs.add(cb);
    cb([...this.tasks], null); // hydrate immediately
    return () => this.tickCbs.delete(cb);
  }

  onBatch(cb: BatchCb): () => void {
    this.batchCbs.add(cb);
    return () => this.batchCbs.delete(cb);
  }

  addTask(t: TaskEvent): void {
    this.tasks = [t, ...this.tasks].slice(0, this.cap);
    this.poke();
  }

  setTaskState(id: string, state: TaskEvent["state"]): void {
    this.tasks = this.tasks.map((t) => (t.id === id ? { ...t, state } : t));
    if (state === "SETTLED") {
      const t = this.tasks.find((x) => x.id === id);
      if (t) this.pending.push(t);
    }
    this.poke();
  }

  getTask(id: string): TaskEvent | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  poke(): void {
    this.emit(null);
  }

  /** convenience for legacy consoles */
  currentHash(): string {
    return randHash();
  }
}

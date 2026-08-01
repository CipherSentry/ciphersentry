/**
 * Sim driver — the transport-level network model the gateway serves until a
 * real chain exists. Same rules as the frontend's SimTransport, enforced in
 * one place on the server: a 2.8s task cadence, RUNNING → VERIFYING →
 * SETTLED, batch of settled receipts every 4th tick, merkle fold to root.
 */
/* ------------------------------ hashing ---------------------------------- */
const fnv32 = (s, seed = 0x811c9dc5) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
};
const hex = (n) => n.toString(16).padStart(8, "0");
export const sh = (s) => `0x${hex(fnv32(s))}${hex(fnv32(s + "::2"))}`;
export const randHex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
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
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export class SimDriver {
    state = {
        tasks: [],
        pending: [],
        batchSeq: 8911,
        epoch: 88421,
        tickCount: 0,
    };
    onTask;
    onBatch;
    timer;
    interval;
    constructor(opts = {}) {
        this.interval = opts.tickMs ?? 2800;
    }
    start() {
        this.seed();
        this.emitFirstLoads();
        this.timer = setInterval(() => this.tick(), this.interval);
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
    }
    snapshots() {
        return { tasks: [...this.state.tasks], batches: this.batches.slice(-12) };
    }
    batches = [];
    seed() {
        const now = Date.now();
        for (let i = 12; i >= 1; i--) {
            const t = this.genTask(now - i * 47_000);
            t.state = i <= 2 ? "RUNNING" : i === 3 ? "VERIFYING" : "SETTLED";
            this.state.tasks.push(t);
        }
        const f81 = {
            id: "cent_f81c2a0",
            agent: "agent:forge-11",
            counterparty: "agent:orbit-2",
            role: "work",
            spec: "embed.kb.nightly",
            amount: "310.50",
            state: "DISPUTED",
            at: now - 12 * 60_000,
            hash: "0x9af2be…99d4",
        };
        this.state.tasks.unshift(f81);
        for (let i = 3; i >= 0; i--)
            this.flushBatch(now - (i + 1) * 45_000);
    }
    emitFirstLoads() {
        for (const t of this.state.tasks.slice(0, 6))
            this.onTask?.(t);
    }
    genTask(at) {
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
    tick() {
        const now = Date.now();
        this.state.tasks = this.state.tasks.map((t) => {
            if (t.state === "RUNNING" && now - t.at > 3_500 && Math.random() < 0.55) {
                const next = { ...t, state: "VERIFYING" };
                this.onTask?.(next);
                return next;
            }
            if (t.state === "VERIFYING" && now - t.at > 6_000 && Math.random() < 0.6) {
                const next = { ...t, state: "SETTLED" };
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
        if (this.state.tickCount % 4 === 0)
            this.flushBatch(now);
    }
    flushBatch(now) {
        if (this.state.pending.length === 0 && this.batches.length > 0)
            return;
        const included = this.state.pending.splice(0, 9);
        const receipts = included.map((t) => {
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
        const batch = {
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
        this.batches = [...this.batches.map((b) => ({ ...b, state: "SETTLED" })), batch].slice(-12);
        this.onBatch?.(batch);
    }
    settleTask(id) {
        const t = this.state.tasks.find((x) => x.id === id);
        return t;
    }
}

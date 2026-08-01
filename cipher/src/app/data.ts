/* ---------------- types ---------------- */

export type TaskState = "RUNNING" | "VERIFYING" | "SETTLED" | "DISPUTED" | "FAILED";
export type AgentTier = "T0" | "T1" | "T2" | "T3";

export interface Agent {
  id: string;
  name: string;
  specialty: "RENDER" | "SCRAPE" | "EMBED" | "AUDIT";
  tier: AgentTier;
  trust: number; // 0-100
  success: number; // %
  tasks24h: number;
  earned30d: number;
  rate: number; // USDC per task
  stake: number; // USDC
  status: "ONLINE" | "PAUSED" | "DEGRADED";
  mine: boolean;
  spark: number[];
}

export interface TaskEvent {
  id: string;
  agent: string;
  counterparty: string;
  role: "work" | "buy"; // my agent worked (earned) or bought (spent)
  spec: string;
  amount: string; // USDC
  state: TaskState;
  at: number; // ts
  hash: string;
}

export interface Approval {
  id: string;
  type: "DISPUTE" | "LIMIT";
  ref: string; // task id or agent
  agent: string;
  counterparty?: string;
  amount?: string;
  summary: string;
  usagePct?: number;
  from?: number;
  to?: number;
  at: number;
  expected?: string;
  reported?: string;
}

export interface Batch {
  id: string;
  count: number;
  total: string;
  at: number;
  state: "SETTLING" | "SETTLED";
}

export interface AlertItem {
  id: string;
  sev: "INFO" | "WARN" | "CRIT";
  msg: string;
  ref: string;
  at: number;
}

export interface Limits {
  global: number;
  perAgent: Record<string, number>;
  requireAbove: number;
  autoPause: boolean;
  digest: boolean;
}

/* ---------------- helpers ---------------- */

const HEX = "0123456789abcdef";

export function randHex(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += HEX[Math.floor(Math.random() * 16)];
  return s;
}

export function randHash() {
  return `0x${randHex(6)}…${randHex(4)}`;
}

export function timeAgo(at: number, now: number) {
  const s = Math.max(1, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/* ---------------- seeds ---------------- */

export const AGENTS: Agent[] = [
  { id: "vector-7", name: "agent:vector-7", specialty: "RENDER", tier: "T2", trust: 96, success: 99.2, tasks24h: 34, earned30d: 1284.2, rate: 4.8, stake: 2600, status: "ONLINE", mine: true, spark: [4,9,7,12,10,14,11,16,14,19,17,22] },
  { id: "probe-9", name: "agent:probe-9", specialty: "SCRAPE", tier: "T1", trust: 88, success: 97.8, tasks24h: 112, earned30d: 640.1, rate: 0.9, stake: 600, status: "ONLINE", mine: true, spark: [6,8,5,9,8,11,9,12,10,13,12,15] },
  { id: "forge-11", name: "agent:forge-11", specialty: "EMBED", tier: "T1", trust: 91, success: 98.6, tasks24h: 57, earned30d: 402.8, rate: 1.6, stake: 850, status: "DEGRADED", mine: true, spark: [8,12,10,9,11,8,7,9,6,7,5,6] },
  { id: "atlas-01", name: "agent:atlas-01", specialty: "AUDIT", tier: "T3", trust: 99, success: 99.9, tasks24h: 210, earned30d: 5210.4, rate: 6.2, stake: 12000, status: "ONLINE", mine: false, spark: [10,14,13,16,18,17,21,23,22,26,25,29] },
  { id: "helix-3", name: "agent:helix-3", specialty: "EMBED", tier: "T2", trust: 94, success: 99.0, tasks24h: 88, earned30d: 1522.8, rate: 2.4, stake: 3100, status: "ONLINE", mine: false, spark: [5,8,7,10,9,12,14,13,15,17,16,19] },
  { id: "orbit-2", name: "agent:orbit-2", specialty: "SCRAPE", tier: "T1", trust: 86, success: 97.1, tasks24h: 64, earned30d: 512.6, rate: 1.1, stake: 700, status: "ONLINE", mine: false, spark: [7,6,8,7,9,8,10,9,8,11,10,12] },
  { id: "nomad-6", name: "agent:nomad-6", specialty: "RENDER", tier: "T1", trust: 89, success: 98.1, tasks24h: 21, earned30d: 388.9, rate: 3.9, stake: 500, status: "PAUSED", mine: false, spark: [4,6,5,8,7,6,9,8,10,9,11,10] },
  { id: "antenna-4", name: "agent:antenna-4", specialty: "AUDIT", tier: "T2", trust: 93, success: 98.9, tasks24h: 45, earned30d: 976.3, rate: 5.5, stake: 2400, status: "ONLINE", mine: false, spark: [9,11,10,13,12,15,14,13,16,18,17,20] },
];

export const SPECS = [
  "render.sequence.4k",
  "render.frames.1080",
  "scrape.pricing.daily",
  "scrape.news.hourly",
  "embed.docs.batch",
  "embed.kb.nightly",
  "audit.contract.fast",
];

const MINE = AGENTS.filter((a) => a.mine);
const EXTERNAL = AGENTS.filter((a) => !a.mine);

export function genEvent(now: number): TaskEvent {
  const agent = MINE[Math.floor(Math.random() * MINE.length)];
  const cp = EXTERNAL[Math.floor(Math.random() * EXTERNAL.length)];
  const spec = SPECS[Math.floor(Math.random() * SPECS.length)];
  const role = Math.random() > 0.45 ? "work" : "buy";
  return {
    id: `mrc_${randHex(7)}`,
    agent: agent.name,
    counterparty: cp.name,
    role,
    spec,
    amount: (3 + Math.random() * 300).toFixed(2),
    state: "RUNNING",
    at: now,
    hash: randHash(),
  };
}

export function seedFeed(now: number): TaskEvent[] {
  const mk = (min: number, state: TaskState): TaskEvent => ({
    ...genEvent(now - min * 60_000),
    state,
    at: now - min * 60_000,
  });
  return [
    {
      id: "mrc_f81c2a0",
      agent: "agent:forge-11",
      counterparty: "agent:orbit-2",
      role: "work",
      spec: "embed.kb.nightly",
      amount: "310.50",
      state: "DISPUTED",
      at: now - 12 * 60_000,
      hash: "0x9af2be…99d4",
    },
    mk(2, "RUNNING"),
    mk(3, "VERIFYING"),
    mk(6, "SETTLED"),
    mk(9, "SETTLED"),
    mk(14, "SETTLED"),
    mk(18, "FAILED"),
  ];
}

export function seedApprovals(now: number): Approval[] {
  return [
    {
      id: "ap_01",
      type: "DISPUTE",
      ref: "mrc_f81c2a0",
      agent: "agent:forge-11",
      counterparty: "agent:orbit-2",
      amount: "310.50",
      summary: "Verifier quorum mismatch (2/3) on output hash",
      at: now - 4 * 60_000,
      expected: "0x9af2be…77c1",
      reported: "0x9af2be…99d4",
    },
    {
      id: "ap_02",
      type: "LIMIT",
      ref: "agent:probe-9",
      agent: "agent:probe-9",
      summary: "Requests daily limit raise 250 → 500 USDC",
      usagePct: 92,
      from: 250,
      to: 500,
      at: now - 31 * 60_000,
    },
  ];
}

export function seedBatches(now: number): Batch[] {
  return [
    { id: "batch_8843", count: 6, total: "214.00", at: now - 40_000, state: "SETTLING" },
    { id: "batch_8842", count: 14, total: "612.40", at: now - 4 * 60_000, state: "SETTLED" },
    { id: "batch_8841", count: 9, total: "388.10", at: now - 22 * 60_000, state: "SETTLED" },
    { id: "batch_8840", count: 21, total: "1,240.75", at: now - 58 * 60_000, state: "SETTLED" },
  ];
}

export function seedAlerts(now: number): AlertItem[] {
  return [
    { id: "al_1", sev: "CRIT", msg: "Dispute opened — verifier quorum mismatch", ref: "mrc_f81c2a0", at: now - 4 * 60_000 },
    { id: "al_2", sev: "WARN", msg: "agent:probe-9 at 92% of daily spend limit", ref: "agent:probe-9", at: now - 31 * 60_000 },
    { id: "al_3", sev: "WARN", msg: "agent:forge-11 success rate dipped below 99%", ref: "agent:forge-11", at: now - 2 * 3_600_000 },
    { id: "al_4", sev: "INFO", msg: "Settlement batch_8842 finalized — 14 tasks", ref: "batch_8842", at: now - 4 * 60_000 },
    { id: "al_5", sev: "INFO", msg: "Staking rewards accrued — 3.12 USDC", ref: "stake", at: now - 7 * 3_600_000 },
  ];
}

/* ---------------- live simulation step ---------------- */

export interface SimResult {
  events: TaskEvent[];
  earned: number;
  spent: number;
  escrowDelta: number;
}

export function stepSim(events: TaskEvent[], now: number, cap = 16): SimResult {
  let earned = 0;
  let spent = 0;
  let escrowDelta = 0;

  let next = events.map<TaskEvent>((ev) => {
    if (ev.state === "RUNNING" && now - ev.at > 3_500 && Math.random() < 0.55) {
      return { ...ev, state: "VERIFYING" };
    }
    if (ev.state === "VERIFYING" && now - ev.at > 6_000 && Math.random() < 0.6) {
      const amt = parseFloat(ev.amount);
      if (ev.role === "work") earned += amt;
      else spent += amt;
      escrowDelta -= amt;
      return { ...ev, state: "SETTLED" };
    }
    return ev;
  });

  if (Math.random() < 0.72) {
    const ev = genEvent(now);
    escrowDelta += parseFloat(ev.amount);
    next = [ev, ...next];
  }

  return { events: next.slice(0, cap), earned, spent, escrowDelta };
}

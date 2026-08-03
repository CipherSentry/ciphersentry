/**
 * Durable fraud case store — Redis when available, memory otherwise.
 *
 * Keys:
 *   fraud:v1:case:{taskId}  — JSON ChallengeCase
 *   fraud:v1:nonce:{taskId} — last consumed ruling nonce
 *   fraud:v1:index          — JSON string[] of taskIds
 *   fraud:v1:simblock       — simulated/chain block height
 */

import type { Kv } from "./kv.ts";
import type { ChallengeCase } from "./fraud-proof.ts";

const PREFIX = "fraud:v1";
const INDEX_KEY = `${PREFIX}:index`;
const SIM_KEY = `${PREFIX}:simblock`;
const caseKey = (id: string) => `${PREFIX}:case:${id}`;
const nonceKey = (id: string) => `${PREFIX}:nonce:${id}`;

/** TTL for resolved/defaulted cases (30d). Open cases: no TTL. */
const RESOLVED_TTL_SEC = 30 * 24 * 3600;

export interface FraudSnapshot {
  cases: ChallengeCase[];
  nonces: Record<string, number>;
  simBlock: number;
}

export class FraudStore {
  constructor(private kv: Kv | null) {}

  get durable(): boolean {
    return this.kv?.mode === "redis";
  }

  get backend(): "redis" | "memory" | "none" {
    if (!this.kv) return "none";
    return this.kv.mode;
  }

  async load(): Promise<FraudSnapshot> {
    if (!this.kv) return { cases: [], nonces: {}, simBlock: 0 };
    const rawIndex = await this.kv.get(INDEX_KEY);
    let ids: string[] = [];
    try {
      ids = rawIndex ? (JSON.parse(rawIndex) as string[]) : [];
    } catch {
      ids = [];
    }
    const cases: ChallengeCase[] = [];
    const nonces: Record<string, number> = {};
    for (const id of ids) {
      const raw = await this.kv.get(caseKey(id));
      if (!raw) continue;
      try {
        cases.push(JSON.parse(raw) as ChallengeCase);
      } catch {
        /* skip corrupt */
      }
      const n = await this.kv.get(nonceKey(id));
      if (n != null) {
        const num = parseInt(n, 10);
        if (Number.isFinite(num)) nonces[id] = num;
      }
    }
    const simRaw = await this.kv.get(SIM_KEY);
    const simBlock = simRaw ? parseInt(simRaw, 10) || 0 : 0;
    return { cases, nonces, simBlock };
  }

  async saveCase(c: ChallengeCase): Promise<void> {
    if (!this.kv) return;
    const ttl =
      c.status === "RESOLVED" || c.status === "DEFAULTED" || c.status === "EXPIRED"
        ? RESOLVED_TTL_SEC
        : undefined;
    await this.kv.set(caseKey(c.taskId), JSON.stringify(c), ttl);
    await this.addIndex(c.taskId);
    if (c.rulingNonce != null) {
      await this.kv.set(nonceKey(c.taskId), String(c.rulingNonce), ttl);
    }
  }

  async saveNonce(taskId: string, n: number): Promise<void> {
    if (!this.kv) return;
    await this.kv.set(nonceKey(taskId), String(n));
  }

  async saveSimBlock(n: number): Promise<void> {
    if (!this.kv) return;
    await this.kv.set(SIM_KEY, String(n));
  }

  private async addIndex(taskId: string): Promise<void> {
    if (!this.kv) return;
    const raw = await this.kv.get(INDEX_KEY);
    let ids: string[] = [];
    try {
      ids = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      ids = [];
    }
    if (!ids.includes(taskId)) {
      ids.push(taskId);
      // cap index growth
      if (ids.length > 5000) ids = ids.slice(-4000);
      await this.kv.set(INDEX_KEY, JSON.stringify(ids));
    }
  }
}

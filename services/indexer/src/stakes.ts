/**
 * Agent stake (s_i) — live from gateway registry / verifier bonds.
 *
 * Trust formula term #0: 50·log2(1 + s_i).
 * Whitepaper §5 fraud: s_i ← 0.95·s_i on proven fault.
 *
 * Fallback seeds mirror gateway REGISTRY + foundation bonds when RPC is cold.
 */

/** USDC stake at risk for known agents (gateway REGISTRY parity) — cold fallback. */
export const AGENT_SEED_STAKES: Readonly<Record<string, number>> = {
  "agent:vector-7": 2600,
  "agent:atlas-01": 12000,
  "agent:helix-3": 3100,
  "agent:probe-9": 600,
  "agent:orbit-2": 700,
  "agent:forge-11": 850,
};

/** CENT bond floor for known foundation verifiers (B1 seats). */
export const VERIFIER_SEED_BONDS: Readonly<Record<string, number>> = {
  "vrf:gamma-1": 40_000,
  "vrf:delta-4": 35_000,
  "vrf:sigma-2": 30_000,
};

/** s_i for agent_id — static seed only (tests / offline). Prefer StakeCache. */
export function seedStake(agentId: string): number {
  if (AGENT_SEED_STAKES[agentId] != null) return AGENT_SEED_STAKES[agentId]!;
  if (VERIFIER_SEED_BONDS[agentId] != null) return VERIFIER_SEED_BONDS[agentId]!;
  return 0;
}

/** Proven-fault stake cut: s_i ← 0.95·s_i */
export const FRAUD_STAKE_FACTOR = 0.95;

export function applyFraudStakeCut(stake: number): number {
  const s = Math.max(0, Number(stake) || 0);
  return Math.floor(s * FRAUD_STAKE_FACTOR * 100) / 100;
}

export interface StakeCacheOpts {
  gatewayUrl?: string;
  /** Refresh interval ms. 0 = no auto refresh. Default 30_000. */
  refreshMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Live stake SoR mirror — registry.query + node.info verifiers.
 * Mutations (fraud slash) live in this process until next refresh.
 */
export class StakeCache {
  private live = new Map<string, number>();
  private local = new Map<string, number>(); // fraud cuts / overrides
  private gatewayUrl: string;
  private fetchImpl: typeof fetch;
  private timer?: ReturnType<typeof setInterval>;
  lastRefresh = 0;
  lastError: string | null = null;

  constructor(opts: StakeCacheOpts = {}) {
    this.gatewayUrl = (opts.gatewayUrl ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8080").replace(
      /\/$/,
      "",
    );
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const ms = opts.refreshMs ?? Number(process.env.STAKE_REFRESH_MS ?? 30_000);
    if (ms > 0) {
      this.timer = setInterval(() => void this.refresh(), ms);
      if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
    }
  }

  /** Effective s_i: local override > live registry > seed. */
  stakeOf(agentId: string): number {
    if (this.local.has(agentId)) return this.local.get(agentId)!;
    if (this.live.has(agentId)) return this.live.get(agentId)!;
    return seedStake(agentId);
  }

  /** Whitepaper proven fault: s_i ← 0.95·s_i. Returns new stake. */
  slashFraud(agentId: string): number {
    const cur = this.stakeOf(agentId);
    const next = applyFraudStakeCut(cur);
    this.local.set(agentId, next);
    return next;
  }

  /** Collusion: s_i ← 0 */
  zeroStake(agentId: string): number {
    this.local.set(agentId, 0);
    return 0;
  }

  async refresh(): Promise<{ agents: number; ok: boolean }> {
    try {
      const rows = await this.rpcRegistry();
      for (const r of rows) {
        if (r.id && Number.isFinite(r.stake)) this.live.set(r.id, r.stake);
      }
      const bonds = await this.rpcBonds().catch(() => [] as { id: string; bond: number }[]);
      for (const b of bonds) {
        if (b.id && b.bond > 0) this.live.set(b.id, b.bond);
      }
      this.lastRefresh = Date.now();
      this.lastError = null;
      return { agents: this.live.size, ok: true };
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return { agents: this.live.size, ok: false };
    }
  }

  private async rpcRegistry(): Promise<{ id: string; stake: number }[]> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "registry.query",
        params: { filter: {} },
      }),
    });
    if (!res.ok) throw new Error(`registry.query HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: { id: string; stake: number }[];
      error?: { message: string };
    };
    if (body.error) throw new Error(body.error.message);
    const rows = Array.isArray(body.result) ? body.result : [];
    return rows.map((r) => ({
      id: String((r as { id?: string }).id ?? ""),
      stake: Number((r as { stake?: number }).stake) || 0,
    })).filter((r) => r.id);
  }

  /** registry.list → verifier bonds as s_i for vrf:* seats. */
  private async rpcBonds(): Promise<{ id: string; bond: number }[]> {
    const res = await this.fetchImpl(`${this.gatewayUrl}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "registry.list",
        params: {},
      }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      result?: { verifiers?: { id?: string; bond?: number }[] };
    };
    const raw = body.result?.verifiers;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => ({
        id: String(r.id ?? ""),
        bond: Number(r.bond) || 0,
      }))
      .filter((r) => r.id && r.bond > 0);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Process-wide cache (server boot wires GATEWAY_URL). */
let shared: StakeCache | null = null;

export function getStakeCache(): StakeCache {
  if (!shared) shared = new StakeCache();
  return shared;
}

export function setStakeCache(c: StakeCache | null): void {
  shared?.stop();
  shared = c;
}

/** Resolve s_i via shared cache or seed. */
export function liveStake(agentId: string): number {
  return shared ? shared.stakeOf(agentId) : seedStake(agentId);
}

/**
 * Edge gateway auth — ed25519 challenge/response + stake-keyed sessions.
 *
 * Wire:
 *   auth.challenge { pubkey } → { challenge_id, nonce, expires_at, message }
 *   auth.session   { challenge_id, pubkey, signature, agent_id? }
 *                → { token, agent_id, stake, rpm, expires_at }
 *   auth.whoami    (Authorization: Bearer <token>) → session
 *
 * Signature message (UTF-8):
 *   cent.auth.v1|<challenge_id>|<nonce_hex>|<pubkey_hex>
 *
 * AUTH_REQUIRED=1 → mutating RPC methods need a live session.
 * Rate limits always on (anonymous IP + authenticated stake tiers).
 */

import { createPublicKey, randomBytes, verify } from "node:crypto";
import type { Kv } from "./kv.ts";

export const AUTH_PREFIX = "cent.auth.v1";

export interface Session {
  token: string;
  pubkey: string;
  agentId: string;
  stake: number;
  rpm: number;
  expiresAt: number;
}

export interface Challenge {
  id: string;
  nonce: string;
  pubkey: string;
  expiresAt: number;
}

export type StakeLookup = (agentId: string, pubkey: string) => number;

/** Methods that stay public even when AUTH_REQUIRED=1. */
export const PUBLIC_METHODS = new Set([
  "auth.challenge",
  "auth.session",
  "auth.whoami",
  "registry.query",
  "registry.list",
  "node.info",
  "events.subscribe",
  "batch.info",
  "batch.pending",
  "fraud.list",
  "fraud.of",
  "fraud.info",
  "epoch.info",
  "epoch.elect",
  "accuracy.of",
  "accuracy.list",
  "accrual.summary",
  "accrual.balance",
]);

export function isPublicMethod(method: string): boolean {
  return PUBLIC_METHODS.has(method);
}

/** RPM from stake: base 30 + min(270, floor(stake/40)). Anon uses base only. */
export function rpmForStake(stake: number): number {
  const s = Math.max(0, stake);
  return 30 + Math.min(270, Math.floor(s / 40));
}

export function authMessage(challengeId: string, nonce: string, pubkey: string): string {
  return `${AUTH_PREFIX}|${challengeId}|${nonce}|${pubkey.toLowerCase()}`;
}

/** Verify ed25519 over UTF-8 message. pubkey/sig hex (with or without 0x). */
export function verifyEd25519(pubkeyHex: string, message: string, sigHex: string): boolean {
  try {
    const pk = Buffer.from(strip0x(pubkeyHex), "hex");
    const sig = Buffer.from(strip0x(sigHex), "hex");
    if (pk.length !== 32 || sig.length !== 64) return false;
    // SPKI DER wrapper for raw Ed25519 public key
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}

function strip0x(h: string): string {
  return h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
}

function hex(n = 16): string {
  return randomBytes(n).toString("hex");
}

export class AuthService {
  private challengeTtl = Number(process.env.AUTH_CHALLENGE_TTL_SEC ?? 60);
  private sessionTtl = Number(process.env.AUTH_SESSION_TTL_SEC ?? 3600);

  constructor(
    private kv: Kv,
    private stakeOf: StakeLookup,
  ) {}

  async issueChallenge(pubkeyRaw: string): Promise<Challenge | { error: string }> {
    const pubkey = strip0x(pubkeyRaw).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return { error: "pubkey must be 32-byte ed25519 hex" };
    const id = `ch_${hex(8)}`;
    const nonce = hex(16);
    const expiresAt = Date.now() + this.challengeTtl * 1000;
    const c: Challenge = { id, nonce, pubkey, expiresAt };
    await this.kv.set(`auth:ch:${id}`, JSON.stringify(c), this.challengeTtl);
    return c;
  }

  async openSession(params: {
    challenge_id: string;
    pubkey: string;
    signature: string;
    agent_id?: string;
  }): Promise<Session | { error: string }> {
    const pubkey = strip0x(params.pubkey).toLowerCase();
    const raw = await this.kv.get(`auth:ch:${params.challenge_id}`);
    if (!raw) return { error: "challenge expired or unknown" };
    const ch = JSON.parse(raw) as Challenge;
    if (ch.pubkey !== pubkey) return { error: "pubkey mismatch" };
    if (Date.now() > ch.expiresAt) return { error: "challenge expired" };

    const msg = authMessage(ch.id, ch.nonce, pubkey);
    if (!verifyEd25519(pubkey, msg, params.signature)) return { error: "invalid signature" };

    await this.kv.del(`auth:ch:${params.challenge_id}`);

    const agentId = String(params.agent_id ?? `pk:${pubkey.slice(0, 12)}`);
    const stake = this.stakeOf(agentId, pubkey);
    const rpm = rpmForStake(stake);
    const token = hex(24);
    const expiresAt = Date.now() + this.sessionTtl * 1000;
    const session: Session = { token, pubkey, agentId, stake, rpm, expiresAt };
    await this.kv.set(`auth:sess:${token}`, JSON.stringify(session), this.sessionTtl);
    return session;
  }

  async sessionOf(token: string | undefined | null): Promise<Session | null> {
    if (!token) return null;
    const t = token.replace(/^Bearer\s+/i, "").trim();
    if (!t) return null;
    const raw = await this.kv.get(`auth:sess:${t}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (Date.now() > s.expiresAt) {
      await this.kv.del(`auth:sess:${t}`);
      return null;
    }
    return s;
  }
}

/* --------------------------- rate limiting -------------------------------- */

export class RateLimiter {
  constructor(private kv: Kv) {}

  /**
   * Returns null if allowed, or error message if capped.
   * Window: 60s fixed. Keyed by session token or anon:ip.
   */
  async check(opts: { key: string; rpm: number }): Promise<string | null> {
    const window = Math.floor(Date.now() / 60_000);
    const k = `rl:${opts.key}:${window}`;
    const n = await this.kv.incr(k, 120);
    if (n > opts.rpm) return `rate limit ${opts.rpm}/min exceeded`;
    return null;
  }
}

export function makeStakeLookup(
  registry: { id: string; stake: number }[],
  poolStake?: (id: string) => number | undefined,
): StakeLookup {
  const map = new Map(registry.map((r) => [r.id, r.stake]));
  return (agentId, _pubkey) => {
    if (map.has(agentId)) return map.get(agentId)!;
    const p = poolStake?.(agentId);
    if (p != null && p > 0) return p;
    // unbound pubkey sessions get anonymous floor stake
    if (agentId.startsWith("pk:")) return 0;
    return 0;
  };
}

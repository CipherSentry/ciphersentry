/**
 * Access-request collector — landing "Request Access" + optional waitlist entries.
 *
 * Storage: single JSON list in Kv (Redis when REDIS_URL set, else memory).
 *   POST /access-requests  — public (rate-limited)
 *   GET  /access-requests  — ops only (Bearer ACCESS_OPS_TOKEN)
 */

import type { Kv } from "./kv.ts";

const LIST_KEY = "access:requests";
const MAX_KEEP = Number(process.env.ACCESS_MAX_KEEP ?? 5000);
const MAX_HANDLE = 64;
const MAX_EMAIL = 160;
const MAX_USE_CASE = 2000;
const MAX_SIG = 256;
const MAX_PUBKEY = 160;

export type AccessKind = "access" | "verifier_waitlist";

export interface AccessRequest {
  id: string;
  queue: number;
  kind: AccessKind;
  handle: string;
  email: string;
  role: string;
  rail: string;
  use_case?: string;
  /** optional device-key proof from the browser */
  sig?: string;
  pubkey?: string;
  fp?: string;
  alg?: string;
  at: number;
  ip?: string;
}

export interface AccessSubmitBody {
  handle?: unknown;
  email?: unknown;
  role?: unknown;
  rail?: unknown;
  use_case?: unknown;
  useCase?: unknown;
  kind?: unknown;
  sig?: unknown;
  pubkey?: unknown;
  fp?: unknown;
  alg?: unknown;
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isEmail(s: string): boolean {
  return s.length >= 5 && s.includes("@") && !s.includes(" ") && s.length <= MAX_EMAIL;
}

export class AccessRequestStore {
  constructor(private kv: Kv) {}

  async list(limit = 100): Promise<AccessRequest[]> {
    const all = await this.load();
    const n = Math.min(Math.max(1, limit), 500);
    return all.slice(0, n);
  }

  async count(): Promise<number> {
    return (await this.load()).length;
  }

  async submit(raw: AccessSubmitBody, meta?: { ip?: string }): Promise<AccessRequest | { error: string }> {
    const handle = str(raw.handle, MAX_HANDLE);
    const email = str(raw.email, MAX_EMAIL).toLowerCase();
    const role = str(raw.role, 40) || "DEVELOPER";
    const rail = str(raw.rail, 40) || "BASE MAINNET";
    const useCase = str(raw.use_case ?? raw.useCase, MAX_USE_CASE);
    const kindRaw = str(raw.kind, 32).toLowerCase().replace(/-/g, "_");
    const kind: AccessKind = kindRaw === "verifier_waitlist" ? "verifier_waitlist" : "access";

    if (handle.length < 2) return { error: "handle required (min 2 chars)" };
    // access requests need a contact; waitlist may be handle-only (device key)
    if (kind === "access" && !isEmail(email)) return { error: "valid email required" };
    if (email && !isEmail(email)) return { error: "invalid email" };

    const all = await this.load();
    const queue = all.length + 1;
    const id = `ar_${Date.now().toString(36)}_${queue.toString(36)}`;
    const row: AccessRequest = {
      id,
      queue,
      kind,
      handle,
      email,
      role,
      rail,
      use_case: useCase || undefined,
      sig: str(raw.sig, MAX_SIG) || undefined,
      pubkey: str(raw.pubkey, MAX_PUBKEY) || undefined,
      fp: str(raw.fp, 48) || undefined,
      alg: str(raw.alg, 48) || undefined,
      at: Date.now(),
      ip: meta?.ip,
    };

    all.unshift(row);
    if (all.length > MAX_KEEP) all.length = MAX_KEEP;
    await this.kv.set(LIST_KEY, JSON.stringify(all));
    return row;
  }

  private async load(): Promise<AccessRequest[]> {
    const raw = await this.kv.get(LIST_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as AccessRequest[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

/** Constant-time-ish compare for ops bearer tokens. */
export function opsTokenOk(header: string | undefined | null, expected: string | undefined): boolean {
  if (!expected || !header) return false;
  const t = header.replace(/^Bearer\s+/i, "").trim();
  if (!t || t.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < t.length; i++) diff |= t.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

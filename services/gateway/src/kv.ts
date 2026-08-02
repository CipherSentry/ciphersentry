/**
 * Key-value store — memory always; Redis/Valkey when REDIS_URL is set.
 * Used for auth sessions, challenges, and stake-keyed rate limits.
 */

import net from "node:net";

export interface Kv {
  readonly mode: "memory" | "redis";
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic incr; returns new value. Sets TTL on first hit if provided. */
  incr(key: string, ttlSec?: number): Promise<number>;
  close(): Promise<void>;
}

/* ------------------------------ memory ------------------------------------ */

export class MemoryKv implements Kv {
  readonly mode = "memory" as const;
  private store = new Map<string, { v: string; exp?: number }>();

  private alive(key: string): { v: string; exp?: number } | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.exp != null && Date.now() > e.exp) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key)?.v ?? null;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.store.set(key, {
      v: value,
      exp: ttlSec != null ? Date.now() + ttlSec * 1000 : undefined,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlSec?: number): Promise<number> {
    const cur = this.alive(key);
    const n = (cur ? parseInt(cur.v, 10) || 0 : 0) + 1;
    const exp = cur?.exp ?? (ttlSec != null ? Date.now() + ttlSec * 1000 : undefined);
    this.store.set(key, { v: String(n), exp });
    return n;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

/* ------------------------------ redis ------------------------------------- */

/** Minimal RESP client (GET/SET/DEL/INCR/EXPIRE/TTL) — no extra deps. */
export class RedisKv implements Kv {
  readonly mode = "redis" as const;
  private sock: net.Socket | null = null;
  private buf = Buffer.alloc(0);
  private waiters: Array<{ resolve: (v: string | null) => void; reject: (e: Error) => void }> = [];
  private connecting: Promise<void> | null = null;

  constructor(
    private host: string,
    private port: number,
  ) {}

  static fromUrl(url: string): RedisKv {
    const u = new URL(url);
    return new RedisKv(u.hostname || "127.0.0.1", Number(u.port || 6379));
  }

  private ensure(): Promise<void> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port }, () => {
        this.sock = s;
        this.connecting = null;
        resolve();
      });
      s.on("data", (chunk) => this.onData(chunk));
      s.on("error", (e) => {
        this.connecting = null;
        const err = e instanceof Error ? e : new Error(String(e));
        for (const w of this.waiters.splice(0)) w.reject(err);
        reject(err);
      });
      s.on("close", () => {
        this.sock = null;
      });
    });
    return this.connecting;
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.waiters.length) {
      const parsed = tryParseResp(this.buf);
      if (!parsed) break;
      this.buf = parsed.rest;
      const w = this.waiters.shift()!;
      if (parsed.err) w.reject(new Error(parsed.err));
      else w.resolve(parsed.value);
    }
  }

  private async cmd(...parts: string[]): Promise<string | null> {
    await this.ensure();
    const payload = encodeResp(parts);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.sock!.write(payload);
    });
  }

  async get(key: string): Promise<string | null> {
    return this.cmd("GET", key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec != null) await this.cmd("SET", key, value, "EX", String(ttlSec));
    else await this.cmd("SET", key, value);
  }

  async del(key: string): Promise<void> {
    await this.cmd("DEL", key);
  }

  async incr(key: string, ttlSec?: number): Promise<number> {
    const raw = await this.cmd("INCR", key);
    const n = parseInt(raw ?? "0", 10) || 0;
    if (ttlSec != null && n === 1) await this.cmd("EXPIRE", key, String(ttlSec));
    return n;
  }

  async close(): Promise<void> {
    this.sock?.destroy();
    this.sock = null;
  }
}

function encodeResp(parts: string[]): string {
  let out = `*${parts.length}\r\n`;
  for (const p of parts) out += `$${Buffer.byteLength(p)}\r\n${p}\r\n`;
  return out;
}

function tryParseResp(buf: Buffer): { value: string | null; err?: string; rest: Buffer } | null {
  if (buf.length < 3) return null;
  const t = String.fromCharCode(buf[0]!);
  if (t === "+" || t === "-" || t === ":") {
    const end = buf.indexOf("\r\n");
    if (end < 0) return null;
    const line = buf.subarray(1, end).toString("utf8");
    const rest = buf.subarray(end + 2);
    if (t === "-") return { value: null, err: line, rest };
    return { value: line, rest };
  }
  if (t === "$") {
    const end = buf.indexOf("\r\n");
    if (end < 0) return null;
    const len = parseInt(buf.subarray(1, end).toString("utf8"), 10);
    if (len < 0) return { value: null, rest: buf.subarray(end + 2) };
    const start = end + 2;
    const total = start + len + 2;
    if (buf.length < total) return null;
    const value = buf.subarray(start, start + len).toString("utf8");
    return { value, rest: buf.subarray(total) };
  }
  // unexpected bulk — drain one line
  const end = buf.indexOf("\r\n");
  if (end < 0) return null;
  return { value: null, rest: buf.subarray(end + 2) };
}

export async function createKv(url?: string | null): Promise<Kv> {
  const u = (url ?? process.env.REDIS_URL ?? "").trim();
  if (!u) return new MemoryKv();
  try {
    const kv = RedisKv.fromUrl(u);
    await kv.set("cs:kv:ping", "1", 5);
    const v = await kv.get("cs:kv:ping");
    if (v !== "1") throw new Error("ping mismatch");
    return kv;
  } catch (e) {
    console.warn(
      `[kv] Redis unavailable (${u}): ${e instanceof Error ? e.message : e} — using memory`,
    );
    return new MemoryKv();
  }
}

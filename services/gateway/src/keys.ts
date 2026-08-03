/**
 * B7 key custody — resolve signing keys from env or *_FILE mounts.
 *
 * Prefer file mounts in prod (K8s secret / docker secret / vault agent):
 *   PROTOCOL_KEY_FILE=/run/secrets/protocol_key
 *   BATCHER_KEY_1_FILE=…  BATCHER_KEY_2_FILE=…  BATCHER_KEY_3_FILE=…
 *   RULER_KEY_FILE=…
 *
 * Env vars still work for local/dev. Never log resolved material.
 */

import { readFileSync } from "node:fs";

export function normalizeKey(raw: string): string {
  const t = raw.trim().replace(/\s+/g, "");
  if (!t) return t;
  if (t.startsWith("0x") || t.startsWith("0X")) return `0x${t.slice(2)}`;
  if (/^[0-9a-fA-F]{64}$/.test(t)) return `0x${t}`;
  return t;
}

/** First hit wins: NAME_FILE (file contents) then NAME (env). */
export function resolveSecret(...names: string[]): string | null {
  for (const name of names) {
    const file = process.env[`${name}_FILE`]?.trim();
    if (file) {
      let body: string;
      try {
        body = readFileSync(file, "utf8");
      } catch (e) {
        throw new Error(
          `[keys] ${name}_FILE unreadable (${file}): ${e instanceof Error ? e.message : e}`,
        );
      }
      const v = normalizeKey(body);
      if (v) return v;
      throw new Error(`[keys] ${name}_FILE empty: ${file}`);
    }
    const env = process.env[name]?.trim();
    if (env) return normalizeKey(env);
  }
  return null;
}

/** CS_ENV=production | prod | B7 → strict ops (redis + nats + auth). */
export function isProdOps(): boolean {
  const env = (process.env.CS_ENV ?? process.env.NODE_ENV ?? "").toLowerCase().trim();
  if (env === "production" || env === "prod") return true;
  const b7 = (process.env.B7 ?? process.env.B7_PROD ?? "").toLowerCase().trim();
  // accept 1/true/yes — Fly secrets and shell can leave trailing whitespace
  if (b7 === "1" || b7 === "true" || b7 === "yes") return true;
  // public single-machine B7: redis+nats required together implies ops mode
  const redisReq = (process.env.REDIS_REQUIRE ?? "").trim() === "1";
  const natsReq = (process.env.NATS_REQUIRE ?? "").trim() === "1";
  if (redisReq && natsReq) return true;
  return false;
}

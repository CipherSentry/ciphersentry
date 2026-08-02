/**
 * WS event signing — architecture §6 "signed as they fire".
 *
 * Message (UTF-8):
 *   cent.event.v1|<topic>|<canonical(data)>|<ts>
 *
 * Keys: EVENT_SIGNING_SEED = 32-byte ed25519 seed hex (optional).
 * Without seed, an ephemeral key is generated at boot (pubkey in health).
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export const EVENT_PREFIX = "cent.event.v1";

/** Canonical JSON: sorted keys at every depth (matches SDK canonicalize). */
export function canonicalize(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
      .join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return JSON.stringify(value) ?? "null";
}

export function eventMessage(topic: string, data: unknown, ts: number): string {
  return `${EVENT_PREFIX}|${topic}|${canonicalize(data)}|${ts}`;
}

function strip0x(h: string): string {
  return h.startsWith("0x") || h.startsWith("0X") ? h.slice(2) : h;
}

function spkiFromRaw(pk32: Buffer) {
  return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk32]);
}

/** PKCS8 for raw 32-byte ed25519 seed/private. */
function pkcs8FromSeed(seed32: Buffer) {
  return Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed32]);
}

export function verifyEventSig(
  pubkeyHex: string,
  topic: string,
  data: unknown,
  ts: number,
  sigHex: string,
): boolean {
  try {
    const pk = Buffer.from(strip0x(pubkeyHex), "hex");
    const sig = Buffer.from(strip0x(sigHex), "hex");
    if (pk.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: spkiFromRaw(pk), format: "der", type: "spki" });
    return verify(null, Buffer.from(eventMessage(topic, data, ts), "utf8"), key, sig);
  } catch {
    return false;
  }
}

export interface SignedParams {
  topic: string;
  data: unknown;
  ts: number;
  sig: string;
  pubkey: string;
}

export class EventSigner {
  readonly pubkey: string;
  private priv: ReturnType<typeof createPrivateKey>;

  constructor(seedHex?: string | null) {
    if (seedHex && strip0x(seedHex).length === 64) {
      const seed = Buffer.from(strip0x(seedHex), "hex");
      this.priv = createPrivateKey({ key: pkcs8FromSeed(seed), format: "der", type: "pkcs8" });
      const pub = createPublicKey(this.priv);
      const spki = pub.export({ type: "spki", format: "der" }) as Buffer;
      this.pubkey = spki.subarray(-32).toString("hex");
    } else {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      this.priv = privateKey;
      const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
      this.pubkey = spki.subarray(-32).toString("hex");
    }
  }

  static fromEnv(): EventSigner {
    return new EventSigner(process.env.EVENT_SIGNING_SEED ?? null);
  }

  sign(topic: string, data: unknown, ts = Date.now()): SignedParams {
    const msg = eventMessage(topic, data, ts);
    const sig = sign(null, Buffer.from(msg, "utf8"), this.priv).toString("hex");
    return { topic, data, ts, sig, pubkey: this.pubkey };
  }

  /** Wrap a bus frame's params with sig fields. */
  signFrame(frame: {
    jsonrpc: "2.0";
    method: string;
    params: { topic: string; data: unknown };
  }): { jsonrpc: "2.0"; method: string; params: SignedParams } {
    const signed = this.sign(frame.params.topic, frame.params.data);
    return { jsonrpc: "2.0", method: frame.method, params: signed };
  }
}

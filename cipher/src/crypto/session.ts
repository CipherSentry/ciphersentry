/**
 * Gateway session keys — Ed25519 WebCrypto for AUTH_REQUIRED.
 * Separate from operator ruling keys (which may be P-256 fallback).
 *
 * Auto path: ?net=rpc&auth=1 → ensureSessionSigner() → openSession().
 */

import type { SessionSigner } from "../sdk/rpc";

const LS_KEY = "cent.sesskey.v1";

export interface SessionKeyMaterial {
  pubkey: string; // 32-byte hex
  priv: CryptoKey;
  pub: CryptoKey;
}

let cached: SessionKeyMaterial | null = null;
let pending: Promise<SessionKeyMaterial> | null = null;

const buf2hex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const hex2buf = (h: string): Uint8Array =>
  new Uint8Array(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)));

const b64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const hasSubtle = () =>
  typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.subtle.generateKey === "function";

/** SPKI DER prefix for raw Ed25519 pub. */
function spkiFromRaw(pk32: Uint8Array): Uint8Array {
  const prefix = new Uint8Array([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const out = new Uint8Array(prefix.length + 32);
  out.set(prefix, 0);
  out.set(pk32, prefix.length);
  return out;
}

async function generate(): Promise<SessionKeyMaterial> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as AlgorithmIdentifier,
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  // raw export may be 32 bytes or SPKI depending on browser — take last 32
  const pk32 = raw.length === 32 ? raw : raw.subarray(-32);
  const pubkey = [...pk32].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { pubkey, priv: pair.privateKey, pub: pair.publicKey };
}

async function load(): Promise<SessionKeyMaterial | null> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { pkcs8, pubHex } = JSON.parse(raw) as { pkcs8: string; pubHex: string };
    if (!pkcs8 || !pubHex || pubHex.length !== 64) return null;
    const alg = { name: "Ed25519" } as unknown as AlgorithmIdentifier;
    const priv = await crypto.subtle.importKey("pkcs8", unb64(pkcs8) as BufferSource, alg, true, ["sign"]);
    const pub = await crypto.subtle.importKey(
      "spki",
      spkiFromRaw(hex2buf(pubHex)) as BufferSource,
      alg,
      true,
      ["verify"],
    );
    return { pubkey: pubHex, priv, pub };
  } catch {
    return null;
  }
}

async function persist(k: SessionKeyMaterial): Promise<void> {
  try {
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", k.priv);
    localStorage.setItem(LS_KEY, JSON.stringify({ pkcs8: b64(pkcs8), pubHex: k.pubkey }));
  } catch {
    /* session-only */
  }
}

export function ensureSessionKey(): Promise<SessionKeyMaterial> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    if (!hasSubtle()) throw new Error("WebCrypto unavailable");
    const restored = await load();
    if (restored) {
      cached = restored;
      return restored;
    }
    const fresh = await generate();
    await persist(fresh);
    cached = fresh;
    return fresh;
  })();
  return pending;
}

/** SessionSigner for RpcTransport.openSession — UTF-8 message → 64-byte hex sig. */
export async function ensureSessionSigner(agentId?: string): Promise<SessionSigner> {
  const k = await ensureSessionKey();
  return {
    pubkey: k.pubkey,
    agentId,
    sign: async (message: string) => {
      const sig = await crypto.subtle.sign(
        { name: "Ed25519" } as unknown as AlgorithmIdentifier,
        k.priv,
        new TextEncoder().encode(message),
      );
      return buf2hex(sig);
    },
  };
}

export function peekSessionPubkey(): string | null {
  return cached?.pubkey ?? null;
}

export function readAuthFlag(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("auth") === "1") return true;
    const hash = window.location.hash.replace(/^#/, "");
    const qi = hash.indexOf("?");
    if (qi >= 0) {
      return new URLSearchParams(hash.slice(qi + 1)).get("auth") === "1";
    }
    return false;
  } catch {
    return false;
  }
}

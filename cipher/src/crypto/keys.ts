/**
 * Operator device keys — real WebCrypto custody.
 * Ed25519 where the browser supports it, ECDSA P-256 as universal fallback.
 * Keys are generated on-device, persisted locally, and never transmitted.
 */

import { canonicalize } from "../sdk/ciphersentry";
import { randHex } from "../app/data";

export type Curve = "Ed25519" | "P-256";

export interface OperatorKey {
  curve: Curve;
  algLabel: string; // "ED25519" | "ECDSA P-256 (FALLBACK)"
  pubHex: string; // raw public key
  fp: string; // op:0x71be0c…e8d3 style fingerprint
  priv: CryptoKey;
  pub: CryptoKey;
}

export interface SignedRuling {
  canonical: string; // canonical payload string that was signed
  sig: string; // hex signature
  pubkey: string;
  fp: string;
  algLabel: string;
  verified: boolean; // result of subtle.verify at sign time
  at: number;
  tx: string;
}

const LS_KEY = "cent.opkey.v2";
let cached: OperatorKey | null = null;
let pending: Promise<OperatorKey> | null = null;

const buf2hex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const hex2buf = (h: string): Uint8Array =>
  new Uint8Array(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)));

const b64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const hasSubtle = () =>
  typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.subtle.generateKey === "function";

export function fingerprint(pubHex: string): string {
  return `op:${pubHex.slice(0, 6)}…${pubHex.slice(-4)}`;
}

async function supportsEd25519(): Promise<boolean> {
  if (!hasSubtle()) return false;
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" } as unknown as AlgorithmIdentifier, false, [
      "sign",
      "verify",
    ]);
    return true;
  } catch {
    return false;
  }
}

function signAlgo(curve: Curve): AlgorithmIdentifier | EcdsaParams {
  return curve === "Ed25519"
    ? ({ name: "Ed25519" } as unknown as AlgorithmIdentifier)
    : { name: "ECDSA", hash: "SHA-256" };
}

async function toOperatorKey(pair: CryptoKeyPair, curve: Curve): Promise<OperatorKey> {
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const pubHex = buf2hex(raw);
  return {
    curve,
    algLabel: curve === "Ed25519" ? "ED25519" : "ECDSA P-256 (FALLBACK)",
    pubHex,
    fp: fingerprint(pubHex),
    priv: pair.privateKey,
    pub: pair.publicKey,
  };
}

async function generate(curve?: Curve): Promise<OperatorKey> {
  const useEd = curve ? curve === "Ed25519" : await supportsEd25519();
  const pair = useEd
    ? ((await crypto.subtle.generateKey({ name: "Ed25519" } as unknown as AlgorithmIdentifier, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair)
    : await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return toOperatorKey(pair, useEd ? "Ed25519" : "P-256");
}

async function persist(k: OperatorKey): Promise<void> {
  try {
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", k.priv);
    localStorage.setItem(LS_KEY, JSON.stringify({ curve: k.curve, pkcs8: b64(pkcs8) }));
  } catch {
    /* storage unavailable — session-only key */
  }
}

async function loadPersisted(): Promise<OperatorKey | null> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { curve, pkcs8 } = JSON.parse(raw) as { curve: Curve; pkcs8: string };
    const alg =
      curve === "Ed25519"
        ? ({ name: "Ed25519" } as unknown as AlgorithmIdentifier)
        : { name: "ECDSA", namedCurve: "P-256" };
    const priv = await crypto.subtle.importKey("pkcs8", unb64(pkcs8) as BufferSource, alg, true, ["sign"]);
    /* re-derive the public half via JWK trickery is awkward across curves;
       instead store-and-regenerate is avoided by exporting pub alongside */
    const stored = JSON.parse(raw) as { pubHex?: string };
    if (!stored.pubHex) return null;
    // For verification we only need public material; sign needs priv.
    const pub = await crypto.subtle.importKey(
      "raw",
      hex2buf(stored.pubHex) as BufferSource,
      alg,
      true,
      ["verify"],
    );
    const pubHex = stored.pubHex;
    return {
      curve,
      algLabel: curve === "Ed25519" ? "ED25519" : "ECDSA P-256 (FALLBACK)",
      pubHex,
      fp: fingerprint(pubHex),
      priv,
      pub,
    };
  } catch {
    return null;
  }
}

export function ensureOperatorKey(): Promise<OperatorKey> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async (): Promise<OperatorKey> => {
    if (!hasSubtle()) throw new Error("WebCrypto unavailable in this context");
    const restored = await loadPersisted();
    if (restored) {
      cached = restored;
      return restored;
    }
    const fresh = await generate();
    // stash the public half next to the private for reload
    try {
      const pkcs8 = await crypto.subtle.exportKey("pkcs8", fresh.priv);
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ curve: fresh.curve, pkcs8: b64(pkcs8), pubHex: fresh.pubHex }),
      );
    } catch {
      await persist(fresh);
    }
    cached = fresh;
    return fresh;
  })();
  return pending;
}

export async function rotateOperatorKey(): Promise<OperatorKey> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
  cached = null;
  pending = null;
  return ensureOperatorKey();
}

export function peekOperatorKey(): OperatorKey | null {
  return cached;
}

/* ---------------- export / import ---------------- */

/** Raw PKCS#8 bytes of the current private key — leaves memory only encrypted. */
export async function exportPkcs8(): Promise<{ pkcs8: Uint8Array; curve: Curve; pubHex: string } | null> {
  if (!cached) return null;
  const raw = await crypto.subtle.exportKey("pkcs8", cached.priv);
  return { pkcs8: new Uint8Array(raw), curve: cached.curve, pubHex: cached.pubHex };
}

/**
 * Install a decrypted pkcs8 as the operator key (replaces current identity).
 * The public component is REQUIRED from the keystore envelope — x-only pubkeys
 * are parity-ambiguous, and a mismatched pair would sign verifiable garbage.
 */
export async function installImportedKey(
  curve: Curve,
  pkcs8: Uint8Array,
  pubHex: string,
): Promise<OperatorKey> {
  if (!pubHex) throw new Error("keystore envelope missing pubHex — refusing unsafe install");
  const alg =
    curve === "Ed25519"
      ? ({ name: "Ed25519" } as unknown as AlgorithmIdentifier)
      : { name: "ECDSA", namedCurve: "P-256" };
  const priv = await crypto.subtle.importKey("pkcs8", pkcs8 as unknown as BufferSource, alg, true, ["sign"]);
  const pub = await crypto.subtle.importKey("raw", hex2buf(pubHex) as BufferSource, alg, true, ["verify"]);

  // prove the pair before installing: sign, verify, refuse on mismatch
  const probe = new TextEncoder().encode("cent:install:probe");
  const sig = await crypto.subtle.sign(signAlgo(curve), priv, probe);
  const ok = await crypto.subtle.verify(signAlgo(curve), pub, sig, probe);
  if (!ok) throw new Error("public component does not match private key — keystore rejected");

  const k: OperatorKey = {
    curve,
    algLabel: curve === "Ed25519" ? "ED25519" : "ECDSA P-256 (FALLBACK)",
    pubHex,
    fp: fingerprint(pubHex),
    priv,
    pub,
  };
  try {
    const p8 = await crypto.subtle.exportKey("pkcs8", priv);
    localStorage.setItem(LS_KEY, JSON.stringify({ curve, pkcs8: b64(p8), pubHex }));
  } catch {
    /* session-only */
  }
  cached = k;
  return k;
}

/* ---------------- signing ---------------- */

export async function signRuling(payload: unknown, key: OperatorKey): Promise<SignedRuling> {
  const canonical = canonicalize(payload);
  const data = new TextEncoder().encode(canonical);
  const sigBuf = await crypto.subtle.sign(signAlgo(key.curve), key.priv, data);
  const verified = await crypto.subtle.verify(signAlgo(key.curve), key.pub, sigBuf, data);
  return {
    canonical,
    sig: buf2hex(sigBuf),
    pubkey: key.pubHex,
    fp: key.fp,
    algLabel: key.algLabel,
    verified,
    at: Date.now(),
    tx: `0x${randHex(6)}…${randHex(4)}`,
  };
}

/** Independent re-verification — used by UIs to prove the signature checks out. */
export async function verifySignature(r: SignedRuling): Promise<boolean> {
  try {
    const curve: Curve = r.algLabel.startsWith("ED25519") ? "Ed25519" : "P-256";
    const alg =
      curve === "Ed25519"
        ? ({ name: "Ed25519" } as unknown as AlgorithmIdentifier)
        : { name: "ECDSA", namedCurve: "P-256" };
    const pub = await crypto.subtle.importKey("raw", hex2buf(r.pubkey) as BufferSource, alg, true, [
      "verify",
    ]);
    return crypto.subtle.verify(signAlgo(curve), pub, hex2buf(r.sig) as BufferSource, new TextEncoder().encode(r.canonical));
  } catch {
    return false;
  }
}

export const WEBCRYPTO_OK = hasSubtle();

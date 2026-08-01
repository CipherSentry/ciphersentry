/**
 * Encrypted keystore — export/import operator keys as password-encrypted JSON.
 * AES-GCM-256, key derived by PBKDF2 (SHA-256, 600k iterations).
 */

import type { Curve } from "./keys";

const KDF_ITERS = 600_000;
export const KEYSTORE_VERSION = "mrc.keystore.v1";

export interface KeystoreFile {
  v: string;
  curve: Curve;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ct: string;
  pubHex: string;
}

const b64 = (b: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b.buffer : b)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: KDF_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptKeystore(
  pkcs8: Uint8Array,
  curve: Curve,
  pubHex: string,
  password: string,
): Promise<KeystoreFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, pkcs8 as BufferSource);
  return {
    v: KEYSTORE_VERSION,
    curve,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERS, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    ct: b64(ct),
    pubHex,
  };
}

export async function decryptKeystore(
  ks: KeystoreFile,
  password: string,
): Promise<{ curve: Curve; pkcs8: Uint8Array }> {
  if (ks.v !== KEYSTORE_VERSION) throw new Error(`unknown keystore version: ${ks.v}`);
  const key = await deriveKey(password, unb64(ks.kdf.salt));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ks.cipher.iv) as BufferSource },
    key,
    unb64(ks.ct) as BufferSource,
  );
  return { curve: ks.curve, pkcs8: new Uint8Array(pt) };
}

export function downloadKeystore(ks: KeystoreFile, fp: string): void {
  const blob = new Blob([JSON.stringify(ks, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `machinarc-op-${fp.replace(/[^0-9a-z]/gi, "").slice(-6)}.keystore.json`;
  a.click();
  URL.revokeObjectURL(url);
}

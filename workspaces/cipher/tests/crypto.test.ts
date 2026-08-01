import { describe, expect, it } from "vitest";
import {
  ensureOperatorKey,
  exportPkcs8,
  fingerprint,
  installImportedKey,
  rotateOperatorKey,
  signRuling,
  verifySignature,
} from "../src/crypto/keys";
import { decryptKeystore, encryptKeystore, KEYSTORE_VERSION } from "../src/crypto/keystore";
import { canonicalize, outputHash } from "../src/sdk/machinarc";

describe("canonical form & hashing", () => {
  it("canonicalize is order-stable at every depth", () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 }, z: [1, { y: 1, x: 2 }] });
    const b = canonicalize({ z: [1, { x: 2, y: 1 }], a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("outputHash is deterministic and collision-free on distinct inputs", () => {
    expect(outputHash({ frames: 240, seed: 88421 })).toBe(outputHash({ frames: 240, seed: 88421 }));
    expect(outputHash({ frames: 240, seed: 88421 })).not.toBe(outputHash({ frames: 241, seed: 88421 }));
    expect(outputHash({})).toMatch(/^0x[0-9a-f]{16}$/);
  });
});

describe("operator key lifecycle", () => {
  it("generates once, then serves the cached identity", async () => {
    const k1 = await ensureOperatorKey();
    const k2 = await ensureOperatorKey();
    expect(k2.fp).toBe(k1.fp);
    expect(k1.fp).toMatch(/^op:[0-9a-f]{6}…[0-9a-f]{4}$/);
    expect(k1.pubHex.length).toBeGreaterThanOrEqual(64);
  });

  it("rotation replaces identity and is adopted by ensure", async () => {
    const k1 = await ensureOperatorKey();
    const k2 = await rotateOperatorKey();
    expect(k2.fp).not.toBe(k1.fp);
    const k3 = await ensureOperatorKey();
    expect(k3.fp).toBe(k2.fp);
  });

  it("signs canonical payloads and independently verifies them", async () => {
    const key = await ensureOperatorKey();
    const sig = await signRuling({ ruling: "REFUND BUYER", task: "mrc_abc", escrow: "42.80 USDC" }, key);
    expect(sig.verified).toBe(true);
    expect(await verifySignature(sig)).toBe(true);

    const tampered = { ...sig, canonical: sig.canonical.replace("REFUND", "RELEASE") };
    expect(await verifySignature(tampered)).toBe(false);
  });

  it("fingerprint truncates consistently", () => {
    expect(fingerprint("abcd1234ef567890")).toBe("op:abcd12…7890");
  });
});

describe("keystore round-trip", () => {
  it("encrypts and decrypts pkcs8 byte-for-byte", async () => {
    const key = await ensureOperatorKey();
    const raw = (await exportPkcs8())!;
    const ks = await encryptKeystore(raw.pkcs8, raw.curve, raw.pubHex, "correct horse battery");
    expect(ks.v).toBe(KEYSTORE_VERSION);
    expect(ks.ct).not.toContain(raw.pubHex);

    const out = await decryptKeystore(ks, "correct horse battery");
    expect(out.curve).toBe(raw.curve);
    expect([...out.pkcs8]).toEqual([...raw.pkcs8]);
  });

  it("wrong password fails decryption", async () => {
    const key = await ensureOperatorKey();
    const raw = (await exportPkcs8())!;
    const ks = await encryptKeystore(raw.pkcs8, raw.curve, raw.pubHex, "right-password");
    await expect(decryptKeystore(ks, "wrong-password")).rejects.toThrow();
  });

  it("reinstalls an identity from a keystore and keeps signatures valid", async () => {
    const original = await ensureOperatorKey();
    const raw = (await exportPkcs8())!;
    const ks = await encryptKeystore(raw.pkcs8, raw.curve, raw.pubHex, "pw-password");
    const bound = await signRuling({ note: "bound to this identity" }, original);
    expect(await verifySignature(bound)).toBe(true);

    const restored = await rotateOperatorKey();
    expect(restored.fp).not.toBe(original.fp);

    const { curve, pkcs8 } = await decryptKeystore(ks, "pw-password");
    const back = await installImportedKey(curve, pkcs8, ks.pubHex);
    expect(back.fp).toBe(original.fp);

    expect(await verifySignature(bound)).toBe(true);
    const freshSig = await signRuling({ after: "restore" }, back);
    expect(await verifySignature(freshSig)).toBe(true);
  });

  it("rejects mismatched pub/priv pairs instead of installing them", async () => {
    const raw = (await exportPkcs8())!;
    const other = await rotateOperatorKey();
    await expect(installImportedKey(raw.curve, raw.pkcs8, other.pubHex)).rejects.toThrow(/does not match/);
  });
});

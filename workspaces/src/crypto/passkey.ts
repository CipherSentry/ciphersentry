/**
 * Passkey guard — WebAuthn platform credentials gate the stored device key.
 * Honest scope: the passkey unlocks access; payload signatures still come
 * from the WebCrypto keypair. Phishing-resistant custody, device-local.
 */

const LS_PRK = "mrc.passkey.v1";

export interface PasskeyRecord {
  id: string; // base64 raw credential id
  name: string;
  createdAt: number;
}

export function passkeyAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === "function"
  );
}

export function getPasskeyRecord(): PasskeyRecord | null {
  try {
    const raw = localStorage.getItem(LS_PRK);
    return raw ? (JSON.parse(raw) as PasskeyRecord) : null;
  } catch {
    return null;
  }
}

const b64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function registerPasskey(name: string): Promise<PasskeyRecord> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Machinarc" },
      user: {
        id: new TextEncoder().encode(`op:${name}:0`),
        name,
        displayName: `Machinarc Operator — ${name}`,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential;

  const record: PasskeyRecord = { id: b64(cred.rawId), name, createdAt: Date.now() };
  try {
    localStorage.setItem(LS_PRK, JSON.stringify(record));
  } catch {
    /* storage unavailable — session registration only */
  }
  return record;
}

/** Biometric / device-pin gate. Resolves true only on a real user-verified assertion. */
export async function unlockWithPasskey(): Promise<boolean> {
  const rec = getPasskeyRecord();
  if (!rec) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: unb64(rec.id) as BufferSource }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

export function revokePasskey(): void {
  try {
    localStorage.removeItem(LS_PRK);
  } catch {
    /* noop */
  }
}

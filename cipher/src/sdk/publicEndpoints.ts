/**
 * S1.3 public demo endpoints.
 *
 * Priority for default node/indexer:
 *   1. VITE_PUBLIC_NODE / VITE_PUBLIC_INDEXER (build-time)
 *   2. production host (ciphersentry.xyz / github pages) → public DNS
 *   3. localhost dev → 127.0.0.1
 *
 * Override at runtime with ?node= / ?indexer= (hash or search).
 */

/**
 * Live public demo (Fly). Custom DNS can CNAME later:
 *   node.base-sepolia.ciphersentry.xyz → ciphersentry.fly.dev
 */
export const PUBLIC_NODE = "https://ciphersentry.fly.dev";
export const PUBLIC_INDEXER = "https://ciphersentry.fly.dev";

export const LOCAL_NODE = "http://127.0.0.1:8080";
export const LOCAL_INDEXER = "http://127.0.0.1:8081";

function isLocalHost(): boolean {
  try {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
  } catch {
    return true;
  }
}

function isProductHost(): boolean {
  try {
    const h = window.location.hostname;
    return (
      h === "ciphersentry.xyz" ||
      h.endsWith(".ciphersentry.xyz") ||
      h.endsWith("github.io") ||
      h.endsWith("pages.dev")
    );
  } catch {
    return false;
  }
}

/** Default gateway for RpcTransport / live CTAs. */
export function resolveDefaultNode(): string {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ?.VITE_PUBLIC_NODE;
    if (vite && typeof vite === "string" && vite.trim()) return vite.trim().replace(/\/$/, "");
  } catch {
    /* no vite */
  }
  if (isProductHost()) return PUBLIC_NODE;
  if (isLocalHost()) return LOCAL_NODE;
  // unknown host (preview deploys): prefer public so visitors see real path
  return PUBLIC_NODE;
}

/** Default indexer HTTP base. */
export function resolveDefaultIndexer(): string {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ?.VITE_PUBLIC_INDEXER;
    if (vite && typeof vite === "string" && vite.trim()) return vite.trim().replace(/\/$/, "");
  } catch {
    /* no vite */
  }
  if (isProductHost()) return PUBLIC_INDEXER;
  if (isLocalHost()) return LOCAL_INDEXER;
  return PUBLIC_INDEXER;
}

/** Map gateway URL → conventional indexer URL when ?indexer unset. */
export function indexerFromNode(node: string): string {
  try {
    const u = new URL(node);
    if (
      u.hostname === "node.base-sepolia.ciphersentry.xyz" ||
      u.hostname === "ciphersentry.fly.dev"
    ) {
      return PUBLIC_INDEXER;
    }
    if (u.port === "8080" || u.port === "") {
      u.port = "8081";
      return u.origin;
    }
    if (u.port === "18080") {
      u.port = "18081";
      return u.origin;
    }
    // same origin, path convention
    return u.origin;
  } catch {
    return resolveDefaultIndexer();
  }
}

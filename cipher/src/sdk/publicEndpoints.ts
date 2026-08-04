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
 * Live public demo (Fly). Gateway + memory indexer co-located (path proxy).
 * Custom DNS can CNAME later:
 *   node.base-sepolia.ciphersentry.xyz → ciphersentry.fly.dev
 * Separate indexer app optional: ciphersentry-indexer.fly.dev
 */
export const PUBLIC_NODE = "https://ciphersentry.fly.dev";
/** Same origin when indexer is embedded; override via VITE_PUBLIC_INDEXER. */
export const PUBLIC_INDEXER = "https://ciphersentry.fly.dev";

export const LOCAL_NODE = "http://127.0.0.1:8080";
/** B7 host / docker-compose.b7 default indexer port. */
export const LOCAL_INDEXER = "http://127.0.0.1:8090";

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
      u.hostname === "ciphersentry.fly.dev" ||
      u.hostname === "ciphersentry-node.fly.dev" ||
      u.hostname === "ciphersentry-indexer.fly.dev"
    ) {
      // path mode: same origin (gateway proxies /batches …)
      if (u.hostname === "ciphersentry-indexer.fly.dev") return PUBLIC_INDEXER;
      return `${u.protocol}//${u.host}`;
    }
    if (u.port === "8080" || u.port === "") {
      u.port = "8090"; // B7 local indexer
      return u.origin;
    }
    if (u.port === "18080") {
      u.port = "18090";
      return u.origin;
    }
    // path convention: /indexer on same origin (optional reverse-proxy)
    if (u.pathname.includes("indexer")) return u.origin + u.pathname.replace(/\/$/, "");
    return u.origin;
  } catch {
    return resolveDefaultIndexer();
  }
}

/**
 * S1.1 live-path helpers — deep links + transport HUD labels.
 * Hash-router deep links: #/app?net=rpc&auth=1&node=…&indexer=…
 * Defaults match product path (rpc + auth on) even without query params.
 */

import { defaultNodeUrl, RpcWireError, type RpcTransport } from "./rpc";
import { resolveDefaultIndexer } from "./publicEndpoints";
import type { Transport } from "./transport";

/** Default live console entry — public node on product host, local in dev. */
export function liveConsoleHref(opts?: {
  node?: string;
  path?: "/app" | "/demo";
  indexer?: string;
}): string {
  const node = opts?.node ?? defaultNodeUrl();
  const indexer = opts?.indexer ?? resolveDefaultIndexer();
  const path = opts?.path ?? "/app";
  const q = new URLSearchParams({ net: "rpc", auth: "1", node, indexer });
  return `#${path}?${q.toString()}`;
}

/** Explorer deep-link after a demo task settles. */
export function liveExplorerHref(opts?: {
  taskId?: string;
  indexer?: string;
  node?: string;
}): string {
  const q = new URLSearchParams();
  if (opts?.taskId) q.set("q", opts.taskId);
  q.set("indexer", opts?.indexer ?? resolveDefaultIndexer());
  q.set("node", opts?.node ?? defaultNodeUrl());
  return `#/explorer?${q.toString()}`;
}

/** Map UI ruling labels → gateway normalizeRuling inputs. */
export function toWireRuling(ruling: string): string {
  const u = ruling.trim().toUpperCase();
  if (u.includes("REFUND")) return "REFUND BUYER";
  if (u.includes("RELEASE") || u.includes("PAY")) return "RELEASE";
  if (u.includes("SPLIT")) return "SPLIT";
  return ruling;
}

export type HudTone = "volt" | "amber" | "red" | "mute";

export interface TransportHud {
  kind: "sim" | "rpc";
  primary: string;
  secondary: string;
  tone: HudTone;
  node?: string;
  sessionLine?: string;
}

/** Compact status for console / mobile chrome. */
export function describeTransport(t: Transport): TransportHud {
  if (t.kind !== "rpc") {
    return {
      kind: "sim",
      primary: "SIM LIVE",
      secondary: "STREAM 2.8S · LOCAL",
      tone: "volt",
    };
  }

  const r = t as RpcTransport;
  const node = r.nodeUrl;
  let primary = `RPC ${r.status}`;
  let secondary = node;
  let tone: HudTone = r.status === "LIVE" ? "volt" : r.status === "CONNECTING" ? "amber" : "red";

  if (r.lastCapBreach) {
    primary = "RPC CAP";
    secondary = r.lastCapBreach.slice(0, 48);
    tone = "red";
  } else if (r.eventRejectStats.pinMismatch > 0) {
    primary = "RPC KEY MISMATCH";
    tone = "red";
  } else if (r.eventRejectStats.rejected > 0 && r.lastEventSigned === false) {
    primary = "RPC SIG REJECT";
    tone = "red";
  } else if (r.status === "LIVE") {
    primary = "RPC NODE · LIVE";
  } else if (r.status === "CONNECTING") {
    primary = "RPC CONNECTING";
  } else {
    primary = "RPC OFFLINE";
  }

  let sessionLine: string | undefined;
  if (r.sessionActive && r.sessionMeta) {
    sessionLine = `AUTH · ${r.sessionMeta.rpm}/min · S=${r.sessionMeta.stake}`;
  } else if (r.authRequired) {
    sessionLine = "AUTH REQUIRED";
    if (tone === "volt") tone = "amber";
  } else if (r.pinnedPubkey) {
    sessionLine = `PIN ${r.pinnedPubkey.slice(0, 8)}…`;
  } else if (r.lastEventSigned === true) {
    sessionLine = "WS SIGNED";
  }

  return { kind: "rpc", primary, secondary, tone, node, sessionLine };
}

/** Single-line toast / status error. */
export function formatWireError(e: unknown): string {
  if (e instanceof RpcWireError) return `${e.code}: ${e.message}`;
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    const c = e as { code: unknown; message: unknown };
    if (typeof c.code === "string" && typeof c.message === "string") {
      return `${c.code}: ${c.message}`;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function isRpcMode(t: Transport): t is RpcTransport {
  return t.kind === "rpc";
}

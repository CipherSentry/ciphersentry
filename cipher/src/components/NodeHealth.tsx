/**
 * S1.3.b — poll gateway /health for landing + gates chrome.
 */
import { useEffect, useState } from "react";
import { defaultNodeUrl } from "../sdk/rpc";
import { resolveDefaultIndexer } from "../sdk/publicEndpoints";

export type HealthState = "checking" | "live" | "offline";

export interface NodeHealthInfo {
  state: HealthState;
  phase?: string;
  bus?: string;
  escrow?: string;
  node: string;
  blockHint?: string;
}

async function probe(node: string): Promise<NodeHealthInfo> {
  const base = node.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return { state: "offline", node: base };
    const h = (await res.json()) as {
      ok?: boolean;
      phase?: string;
      bus?: string;
      escrow?: string;
      epoch?: number;
    };
    if (!h.ok) return { state: "offline", node: base, phase: h.phase };
    return {
      state: "live",
      phase: h.phase,
      bus: typeof h.bus === "string" ? h.bus : undefined,
      escrow: typeof h.escrow === "string" ? h.escrow : undefined,
      node: base,
      blockHint: h.epoch != null ? `EPOCH ${h.epoch}` : undefined,
    };
  } catch {
    return { state: "offline", node: base };
  }
}

/** Compact pill for header / gates. */
export default function NodeHealth({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<NodeHealthInfo>(() => ({
    state: "checking",
    node: defaultNodeUrl(),
  }));

  useEffect(() => {
    let dead = false;
    const tick = async () => {
      const next = await probe(defaultNodeUrl());
      if (!dead) setInfo(next);
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, []);

  const tone =
    info.state === "live"
      ? "text-volt"
      : info.state === "checking"
        ? "text-amber-300"
        : "text-mute";
  const dot =
    info.state === "live"
      ? "bg-volt"
      : info.state === "checking"
        ? "bg-amber-300"
        : "bg-mute/50";
  const label =
    info.state === "live"
      ? `NODE LIVE${info.phase ? ` · ${info.phase}` : ""}`
      : info.state === "checking"
        ? "NODE …"
        : "NODE OFFLINE";

  return (
    <a
      href={liveConsoleFromHealth(info)}
      title={`${info.node}${info.escrow ? ` · escrow ${info.escrow}` : ""}${info.bus ? ` · bus ${info.bus}` : ""}`}
      className={`inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.18em] ${tone} ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 ${dot} ${info.state === "live" ? "animate-pulse" : ""}`} />
      <span className="tabular-nums">{label}</span>
      {info.blockHint && info.state === "live" && (
        <span className="hidden text-mute/70 xl:inline">· {info.blockHint}</span>
      )}
    </a>
  );
}

function liveConsoleFromHealth(info: NodeHealthInfo): string {
  const q = new URLSearchParams({
    net: "rpc",
    auth: "1",
    node: info.node,
    indexer: resolveDefaultIndexer(),
  });
  return `#/app?${q.toString()}`;
}

/** Hook for pages that need full health JSON. */
export function useNodeHealth(pollMs = 30_000): NodeHealthInfo {
  const [info, setInfo] = useState<NodeHealthInfo>(() => ({
    state: "checking",
    node: defaultNodeUrl(),
  }));
  useEffect(() => {
    let dead = false;
    const tick = async () => {
      const next = await probe(defaultNodeUrl());
      if (!dead) setInfo(next);
    };
    void tick();
    const id = setInterval(tick, pollMs);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [pollMs]);
  return info;
}

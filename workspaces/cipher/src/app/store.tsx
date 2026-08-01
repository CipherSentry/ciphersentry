import { createContext, useContext } from "react";
import type {
  Agent,
  AlertItem,
  Approval,
  Batch,
  Limits,
  TaskEvent,
} from "./data";

export type Tab = "feed" | "registry" | "wallet" | "alerts";

export type Overlay =
  | { s: "task"; id: string }
  | { s: "agent"; id: string }
  | { s: "dispute"; id: string }
  | { s: "staking" };

export interface Toast {
  id: number;
  msg: string;
}

export interface AppValue {
  connected: boolean;
  tab: Tab;
  overlays: Overlay[];
  now: number;
  feed: TaskEvent[];
  agents: Agent[];
  approvals: Approval[];
  batches: Batch[];
  alerts: AlertItem[];
  limits: Limits;
  wallet: { avail: number; escrow: number; earned: number; spent: number; stake: number };
  toasts: Toast[];

  connect: () => void;
  setTab: (t: Tab) => void;
  open: (o: Overlay) => void;
  close: () => void;
  closeAll: () => void;
  toast: (msg: string) => void;
  resolveApproval: (id: string, note: string) => void;
  toggleAgent: (id: string) => void;
  setAgentLimit: (id: string, v: number) => void;
  setGlobalLimit: (v: number) => void;
  setRequireAbove: (v: number) => void;
  setFlag: (k: "autoPause" | "digest", v: boolean) => void;
  hire: (name: string) => void;
  stakeMore: (v: number) => void;
  settleFeedItem: (id: string, state: TaskEvent["state"]) => void;
}

export const AppCtx = createContext<AppValue | null>(null);

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

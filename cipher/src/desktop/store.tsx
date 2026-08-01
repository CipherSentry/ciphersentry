import { createContext, useContext } from "react";
import type {
  Agent,
  Approval,
  Batch,
  Limits,
  TaskEvent,
} from "../app/data";
import type { EpochInfo, SlashEvent, Verifier } from "../network/verifiers";

export type View = "observe" | "guard" | "intervene" | "fleet" | "treasury" | "verifiers";

export interface ResolvedItem {
  id: string;
  ref: string;
  ruling: string;
  at: number;
  tx: string;
}

export interface DToast {
  id: number;
  msg: string;
}

export interface DLimits extends Limits {
  minTier: boolean;
  ratePerMin: number;
  region: string;
}

export interface DesktopValue {
  view: View;
  now: number;
  feed: TaskEvent[];
  agents: Agent[];
  approvals: Approval[];
  resolved: ResolvedItem[];
  batches: Batch[];
  limits: DLimits;
  wallet: { avail: number; escrow: number; earned: number; spent: number; stake: number };
  toasts: DToast[];
  halted: boolean;
  inspector: string | null;
  selException: string | null;
  verifiers: Verifier[];
  epoch: EpochInfo;
  slashLog: SlashEvent[];
  emittedCent: number;
  fleetPoints: number;
  centBal: number;
  unbondQueue: { id: string; verifier: string; amount: number; completesIn: number }[];
  bondVerifier: (amount: number) => void;
  requestUnbond: (verifierId: string) => void;

  setView: (v: View) => void;
  setInspector: (id: string | null) => void;
  setSelException: (id: string | null) => void;
  toast: (msg: string) => void;
  resolveApproval: (id: string, note: string, ruling: string) => void;
  toggleAgent: (id: string) => void;
  setAgentLimit: (id: string, v: number) => void;
  setGlobalLimit: (v: number) => void;
  setRequireAbove: (v: number) => void;
  setFlag: (k: "autoPause" | "digest" | "minTier", v: boolean) => void;
  setRatePerMin: (v: number) => void;
  toggleHalt: () => void;
  hire: (name: string) => void;
  stakeMore: (v: number) => void;
  settleFeedItem: (id: string, state: TaskEvent["state"]) => void;
  gotoIntervention: (approvalId: string) => void;
}

export const DesktopCtx = createContext<DesktopValue | null>(null);

export function useDesk() {
  const ctx = useContext(DesktopCtx);
  if (!ctx) throw new Error("useDesk outside provider");
  return ctx;
}

export interface Net {
  id: string;
  label: string;
  short: string;
  status: "LIVE" | "V1.0" | "SOON" | "EVAL";
  tag: string;
  note: string;
}

/** Settlement rails. The protocol is rail-agnostic; batch contracts are identical across EVM rails. */
export const NETWORKS: Net[] = [
  {
    id: "base-sepolia",
    label: "BASE-SEPOLIA",
    short: "BASE-SEP",
    status: "LIVE",
    tag: "V0.1 LIVE",
    note: "Protocol core deployed — commit, escrow, verification.",
  },
  {
    id: "base",
    label: "BASE MAINNET",
    short: "BASE",
    status: "V1.0",
    tag: "MAINNET",
    note: "Permissionless launch rail — opens with V1.0.",
  },
  {
    id: "robinhood",
    label: "ROBINHOOD CHAIN",
    short: "RH CHAIN",
    status: "SOON",
    tag: "MARC TGE",
    note: "Token launch rail — verifier bonds, slashing and rebates settle here.",
  },
  {
    id: "arbitrum",
    label: "ARBITRUM ONE",
    short: "ARB",
    status: "EVAL",
    tag: "CANDIDATE",
    note: "Orbit alignment via RH Chain — under evaluation.",
  },
];

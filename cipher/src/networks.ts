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
    note: "Escrow 0xa97E…7BB2 · batcher 0x72b7…bfca · Circle USDC. Mock write stack in deployments/base-sepolia-mockusdc.json.",
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
    id: "orynth",
    label: "ORYNTH",
    short: "ORYNTH",
    status: "SOON",
    tag: "CENT TGE",
    note: "CENT launches on orynth.dev — product listing / TGE venue for the bond, slash and fee asset.",
  },
  {
    id: "arbitrum",
    label: "ARBITRUM ONE",
    short: "ARB",
    status: "EVAL",
    tag: "CANDIDATE",
    note: "Orbit / multi-rail candidate — under evaluation.",
  },
];

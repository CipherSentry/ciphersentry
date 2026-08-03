/**
 * On-chain addresses for live rails.
 * Source of truth: cipher/contracts/deployments/*.json
 */

export interface Deployment {
  chainId: number;
  mode: string;
  deployer: string;
  usdc: string;
  cent: string;
  escrow: string;
  batcher: string;
  vestingVault: string;
  registry: string;
  election: string;
  slashExecutor: string;
  smokeCommitTx?: string;
  note?: string;
}

/** Circle USDC production stack on Base Sepolia */
export const BASE_SEPOLIA: Deployment = {
  chainId: 84532,
  mode: "base-sepolia",
  deployer: "0x96a438924ACE133D5909bd3BAF3263845B760eF4",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  cent: "0x360e506eb0a646D91500BFFeB36723ca5aD023F8",
  escrow: "0xa97E729Fdb0002705a19cDd4F39FE551f3d77BB2",
  batcher: "0x72b735E47983ACb9039bb1f1B757BF9c09f4bfca",
  vestingVault: "0xC8F85a155d61aA5BCbCDB7f05E66347c9F88d9ac",
  registry: "0xC7De42E9F3ff86b96386a4c6168D89617AB99aFd",
  election: "0x1FA68fFB7f90f1c1535bd6d67b80724633947568",
  slashExecutor: "0xCE3b3854BAdC63eafb097E0d0E1e0F156124514a",
};

/** MockUSDC write-path stack (mintable) on Base Sepolia */
export const BASE_SEPOLIA_MOCKUSDC: Deployment = {
  chainId: 84532,
  mode: "base-sepolia-mockusdc",
  deployer: "0xD309Fc7e2a3055Ed9320b7316ec142A1C5d8ba15",
  usdc: "0x4fa4890F31143C5158eD0Aa95d80815bFd3580D0",
  cent: "0x4f3e99cafe2a0e9803b9a7aae9cca2163348cfa1",
  escrow: "0xB41EC9A2E9fD7b9226E53a93daef0E1655729890",
  batcher: "0x301284283E1592C094355f4ad17a8Ddb75D2656F",
  vestingVault: "0xFa79780237DD58a5C799983D722EAf6aBE1C1296",
  registry: "0x3e237d84958cdbc9a5bf0535c30d449078532211",
  election: "0xDd2a21A41F6A07DF47192C91b709D5B4e73FfeDf",
  slashExecutor: "0xbbdeb95262a66772b6abc40668db6ae8a737ca74",
  note: "Ceremony hybrid stack — WATCHER=protocol, batcher 2-of-3 rotated",
};

export const DEPLOYMENTS = {
  "base-sepolia": BASE_SEPOLIA,
  "base-sepolia-mockusdc": BASE_SEPOLIA_MOCKUSDC,
} as const;

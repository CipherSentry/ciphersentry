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
  deployer: "0xab290337AF2f808D5aA3Ff0dbF270253AEb6E1E3",
  usdc: "0x4fa4890F31143C5158eD0Aa95d80815bFd3580D0",
  cent: "0x9f59f6454c14b5a4f1456e7e0c83aa0e03e39e96",
  escrow: "0x20a1253ec5b06e319384762c0b1b896d5b9baf15",
  batcher: "0xb9cc42df4f77b172901ee4d84ced98f576dcc31f",
  vestingVault: "0xFa79780237DD58a5C799983D722EAf6aBE1C1296",
  registry: "0xdb74154c97c3b93f7536bfb4d44665987cb6dbbf",
  election: "0x318a6c18fb25623dcfa71726e32f500a03ae07fe",
  slashExecutor: "0x5b7d9a23b30941aaf98103e71c99af62c02304d1",
  note: "Elect live — protocol CENT + 3 bonded seats; epoch 703771 quorum finalized; escrow/batcher mock USDC unchanged",
};

export const DEPLOYMENTS = {
  "base-sepolia": BASE_SEPOLIA,
  "base-sepolia-mockusdc": BASE_SEPOLIA_MOCKUSDC,
} as const;

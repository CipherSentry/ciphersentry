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
  deployer: "0x96a438924ACE133D5909bd3BAF3263845B760eF4",
  usdc: "0x9F1212c51F52e5964eafae16b624E980CB0b3E4f",
  cent: "0xEfDAdd5080435Ac87C4689131ace12d9AE0ec887",
  escrow: "0x597CD2fA7c74FBAcE24e7c141D4dc54Bd8e567b4",
  batcher: "0xdbd23CF2b0944552C17C2db73b5e8a14a1649e14",
  vestingVault: "0x870071096f7a2630820Df6B482fdd845e999A20d",
  registry: "0x1424a75aB1bab8bBE6fAa19Df14797156442a73c",
  election: "0x4aB2205CcCF3d71126769bDb90B5ca06C3A61694",
  slashExecutor: "0x4FED88cbD0065d832ac8f54444E8498a56f9bc0b",
  smokeCommitTx: "0x8741743272ba7ae60e7dc56b7335a70e3454ee2544a0cc8b6cd3f50ea4dc20f6",
  note: "MockUSDC faucet stack for write-path smoke",
};

export const DEPLOYMENTS = {
  "base-sepolia": BASE_SEPOLIA,
  "base-sepolia-mockusdc": BASE_SEPOLIA_MOCKUSDC,
} as const;

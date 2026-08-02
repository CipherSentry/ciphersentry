/**
 * Slash executor gateway — B3 optional chain writer.
 *
 * Modes:
 *   OFFLINE     — no SLASH_EXECUTOR_ADDRESS
 *   WATCH-ONLY  — address set, no key
 *   WRITE-READY — PROTOCOL_KEY / PROTOCOL_FROM can submitEvidence
 *
 * Off-chain bond cuts already land in BondRegistry on verify mismatch;
 * this is the slow on-chain path to SlashExecutor.sol.
 */

import { createWalletClient, http, keccak256, toBytes, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";

export interface SlashWriteConfig {
  rpcUrl: string;
  slashExecutorAddress: string | null;
  protocolKey: string | null;
  fromAddress: string | null;
  chainId: number;
}

export interface SlashSubmitParams {
  evidenceHash: string;
  target: string;
  severity: "FalseVote" | "Collusion";
}

export interface SlashSubmitResult {
  mode: "offline" | "submitted" | "simulated";
  txHash?: string;
  error?: string;
  calldata?: string;
}

const SUBMIT_SELECTOR = keccak256(toBytes("submitEvidence(bytes32,address,uint8)")).slice(0, 10);

function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function pad32(hexNo0x: string): string {
  return hexNo0x.replace(/^0x/, "").padStart(64, "0").slice(-64);
}

function encodeAddress(addr: string): string {
  return pad32(addr.toLowerCase().replace(/^0x/, ""));
}

function fnvBytes32(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9af2be11;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= s.charCodeAt(i) + 1;
    h2 = Math.imul(h2, 0x01000193);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, "0");
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  const c = ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  const d = (Math.imul(h1, h2) >>> 0).toString(16).padStart(8, "0");
  return (a + b + c + d).padEnd(64, "0").slice(0, 64);
}

function encodeSubmitEvidence(evidenceHash: string, target: string, severity: "FalseVote" | "Collusion"): Hex {
  const hashWord = pad32(evidenceHash);
  const targetWord = isAddress(target)
    ? encodeAddress(target)
    : encodeAddress("0x" + fnvBytes32(target).slice(0, 40));
  const sevWord = pad32(severity === "Collusion" ? "1" : "0");
  return (`${SUBMIT_SELECTOR}${hashWord}${targetWord}${sevWord}`) as Hex;
}

function pickChain(chainId: number) {
  if (chainId === 31337) return foundry;
  if (chainId === 84532) return baseSepolia;
  return { ...baseSepolia, id: chainId };
}

async function ethRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export function makeSlashConfigFromEnv(): SlashWriteConfig {
  let key = process.env.PROTOCOL_KEY ?? process.env.PRIVATE_KEY ?? null;
  if (key && !key.startsWith("0x")) key = `0x${key}`;
  return {
    rpcUrl: process.env.CHAIN_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia.publicnode.com",
    slashExecutorAddress: process.env.SLASH_EXECUTOR_ADDRESS ?? null,
    protocolKey: key,
    fromAddress: process.env.PROTOCOL_FROM ?? process.env.OPERATOR_ADDRESS ?? null,
    chainId: Number(process.env.CHAIN_ID ?? 84532),
  };
}

export class SlashExecutorGateway {
  constructor(private cfg: SlashWriteConfig) {}

  get mode(): "offline" | "write-ready" | "watch-only" {
    if (!this.cfg.slashExecutorAddress) return "offline";
    if (this.cfg.protocolKey || this.cfg.fromAddress) return "write-ready";
    return "watch-only";
  }

  encode(params: SlashSubmitParams): string {
    return encodeSubmitEvidence(params.evidenceHash, params.target, params.severity);
  }

  async submit(params: SlashSubmitParams): Promise<SlashSubmitResult> {
    const data = encodeSubmitEvidence(params.evidenceHash, params.target, params.severity);
    if (!this.cfg.slashExecutorAddress) {
      return { mode: "offline", calldata: data };
    }
    const to = this.cfg.slashExecutorAddress as Address;

    if (this.cfg.protocolKey) {
      try {
        const account = privateKeyToAccount(this.cfg.protocolKey as Hex);
        const chain = pickChain(this.cfg.chainId);
        const client = createWalletClient({ account, chain, transport: http(this.cfg.rpcUrl) });
        const txHash = await client.sendTransaction({ to, data, value: 0n, chain, account });
        return { mode: "submitted", txHash, calldata: data };
      } catch (e) {
        return { mode: "simulated", error: (e as Error).message, calldata: data };
      }
    }

    if (this.cfg.fromAddress) {
      try {
        const txHash = await ethRpc<string>(this.cfg.rpcUrl, "eth_sendTransaction", [
          { from: this.cfg.fromAddress, to, data, value: "0x0" },
        ]);
        return { mode: "submitted", txHash, calldata: data };
      } catch (e) {
        return { mode: "simulated", error: (e as Error).message, calldata: data };
      }
    }

    return { mode: "simulated", calldata: data };
  }
}

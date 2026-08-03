/**
 * Escrow gateway — optional on-chain commit writer for B0.
 *
 * Modes:
 *   OFFLINE  — no ESCROW_ADDRESS
 *   WATCH    — address set, no key
 *   WRITE    — PROTOCOL_KEY → eth_sendRawTransaction (Alchemy/public RPC)
 *              or PROTOCOL_FROM → eth_sendTransaction (anvil unlocked)
 *
 * Escrow.commit(bytes32 spec, address worker, uint96 amount, uint96 bond)
 */

import { createWalletClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { resolveSecret } from "./keys.ts";

export interface EscrowWriteConfig {
  rpcUrl: string;
  escrowAddress: string | null;
  /** 0x-prefixed private key for eth_sendRawTransaction */
  protocolKey: string | null;
  /** from address when using eth_sendTransaction (unlocked / anvil) */
  fromAddress: string | null;
  chainId: number;
  /** USDC 6-decimals bond floor match Escrow.MIN_BOND */
  defaultBond: bigint;
}

export interface ChainCommitParams {
  taskIdHint: string;
  worker: string;
  buyer?: string;
  amountUsdc: string;
  spec: string;
}

export interface ChainCommitResult {
  mode: "offline" | "submitted" | "simulated";
  txHash?: string;
  taskId?: string;
  error?: string;
}

/** cast sig "commit(bytes32,address,uint96,uint96)" */
const COMMIT_SELECTOR = "8ecbf09f";

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

function usdcToUint96(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const f = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(f || "0");
}

function encodeCommitCalldata(spec: string, worker: string, amount: bigint, bond: bigint): Hex {
  const specWord = isAddress(spec) ? pad32(spec) : fnvBytes32(spec);
  const workerWord = isAddress(worker)
    ? encodeAddress(worker)
    : encodeAddress("0x" + fnvBytes32(worker).slice(0, 40));
  const amountWord = pad32(amount.toString(16));
  const bondWord = pad32(bond.toString(16));
  return ("0x" + COMMIT_SELECTOR + specWord + workerWord + amountWord + bondWord) as Hex;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

function pickChain(chainId: number) {
  if (chainId === 31337) return foundry;
  if (chainId === 84532) return baseSepolia;
  return { ...baseSepolia, id: chainId };
}

export function makeEscrowConfigFromEnv(): EscrowWriteConfig {
  // B7: PROTOCOL_KEY_FILE / PRIVATE_KEY_FILE preferred over env plaintext
  const key = resolveSecret("PROTOCOL_KEY", "PRIVATE_KEY");
  return {
    rpcUrl: process.env.CHAIN_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia.publicnode.com",
    escrowAddress: process.env.ESCROW_ADDRESS ?? null,
    protocolKey: key,
    fromAddress: process.env.PROTOCOL_FROM ?? process.env.OPERATOR_ADDRESS ?? null,
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    defaultBond: BigInt(process.env.DEFAULT_BOND_USDC_UNITS ?? "10000"),
  };
}

export class EscrowGateway {
  constructor(private cfg: EscrowWriteConfig) {}

  get enabled(): boolean {
    return Boolean(this.cfg.escrowAddress);
  }

  get mode(): "offline" | "write-ready" | "watch-only" {
    if (!this.cfg.escrowAddress) return "offline";
    if (this.cfg.protocolKey || this.cfg.fromAddress) return "write-ready";
    return "watch-only";
  }

  async commit(params: ChainCommitParams): Promise<ChainCommitResult> {
    if (!this.cfg.escrowAddress) {
      return { mode: "offline" };
    }

    const amount = usdcToUint96(params.amountUsdc);
    const bond = this.cfg.defaultBond;
    if (amount < 10_000n) {
      return { mode: "offline", error: "amount below MIN_AMOUNT (0.01 USDC)" };
    }

    const data = encodeCommitCalldata(params.spec, params.worker, amount, bond);
    const to = this.cfg.escrowAddress as Address;

    // Preferred: signed raw tx (Alchemy / public RPC)
    if (this.cfg.protocolKey) {
      try {
        const account = privateKeyToAccount(this.cfg.protocolKey as Hex);
        const chain = pickChain(this.cfg.chainId);
        const client = createWalletClient({
          account,
          chain,
          transport: http(this.cfg.rpcUrl),
        });
        const txHash = await client.sendTransaction({
          to,
          data,
          value: 0n,
          chain,
          account,
        });
        return { mode: "submitted", txHash, taskId: params.taskIdHint };
      } catch (e) {
        return {
          mode: "simulated",
          taskId: params.taskIdHint,
          error: `sendRawTransaction failed: ${(e as Error).message}`,
        };
      }
    }

    // Anvil / unlocked RPC
    if (this.cfg.fromAddress) {
      try {
        const txHash = await rpc<string>(this.cfg.rpcUrl, "eth_sendTransaction", [
          { from: this.cfg.fromAddress, to, data, value: "0x0" },
        ]);
        return { mode: "submitted", txHash, taskId: params.taskIdHint };
      } catch (e) {
        return {
          mode: "simulated",
          taskId: params.taskIdHint,
          error: `eth_sendTransaction failed: ${(e as Error).message}`,
        };
      }
    }

    return { mode: "simulated", taskId: params.taskIdHint };
  }

  encodeCommit(params: ChainCommitParams): string {
    const amount = usdcToUint96(params.amountUsdc);
    return encodeCommitCalldata(params.spec, params.worker, amount, this.cfg.defaultBond);
  }
}

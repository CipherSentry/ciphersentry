/**
 * Escrow gateway — on-chain commit + dispute drive for B0/B5.
 *
 * Modes:
 *   OFFLINE  — no ESCROW_ADDRESS
 *   WATCH    — address set, no key
 *   WRITE    — PROTOCOL_KEY → eth_sendRawTransaction (Alchemy/public RPC)
 *              or PROTOCOL_FROM → eth_sendTransaction (anvil unlocked)
 *
 * On-chain taskId = keccak256(chainId, buyer, worker, spec, amount, block)
 * — never the ledger `cent_*` string. Commit parses Committed logs.
 *
 * Dispute drive (write-ready): acknowledge → report(bad) → 2× mismatch votes
 * → State.Disputed so Escrow.rule can land capital.
 *
 * Env:
 *   ESCROW_WORKER_KEY — signs acknowledge/report (anvil #2 locally)
 *   ESCROW_WORKER_ADDRESS — optional override if key not set
 *   ESCROW_VERIFIER_KEY_1/2 — extra verifiers for mismatch (default anvil #1 + protocol)
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type Log,
} from "viem";
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
  /** Worker EOA key — acknowledge + report on dispute path */
  workerKey: string | null;
  /** Explicit worker address when no key (must match on-chain commit) */
  workerAddress: string | null;
  /** Keys that can vote (must be setVerifier on escrow). Protocol/ruler is usually #0. */
  verifierKeys: string[];
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
  /** Ledger hint (cent_*) */
  taskId?: string;
  /** Real on-chain bytes32 from Committed event */
  chainTaskId?: string;
  workerAddress?: string;
  error?: string;
}

export interface DriveDisputeParams {
  /** On-chain task id (0x…64). If omitted, commits a fresh task first. */
  chainTaskId?: string;
  amountUsdc?: string;
  spec?: string;
  /** Bad report hash (default 0xdead…) */
  reportedHash?: Hex;
  /** Dissent hash for mismatch votes (default 0xbeef…) */
  dissentHash?: Hex;
}

export interface DriveDisputeResult {
  mode: "offline" | "submitted" | "simulated";
  chainTaskId?: string;
  txHashes: string[];
  error?: string;
}

const ESCROW_ABI = [
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spec", type: "bytes32" },
      { name: "worker", type: "address" },
      { name: "amount", type: "uint96" },
      { name: "bond", type: "uint96" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "acknowledge",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "report",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "bytes32" },
      { name: "outputHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "vote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "bytes32" },
      { name: "recomputed", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tasks",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "worker", type: "address" },
      { name: "amount", type: "uint96" },
      { name: "bond", type: "uint96" },
      { name: "spec", type: "bytes32" },
      { name: "reportedHash", type: "bytes32" },
      { name: "state", type: "uint8" },
      { name: "stateAt", type: "uint32" },
      { name: "ttl", type: "uint64" },
      { name: "matched", type: "uint8" },
      { name: "mismatched", type: "uint8" },
      { name: "rulingNonce", type: "uint64" },
    ],
  },
] as const;

/** Committed(bytes32,address,address,uint96,uint96,bytes32) */
const COMMITTED_TOPIC =
  "0xca7c5fe4ba9acd8accfbc27f67f0a3b6660b3fa827f80b864ac8628301ec3c08" as Hex;

function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function normalizeKey(k: string | null | undefined): string | null {
  if (!k) return null;
  return k.startsWith("0x") ? k : `0x${k}`;
}

function fnvBytes32(s: string): Hex {
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
  return (`0x${(a + b + c + d).padEnd(64, "0").slice(0, 64)}`) as Hex;
}

function usdcToUint96(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const f = (frac + "000000").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(f || "0");
}

function pickChain(chainId: number) {
  if (chainId === 31337) return foundry;
  if (chainId === 84532) return baseSepolia;
  return { ...baseSepolia, id: chainId };
}

function parseChainTaskId(logs: Log[]): Hex | null {
  for (const log of logs) {
    const t0 = log.topics[0]?.toLowerCase();
    if (t0 === COMMITTED_TOPIC && log.topics[1]) {
      return log.topics[1] as Hex;
    }
  }
  return null;
}

export function makeEscrowConfigFromEnv(): EscrowWriteConfig {
  const key = resolveSecret("PROTOCOL_KEY", "PRIVATE_KEY");
  const workerKey = normalizeKey(
    resolveSecret("ESCROW_WORKER_KEY") ?? process.env.ESCROW_WORKER_KEY ?? null,
  );
  const v1 = normalizeKey(process.env.ESCROW_VERIFIER_KEY_1 ?? process.env.BATCHER_KEY_2 ?? null);
  const v2 = normalizeKey(process.env.ESCROW_VERIFIER_KEY_2 ?? key);
  const verifierKeys = [v1, v2].filter((k): k is string => Boolean(k));
  // ensure protocol is among verifiers for vote path
  if (key && !verifierKeys.some((k) => k.toLowerCase() === key.toLowerCase())) {
    verifierKeys.push(key);
  }
  return {
    rpcUrl: process.env.CHAIN_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia.publicnode.com",
    escrowAddress: process.env.ESCROW_ADDRESS ?? null,
    protocolKey: key,
    fromAddress: process.env.PROTOCOL_FROM ?? process.env.OPERATOR_ADDRESS ?? null,
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    defaultBond: BigInt(process.env.DEFAULT_BOND_USDC_UNITS ?? "10000"),
    workerKey,
    workerAddress: process.env.ESCROW_WORKER_ADDRESS ?? null,
    verifierKeys,
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

  /** On-chain worker address used for commit/dispute. */
  resolveWorkerAddress(workerHint?: string): Address {
    if (this.cfg.workerKey) {
      return privateKeyToAccount(this.cfg.workerKey as Hex).address;
    }
    if (this.cfg.workerAddress && isAddress(this.cfg.workerAddress)) {
      return this.cfg.workerAddress as Address;
    }
    if (workerHint && isAddress(workerHint)) return workerHint as Address;
    if (workerHint) {
      // deterministic pseudo-address — not key-controllable
      return (`0x${fnvBytes32(workerHint).slice(2, 42)}`) as Address;
    }
    // fallback: protocol itself invalid as worker; use dead address
    return "0x00000000000000000000000000000000000000fe" as Address;
  }

  private publicClient() {
    return createPublicClient({
      chain: pickChain(this.cfg.chainId),
      transport: http(this.cfg.rpcUrl),
    });
  }

  private async sendAs(
    key: string,
    data: Hex,
  ): Promise<{ mode: "submitted" | "simulated"; txHash?: string; error?: string }> {
    if (!this.cfg.escrowAddress) return { mode: "simulated", error: "no escrow" };
    const to = this.cfg.escrowAddress as Address;
    const chain = pickChain(this.cfg.chainId);
    try {
      const account = privateKeyToAccount(key as Hex);
      const client = createWalletClient({ account, chain, transport: http(this.cfg.rpcUrl) });
      const txHash = await client.sendTransaction({ to, data, value: 0n, chain, account });
      // wait for inclusion so next step sees state
      await this.publicClient().waitForTransactionReceipt({ hash: txHash });
      return { mode: "submitted", txHash };
    } catch (e) {
      return { mode: "simulated", error: (e as Error).message };
    }
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

    const worker = this.resolveWorkerAddress(params.worker);
    const spec = isAddress(params.spec)
      ? (params.spec as Hex)
      : fnvBytes32(params.spec);
    const data = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "commit",
      args: [spec, worker, amount, bond],
    });
    const to = this.cfg.escrowAddress as Address;
    const chain = pickChain(this.cfg.chainId);

    if (this.cfg.protocolKey) {
      try {
        const account = privateKeyToAccount(this.cfg.protocolKey as Hex);
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
        const receipt = await this.publicClient().waitForTransactionReceipt({ hash: txHash });
        const chainTaskId = parseChainTaskId(receipt.logs as Log[]) ?? undefined;
        return {
          mode: "submitted",
          txHash,
          taskId: params.taskIdHint,
          chainTaskId,
          workerAddress: worker,
        };
      } catch (e) {
        return {
          mode: "simulated",
          taskId: params.taskIdHint,
          workerAddress: worker,
          error: `sendRawTransaction failed: ${(e as Error).message}`,
        };
      }
    }

    if (this.cfg.fromAddress) {
      try {
        const txHash = await fetch(this.cfg.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendTransaction",
            params: [{ from: this.cfg.fromAddress, to, data, value: "0x0" }],
          }),
        }).then(async (r) => {
          const body = (await r.json()) as { result?: string; error?: { message: string } };
          if (body.error) throw new Error(body.error.message);
          return body.result as Hex;
        });
        const receipt = await this.publicClient().waitForTransactionReceipt({ hash: txHash });
        const chainTaskId = parseChainTaskId(receipt.logs as Log[]) ?? undefined;
        return {
          mode: "submitted",
          txHash,
          taskId: params.taskIdHint,
          chainTaskId,
          workerAddress: worker,
        };
      } catch (e) {
        return {
          mode: "simulated",
          taskId: params.taskIdHint,
          workerAddress: worker,
          error: `eth_sendTransaction failed: ${(e as Error).message}`,
        };
      }
    }

    return { mode: "simulated", taskId: params.taskIdHint, workerAddress: worker };
  }

  /**
   * Drive an on-chain task to Disputed so Escrow.rule can settle capital.
   * Requires ESCROW_WORKER_KEY + ≥2 verifier keys (ruler usually included).
   */
  async driveToDisputed(params: DriveDisputeParams = {}): Promise<DriveDisputeResult> {
    if (!this.cfg.escrowAddress) return { mode: "offline", txHashes: [] };
    if (this.mode !== "write-ready") {
      return { mode: "simulated", txHashes: [], error: "escrow not write-ready" };
    }
    if (!this.cfg.workerKey) {
      return {
        mode: "simulated",
        txHashes: [],
        error: "ESCROW_WORKER_KEY required to drive dispute (acknowledge/report)",
      };
    }
    if (this.cfg.verifierKeys.length < 2) {
      return {
        mode: "simulated",
        txHashes: [],
        error: "need ≥2 ESCROW_VERIFIER_KEY_* (mismatch threshold is 2)",
      };
    }

    const txHashes: string[] = [];
    let chainTaskId = params.chainTaskId as Hex | undefined;

    if (!chainTaskId) {
      const c = await this.commit({
        taskIdHint: `cent_dispute_${Date.now().toString(36)}`,
        worker: this.resolveWorkerAddress(),
        amountUsdc: params.amountUsdc ?? "2.00",
        spec: params.spec ?? "fraud.dispute.drive",
      });
      if (c.mode !== "submitted" || !c.chainTaskId) {
        return {
          mode: c.mode === "offline" ? "offline" : "simulated",
          txHashes: c.txHash ? [c.txHash] : [],
          error: c.error ?? "commit did not yield chainTaskId",
        };
      }
      chainTaskId = c.chainTaskId as Hex;
      if (c.txHash) txHashes.push(c.txHash);
    }

    const reported =
      params.reportedHash ??
      (keccak256(toBytes("deadbeef-report")) as Hex);
    const dissent =
      params.dissentHash ??
      (keccak256(toBytes("beef-dissent")) as Hex);

    // acknowledge as worker
    const ackData = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "acknowledge",
      args: [chainTaskId],
    });
    const ack = await this.sendAs(this.cfg.workerKey, ackData);
    if (ack.mode !== "submitted") {
      return { mode: "simulated", chainTaskId, txHashes, error: `acknowledge: ${ack.error}` };
    }
    if (ack.txHash) txHashes.push(ack.txHash);

    // report bad hash as worker
    const repData = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "report",
      args: [chainTaskId, reported],
    });
    const rep = await this.sendAs(this.cfg.workerKey, repData);
    if (rep.mode !== "submitted") {
      return { mode: "simulated", chainTaskId, txHashes, error: `report: ${rep.error}` };
    }
    if (rep.txHash) txHashes.push(rep.txHash);

    // 2 mismatch votes → Disputed
    const voters = this.cfg.verifierKeys.slice(0, 2);
    for (const vk of voters) {
      const voteData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "vote",
        args: [chainTaskId, dissent],
      });
      const v = await this.sendAs(vk, voteData);
      if (v.mode !== "submitted") {
        return {
          mode: "simulated",
          chainTaskId,
          txHashes,
          error: `vote: ${v.error}`,
        };
      }
      if (v.txHash) txHashes.push(v.txHash);
    }

    // confirm Disputed (state enum = 5)
    try {
      const state = await this.publicClient().readContract({
        address: this.cfg.escrowAddress as Address,
        abi: ESCROW_ABI,
        functionName: "tasks",
        args: [chainTaskId],
      });
      const st = Number((state as readonly unknown[])[6]);
      if (st !== 5) {
        return {
          mode: "simulated",
          chainTaskId,
          txHashes,
          error: `expected Disputed(5), got state=${st}`,
        };
      }
    } catch (e) {
      return {
        mode: "simulated",
        chainTaskId,
        txHashes,
        error: `tasks() read failed: ${(e as Error).message}`,
      };
    }

    return { mode: "submitted", chainTaskId, txHashes };
  }

  encodeCommit(params: ChainCommitParams): string {
    const amount = usdcToUint96(params.amountUsdc);
    const worker = this.resolveWorkerAddress(params.worker);
    const spec = isAddress(params.spec) ? (params.spec as Hex) : fnvBytes32(params.spec);
    return encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "commit",
      args: [spec, worker, amount, this.cfg.defaultBond],
    });
  }
}

/**
 * Settlement batcher gateway — B4 on-chain Merkle root writer.
 *
 * Collects settled receipt leaves → folds a binary Merkle root → EIP-712
 * signs with 2-of-3 batcher keys → SettlementBatcher.anchorRoot via
 * eth_sendRawTransaction (Alchemy / public RPC / anvil).
 *
 * Modes:
 *   OFFLINE     — no BATCHER_ADDRESS (still buffers + dry-run roots)
 *   WATCH-ONLY  — address set, <2 signer keys
 *   WRITE-READY — ≥2 BATCHER_KEY_* (or PROTOCOL_KEY + BATCHER_KEY_2)
 *
 * Contract: SettlementBatcher.sol
 *   anchorRoot(bytes32 root, uint32 count, bytes[] sigs)  — 2-of-3
 *   emergencyAnchor(bytes32, uint32, bytes)               — after 2 misses
 *   markMissedWindow()
 */

import {
  createWalletClient,
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";

/* -------------------------------- types ----------------------------------- */

export interface BatcherConfig {
  rpcUrl: string;
  batcherAddress: string | null;
  /** At least 2 keys required for regular anchorRoot. */
  signerKeys: string[];
  /** Sender for the tx (defaults to first signer). */
  submitKey: string | null;
  fromAddress: string | null;
  chainId: number;
  /** Auto-flush interval ms (0 = manual only). Default 30_000. */
  intervalMs: number;
  /** Flush when pending reaches this count. Default 9. */
  maxPending: number;
}

export interface ReceiptLeaf {
  taskId: string;
  leaf: Hex;
  amount: string;
  worker: string;
  reported: string;
  recomputed: string;
  at: number;
}

export interface BuiltBatch {
  batchId: number;
  root: Hex;
  count: number;
  leaves: ReceiptLeaf[];
  paths: Hex[][];
  digest: Hex;
}

export interface AnchorResult {
  mode: "offline" | "submitted" | "simulated" | "buffered";
  batchId?: number;
  root?: Hex;
  count?: number;
  leaves?: number;
  txHash?: string;
  error?: string;
  calldata?: string;
  emergency?: boolean;
}

/* -------------------------------- abi ------------------------------------- */

const BATCHER_ABI = [
  {
    type: "function",
    name: "anchorRoot",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "bytes32" },
      { name: "count", type: "uint32" },
      { name: "sigs", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "emergencyAnchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "root", type: "bytes32" },
      { name: "count", type: "uint32" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markMissedWindow",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "nextBatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "missedWindows",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "lastAnchoredAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "batchWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "BATCH_TYPEHASH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const BATCH_TYPEHASH = keccak256(
  new TextEncoder().encode("Batch(uint64 batchId,bytes32 root,uint32 count,bool emergency)"),
);

const DOMAIN_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "EthereumEIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);

/* ------------------------------ pure utils -------------------------------- */

export function leafHash(taskId: string, recomputed: string): Hex {
  const enc = new TextEncoder();
  const a = enc.encode(taskId);
  const b = enc.encode(recomputed);
  const buf = new Uint8Array(a.length + 1 + b.length);
  buf.set(a, 0);
  buf[a.length] = 0x3a; // ':'
  buf.set(b, a.length + 1);
  return keccak256(buf);
}

/** Binary Merkle root. Odd node duplicated. Leaves hashed as-is (already 32-byte). */
export function merkleRoot(leaves: Hex[]): { root: Hex; paths: Hex[][] } {
  if (leaves.length === 0) {
    return { root: ("0x" + "00".repeat(32)) as Hex, paths: [] };
  }
  let level = leaves.map((l) => normalizeHex32(l));
  const tree: Hex[][] = [level.slice()];
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]!];
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hashPair(level[i]!, level[i + 1]!));
    }
    level = next;
    tree.push(level.slice());
  }
  const root = level[0]!;
  const paths = leaves.map((_, idx) => inclusionPath(tree, idx));
  return { root, paths };
}

function hashPair(a: Hex, b: Hex): Hex {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  const cat = new Uint8Array(64);
  cat.set(left, 0);
  cat.set(right, 32);
  return keccak256(cat);
}

function inclusionPath(tree: Hex[][], leafIndex: number): Hex[] {
  const path: Hex[] = [];
  let idx = leafIndex;
  for (let d = 0; d < tree.length - 1; d++) {
    const level = tree[d]!;
    const sibling = idx % 2 === 0 ? level[idx + 1] ?? level[idx]! : level[idx - 1]!;
    path.push(sibling);
    idx = Math.floor(idx / 2);
  }
  return path;
}

export function normalizeHex32(h: string): Hex {
  const raw = h.replace(/^0x/i, "").toLowerCase().padStart(64, "0").slice(-64);
  return (`0x${raw}`) as Hex;
}

function hexToBytes(h: Hex): Uint8Array {
  const raw = h.replace(/^0x/, "");
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Domain separator matching SettlementBatcher constructor. */
export function domainSeparator(chainId: number, verifyingContract: Address): Hex {
  const nameHash = keccak256(new TextEncoder().encode("SettlementBatcher"));
  const versionHash = keccak256(new TextEncoder().encode("0.1"));
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [
      DOMAIN_TYPEHASH,
      nameHash,
      versionHash,
      BigInt(chainId),
      verifyingContract,
    ]),
  );
}

export function batchDigest(
  domain: Hex,
  batchId: bigint,
  root: Hex,
  count: number,
  emergency: boolean,
): Hex {
  const structHash = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, uint64, bytes32, uint32, bool"), [
      BATCH_TYPEHASH,
      batchId,
      normalizeHex32(root),
      count,
      emergency,
    ]),
  );
  // keccak256("\x19\x01" || domain || structHash)
  const prefix = new Uint8Array(2 + 32 + 32);
  prefix[0] = 0x19;
  prefix[1] = 0x01;
  prefix.set(hexToBytes(domain), 2);
  prefix.set(hexToBytes(structHash), 34);
  return keccak256(prefix);
}

export { BATCH_TYPEHASH, DOMAIN_TYPEHASH };

function pickChain(chainId: number) {
  if (chainId === 31337) return foundry;
  if (chainId === 84532) return baseSepolia;
  return { ...baseSepolia, id: chainId };
}

function normalizeKey(k: string | null | undefined): string | null {
  if (!k) return null;
  return k.startsWith("0x") ? k : `0x${k}`;
}

/* ------------------------------ config ------------------------------------ */

export function makeBatcherConfigFromEnv(): BatcherConfig {
  const keys: string[] = [];
  for (const name of ["BATCHER_KEY_1", "BATCHER_KEY_2", "BATCHER_KEY_3", "BATCHER_KEY"]) {
    const k = normalizeKey(process.env[name]);
    if (k && !keys.includes(k)) keys.push(k);
  }
  // PROTOCOL_KEY may double as signer #1 when only one batcher key is set
  const protocol = normalizeKey(process.env.PROTOCOL_KEY ?? process.env.PRIVATE_KEY);
  if (protocol && !keys.includes(protocol)) keys.unshift(protocol);

  return {
    rpcUrl: process.env.CHAIN_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia.publicnode.com",
    batcherAddress: process.env.BATCHER_ADDRESS ?? null,
    signerKeys: keys,
    submitKey: normalizeKey(process.env.BATCHER_SUBMIT_KEY) ?? keys[0] ?? protocol,
    fromAddress: process.env.PROTOCOL_FROM ?? process.env.OPERATOR_ADDRESS ?? null,
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    intervalMs: Number(process.env.BATCH_INTERVAL_MS ?? 30_000),
    maxPending: Number(process.env.BATCH_MAX_PENDING ?? 9),
  };
}

/* ------------------------------ gateway ----------------------------------- */

export class SettlementBatcherGateway {
  private pending: ReceiptLeaf[] = [];
  private history: Array<BuiltBatch & { txHash?: string; mode: string; at: number }> = [];
  private timer?: ReturnType<typeof setInterval>;
  private anchoring = false;
  private localBatchSeq = 0;
  onBatch?: (b: Record<string, unknown>) => void;

  constructor(private cfg: BatcherConfig) {}

  get mode(): "offline" | "write-ready" | "watch-only" {
    if (!this.cfg.batcherAddress) return "offline";
    if (this.cfg.signerKeys.length >= 2 || (this.cfg.signerKeys.length >= 1 && this.cfg.fromAddress)) {
      // need 2 signers for regular path; 1+from is still watch until 2 keys
    }
    if (this.cfg.signerKeys.length >= 2) return "write-ready";
    return "watch-only";
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get pendingLeaves(): ReceiptLeaf[] {
    return [...this.pending];
  }

  get anchored(): typeof this.history {
    return [...this.history];
  }

  /** Start auto-flush timer (no-op when intervalMs ≤ 0). */
  start(): void {
    if (this.cfg.intervalMs <= 0) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.pending.length > 0) void this.anchor();
    }, this.cfg.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Enqueue a settled receipt leaf. Auto-flushes at maxPending. */
  enqueue(params: {
    taskId: string;
    recomputed: string;
    reported?: string;
    amount?: string;
    worker?: string;
  }): ReceiptLeaf {
    const leaf: ReceiptLeaf = {
      taskId: params.taskId,
      leaf: leafHash(params.taskId, params.recomputed),
      amount: params.amount ?? "0",
      worker: params.worker ?? "",
      reported: params.reported ?? params.recomputed,
      recomputed: params.recomputed,
      at: Date.now(),
    };
    this.pending.push(leaf);
    if (this.pending.length >= this.cfg.maxPending) {
      void this.anchor();
    }
    return leaf;
  }

  info(): Record<string, unknown> {
    return {
      mode: this.mode,
      phase: "B4",
      pending: this.pending.length,
      anchored: this.history.length,
      interval_ms: this.cfg.intervalMs,
      max_pending: this.cfg.maxPending,
      batcher: this.cfg.batcherAddress,
      signers_loaded: this.cfg.signerKeys.length,
      last: this.history[this.history.length - 1]
        ? {
            batch_id: this.history[this.history.length - 1]!.batchId,
            root: this.history[this.history.length - 1]!.root,
            count: this.history[this.history.length - 1]!.count,
            mode: this.history[this.history.length - 1]!.mode,
            tx: this.history[this.history.length - 1]!.txHash ?? null,
          }
        : null,
    };
  }

  /** Build merkle + digest without submitting. */
  async build(emergency = false): Promise<BuiltBatch | null> {
    if (this.pending.length === 0) return null;
    const leaves = this.pending.slice();
    const { root, paths } = merkleRoot(leaves.map((l) => l.leaf));
    const batchId = await this.readNextBatchId();
    const domain = this.cfg.batcherAddress
      ? domainSeparator(this.cfg.chainId, this.cfg.batcherAddress as Address)
      : domainSeparator(this.cfg.chainId, "0x0000000000000000000000000000000000000001");
    const digest = batchDigest(domain, BigInt(batchId), root, leaves.length, emergency);
    return { batchId, root, count: leaves.length, leaves, paths, digest };
  }

  /**
   * Flush pending leaves → Merkle root → 2-of-3 signed anchorRoot (or dry-run).
   */
  async anchor(opts: { emergency?: boolean } = {}): Promise<AnchorResult> {
    if (this.anchoring) return { mode: "buffered", leaves: this.pending.length, error: "anchor in flight" };
    if (this.pending.length === 0) return { mode: "buffered", leaves: 0, error: "nothing pending" };

    this.anchoring = true;
    try {
      const emergency = Boolean(opts.emergency);
      const built = await this.build(emergency);
      if (!built) return { mode: "buffered", leaves: 0, error: "nothing pending" };

      const need = emergency ? 1 : 2;
      const sigs = await this.signBatch(built.digest, need);

      // No chain address: pure offline merklization (CI smoke / local sim)
      if (!this.cfg.batcherAddress) {
        this.commitLocal(built, "offline");
        return {
          mode: "offline",
          batchId: built.batchId,
          root: built.root,
          count: built.count,
          leaves: built.leaves.length,
          emergency,
        };
      }

      if (sigs.length < need) {
        // Keep leaves so operators can supply keys and retry
        const calldata = this.encodeAnchor(built.root, built.count, sigs, emergency);
        return {
          mode: "simulated",
          batchId: built.batchId,
          root: built.root,
          count: built.count,
          leaves: built.leaves.length,
          calldata,
          error: `need ${need} signer key(s), have ${sigs.length}`,
          emergency,
        };
      }

      const data = this.encodeAnchor(built.root, built.count, sigs, emergency);
      const sent = await this.sendTx(data as Hex);
      if (sent.mode === "submitted") {
        this.commitLocal(built, "submitted", sent.txHash);
        return {
          mode: "submitted",
          batchId: built.batchId,
          root: built.root,
          count: built.count,
          leaves: built.leaves.length,
          txHash: sent.txHash,
          calldata: data,
          emergency,
        };
      }
      return {
        mode: "simulated",
        batchId: built.batchId,
        root: built.root,
        count: built.count,
        leaves: built.leaves.length,
        error: sent.error,
        calldata: data,
        emergency,
      };
    } finally {
      this.anchoring = false;
    }
  }

  async markMissed(): Promise<AnchorResult> {
    if (!this.cfg.batcherAddress) return { mode: "offline", error: "no BATCHER_ADDRESS" };
    const data = encodeFunctionData({ abi: BATCHER_ABI, functionName: "markMissedWindow" });
    const sent = await this.sendTx(data);
    return { ...sent, calldata: data };
  }

  /* ----------------------------- internals -------------------------------- */

  private commitLocal(built: BuiltBatch, mode: string, txHash?: string): void {
    this.pending = [];
    this.history.push({ ...built, mode, txHash, at: Date.now() });
    this.onBatch?.({
      batch_id: `batch_${built.batchId}`,
      root: built.root,
      count: built.count,
      state: mode === "submitted" ? "SETTLING" : "SETTLED",
      total: built.leaves.reduce((s, l) => s + parseFloat(l.amount || "0"), 0).toFixed(2),
      receipts: built.leaves.map((l, i) => ({
        receipt_id: l.taskId,
        task_id: l.taskId,
        leaf: l.leaf,
        path: built.paths[i] ?? [],
        reported: l.reported,
        recomputed: l.recomputed,
      })),
      _src: "batcher",
      tx: txHash ?? null,
    });
  }

  private encodeAnchor(root: Hex, count: number, sigs: Hex[], emergency: boolean): string {
    if (emergency) {
      return encodeFunctionData({
        abi: BATCHER_ABI,
        functionName: "emergencyAnchor",
        args: [root, count, sigs[0] ?? "0x"],
      });
    }
    return encodeFunctionData({
      abi: BATCHER_ABI,
      functionName: "anchorRoot",
      args: [root, count, sigs],
    });
  }

  private async signBatch(digest: Hex, need: number): Promise<Hex[]> {
    const sigs: Hex[] = [];
    for (const key of this.cfg.signerKeys) {
      if (sigs.length >= need) break;
      try {
        const account = privateKeyToAccount(key as Hex);
        // personal_sign style: sign the digest bytes as eth_sign (raw)
        // Contract uses ecrecover(digest, v, r, s) over the EIP-712 digest directly.
        const sig = await account.sign({ hash: digest });
        sigs.push(sig);
      } catch {
        /* skip bad key */
      }
    }
    return sigs;
  }

  private async readNextBatchId(): Promise<number> {
    if (!this.cfg.batcherAddress) {
      return this.localBatchSeq++;
    }
    try {
      const client = createPublicClient({
        chain: pickChain(this.cfg.chainId),
        transport: http(this.cfg.rpcUrl),
      });
      const id = await client.readContract({
        address: this.cfg.batcherAddress as Address,
        abi: BATCHER_ABI,
        functionName: "nextBatchId",
      });
      return Number(id);
    } catch {
      return this.localBatchSeq++;
    }
  }

  private async sendTx(data: Hex): Promise<{ mode: "submitted" | "simulated" | "offline"; txHash?: string; error?: string }> {
    if (!this.cfg.batcherAddress) return { mode: "offline" };
    const to = this.cfg.batcherAddress as Address;
    const chain = pickChain(this.cfg.chainId);

    const key = this.cfg.submitKey ?? this.cfg.signerKeys[0] ?? null;
    if (key) {
      try {
        const account = privateKeyToAccount(key as Hex);
        const client = createWalletClient({ account, chain, transport: http(this.cfg.rpcUrl) });
        const txHash = await client.sendTransaction({ to, data, value: 0n, chain, account });
        return { mode: "submitted", txHash };
      } catch (e) {
        return { mode: "simulated", error: (e as Error).message };
      }
    }

    if (this.cfg.fromAddress) {
      try {
        const res = await fetch(this.cfg.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendTransaction",
            params: [{ from: this.cfg.fromAddress, to, data, value: "0x0" }],
          }),
        });
        const body = (await res.json()) as { result?: string; error?: { message: string } };
        if (body.error) throw new Error(body.error.message);
        return { mode: "submitted", txHash: body.result };
      } catch (e) {
        return { mode: "simulated", error: (e as Error).message };
      }
    }

    return { mode: "simulated", error: "no submit key or PROTOCOL_FROM" };
  }

  /** Test helper — inject accounts without env. */
  static fromKeys(
    address: string | null,
    keys: string[],
    opts: Partial<BatcherConfig> = {},
  ): SettlementBatcherGateway {
    return new SettlementBatcherGateway({
      rpcUrl: opts.rpcUrl ?? "http://127.0.0.1:8545",
      batcherAddress: address,
      signerKeys: keys.map((k) => normalizeKey(k)!),
      submitKey: normalizeKey(keys[0] ?? null),
      fromAddress: opts.fromAddress ?? null,
      chainId: opts.chainId ?? 31337,
      intervalMs: opts.intervalMs ?? 0,
      maxPending: opts.maxPending ?? 9,
    });
  }
}

// silence unused import warning for PrivateKeyAccount type re-export path
export type { PrivateKeyAccount };

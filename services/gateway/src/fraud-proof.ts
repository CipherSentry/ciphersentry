/**
 * Fraud-proof worker — B5.
 *
 * On quorum mismatch (DISPUTED), open a challenge case inside the 64-block
 * fraud window, re-execute with a *fresh* challenge quorum, decide a ruling
 * (Refund / Release / Split), post slash evidence, and optionally submit
 * Escrow.rule via EIP-712 RULER signature (Alchemy / anvil).
 *
 * Modes:
 *   OFFLINE     — no ESCROW_ADDRESS (cases resolve off-chain only)
 *   WATCH-ONLY  — escrow set, no RULER_KEY
 *   WRITE-READY — RULER_KEY (or PROTOCOL_KEY) can post Escrow.rule
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import {
  expectedPureHash,
  FOUNDATION_QUORUM,
  type EvidencePackage,
  type Vote,
  type SlashApplyRow,
} from "@ciphersentry/verifier-daemon";
import type { SlashExecutorGateway } from "./slash-executor.ts";

/* -------------------------------- types ----------------------------------- */

export type RulingKind = "Refund" | "Release" | "Split";

export type ChallengeStatus =
  | "OPEN"
  | "CHALLENGING"
  | "RESOLVED"
  | "EXPIRED"
  | "DEFAULTED";

export interface FraudConfig {
  rpcUrl: string;
  escrowAddress: string | null;
  rulerKey: string | null;
  fromAddress: string | null;
  chainId: number;
  /** Blocks (on-chain window). Default 64. */
  fraudWindowBlocks: number;
  /** Wall-clock fallback when offline (ms). Default 120_000 (~2 min). */
  fraudWindowMs: number;
  /** Auto-run challenge on open. Default true. */
  autoChallenge: boolean;
}

export interface OpenChallengeParams {
  taskId: string;
  reported: string;
  inputJson: unknown;
  buyer: string;
  worker: string;
  amount: string;
  /** Original verify votes (mismatched). */
  votes: Vote[];
  evidence?: EvidencePackage;
  slashes?: SlashApplyRow[];
  /** Optional simulated open block; defaults to 0 offline. */
  openBlock?: number;
}

export interface ChallengeCase {
  taskId: string;
  status: ChallengeStatus;
  reported: string;
  inputJson: unknown;
  buyer: string;
  worker: string;
  amount: string;
  openAt: number;
  openBlock: number;
  windowBlocks: number;
  windowMs: number;
  originalVotes: Vote[];
  evidence?: EvidencePackage;
  slashes: SlashApplyRow[];
  /** Fresh challenge quorum recompute */
  challengeVotes?: Vote[];
  recomputed?: string;
  ruling?: RulingKind;
  reason?: string;
  rulingNonce: number;
  chain?: {
    mode: "offline" | "submitted" | "simulated";
    txHash?: string;
    error?: string;
    calldata?: string;
  };
  resolvedAt?: number;
}

export interface ChallengeResult {
  case: ChallengeCase;
  ruling: RulingKind;
  recomputed: string;
  challengeVotes: Vote[];
  reason: string;
}

export interface RuleSubmitResult {
  mode: "offline" | "submitted" | "simulated";
  txHash?: string;
  error?: string;
  calldata?: string;
  ruling: RulingKind;
  nonce: number;
  sig?: string;
}

/* -------------------------------- abi ------------------------------------- */

const ESCROW_ABI = [
  {
    type: "function",
    name: "rule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "bytes32" },
      { name: "ruling", type: "uint8" },
      { name: "nonce", type: "uint64" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "defaultRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "FRAUD_WINDOW",
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
] as const;

const RULING_TYPEHASH = keccak256(
  new TextEncoder().encode("Ruling(bytes32 taskId,uint8 ruling,uint64 nonce)"),
);

const DOMAIN_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "EthereumEIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);

const RULING_CODE: Record<RulingKind, number> = {
  Refund: 0,
  Release: 1,
  Split: 2,
};

/* ------------------------------ pure utils -------------------------------- */

export function normalizeRuling(r: string): RulingKind {
  const u = r.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (u === "REFUND" || u === "REFUND BUYER" || u === "0") return "Refund";
  if (u === "RELEASE" || u === "PAY WORKER" || u === "1") return "Release";
  if (u === "SPLIT" || u === "SPLIT 50 50" || u === "2") return "Split";
  throw new Error(`unknown ruling: ${r}`);
}

export function domainSeparatorEscrow(chainId: number, verifyingContract: Address): Hex {
  const nameHash = keccak256(new TextEncoder().encode("CipherSentryEscrow"));
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

export function rulingDigest(
  domain: Hex,
  taskId: Hex,
  ruling: RulingKind,
  nonce: bigint,
): Hex {
  const structHash = keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint8, uint64"), [
      RULING_TYPEHASH,
      normalizeBytes32(taskId),
      RULING_CODE[ruling],
      nonce,
    ]),
  );
  const prefix = new Uint8Array(2 + 32 + 32);
  prefix[0] = 0x19;
  prefix[1] = 0x01;
  prefix.set(hexToBytes(domain), 2);
  prefix.set(hexToBytes(structHash), 34);
  return keccak256(prefix);
}

export function taskIdToBytes32(taskId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(taskId)) return taskId.toLowerCase() as Hex;
  return keccak256(new TextEncoder().encode(taskId));
}

export function decideRuling(reported: string, recomputed: string): { ruling: RulingKind; reason: string } {
  const a = reported.toLowerCase().replace(/^0x/, "");
  const b = recomputed.toLowerCase().replace(/^0x/, "");
  if (a === b) {
    return {
      ruling: "Release",
      reason: "challenge quorum confirms reported hash — original mismatch was false",
    };
  }
  return {
    ruling: "Refund",
    reason: "challenge quorum recomputed a different hash — report rejected",
  };
}

/** Fresh challenge quorum: foundation seats that are *not* in the original set when possible. */
export function pickChallengeQuorum(original: string[], all: string[] = FOUNDATION_QUORUM): string[] {
  const orig = new Set(original);
  const fresh = all.filter((id) => !orig.has(id));
  const pool = fresh.length >= 3 ? fresh : all;
  // rotate so challenge set differs when foundation only
  if (fresh.length < 3 && original.length > 0) {
    const rotated = [...all.slice(1), all[0]!];
    return rotated.slice(0, 3);
  }
  return pool.slice(0, 3);
}

export function runChallengeVotes(
  taskId: string,
  inputJson: unknown,
  reported: string,
  quorum: string[],
): { votes: Vote[]; recomputed: string } {
  // same pure recompute path as VerifierPool (expectedPureHash)
  const recomputed = expectedPureHash(taskId, inputJson);
  const rep = String(reported).toLowerCase();
  const votes: Vote[] = quorum.map((verifier) => ({
    verifier,
    recomputed,
    ok: recomputed.toLowerCase() === rep,
    ms: 0,
  }));
  return { votes, recomputed };
}

function normalizeBytes32(h: string): Hex {
  const raw = h.replace(/^0x/i, "").toLowerCase().padStart(64, "0").slice(-64);
  return (`0x${raw}`) as Hex;
}

function hexToBytes(h: Hex): Uint8Array {
  const raw = h.replace(/^0x/, "");
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}

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

export function makeFraudConfigFromEnv(): FraudConfig {
  let key = process.env.RULER_KEY ?? process.env.PROTOCOL_KEY ?? process.env.PRIVATE_KEY ?? null;
  key = normalizeKey(key);
  return {
    rpcUrl: process.env.CHAIN_RPC ?? process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia.publicnode.com",
    escrowAddress: process.env.ESCROW_ADDRESS ?? null,
    rulerKey: key,
    fromAddress: process.env.PROTOCOL_FROM ?? process.env.OPERATOR_ADDRESS ?? null,
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    fraudWindowBlocks: Number(process.env.FRAUD_WINDOW_BLOCKS ?? 64),
    fraudWindowMs: Number(process.env.FRAUD_WINDOW_MS ?? 120_000),
    autoChallenge: (process.env.FRAUD_AUTO ?? "1") !== "0",
  };
}

/* ------------------------------ worker ------------------------------------ */

export class FraudProofWorker {
  private cases = new Map<string, ChallengeCase>();
  private nonces = new Map<string, number>();
  private simulatedBlock = 0;

  constructor(
    private cfg: FraudConfig,
    private slashChain?: SlashExecutorGateway,
  ) {}

  get mode(): "offline" | "write-ready" | "watch-only" {
    if (!this.cfg.escrowAddress) return "offline";
    if (this.cfg.rulerKey || this.cfg.fromAddress) return "write-ready";
    return "watch-only";
  }

  get autoChallenge(): boolean {
    return this.cfg.autoChallenge;
  }

  /** Advance simulated block (tests / offline expiry). */
  tickBlock(n = 1): number {
    this.simulatedBlock += n;
    return this.simulatedBlock;
  }

  get blockHeight(): number {
    return this.simulatedBlock;
  }

  info(): Record<string, unknown> {
    const all = [...this.cases.values()];
    return {
      mode: this.mode,
      phase: "B5",
      open: all.filter((c) => c.status === "OPEN" || c.status === "CHALLENGING").length,
      resolved: all.filter((c) => c.status === "RESOLVED").length,
      expired: all.filter((c) => c.status === "EXPIRED" || c.status === "DEFAULTED").length,
      total: all.length,
      fraud_window_blocks: this.cfg.fraudWindowBlocks,
      fraud_window_ms: this.cfg.fraudWindowMs,
      auto_challenge: this.cfg.autoChallenge,
      escrow: this.cfg.escrowAddress,
      simulated_block: this.simulatedBlock,
    };
  }

  list(status?: ChallengeStatus): ChallengeCase[] {
    const all = [...this.cases.values()];
    if (!status) return all;
    return all.filter((c) => c.status === status);
  }

  of(taskId: string): ChallengeCase | undefined {
    return this.cases.get(taskId);
  }

  /**
   * Open a fraud case for a DISPUTED task. Optionally auto-challenges.
   */
  async open(params: OpenChallengeParams): Promise<ChallengeCase> {
    const existing = this.cases.get(params.taskId);
    if (existing && existing.status !== "EXPIRED" && existing.status !== "DEFAULTED") {
      return existing;
    }

    const c: ChallengeCase = {
      taskId: params.taskId,
      status: "OPEN",
      reported: params.reported,
      inputJson: params.inputJson,
      buyer: params.buyer,
      worker: params.worker,
      amount: params.amount,
      openAt: Date.now(),
      openBlock: params.openBlock ?? this.simulatedBlock,
      windowBlocks: this.cfg.fraudWindowBlocks,
      windowMs: this.cfg.fraudWindowMs,
      originalVotes: params.votes,
      evidence: params.evidence,
      slashes: params.slashes ?? [],
      rulingNonce: (this.nonces.get(params.taskId) ?? 0) + 1,
    };
    this.cases.set(params.taskId, c);

    // best-effort slash evidence posts for original false voters
    if (this.slashChain && params.evidence) {
      for (const s of params.slashes ?? []) {
        void this.slashChain.submit({
          evidenceHash: params.evidence.sig,
          target: s.target,
          severity: s.severity,
        });
      }
    }

    if (this.cfg.autoChallenge) {
      await this.challenge(params.taskId);
    }
    return this.cases.get(params.taskId)!;
  }

  /**
   * Re-execute with a fresh challenge quorum and decide a ruling (does not post on-chain).
   */
  async challenge(taskId: string, opts: { quorum?: string[] } = {}): Promise<ChallengeResult> {
    const c = this.cases.get(taskId);
    if (!c) throw new Error(`no fraud case for ${taskId}`);
    if (c.status === "RESOLVED" || c.status === "DEFAULTED") {
      return {
        case: c,
        ruling: c.ruling!,
        recomputed: c.recomputed!,
        challengeVotes: c.challengeVotes ?? [],
        reason: c.reason ?? "already resolved",
      };
    }
    if (this.isWindowClosed(c)) {
      c.status = "EXPIRED";
      throw new Error(`fraud window closed for ${taskId}`);
    }

    c.status = "CHALLENGING";
    const originalIds = c.originalVotes.map((v) => v.verifier);
    const quorum = opts.quorum ?? pickChallengeQuorum(originalIds);
    const { votes, recomputed } = runChallengeVotes(taskId, c.inputJson, c.reported, quorum);
    const { ruling, reason } = decideRuling(c.reported, recomputed);

    c.challengeVotes = votes;
    c.recomputed = recomputed;
    c.ruling = ruling;
    c.reason = reason;
    c.status = "RESOLVED";
    c.resolvedAt = Date.now();
    this.nonces.set(taskId, c.rulingNonce);

    return { case: c, ruling, recomputed, challengeVotes: votes, reason };
  }

  /**
   * Apply a manual ruling (operator) without re-exec, still window-gated.
   */
  async manualRule(taskId: string, rulingRaw: string, reason?: string): Promise<ChallengeCase> {
    const c = this.cases.get(taskId);
    if (!c) throw new Error(`no fraud case for ${taskId}`);
    if (this.isWindowClosed(c) && c.status !== "RESOLVED") {
      c.status = "EXPIRED";
      throw new Error(`fraud window closed for ${taskId}`);
    }
    const ruling = normalizeRuling(rulingRaw);
    c.ruling = ruling;
    c.reason = reason ?? `manual ruling: ${ruling}`;
    c.recomputed = c.recomputed ?? expectedPureHash(taskId, c.inputJson);
    c.status = "RESOLVED";
    c.resolvedAt = Date.now();
    this.nonces.set(taskId, c.rulingNonce);
    return c;
  }

  /**
   * Submit Escrow.rule for a resolved case (or sign-only offline).
   */
  async submitRule(taskId: string, override?: RulingKind): Promise<RuleSubmitResult> {
    const c = this.cases.get(taskId);
    if (!c) throw new Error(`no fraud case for ${taskId}`);
    if (c.status !== "RESOLVED" && !override) {
      // try challenge first
      await this.challenge(taskId);
    }
    const ruling = override ?? c.ruling;
    if (!ruling) throw new Error("no ruling to submit");
    if (this.isWindowClosed(c) && this.cfg.escrowAddress) {
      // on-chain path would revert WindowClosed — surface clearly
      return {
        mode: "simulated",
        error: "fraud window closed",
        ruling,
        nonce: c.rulingNonce,
      };
    }

    const taskBytes = taskIdToBytes32(taskId);
    const nonce = BigInt(c.rulingNonce);
    const domain = this.cfg.escrowAddress
      ? domainSeparatorEscrow(this.cfg.chainId, this.cfg.escrowAddress as Address)
      : domainSeparatorEscrow(this.cfg.chainId, "0x0000000000000000000000000000000000000001");
    const digest = rulingDigest(domain, taskBytes, ruling, nonce);

    let sig: Hex | undefined;
    if (this.cfg.rulerKey) {
      const account = privateKeyToAccount(this.cfg.rulerKey as Hex);
      sig = await account.sign({ hash: digest });
    }

    if (!this.cfg.escrowAddress) {
      c.chain = { mode: "offline" };
      return { mode: "offline", ruling, nonce: c.rulingNonce, sig };
    }

    if (!sig) {
      const data = this.encodeRule(taskBytes, ruling, nonce, "0x");
      c.chain = { mode: "simulated", error: "no RULER_KEY", calldata: data };
      return { mode: "simulated", error: "no RULER_KEY", calldata: data, ruling, nonce: c.rulingNonce };
    }

    const data = this.encodeRule(taskBytes, ruling, nonce, sig);
    const sent = await this.sendTx(data as Hex);
    c.chain = { mode: sent.mode, txHash: sent.txHash, error: sent.error, calldata: data };
    return { ...sent, ruling, nonce: c.rulingNonce, sig, calldata: data };
  }

  /**
   * After window expiry: mark defaulted + optional Escrow.defaultRefund.
   */
  async defaultRefund(taskId: string): Promise<RuleSubmitResult & { status: ChallengeStatus }> {
    const c = this.cases.get(taskId);
    if (!c) throw new Error(`no fraud case for ${taskId}`);
    if (!this.isWindowClosed(c) && c.status !== "EXPIRED") {
      throw new Error(`fraud window still open for ${taskId}`);
    }
    c.status = "DEFAULTED";
    c.ruling = "Refund";
    c.reason = "window expired — default refund to buyer";
    c.resolvedAt = Date.now();

    if (!this.cfg.escrowAddress) {
      c.chain = { mode: "offline" };
      return { mode: "offline", ruling: "Refund", nonce: c.rulingNonce, status: c.status };
    }

    const data = encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "defaultRefund",
      args: [taskIdToBytes32(taskId)],
    });
    const sent = await this.sendTx(data);
    c.chain = { mode: sent.mode, txHash: sent.txHash, error: sent.error, calldata: data };
    return { ...sent, ruling: "Refund", nonce: c.rulingNonce, status: c.status, calldata: data };
  }

  isWindowClosed(c: ChallengeCase): boolean {
    const byBlock = this.simulatedBlock > c.openBlock + c.windowBlocks;
    const byTime = Date.now() > c.openAt + c.windowMs;
    // Offline: wall clock; write path tests can force block via tickBlock
    if (this.cfg.escrowAddress && this.simulatedBlock > 0) return byBlock;
    if (!this.cfg.escrowAddress) return byTime;
    // write-ready without simulated blocks: use wall clock as soft gate
    return byTime;
  }

  /* ----------------------------- internals -------------------------------- */

  private encodeRule(taskId: Hex, ruling: RulingKind, nonce: bigint, sig: string): string {
    return encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "rule",
      args: [taskId, RULING_CODE[ruling], nonce, sig as Hex],
    });
  }

  private async sendTx(data: Hex): Promise<{ mode: "submitted" | "simulated" | "offline"; txHash?: string; error?: string }> {
    if (!this.cfg.escrowAddress) return { mode: "offline" };
    const to = this.cfg.escrowAddress as Address;
    const chain = pickChain(this.cfg.chainId);

    if (this.cfg.rulerKey) {
      try {
        const account = privateKeyToAccount(this.cfg.rulerKey as Hex);
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

    return { mode: "simulated", error: "no RULER_KEY or PROTOCOL_FROM" };
  }

  static forTest(opts: Partial<FraudConfig> = {}, slash?: SlashExecutorGateway): FraudProofWorker {
    return new FraudProofWorker(
      {
        rpcUrl: opts.rpcUrl ?? "http://127.0.0.1:8545",
        escrowAddress: opts.escrowAddress ?? null,
        rulerKey: opts.rulerKey ?? null,
        fromAddress: opts.fromAddress ?? null,
        chainId: opts.chainId ?? 31337,
        fraudWindowBlocks: opts.fraudWindowBlocks ?? 64,
        fraudWindowMs: opts.fraudWindowMs ?? 60_000,
        autoChallenge: opts.autoChallenge ?? true,
      },
      slash,
    );
  }
}

// silence unused import if pureRecompute path always used
void createPublicClient;

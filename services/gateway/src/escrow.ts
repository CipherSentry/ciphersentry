/**
 * Escrow gateway — optional on-chain commit writer for B0.
 *
 * Modes:
 *   OFFLINE  — no ESCROW_ADDRESS: returns null (ledger stays in-memory)
 *   WATCH    — address set, no key: read-only via ChainWatcher
 *   WRITE    — PROTOCOL_KEY (or unlocked eth_sendTransaction account):
 *              encodes Escrow.commit and submits a tx on Base-Sepolia
 *
 * Escrow.commit(bytes32 spec, address worker, uint96 amount, uint96 bond)
 * selector = keccak256("commit(bytes32,address,uint96,uint96)")[0:4]
 */

export interface EscrowWriteConfig {
  rpcUrl: string;
  escrowAddress: string | null;
  /** 0x-prefixed private key — only used if the RPC rejects eth_sendTransaction */
  protocolKey: string | null;
  /** from address when using eth_sendTransaction (unlocked / anvil) */
  fromAddress: string | null;
  chainId: number;
  /** USDC 6-decimals bond floor match Escrow.MIN_BOND */
  defaultBond: bigint;
}

export interface ChainCommitParams {
  taskIdHint: string;
  worker: string; // 0x address OR agent id (hashed when not address)
  buyer?: string;
  amountUsdc: string; // decimal string e.g. "10.00"
  spec: string;
}

export interface ChainCommitResult {
  mode: "offline" | "submitted" | "simulated";
  txHash?: string;
  taskId?: string;
  error?: string;
}

/** first 4 bytes of keccak256("commit(bytes32,address,uint96,uint96)") — cast sig */
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

/** FNV-ish bytes32 stand-in for non-address agent ids / specs (deterministic). */
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

function encodeCommitCalldata(spec: string, worker: string, amount: bigint, bond: bigint): string {
  const specWord = isAddress(spec) ? pad32(spec) : fnvBytes32(spec);
  const workerWord = isAddress(worker) ? encodeAddress(worker) : encodeAddress("0x" + fnvBytes32(worker).slice(0, 40));
  const amountWord = pad32(amount.toString(16));
  const bondWord = pad32(bond.toString(16));
  return "0x" + COMMIT_SELECTOR + specWord + workerWord + amountWord + bondWord;
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

export function makeEscrowConfigFromEnv(): EscrowWriteConfig {
  return {
    rpcUrl: process.env.CHAIN_RPC ?? "https://base-sepolia.publicnode.com",
    escrowAddress: process.env.ESCROW_ADDRESS ?? null,
    protocolKey: process.env.PROTOCOL_KEY ?? null,
    fromAddress: process.env.PROTOCOL_FROM ?? process.env.OPERATOR_ADDRESS ?? null,
    chainId: Number(process.env.CHAIN_ID ?? 84532), // Base Sepolia
    defaultBond: BigInt(process.env.DEFAULT_BOND_USDC_UNITS ?? "10000"), // 0.01 USDC
  };
}

export class EscrowGateway {
  constructor(private cfg: EscrowWriteConfig) {}

  get enabled(): boolean {
    return Boolean(this.cfg.escrowAddress);
  }

  get mode(): "offline" | "write-ready" | "watch-only" {
    if (!this.cfg.escrowAddress) return "offline";
    if (this.cfg.fromAddress || this.cfg.protocolKey) return "write-ready";
    return "watch-only";
  }

  /**
   * Attempt on-chain commit. Never throws into the RPC path —
   * returns simulated/offline so the in-memory ledger still advances.
   */
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
    const to = this.cfg.escrowAddress;

    // Dev path: unlocked account on local/dev RPC
    if (this.cfg.fromAddress) {
      try {
        const txHash = await rpc<string>(this.cfg.rpcUrl, "eth_sendTransaction", [
          {
            from: this.cfg.fromAddress,
            to,
            data,
            // value 0 — USDC pulled via transferFrom; caller must have approved
            value: "0x0",
          },
        ]);
        return {
          mode: "submitted",
          txHash,
          taskId: params.taskIdHint,
        };
      } catch (e) {
        return {
          mode: "simulated",
          taskId: params.taskIdHint,
          error: `eth_sendTransaction failed: ${(e as Error).message}`,
        };
      }
    }

    // PROTOCOL_KEY present but no raw-signer library bundled in B0 —
    // record intent for the operator / external signer.
    if (this.cfg.protocolKey) {
      return {
        mode: "simulated",
        taskId: params.taskIdHint,
        error: "PROTOCOL_KEY set — use external signer or PROTOCOL_FROM unlocked account; calldata ready",
        txHash: undefined,
      };
    }

    return { mode: "simulated", taskId: params.taskIdHint };
  }

  /** Expose calldata for external signers / docs. */
  encodeCommit(params: ChainCommitParams): string {
    const amount = usdcToUint96(params.amountUsdc);
    return encodeCommitCalldata(params.spec, params.worker, amount, this.cfg.defaultBond);
  }
}


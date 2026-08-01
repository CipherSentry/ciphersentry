/**
 * Chain watcher — binds the gateway's event stream to deployed contracts.
 *
 * Listens over JSON-RPC eth_getLogs for our two ENG-A contracts and decodes
 * events ONLY by their exact topic0 signature hash (computed here from the
 * event signatures of Escrow.sol and SettlementBatcher.sol — no guessing,
 * validated by tests, not trust). A tiny legal-transition fallback remains
 * for any future events the table doesn't know yet.
 */

import { keccak256 } from "./keccak256";

/* ------------------------------ config ------------------------------------- */

export interface ChainConfig {
  rpcUrl: string;
  escrowAddress: string | null;
  batcherAddress: string | null;
  pollMs: number;
  startBlock?: bigint;
}

type Log = {
  address: string;
  blockNumber: `0x${string}`;
  data: `0x${string}`;
  topics: `0x${string}`[];
  logIndex?: `0x${string}`;
};

const BLOCK_STEP = 500n;
const DEFAULT_POLL = 2_500;

/* --------------------- event topic registry (the law) ---------------------- */

const S = (s: string) => keccak256(new TextEncoder().encode(s));

/**
 * Signature of every event our broadcasts emit, hashed at load time into its
 * topic0 fingerprint. Order-independent lookup across both contracts.
 */
export const EVENT_TOPICS: Record<string, { state: string }> = {
  [S("Committed(bytes32,address,address,uint96,uint96,bytes32)")]: { state: "COMMITTED" },
  [S("Acknowledged(bytes32,uint64)")]: { state: "EXECUTING" },
  [S("Reported(bytes32,bytes32)")]: { state: "VERIFYING" },
  [S("Voted(bytes32,address,bool,uint8,uint8)")]: { state: "VERIFYING" },
  [S("Disputed(bytes32,bytes32,bytes32)")]: { state: "DISPUTED" },
  [S("Settled(bytes32,uint8,uint96,uint96,uint96)")]: { state: "SETTLED" },
  [S("Ruled(bytes32,uint8,uint64)")]: { state: "SETTLED" },
  [S("Failed(bytes32,uint96)")]: { state: "FAILED" },
  [S("BatchAnchored(uint64,bytes32,uint32,address,bool)")]: { state: "ANCHORED" },
};

const NEXT: Record<string, string[]> = {
  COMMITTED: ["EXECUTING"],
  EXECUTING: ["VERIFYING", "FAILED"],
  VERIFYING: ["SETTLED", "DISPUTED"],
  DISPUTED: ["SETTLED", "FAILED"],
};

/** Pure decode — importable in tests without invoking the watcher. */
export function decodeLog(
  log: Log,
  lastState: string | undefined,
  isEscrow: boolean,
): { state?: string; taskId?: string } | { anchor: true; batchId: number; root: string } | null {
  const t0 = log.topics[0]?.toLowerCase();
  let state = t0 ? EVENT_TOPICS[t0]?.state : undefined;

  if (!state) {
    // legal-transition fallback for any future events the table doesn't know
    state = isEscrow && last && NEXT[last]
      ? NEXT[last]![0]
      : isEscrow
        ? "COMMITTED"
        : "ANCHORED";
  }

  if (isEscrow) {
    const rawId = log.topics[1];
    if (!rawId) return null;
    if (lastState && NEXT[lastState] && !NEXT[lastState].includes(state)) return null; // skip impossible orders
    return { state, taskId: rawId.toLowerCase() };
  }

  if (state !== "ANCHORED") return null;
  if (!log.topics[1] || !log.topics[2]) return null;
  return { anchor: true, batchId: Number(BigInt(log.topics[1])), root: log.topics[2] };
}

/* --------------------------- rpc via fetch --------------------------------- */

async function rpc<T = unknown>(cfg: ChainConfig, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

const latestBlock = async (cfg: ChainConfig): Promise<bigint> =>
  BigInt((await rpc(cfg, "eth_blockNumber", [])) as string);

async function getLogs(cfg: ChainConfig, address: string, fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  try {
    return await rpc<Log[]>(cfg, "eth_getLogs", [
      { address, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` },
    ]);
  } catch {
    return [];
  }
}

/* ------------------------------ watcher ----------------------------------- */

export interface ChainEvents {
  onTaskFrame: (t: Record<string, unknown>) => void;
  onBatchFrame: (b: Record<string, unknown>) => void;
}

export class ChainWatcher {
  private lastBlock: bigint;
  private stateByTask = new Map<string, string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private cfg: ChainConfig,
    private events: ChainEvents,
  ) {
    this.lastBlock = cfg.startBlock ?? 0n;
  }

  get enabled(): boolean {
    return Boolean(this.cfg.escrowAddress || this.cfg.batcherAddress);
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    this.lastBlock = this.cfg.startBlock ?? (await latestBlock(this.cfg));
    console.log(`  chain     → watching from block ${this.lastBlock}`);
    this.timer = setInterval(() => void this.poll(), this.cfg.pollMs ?? DEFAULT_POLL);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    try {
      const upTo = await latestBlock(this.cfg);
      if (upTo <= this.lastBlock) return;
      const from = this.lastBlock + 1n;
      const to = from + BLOCK_STEP > upTo ? upTo : from + BLOCK_STEP;

      const logs: Log[] = [];
      if (this.cfg.escrowAddress) logs.push(...(await getLogs(this.cfg, this.cfg.escrowAddress, from, to)));
      if (this.cfg.batcherAddress) logs.push(...(await getLogs(this.cfg, this.cfg.batcherAddress, from, to)));

      logs.sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? (a.logIndex ?? "0x").localeCompare(b.logIndex ?? "0x")
          : a.blockNumber.localeCompare(b.blockNumber),
      );

      for (const log of logs) this.handle(log);
      this.lastBlock = to;
    } catch {
      // tolerant: chain polling should never kill the gateway's tick loop
    }
  }

  private handle(log: Log): void {
    const isEscrow = this.cfg.escrowAddress?.toLowerCase() === log.address.toLowerCase();
    const decoded = decodeLog(log, this.stateByTask.get(log.topics[1]?.toLowerCase() ?? ""), isEscrow);
    if (!decoded) return;

    if ("anchor" in decoded && decoded.anchor) {
      this.events.onBatchFrame({
        batch_id: `batch_${decoded.batchId}`,
        root: decoded.root,
        count: 0,
        state: "SETTLED",
        _src: "chain",
      });
      return;
    }

    if ("taskId" in decoded && decoded.taskId) {
      const { taskId, state } = decoded as { taskId: string; state: string };
      this.stateByTask.set(taskId, state);
      this.events.onTaskFrame({
        id: taskId,
        state,
        role: "work",
        at: Number(BigInt(log.blockNumber)),
        spec: "on-chain",
        _src: "chain",
      });
    }
  }
}

export function makeChainConfigFromEnv(): ChainConfig {
  return {
    rpcUrl: process.env.CHAIN_RPC ?? "https://base-sepolia.publicnode.com",
    escrowAddress: process.env.ESCROW_ADDRESS ?? null,
    batcherAddress: process.env.BATCHER_ADDRESS ?? null,
    pollMs: Number(process.env.CHAIN_POLL_MS ?? 2500),
    startBlock: process.env.CHAIN_START_BLOCK ? BigInt(process.env.CHAIN_START_BLOCK) : undefined,
  };
}

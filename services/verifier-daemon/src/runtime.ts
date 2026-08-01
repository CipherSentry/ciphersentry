/**
 * Deterministic WASM runtime — the sandbox every verifier re-executes inside.
 *
 * Design contract (architecture.md §2 VERIFIER POOL):
 *  1. Same input → same bytes, on any machine, regardless of host clock.
 *  2. The module can only call what the frozen table allows.
 *  3. Deterministic clock + seeded RNG are injected FROM THE TASK, so two
 *     honest recomputes of the same task produce identical behavior.
 *
 * Production note: true instruction fueling requires `wasm-instrumentation`
 * metering injection. This runtime exposes `mrc_budget_checkpoint` and the
 * BUDGET_HOOK seam below; swap the no-op for the metered variant without
 * touching daemon code.
 */

/* ---------------- hashing + canonical form (independent of the web sdk) --- */

const fnv32 = (s: string, seed = 0x811c9dc5): number => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export const hex = (n: number): string => n.toString(16).padStart(8, "0");
export const outputHashOf = (s: string): string => `0x${hex(fnv32(s))}${hex(fnv32(s, 0x9af2be))}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function canonicalize(value: unknown): string {
  if (isObj(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return JSON.stringify(value) ?? "null";
}

/* ---------------- deterministic clock + seeded rng ------------------------ */

/** Clock is a pure function of the task identity — every verifier's "now"
 *  is the same "now", forever. Derived, not declared: fnv(first 4 hex of task). */
export function injectedNowMs(taskId: string): number {
  const h = fnv32(`now:${taskId}`);
  return 1_700_000_000_000 + (h % 86_400_000); // epoch + up to one day, stable per task
}

/** PCG32 — small, exact, perfectly reproducible across JS engines. */
export class SeededRng {
  private state: bigint;
  private inc: bigint;

  constructor(seedHex: string) {
    this.state = BigInt(`0x${seedHex.slice(0, 16)}`);
    this.inc = BigInt(`0x${seedHex.slice(16, 32) || "1"}`) | 1n;
    this.next();
    this.next();
  }

  next(): number {
    const prev = this.state;
    this.state = (prev * 6364136223846793005n + this.inc) % 2n ** 64n;
    const xorshifted = Number((prev >> 18n) ^ prev) >>> 0;
    return ((xorshifted >>> 27) | (xorshifted << 5)) >>> 0;
  }

  nextF64(): number {
    return this.next() / 2 ** 32;
  }
}

/* ------------------------- frozen syscall table --------------------------- */

export const FROZEN_IMPORTS = [
  "mrc_now",
  "mrc_rng_next",
  "mrc_log",
  "mrc_budget_checkpoint",
] as const;

export type FrozenImport = (typeof FROZEN_IMPORTS)[number];

/** Version of the allowed table, published in the audit pack. Any module
 *  importing a name outside it is rejected before execution. */
export const FROZEN_TABLE_HASH = outputHashOf(FROZEN_IMPORTS.join("|"));

/* ------------------------------ runtime ----------------------------------- */

export interface RunRequest {
  wasm: Uint8Array;
  taskId: string;
  inputJson: unknown;
  maxMemoryPages?: number; // default 64
  wallBudgetMs?: number; // advisory until fueling hooks are metered
}

export interface RunResult {
  ok: boolean;
  outputJson?: unknown;
  outputHash?: string;
  error?: string;
  ms: number;
  logs: string[];
}

export class DeterministicSandbox {
  async run(req: RunRequest): Promise<RunResult> {
    const started = Date.now();
    const logs: string[] = [];
    const maxMem = req.maxMemoryPages ?? 64;

    /* --- compile + frozen-table enforcement --- */
    let mod: WebAssembly.Module;
    try {
      mod = await WebAssembly.compile(req.wasm as BufferSource);
    } catch (e) {
      return { ok: false, error: `compile: ${msg(e)}`, ms: Date.now() - started, logs };
    }

    for (const imp of WebAssembly.Module.imports(mod)) {
      if (imp.module !== "env") return { ok: false, error: `import namespace "${imp.module}" forbidden`, ms: Date.now() - started, logs };
      if (!(FROZEN_IMPORTS as readonly string[]).includes(imp.name)) {
        return { ok: false, error: `unfrozen syscall "${imp.name}" rejected`, ms: Date.now() - started, logs };
      }
    }

    /* --- deterministic host imports --- */
    const taskNow = injectedNowMs(req.taskId);
    const rng = new SeededRng(canonicalHashForTask(req.taskId));
    const memory = new WebAssembly.Memory({ initial: 1, maximum: maxMem });
    let budgetOk = true;

    const env: Record<string, WebAssembly.ImportValue> = {
      memory,
      mrc_now: () => taskNow, // always the same answer for this task
      mrc_rng_next: () => rng.next(),
      mrc_log: (ptr: number, len: number) => {
        logs.push(decodeMemory(memory, ptr, len).slice(0, 240));
      },
      // BUDGET_HOOK: replace with metered countdown once fueling is injected.
      mrc_budget_checkpoint: (remaining: number) => {
        if (remaining <= 0) budgetOk = false;
        return budgetOk ? 1 : 0;
      },
    };

    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(mod, { env });
    } catch (e) {
      return { ok: false, error: `instantiate: ${msg(e)}`, ms: Date.now() - started, logs };
    }

    /* --- write input canonically; call the entry point --- */
    const inputString = canonicalize(req.inputJson);
    const inputBytes = new TextEncoder().encode(inputString);
    const INPUT_PTR = 65_536; // spec ABI: input region starts at 64KiB
    ensureMemory(memory, INPUT_PTR + inputBytes.length);
    new Uint8Array(memory.buffer).set(inputBytes, INPUT_PTR);

    const execute = instance.exports.mrc_execute as (ptr: number, len: number) => number;
    if (typeof execute !== "function") {
      return { ok: false, error: `module must export mrc_execute(ptr,u32)->u64`, ms: Date.now() - started, logs };
    }

    let packed: number;
    try {
      packed = execute(INPUT_PTR, inputBytes.length);
    } catch (e) {
      return { ok: false, error: `execute trap: ${msg(e)}`, ms: Date.now() - started, logs };
    }
    if (!budgetOk) {
      return { ok: false, error: "budget exhausted by module", ms: Date.now() - started, logs };
    }

    /* ABI: returns (ptr << 32) | len as a single u64 (i64) — JS number is
       exact for values below 2^53; enforce i32x2 layout for safety. */
    const outPtr = packed >>> 0;
    const memOut = instance.exports.memory as WebAssembly.Memory | undefined;
    const mem = memOut ?? memory;
    const outJsonString = decodeMemory(mem, outPtr, readU32(mem, outPtr));
    const prefix = new TextDecoder().decode(new Uint8Array(outJsonString));

    let outputJson: unknown;
    try {
      outputJson = JSON.parse(prefix.slice(4)); // first 4 bytes are len
    } catch {
      outputJson = prefix;
    }

    const canonicalOut = canonicalize(outputJson);
    return {
      ok: true,
      outputJson,
      outputHash: outputHashOf(canonicalOut),
      ms: Date.now() - started,
      logs,
    };
  }
}

/* ------------------------------ helpers ----------------------------------- */

export function canonicalHashForTask(taskId: string): string {
  return outputHashOf(canonicalize({ task: taskId, op: "seed" })).slice(2);
}

function ensureMemory(memory: WebAssembly.Memory, needBytes: number): void {
  const have = memory.buffer.byteLength;
  if (needBytes <= have) return;
  const pagesNeeded = Math.ceil((needBytes - have) / 65_536);
  memory.grow(pagesNeeded);
}

function decodeMemory(memory: WebAssembly.Memory, ptr: number, len: number): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(memory.buffer, ptr, len));
}

function readU32(memory: WebAssembly.Memory, ptr: number): number {
  return new DataView(memory.buffer).getUint32(ptr, true);
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

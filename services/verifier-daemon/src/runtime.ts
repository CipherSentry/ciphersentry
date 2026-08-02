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
 * metering injection. This runtime exposes `cent_budget_checkpoint` and the
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
  "cent_now",
  "cent_rng_next",
  "cent_log",
  "cent_budget_checkpoint",
] as const;

export type FrozenImport = (typeof FROZEN_IMPORTS)[number];

/** Version of the allowed table, published in the audit pack. Any module
 *  importing a name outside it is rejected before execution. */
export const FROZEN_TABLE_HASH = outputHashOf(FROZEN_IMPORTS.join("|"));

/* ------------------------------ runtime ----------------------------------- */

export interface RunRequest {
  /** When omitted / empty, pure-JS recompute is used (B1 default for non-WASM specs). */
  wasm?: Uint8Array;
  taskId: string;
  inputJson: unknown;
  maxMemoryPages?: number; // default 64
  wallBudgetMs?: number; // advisory until fueling hooks are metered
  /** Force pure mode even if wasm bytes are present. */
  mode?: "wasm" | "pure";
}

export interface RunResult {
  ok: boolean;
  outputJson?: unknown;
  outputHash?: string;
  error?: string;
  ms: number;
  logs: string[];
  mode?: "wasm" | "pure";
}

/**
 * Pure recompute — no WASM. Output hash is a function of canonical input only.
 * Same taskId + input → same hash on every foundation verifier.
 */
export function pureRecompute(inputJson: unknown, taskId: string): { outputJson: unknown; outputHash: string } {
  const outputJson = {
    ok: true,
    task: taskId,
    input: inputJson,
    now: injectedNowMs(taskId),
  };
  return { outputJson, outputHash: outputHashOf(canonicalize(outputJson)) };
}

export class DeterministicSandbox {
  async run(req: RunRequest): Promise<RunResult> {
    const started = Date.now();
    const logs: string[] = [];
    const wantPure = req.mode === "pure" || !req.wasm || req.wasm.byteLength === 0;

    if (wantPure) {
      const { outputJson, outputHash } = pureRecompute(req.inputJson, req.taskId);
      return { ok: true, outputJson, outputHash, ms: Date.now() - started, logs, mode: "pure" };
    }

    /* --- compile + frozen-table enforcement --- */
    const maxMem = req.maxMemoryPages ?? 64;
    let mod: WebAssembly.Module;
    try {
      mod = await WebAssembly.compile(req.wasm as BufferSource);
    } catch (e) {
      return { ok: false, error: `compile: ${msg(e)}`, ms: Date.now() - started, logs, mode: "wasm" };
    }

    for (const imp of WebAssembly.Module.imports(mod)) {
      if (imp.module !== "env") {
        return { ok: false, error: `import namespace "${imp.module}" forbidden`, ms: Date.now() - started, logs, mode: "wasm" };
      }
      if (!(FROZEN_IMPORTS as readonly string[]).includes(imp.name)) {
        return { ok: false, error: `unfrozen syscall "${imp.name}" rejected`, ms: Date.now() - started, logs, mode: "wasm" };
      }
    }

    /* --- deterministic host imports --- */
    const taskNow = injectedNowMs(req.taskId);
    const rng = new SeededRng(canonicalHashForTask(req.taskId));
    let budgetOk = true;

    // Prefer the module's own exported memory when present (fixture style).
    const env: Record<string, WebAssembly.ImportValue> = {
      cent_now: () => taskNow,
      cent_rng_next: () => rng.next(),
      cent_log: (ptr: number, len: number) => {
        // bound later once we know which memory the instance owns
        void ptr;
        void len;
      },
      // BUDGET_HOOK: replace with metered countdown once fueling is injected.
      cent_budget_checkpoint: (remaining: number) => {
        if (remaining <= 0) budgetOk = false;
        return budgetOk ? 1 : 0;
      },
    };

    let instance: WebAssembly.Instance;
    try {
      instance = await WebAssembly.instantiate(mod, { env });
    } catch (e) {
      // Some modules import env.memory — provide it and retry once.
      const memory = new WebAssembly.Memory({ initial: 1, maximum: maxMem });
      env.memory = memory;
      env.cent_log = (ptr: number, len: number) => {
        logs.push(decodeMemory(memory, ptr, len).slice(0, 240));
      };
      try {
        instance = await WebAssembly.instantiate(mod, { env });
      } catch (e2) {
        return { ok: false, error: `instantiate: ${msg(e2)}`, ms: Date.now() - started, logs, mode: "wasm" };
      }
    }

    const mem = (instance.exports.memory as WebAssembly.Memory | undefined) ?? (env.memory as WebAssembly.Memory | undefined);
    if (!mem) {
      return { ok: false, error: "module must export or import memory", ms: Date.now() - started, logs, mode: "wasm" };
    }
    env.cent_log = (ptr: number, len: number) => {
      logs.push(decodeMemory(mem, ptr, Math.min(len, 240)));
    };

    /* --- write input canonically; call the entry point --- */
    const inputString = canonicalize(req.inputJson);
    const inputBytes = new TextEncoder().encode(inputString);
    const INPUT_PTR = 1024; // low-memory fixtures (1 page) cannot host 64KiB inputs
    ensureMemory(mem, INPUT_PTR + inputBytes.length);
    new Uint8Array(mem.buffer).set(inputBytes, INPUT_PTR);

    const execute = instance.exports.cent_execute as ((ptr: number, len: number) => number | bigint) | undefined;
    if (typeof execute !== "function") {
      return { ok: false, error: "module must export cent_execute(ptr,u32)->i32|i64", ms: Date.now() - started, logs, mode: "wasm" };
    }

    let packed: number | bigint;
    try {
      packed = execute(INPUT_PTR, inputBytes.length);
    } catch (e) {
      return { ok: false, error: `execute trap: ${msg(e)}`, ms: Date.now() - started, logs, mode: "wasm" };
    }
    if (!budgetOk) {
      return { ok: false, error: "budget exhausted by module", ms: Date.now() - started, logs, mode: "wasm" };
    }

    const outputJson = decodeWasmOutput(mem, packed);
    if (outputJson === undefined) {
      return { ok: false, error: "unable to decode module output", ms: Date.now() - started, logs, mode: "wasm" };
    }

    const canonicalOut = canonicalize(outputJson);
    return {
      ok: true,
      outputJson,
      outputHash: outputHashOf(canonicalOut),
      ms: Date.now() - started,
      logs,
      mode: "wasm",
    };
  }
}

/** Decode ABI: packed = (ptr << 32) | len, or ptr to [u32 le len][bytes], or bare JSON in low memory. */
export function decodeWasmOutput(memory: WebAssembly.Memory, packed: number | bigint): unknown | undefined {
  const p = typeof packed === "bigint" ? packed : BigInt(packed >>> 0);
  const hi = Number(p >> 32n);
  const lo = Number(p & 0xffffffffn);

  const tryRegion = (ptr: number, lenHint?: number): unknown | undefined => {
    if (ptr < 0 || ptr >= memory.buffer.byteLength) return undefined;
    const view = new DataView(memory.buffer);
    const len = lenHint && lenHint > 0 ? lenHint : view.getUint32(ptr, true);
    if (len > 0 && len < 1 << 20 && ptr + 4 + len <= memory.buffer.byteLength) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(
        new Uint8Array(memory.buffer, ptr + 4, len),
      );
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    // bare JSON starting at ptr (fixture: u32 len may be wrong; scan braces)
    const slice = new Uint8Array(memory.buffer, ptr, Math.min(4096, memory.buffer.byteLength - ptr));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return undefined;
  };

  // (ptr << 32) | len layout
  if (hi > 0) {
    const got = tryRegion(hi, lo);
    if (got !== undefined) return got;
  }
  // packed as ptr only
  const asPtr = lo || Number(p);
  const got = tryRegion(asPtr);
  if (got !== undefined) return got;
  // common fixture: writes output at address 0
  return tryRegion(0);
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

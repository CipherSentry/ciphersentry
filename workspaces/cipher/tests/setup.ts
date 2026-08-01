import { afterEach, beforeEach, vi } from "vitest";

/** In-memory localStorage — the crypto layer is browser-first, tests are node. */
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => {
    this.m.set(k, v);
  };
  removeItem = (k: string) => {
    this.m.delete(k);
  };
  key = (i: number) => [...this.m.keys()][i] ?? null;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemStorage());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

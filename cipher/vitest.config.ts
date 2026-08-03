import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15_000,
    // forks + fake timers in transport tests OOM'd the worker (heap)
    pool: "threads",
    maxWorkers: 2,
  },
});

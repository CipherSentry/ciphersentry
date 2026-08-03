/**
 * B7 key custody unit tests.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeKey, resolveSecret, isProdOps } from "../src/keys.ts";

describe("keys custody", () => {
  const prev: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cs-keys-"));
    for (const k of [
      "PROTOCOL_KEY",
      "PROTOCOL_KEY_FILE",
      "PRIVATE_KEY",
      "CS_ENV",
      "B7",
      "B7_PROD",
      "NODE_ENV",
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("normalizeKey pads 0x", () => {
    assert.match(normalizeKey("ab".repeat(32)), /^0xab/);
    assert.match(normalizeKey("0x" + "cd".repeat(32)), /^0xcd/);
  });

  it("prefers *_FILE over env", () => {
    const f = join(dir, "pk");
    writeFileSync(f, "11".repeat(32) + "\n");
    process.env.PROTOCOL_KEY = "0x" + "22".repeat(32);
    process.env.PROTOCOL_KEY_FILE = f;
    const k = resolveSecret("PROTOCOL_KEY");
    assert.equal(k, "0x" + "11".repeat(32));
    unlinkSync(f);
  });

  it("falls back to env", () => {
    process.env.PROTOCOL_KEY = "0x" + "33".repeat(32);
    assert.equal(resolveSecret("PROTOCOL_KEY", "PRIVATE_KEY"), "0x" + "33".repeat(32));
  });

  it("isProdOps from CS_ENV/B7", () => {
    assert.equal(isProdOps(), false);
    process.env.CS_ENV = "production";
    assert.equal(isProdOps(), true);
    delete process.env.CS_ENV;
    process.env.B7 = "1";
    assert.equal(isProdOps(), true);
  });
});

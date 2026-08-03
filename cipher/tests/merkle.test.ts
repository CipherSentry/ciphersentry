import { describe, expect, it } from "vitest";
import {
  keccakHex,
  normalizeHex32,
  proofLooksValid,
  verifyInclusionEitherOrder,
} from "../src/sdk/merkle";

describe("client merkle", () => {
  it("normalizes hex32", () => {
    expect(normalizeHex32("0xab")).toMatch(/^0x0+ab$/);
  });

  it("verifies single-leaf path (empty siblings = root is leaf)", () => {
    const leaf = keccakHex(new TextEncoder().encode("solo"));
    expect(verifyInclusionEitherOrder(leaf, [], leaf)).toBe(true);
  });

  it("rejects wrong root", () => {
    const leaf = keccakHex(new TextEncoder().encode("a"));
    const bad = keccakHex(new TextEncoder().encode("b"));
    expect(verifyInclusionEitherOrder(leaf, [], bad)).toBe(false);
  });

  it("accepts sim display ladder [leaf,…,root] and indexer valid flag", () => {
    const leaf = "0xaaaaaaaaaaaaaaaa";
    const root = "0xbbbbbbbbbbbbbbbb";
    expect(proofLooksValid(leaf, [leaf, "0xdead", root], root, null)).toBe(true);
    expect(proofLooksValid(leaf, ["0xnope"], root, true)).toBe(true);
    expect(proofLooksValid(leaf, ["0xnope"], root, false)).toBe(false);
  });
});

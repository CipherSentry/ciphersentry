/**
 * Binary Merkle + leaf hashing — same convention as gateway batcher (B4).
 *
 * leaf = keccak256(taskId + ":" + recomputed)
 * pair = keccak256(left || right)  // 32||32 bytes, odd node duplicated
 */

import { keccak_256 } from "@noble/hashes/sha3";

export type Hex = `0x${string}`;

function bytesToHex(b: Uint8Array): Hex {
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function hexToBytes(h: string): Uint8Array {
  const raw = h.replace(/^0x/i, "");
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function normalizeHex32(h: string): Hex {
  const raw = h.replace(/^0x/i, "").toLowerCase().padStart(64, "0").slice(-64);
  return `0x${raw}` as Hex;
}

export function keccakHex(data: Uint8Array): Hex {
  return bytesToHex(keccak_256(data));
}

/** Match SettlementBatcherGateway.leafHash(taskId, recomputed). */
export function leafHash(taskId: string, recomputed: string): Hex {
  const enc = new TextEncoder();
  const a = enc.encode(taskId);
  const b = enc.encode(recomputed);
  const buf = new Uint8Array(a.length + 1 + b.length);
  buf.set(a, 0);
  buf[a.length] = 0x3a; // ':'
  buf.set(b, a.length + 1);
  return keccakHex(buf);
}

function hashPair(a: Hex, b: Hex): Hex {
  const cat = new Uint8Array(64);
  cat.set(hexToBytes(normalizeHex32(a)), 0);
  cat.set(hexToBytes(normalizeHex32(b)), 32);
  return keccakHex(cat);
}

/** Binary Merkle root. Odd node duplicated. Leaves already 32-byte hashes. */
export function merkleRoot(leaves: string[]): { root: Hex; paths: Hex[][] } {
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

/**
 * Verify leaf ∈ root using sibling path.
 * Path stores siblings only (no left/right bit); try both orders per level.
 * Depth is log2(n) ≤ 16 for production batches — 2^d is fine.
 */
export function verifyInclusion(leaf: string, path: string[], root: string): boolean {
  return verifyInclusionEitherOrder(leaf, path, root);
}

export function verifyInclusionEitherOrder(leaf: string, path: string[], root: string): boolean {
  let candidates = new Set<string>([normalizeHex32(leaf)]);
  for (const sib of path) {
    const s = normalizeHex32(sib);
    const next = new Set<string>();
    for (const h of candidates) {
      next.add(hashPair(h as Hex, s));
      next.add(hashPair(s, h as Hex));
    }
    candidates = next;
  }
  return candidates.has(normalizeHex32(root));
}

/** Recompute root from leaves in insertion order; compare to anchored root. */
export function reconcileRoot(leaves: string[], anchoredRoot: string): boolean {
  if (!leaves.length) return anchoredRoot === ("0x" + "00".repeat(32));
  const { root } = merkleRoot(leaves);
  return root === normalizeHex32(anchoredRoot);
}

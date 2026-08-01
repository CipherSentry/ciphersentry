/**
 * keccak256 — minimal pure-JS implementation for event topic0 computation.
 * Keccak-f[1600] sponge, 24 rounds, r=136-byte blocks for keccak-256.
 * Used only for topic0 hashes (signature of contract events), never for
 * secrets. Test coverage proves output against fixtures, not trust.
 */
const ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14],
];
const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000800an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x0000000080000008n, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const MASK64 = (1n << 64n) - 1n;
function rotl(x, n) {
    if (n === 0)
        return x & MASK64;
    return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64;
}
function keccakF(state) {
    const C = new Array(5).fill(0n);
    const D = new Array(5).fill(0n);
    const B = new Array(25).fill(0n);
    for (let round = 0; round < 24; round++) {
        // theta
        for (let x = 0; x < 5; x++) {
            C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
        }
        for (let x = 0; x < 5; x++) {
            D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
        }
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                state[x + 5 * y] ^= D[x];
            }
        }
        // rho + pi
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], ROT[x][y]);
            }
        }
        // chi
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                state[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y]) & B[(x + 2) % 5 + 5 * y]);
            }
        }
        // iota
        state[0] ^= RC[round];
    }
}
export function keccak256(input) {
    const BLOCK = 136;
    // padding: pad10*1 with 0x01 | 0x80 termination flag set on last byte
    const padded = new Uint8Array(Math.ceil((input.length + 1) / BLOCK) * BLOCK);
    padded.set(input);
    padded[input.length] |= 0x01;
    padded[padded.length - 1] |= 0x80;
    const state = new Array(25).fill(0n);
    for (let off = 0; off < padded.length; off += BLOCK) {
        for (let i = 0; i < BLOCK / 8; i++) {
            let lane = 0n;
            for (let j = 7; j >= 0; j--) {
                lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]);
            }
            state[i] ^= lane;
        }
        keccakF(state);
    }
    // squeeze 32 bytes little-endian lanes 0..3
    let out = "";
    for (let i = 0; i < 4; i++) {
        let lane = state[i];
        for (let j = 0; j < 8; j++) {
            out += (lane & 0xffn).toString(16).padStart(2, "0");
            lane >>= 8n;
        }
    }
    return `0x${out}`;
}

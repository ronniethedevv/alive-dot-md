// keccak256, as Ethereum uses it.
//
// Node ships `sha3-256`, which is NOT the same function: SHA-3 pads with 0x06,
// original Keccak pads with 0x01, and the digests differ completely. Reaching
// for crypto.createHash("sha3-256") here would produce a plausible-looking
// 32-byte hash that no on-chain check would ever match.
//
// Implemented rather than depended upon so the repo stays install-free, and
// validated against `cast keccak` in the tests. Lanes are BigInt for clarity;
// the inputs here are short reason documents, not bulk data.

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROT = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const MASK = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number) =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function keccakF(A: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // θ
    const C = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) C[x] = A[x]! ^ A[x + 5]! ^ A[x + 10]! ^ A[x + 15]! ^ A[x + 20]!;
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5]! ^ rotl(C[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) A[x + y] = A[x + y]! ^ D;
    }
    // ρ and π
    const B = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y]!, ROT[x + 5 * y]!);
      }
    }
    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        A[x + y] = B[x + y]! ^ (~B[((x + 1) % 5) + y]! & MASK & B[((x + 2) % 5) + y]!);
      }
    }
    // ι
    A[0] = A[0]! ^ RC[round]!;
  }
}

/** keccak256 over raw bytes. Returns a 0x-prefixed 32-byte hex string. */
export function keccak256(input: Uint8Array | string): `0x${string}` {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const RATE = 136; // 1088 bits, the rate for keccak256

  // Pad10*1 with the ORIGINAL Keccak domain byte 0x01, not SHA-3's 0x06.
  const padLen = RATE - (data.length % RATE);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1]! | 0x80);

  const A = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]!);
      A[i] = A[i]! ^ lane;
    }
    keccakF(A);
  }

  let out = "";
  for (let i = 0; i < 4; i++) {
    let lane = A[i]!;
    for (let b = 0; b < 8; b++) {
      out += (lane & 0xffn).toString(16).padStart(2, "0");
      lane >>= 8n;
    }
  }
  return `0x${out}`;
}

// Minimal ABI codec. We call four view functions and decode three return
// shapes, so a full ABI library would be dependency weight for nothing.

export const SEL = {
  tokenURI: "0xc87b56dd",       // tokenURI(uint256) -> string
  ownerOf: "0x6352211e",        // ownerOf(uint256) -> address
  getAgentWallet: "0x00339509", // getAgentWallet(uint256) -> address
  getClients: "0x42dd519c",     // getClients(uint256) -> address[]
  getLastIndex: "0xf2d81759",   // getLastIndex(uint256,address) -> uint64
} as const;

export function encodeUint(sel: string, n: bigint | number): string {
  return sel + BigInt(n).toString(16).padStart(64, "0");
}

function words(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function num(b: Uint8Array, at: number): number {
  // Safe here: every length/offset we read is far below 2^53.
  let v = 0n;
  for (let i = at; i < at + 32; i++) v = (v << 8n) | BigInt(b[i] ?? 0);
  return Number(v);
}

/** Decode a dynamic `string` return. Returns null on anything malformed. */
export function decodeString(hex: string | null | undefined): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const b = words(hex);
    if (b.length < 64) return null;
    const off = num(b, 0);
    if (off + 32 > b.length) return null;
    const len = num(b, off);
    if (len < 0 || off + 32 + len > b.length) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(off + 32, off + 32 + len));
  } catch {
    return null;
  }
}

export function decodeAddress(hex: string | null | undefined): string | null {
  if (!hex || hex.length < 66) return null;
  return "0x" + hex.slice(-40);
}

/** Decode a dynamic `address[]` return. Returns [] on anything malformed. */
export function decodeAddressArray(hex: string | null | undefined): string[] {
  if (!hex || hex === "0x") return [];
  try {
    const b = words(hex);
    if (b.length < 64) return [];
    const off = num(b, 0);
    const len = num(b, off);
    const out: string[] = [];
    for (let i = 0; i < len; i++) {
      const at = off + 32 + i * 32;
      if (at + 32 > b.length) break;
      let s = "";
      for (let j = at + 12; j < at + 32; j++) s += (b[j] ?? 0).toString(16).padStart(2, "0");
      out.push("0x" + s);
    }
    return out;
  } catch {
    return [];
  }
}

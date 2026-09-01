// Minimal ABI encoder for the ERC-8183 call shapes. Browser copy.
//
// Kept byte-identical in behaviour to packages/escrow/src/encode.ts, which is
// covered by tests asserting equality with `cast calldata`. No Node APIs are
// used here, so the same code runs in the browser unchanged.
//
// Kept hand-rolled and dependency-free like the rest of the indexer, but with a
// hard boundary: this file builds CALLDATA only. It never signs and never sends.
// Signing a mainnet transaction that moves real U is the operator's action, so
// the output here is a hex string they execute, not a transaction we broadcast.

export type Hex = `0x${string}`;

const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");

export function encAddress(a: string): string {
  const clean = a.replace(/^0x/, "").toLowerCase();
  if (clean.length !== 40) throw new Error(`not an address: ${a}`);
  return pad(clean);
}

export function encUint(n: bigint | number): string {
  const v = BigInt(n);
  if (v < 0n) throw new Error("uint cannot be negative");
  return pad(v.toString(16));
}

export function encBytes32(h: string): string {
  const clean = h.replace(/^0x/, "");
  if (clean.length !== 64) throw new Error(`not bytes32: ${h}`);
  return clean.toLowerCase();
}

/** Dynamic `string` / `bytes`: 32-byte length then right-padded content. */
function encDynamic(bytes: Uint8Array): string {
  const len = encUint(bytes.length);
  let body = "";
  for (const b of bytes) body += b.toString(16).padStart(2, "0");
  const padded = body.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  return len + padded;
}

type Arg =
  | { t: "address"; v: string }
  | { t: "uint256"; v: bigint | number }
  | { t: "bytes32"; v: string }
  | { t: "string"; v: string }
  | { t: "bytes"; v: string };

/**
 * Encode a call. Head/tail layout: static args inline, dynamic args replaced by
 * an offset into the tail. Getting this wrong produces calldata that a node
 * accepts and a contract misreads, so the shapes are unit-tested.
 */
export function encodeCall(selector: string, args: Arg[]): Hex {
  const headSize = args.length * 32;
  let head = "";
  let tail = "";
  for (const a of args) {
    switch (a.t) {
      case "address": head += encAddress(a.v); break;
      case "uint256": head += encUint(a.v); break;
      case "bytes32": head += encBytes32(a.v); break;
      case "string":
      case "bytes": {
        head += encUint(headSize + tail.length / 2);
        const bytes = a.t === "string"
          ? new TextEncoder().encode(a.v)
          : Uint8Array.from((a.v.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));
        tail += encDynamic(bytes);
        break;
      }
    }
  }
  return (selector.replace(/^0x/, "").padStart(8, "0").length === 8
    ? `0x${selector.replace(/^0x/, "")}${head}${tail}`
    : (() => { throw new Error("bad selector"); })()) as Hex;
}

/**
 * Selectors, computed with `cast sig` against the live ABI, not from memory.
 * Six of these were guessed wrong on the first pass and produced calldata a
 * node would happily accept and the contract would misread; `getAgentWallet`
 * and `getLastIndex` failed the same way earlier in the build. Never hand-write
 * a selector, and never annotate one as verified until it has been.
 */
export const SELECTORS = {
  // AgenticCommerce
  createJob:    "0x41528812", // createJob(address,address,uint256,string,address)
  fund:         "0xd2e13f50", // fund(uint256,uint256,bytes)
  submit:       "0x9e63798d", // submit(uint256,bytes32,bytes)
  complete:     "0xd75bbdf3", // complete(uint256,bytes32,bytes)
  reject:       "0x41dd26f5", // reject(uint256,bytes32,bytes)
  claimRefund:  "0x5b7baf64", // claimRefund(uint256)
  getJob:       "0xbf22c457", // getJob(uint256)
  jobHasBudget: "0xfabc3329", // jobHasBudget(uint256)
  // ERC-20
  approve:      "0x095ea7b3", // approve(address,uint256)
  allowance:    "0xdd62ed3e", // allowance(address,address)
  balanceOf:    "0x70a08231", // balanceOf(address)
} as const;

/** Addresses the UI links to. Verified on BSC mainnet during the Day 0 spike. */
export const CHAIN = {
  id: 56,
  hexId: "0x38",
  name: "BNB Smart Chain",
  rpc: "https://bsc-rpc.publicnode.com",
  explorer: "https://bscscan.com",
  currency: { name: "BNB", symbol: "BNB", decimals: 18 },
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  commerce: "0xea4daa3100a767e86fded867729ae7446476eba6",
  paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666",
  paymentSymbol: "U",
  /** decimals() on the U token, read on chain. */
  paymentDecimals: 18,
} as const;

/**
 * A read against the connected wallet's node.
 *
 * Reads go through the wallet's own provider rather than a URL of ours, so the
 * balance and allowance shown here are the ones the wallet will itself see when
 * it simulates the transaction. Asking a different node risks telling the user
 * they can afford something their wallet then refuses.
 *
 * Returns null on any failure. Rule 0 at the edge: a read that did not happen
 * is not a zero, and every caller must render "unknown" rather than "0".
 */
export async function ethCall(to: string, data: string): Promise<string | null> {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!eth) return null;
  try {
    const hex = (await eth.request({
      method: "eth_call",
      params: [{ to, data }, "latest"],
    })) as string;
    return typeof hex === "string" && hex.startsWith("0x") ? hex : null;
  } catch {
    return null;
  }
}

/** Same, decoded as a single uint256. null means "we could not read it". */
export async function readUint(to: string, data: string): Promise<bigint | null> {
  const hex = await ethCall(to, data);
  if (!hex || hex === "0x") return null;
  try { return BigInt(hex); } catch { return null; }
}

/** Whole-token display for an 18-decimal amount, without floating point. */
export function formatU(units: bigint, dp = 4): string {
  const whole = units / 10n ** 18n;
  const frac = (units % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, dp)}` : whole.toString();
}

/** Whole U to raw units. 18 decimals, no floating point in the amount. */
export function toUnits(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.trim().split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18) || "0");
}

/**
 * Where to get U.
 *
 * Escrow settles in U and nothing else, which is immutable on the commerce
 * kernel. Telling someone their balance is zero without telling them what to do
 * about it is a dead end, and the liquid venue is not guessable: the V2 pair
 * holds about a cent and looks like proof U is untradeable. It is an abandoned
 * shell. This is the V3 pool, measured at roughly 11M U against 10M USDT.
 */
export const U_POOL = {
  label: "PancakeSwap V3 · U/USDT",
  url: "https://pancakeswap.finance/swap?outputCurrency=0xcE24439F2D9C6a2289F741120FE202248B666666&chain=bsc",
} as const;

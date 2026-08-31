// Verified on BSC mainnet (chain 56) during the Day-0 spike, 2026-08-30.
// Every address below was confirmed by an eth_call against a live node, not
// read from a doc. See docs/DAY0-FINDINGS.md for the transcript of checks.

export const CHAIN_ID = 56;

/** ERC-8004 registries. CREATE2 singletons — same address on every mainnet. */
export const ERC8004 = {
  /** name() = "AgentIdentity", symbol() = "AGENT". No totalSupply(). */
  identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  /** getVersion() = "2.0.0"; getIdentityRegistry() points at the above. */
  reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  /** No validation registry deployed — still under TEE-community discussion. */
  validationRegistry: null,
} as const;

/** ERC-8183 commerce kernel, from the BNBAgent SDK deployment manifest. */
export const ERC8183 = {
  commerceProxy: "0xea4daa3100a767e86fded867729ae7446476eba6",
  routerProxy: "0x51895229e12f9876011789b04f8698af06ccd6da",
  policy: "0x9c01845705b3078aa2e8cff7520a6376fd766de5",
  /**
   * paymentToken() on the commerce kernel. Immutable — the escrow settles in
   * this token and nothing else. name() = "United Stables", symbol() = "U",
   * decimals() = 18. This is why AgentCard.budget.token is "U", not "USDT".
   */
  paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666",
  paymentTokenSymbol: "U",
  paymentTokenDecimals: 18,
  /** platformFeeBP() = 0, MAX_PLATFORM_FEE_BP = 1000, treasury = 0x…dEaD. */
  platformFeeBP: 0,
  /** owner() — not us. We cannot call setPlatformFee. See threat model. */
  kernelOwner: "0x5057b09A4b510ccaf7e3fb3038Ba60713E62B1fc",
} as const;

/** B402 payment rail. Multi-token, unlike the escrow kernel. */
export const B402 = {
  facilitatorUrl: "https://facilitator.b402.ai",
  settles: ["U", "USD1", "USDT", "USDC"],
} as const;

/**
 * Free public RPCs serve only a recent block window; historical eth_getLogs
 * is refused everywhere we tested. Backfill needs a keyed endpoint.
 * Tip-following (5000-block windows) works unauthenticated.
 */
export const RPC = {
  tip: "https://bsc-rpc.publicnode.com",
  archive: process.env.BSC_ARCHIVE_RPC ?? null,
  maxLogWindow: 5000,
} as const;

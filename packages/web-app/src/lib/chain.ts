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

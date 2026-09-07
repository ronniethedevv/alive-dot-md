// What is this agent's wallet actually allowed to do, right now, on chain?
//
//   node --experimental-strip-types packages/escrow/src/keystore.ts --proven
//   node --experimental-strip-types packages/escrow/src/keystore.ts 0xabc… 0xdef…
//   node --experimental-strip-types packages/escrow/src/keystore.ts --testnet 0xabc…
//
// THE READ LAYER, AND WHY IT IS READ-ONLY ON PURPOSE.
//
// Altana's KeyStore is a public registry of session keys. A wallet owner grants
// a scoped session - an allowlist of calls, a spend cap, an expiry - and the
// grant is recorded where ANYONE can check it. That last part is the whole
// point and the reason this file exists: we can state what an agent is
// authorised to do without asking the agent, without trusting its card, and
// without a relationship with its operator.
//
// It pairs with the other two layers this product already has:
//
//   8004scan        identity  - who this agent claims to be
//   KeyStore        authority - what it may do right now, and until when
//   commerce kernel evidence  - what it has actually been paid to do
//
// Each costs a different thing to fake, which is why they are worth showing
// together and never merging into one number.
//
// Nothing here signs, spends, or grants. Reads only.

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { BNB, BNB_TESTNET } from "@altananetwork/sdk";

/**
 * The KeyStore's read surface, lifted from the SDK's internal module.
 *
 * `getKeys` is the one that matters and the one that is easy to miss:
 * `isValidKey` needs a keyId you already have, which is fine when you granted
 * the session and useless when you are inspecting a stranger's wallet.
 * `getKeys(user)` enumerates, so a third party can audit an agent it has never
 * interacted with. Without it this whole layer would only work for our own
 * agents.
 */
export const KEYSTORE_ABI = [
  {
    name: "getKeys", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    name: "isValidKey", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getPublicKey", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }],
    outputs: [{ type: "bytes" }],
  },
] as const;

export interface SessionKey {
  keyId: `0x${string}`;
  /** The registry's own answer: is this key authority today. */
  valid: boolean;
}

export interface WalletAuthority {
  wallet: Address;
  chainId: number;
  keyStore: Address;
  /** Every key the registry has ever recorded for this wallet. */
  keys: SessionKey[];
  active: number;
  /**
   * NOT "this wallet has no agent".
   *
   * A wallet with no registered key may still be granting sessions with
   * `register: false`, in which case the authorization exists on the account
   * and simply is not published. The honest reading of an empty list is "no
   * PUBLISHED authority", and the UI must say that rather than implying the
   * agent is unauthorised. Same discipline as `unprobed` in §12 rule 0: the
   * absence of a record is not a finding.
   */
  none: boolean;
  /** Set when the read itself failed. A verdict is never inferred from an error. */
  error?: string;
}

const NETS = {
  mainnet: { cfg: BNB, chain: bsc },
  testnet: { cfg: BNB_TESTNET, chain: bscTestnet },
} as const;
export type NetName = keyof typeof NETS;

export function keystoreClient(net: NetName = "mainnet"): {
  pc: PublicClient; keyStore: Address; chainId: number;
} {
  const { cfg, chain } = NETS[net];
  const url = (net === "mainnet" && process.env.BSC_RPC) || cfg.publicRpcUrl;
  return {
    // Long timeout deliberately. The prober's default 10s connect ceiling is
    // what recorded 27 live agents as unreachable; the same mistake is not
    // being repeated one directory over.
    pc: createPublicClient({ chain, transport: http(url, { timeout: 30_000, retryCount: 2 }) }) as PublicClient,
    keyStore: cfg.keyStore as Address,
    chainId: cfg.chainId,
  };
}

/** Every session key the KeyStore holds for one wallet, with its validity. */
export async function readAuthority(
  wallet: Address,
  net: NetName = "mainnet",
  client?: ReturnType<typeof keystoreClient>,
): Promise<WalletAuthority> {
  const { pc, keyStore, chainId } = client ?? keystoreClient(net);
  const base = { wallet, chainId, keyStore, keys: [] as SessionKey[], active: 0, none: true };
  try {
    const ids = await pc.readContract({
      address: keyStore, abi: KEYSTORE_ABI, functionName: "getKeys", args: [wallet],
    }) as readonly `0x${string}`[];

    // Validity is per key and is read individually: a wallet can hold a live
    // key alongside three expired ones, and collapsing that to a count would
    // lose the distinction the panel exists to show.
    const keys: SessionKey[] = [];
    for (const keyId of ids) {
      const valid = await pc.readContract({
        address: keyStore, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [wallet, keyId],
      }) as boolean;
      keys.push({ keyId, valid });
    }
    return { ...base, keys, active: keys.filter((k) => k.valid).length, none: keys.length === 0 };
  } catch (e: any) {
    return { ...base, error: String(e?.shortMessage ?? e?.message ?? e).slice(0, 120) };
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (import.meta.filename === process.argv[1]) {
  const net: NetName = process.argv.includes("--testnet") ? "testnet" : "mainnet";
  const client = keystoreClient(net);
  console.log(`network    BNB ${net} (${client.chainId})`);
  console.log(`keystore   ${client.keyStore}`);

  const code = await client.pc.getCode({ address: client.keyStore });
  console.log(`deployed   ${code && code !== "0x" ? `yes, ${(code.length - 2) / 2} bytes` : "NO CODE AT ADDRESS"}\n`);

  let targets: { label: string; wallet: Address }[] = process.argv
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    .map((w) => ({ label: w, wallet: w as Address }));

  if (process.argv.includes("--proven")) {
    const { openDb } = await import("../../../indexer/src/db.ts");
    const db = openDb();
    targets = (db.prepare(`
      SELECT t.agent_id, COALESCE(a.name, t.agent_id) name, w.wallet
        FROM agent_trust t
        JOIN agent_wallets w USING(agent_id)
        LEFT JOIN agents a USING(agent_id)
       WHERE t.tier = 'proven'
       ORDER BY t.score DESC`).all() as any[])
      .map((r) => ({ label: String(r.name).slice(0, 32), wallet: r.wallet as Address }));
  }

  if (!targets.length) {
    console.log("Pass one or more 0x addresses, or --proven to check the catalog's proven agents.");
    process.exit(0);
  }

  let withKeys = 0, errors = 0;
  for (const t of targets) {
    const a = await readAuthority(t.wallet, net, client);
    if (a.error) { errors++; console.log(`${t.label.padEnd(33)} ERROR ${a.error}`); continue; }
    if (!a.none) withKeys++;
    console.log(`${t.label.padEnd(33)} ${t.wallet.slice(0, 10)}…  keys=${a.keys.length} active=${a.active}`);
    for (const k of a.keys) console.log(`      ${k.keyId.slice(0, 20)}…  valid=${k.valid}`);
  }
  console.log(`\n${withKeys} of ${targets.length} wallets publish a session key${errors ? `; ${errors} could not be read` : ""}.`);
}

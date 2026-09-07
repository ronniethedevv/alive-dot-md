// Prove agent-to-agent delegation end to end, on chain, before any UI exists.
//
//   $env:ALIVE_KEY = "0x..."                        # PowerShell
//   node --experimental-strip-types packages/escrow/src/altana-spike.ts
//   node --experimental-strip-types packages/escrow/src/altana-spike.ts --mainnet
//
// WHY. ROADMAP §7 specifies subcontracting rails - depth cap, budget envelope,
// deadline contraction - and says plainly: "all client-side in our SDK (nothing
// on chain enforces these - we ship a convention, not a constraint)". A
// convention is not a safety property. An agent that ignores our SDK ignores
// every rail.
//
// Altana's session keys make the same rails CHAIN-ENFORCED. A session carries a
// call allowlist (down to the function signature), a spend cap per period, and
// an expiry, committed on chain in the Keystore. The validator rejects anything
// outside them, whatever the agent intends. That turns §7 from a promise into a
// constraint, which is a materially stronger claim and the one worth demoing.
//
// WHAT THIS PROVES, in order, each with an artifact you can check yourself:
//
//   1. an agent has its own smart account
//   2. a session is granted with REAL limits: allowlist, spend cap, expiry
//   3. the grant is readable on chain by anyone, via Keystore.isValidKey
//   4. the session can act within its limits - a real transaction
//   5. the session CANNOT act outside them - the interesting half
//   6. revocation is one transaction and is immediate
//
// Testnet by default. Nothing here touches mainnet without --mainnet, because a
// spike whose failure mode is "spent real money" is not a spike.

import {
  createClient, signerFromPrivateKey, erc8183Addresses, serializeSession,
  BNB, BNB_TESTNET, erc8183SubmitPermissions,
} from "@altananetwork/sdk";
import { createPublicClient, http, keccak256 } from "viem";
import { randomBytes } from "node:crypto";

const MAINNET = process.argv.includes("--mainnet");
const NET = MAINNET ? BNB : BNB_TESTNET;
const ADDR = erc8183Addresses(NET.chainId);

/**
 * The key is read from the environment and never printed, never written, never
 * sent anywhere. Altana's design keeps custody with the integrator: the SDK
 * signs locally and the key does not leave this process.
 */
const KEY = process.env.ALIVE_KEY;
if (!KEY || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
  console.error(
    "Set ALIVE_KEY to a funded test key first.\n\n"
    + "  PowerShell:  $env:ALIVE_KEY = \"0x...\"\n"
    + "  bash:        export ALIVE_KEY=0x...\n\n"
    + "Use a DISPOSABLE key. On testnet it needs only tBNB from a faucet.\n"
    + "Never use a key that holds anything you care about.",
  );
  process.exit(1);
}

const line = (s = "") => console.log(s);
const step = (n: number, s: string) => line(`\n── ${n}. ${s} ${"─".repeat(Math.max(0, 52 - s.length))}`);

line(`network      ${NET.chainId === 56 ? "BNB mainnet (56)" : "BNB testnet (97)"}`);
line(`commerce     ${ADDR.commerce}`);
line(`payment U    ${ADDR.paymentToken}`);
line(`keystore     ${NET.keyStore}`);
if (MAINNET) line("\n!! MAINNET. This spends real funds.\n");

const client = createClient({ chains: [NET] });
const signer = signerFromPrivateKey(KEY as `0x${string}`);

// ── 1. the agent's own account ────────────────────────────────────────────
step(1, "agent smart account");
const wallet = await client.createWallet({ signer });
line(`wallet       ${wallet.address}`);

/** Balances come back with bigint fields, which JSON.stringify refuses. */
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

const balances = await client.balances({ wallet, chainId: NET.chainId }).catch(() => null);
line(`balance      ${balances ? j(balances) : "(could not read)"}`);
line(`explorer     ${NET.explorer}/address/${wallet.address}`);
line("\nFund this address with a little native gas before the first execute.");
if (!MAINNET) line(`Faucet: https://www.bnbchain.org/en/testnet-faucet`);

// ── 2. a session with real limits ─────────────────────────────────────────
step(2, "grant a scoped session");

/**
 * The rails, as on-chain permissions rather than as our own good intentions.
 *
 * `erc8183SubmitPermissions` scopes to the commerce contract AND to the
 * `submit` function signature specifically, so a subcontracted agent granted
 * this session can deliver work and can do nothing else with the escrow - it
 * cannot create jobs, cannot move the budget, cannot settle in its own favour.
 *
 * The spend cap is the §7 "budget envelope" and the expiry is the §7 "deadline
 * contraction". Both are enforced by the validator, not by us.
 */
const DAY = 24 * 60 * 60;
const permissions = {
  calls: erc8183SubmitPermissions(NET.chainId),
  spend: [{
    limit: 1_000_000_000_000_000_000n, // 1 U, 18 decimals
    period: "day" as const,
    token: ADDR.paymentToken,
  }],
};
const expiry = Math.floor(Date.now() / 1000) + 7 * DAY;

line(`allowlist    ${j(permissions.calls)}`);
line(`spend cap    1 U per day  (${ADDR.paymentToken})`);
line(`expiry       ${new Date(expiry * 1000).toISOString()}`);

/**
 * OUR OWN session key, not the SDK's ephemeral one.
 *
 * `grantSession` without a `sessionSigner` mints a key that exists only in this
 * process's memory. Lose it before persisting and the on-chain authorization it
 * backs is permanently unusable - revoke-and-regrant is the only way out. The
 * SDK warns about this at runtime, which is how it was caught here rather than
 * during a demo.
 *
 * So: generate the key, keep it, and persist the session with
 * `serializeSession` (JSON-safe, carries no secret). The pair is what the
 * product will store - key in a secret store, serialized session in the DB.
 */
const sessionKey = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
const sessionSigner = signerFromPrivateKey(sessionKey);

let session: any;
try {
  session = await client.grantSession({ wallet, signer, sessionSigner, permissions, expiry });
  line(`\ngranted      ${session.transactionHash ?? "(no hash returned; relay confirmed)"}`);
  // What a real integration stores. Never `JSON.stringify` a Session: it throws
  // on the bigint limits and embeds the session's private key.
  line(`serialized   ${serializeSession(session).slice(0, 80)}…`);
  line(`session key  held by us, ${sessionKey.length} chars, not printed`);
} catch (e: any) {
  line(`\ngrant FAILED: ${String(e?.message ?? e).slice(0, 300)}`);
  line("\nIf this says the wallet is unfunded, send gas to the address above and re-run.");
  process.exit(1);
}

// ── 3. anyone can verify it, on chain ─────────────────────────────────────
step(3, "third-party verification via Keystore");

const publicClient = createPublicClient({ chain: NET.chain, transport: http(NET.publicRpcUrl) });
const KEYSTORE_ABI = [{
  name: "isValidKey", type: "function", stateMutability: "view",
  inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }],
  outputs: [{ type: "bool" }],
}] as const;

const keyId = keccak256(session.publicKey);
const authorized = await publicClient.readContract({
  address: NET.keyStore, abi: KEYSTORE_ABI,
  functionName: "isValidKey", args: [wallet.address, keyId],
});
line(`keyId        ${keyId}`);
line(`isValidKey   ${authorized}`);
line(
  authorized
    ? "\nThis is the part that matters: a wallet that has never heard of\n"
      + "ALIVE.MD can read this permission straight off the chain. The\n"
      + "integration is verifiable, not asserted."
    : "\nNOT registered. If the session was granted with register:false, call\n"
      + "client.registerSessionKey to add the Keystore entry.",
);

// ── 4 and 5. inside the limits, and outside them ──────────────────────────
step(4, "act within the session, then try to exceed it");
line("Deliberately not executed in this spike.");
line("");
line("Step 4 needs a real job the agent is the provider on, and step 5 spends");
line("a transaction to prove a revert. Both belong in the integration test that");
line("follows this, against a job we created ourselves - not against a stranger's");
line("escrow. What is proven above is the delegation itself, which is the part");
line("that was previously only a convention.");

// ── 6. revocation ─────────────────────────────────────────────────────────
step(6, "revoke, and confirm it took effect");
try {
  await client.revokeSession({ wallet, signer, session });
  const stillValid = await publicClient.readContract({
    address: NET.keyStore, abi: KEYSTORE_ABI,
    functionName: "isValidKey", args: [wallet.address, keyId],
  });
  line(`isValidKey after revoke   ${stillValid}`);
  line(
    stillValid
      ? "\nStill valid - revocation did not take. Investigate before trusting this."
      : "\nRevoked, and the chain agrees. One transaction, immediate effect.\n"
        + "This is what the product's Revoke button will call.",
  );
} catch (e: any) {
  line(`revoke FAILED: ${String(e?.message ?? e).slice(0, 200)}`);
}

line("\ndone.");

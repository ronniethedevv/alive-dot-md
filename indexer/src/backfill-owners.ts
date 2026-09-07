// Backfill `owner` for agents that survived the filter.
//
//   node --experimental-strip-types indexer/src/backfill-owners.ts [--all]
//
// WHY THIS EXISTS, and why it is not optional.
//
// §9 recorded the decision to drop `ownerOf` from the main sweep: `tokenURI`
// alone distinguishes minted from unminted, so calling both doubled a 640k-call
// pass for a field most agents never need. The note said owner would be
// "backfilled lazily for agents that survive the filter". That backfill was
// never written, so `owner` is NULL for every listed agent.
//
// That is not a cosmetic gap. The hire flow passes the agent's owner as the
// ERC-8183 `provider`, and fell back to the connected wallet when it was
// missing - so hiring any agent in the live catalog created a job whose client,
// provider and evaluator were all the same address. The escrow would have paid
// the user back to themselves and reported success.
//
// One `ownerOf` call per agent. On the 177-agent live set that is one batch.

import { Rpc } from "./rpc.ts";
import { openDb } from "./db.ts";
import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { SEL, encodeUint } from "./abi.ts";

const ALL = process.argv.includes("--all");
/**
 * Agents that have TAKEN A JOB, whatever their probe verdict.
 *
 * The two existing selections both key on verified_class, so neither reaches an
 * agent whose endpoint is down but which has settled real work - AgentCensus,
 * nine completed jobs, a 404 endpoint. That left owner NULL for all 862 agents
 * with a job record, which in turn made the self-dealing check vacuous: it
 * reported 0 because it had nothing to compare, not because the market is arm's
 * length. A check that cannot fail is not a check.
 */
const PAID = process.argv.includes("--paid");
const BATCH = 60;

const db = openDb();

/**
 * Who to fetch. By default only agents that can actually be hired, because that
 * is where a missing owner does damage. `--all` widens it to anything probed,
 * for when the catalog filter changes.
 */
const rows = db.prepare(
    PAID
    ? `SELECT a.agent_id FROM agents a JOIN agent_record r ON r.agent_id = a.agent_id
        WHERE a.owner IS NULL OR a.agent_wallet IS NULL
        ORDER BY CAST(a.agent_id AS INTEGER)`
    : ALL
    ? `SELECT agent_id FROM agents
        WHERE (owner IS NULL OR agent_wallet IS NULL) AND verified_class != 'unprobed'
        ORDER BY CAST(agent_id AS INTEGER)`
    : `SELECT agent_id FROM agents
        WHERE (owner IS NULL OR agent_wallet IS NULL) AND verified_class = 'task-interface'
        ORDER BY CAST(agent_id AS INTEGER)`,
).all() as { agent_id: string }[];

if (rows.length === 0) {
  console.log("nothing to backfill: every matching agent already has an owner.");
  process.exit(0);
}

console.log(`backfilling owner for ${rows.length} agents${ALL ? " (--all)" : " (hireable only)"}`);

const rpc = new Rpc();
const update = db.prepare(`UPDATE agents SET owner = ? WHERE agent_id = ?`);
const updateWallet = db.prepare(`UPDATE agents SET agent_wallet = ? WHERE agent_id = ?`);

/**
 * getAgentWallet(uint256). Computed with the repo's own keccak, never hand
 * written - §9 records six selectors guessed wrong on the first pass, each
 * producing calldata a node accepts and a contract misreads.
 *
 * This is the field that matters for hiring. ERC-8183 pays the `provider`
 * address, and the convention on chain is that the provider is the agent's
 * WALLET, not the NFT owner: agent 158888 has completed 193 jobs as provider
 * 0x9019669126DA…, which is exactly its getAgentWallet, and its owner is a
 * different address. The registry defaults the wallet to the owner at
 * registration, so the two agree until an operator sets one - and every
 * operator running real jobs has set one.
 */
const SEL_AGENT_WALLET = "0x00339509";

let written = 0;
let wallets_written = 0;
let reverted = 0;
let failed = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const results = await rpc.ethCallDetailed(
    chunk.map((r) => ({
      to: ERC8004.identityRegistry,
      data: encodeUint(SEL.ownerOf, Number(r.agent_id)),
    })),
  );

  for (let j = 0; j < chunk.length; j++) {
    const res = results[j];
    const id = chunk[j]!.agent_id;

    // Rule 0: an RPC failure must never land in a shape indistinguishable from
    // an on-chain answer. A failed read leaves the column NULL and is counted,
    // so a later pass picks it up; it is never written as "no owner".
    if (!res || res.kind === "error") { failed++; continue; }
    if (res.kind === "revert" || res.data === "0x") { reverted++; continue; }

    const word = res.data.slice(2).padStart(64, "0");
    const addr = "0x" + word.slice(24);
    if (!/^0x[0-9a-f]{40}$/i.test(addr) || /^0x0+$/.test(addr)) { reverted++; continue; }

    update.run(addr.toLowerCase(), id);
    written++;
  }

  // Second pass over the same chunk for the payment wallet.
  const wallets = await rpc.ethCallDetailed(
    chunk.map((r) => ({
      to: ERC8004.identityRegistry,
      data: encodeUint(SEL_AGENT_WALLET, Number(r.agent_id)),
    })),
  );
  for (let j = 0; j < chunk.length; j++) {
    const res = wallets[j];
    const id = chunk[j]!.agent_id;
    if (!res || res.kind !== "ok" || res.data === "0x") continue;
    const addr = "0x" + res.data.slice(2).padStart(64, "0").slice(24);
    if (!/^0x[0-9a-f]{40}$/i.test(addr) || /^0x0+$/.test(addr)) continue;
    updateWallet.run(addr.toLowerCase(), id);
    wallets_written++;
  }
  process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}

console.log(
  `\ndone. written ${written}, no owner on chain ${reverted}, read failed ${failed}`,
);
if (failed > 0) console.log("re-run to retry the reads that failed; they are still NULL.");

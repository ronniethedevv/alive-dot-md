// Prepares first-party agent registrations and stops at the signature.
//
// It emits the registration files, the exact `register(string)` calldata, and a
// preflight report. It does NOT sign or send: registering mints permanent
// public identities on BSC mainnet and costs real gas, so the transaction is
// the operator's to execute. Everything up to that point is here.
//
//   node --experimental-strip-types packages/agents/src/seed.ts [--base https://…]

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, registrationFile } from "./service.ts";
import { ERC8004 } from "../../shared/src/chain.ts";
import { openDb } from "../../../indexer/src/db.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "registrations");

const baseArg = process.argv.indexOf("--base");
const BASE = baseArg >= 0 ? process.argv[baseArg + 1]! : (process.env.AGENT_BASE_URL ?? "");

/** ABI-encode register(string agentURI). Selector verified against the live ABI. */
function encodeRegister(uri: string): string {
  const sel = "0xf2c298be"; // register(string)
  const bytes = Buffer.from(uri, "utf8");
  const len = bytes.length.toString(16).padStart(64, "0");
  const padded = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
  const offset = (32).toString(16).padStart(64, "0");
  return sel + offset + len + padded;
}

mkdirSync(OUT, { recursive: true });

console.log("first-party agent registration preflight\n");

if (!BASE || BASE.includes("localhost")) {
  console.log("  ! AGENT_BASE_URL is not a public URL.");
  console.log("    The service must be reachable from the open internet BEFORE registering:");
  console.log("    our own verifier resolves a non-public host to `unreachable`, which is");
  console.log("    exactly the failure mode we catalogue in other people's agents (ROADMAP 4).");
  console.log("    Registering against localhost would put a permanently broken identity on");
  console.log("    mainnet. Deploy first, then re-run with --base https://your-host\n");
}

const rows: string[] = [];
for (const a of AGENTS) {
  const file = registrationFile(a, BASE || "https://REPLACE-ME");
  const path = join(OUT, `${a.slug}.json`);
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");

  // Hosted file, not a data: URI. Inline would be cheaper to register but
  // immutable without an on-chain setAgentURI, and these endpoints will move.
  const agentUri = `${BASE || "https://REPLACE-ME"}/agents/${a.slug}/registration.json`;
  const calldata = encodeRegister(agentUri);

  console.log(`── ${a.name}`);
  console.log(`   slug        ${a.slug}`);
  console.log(`   categories  ${a.categories.join(", ")}`);
  console.log(`   skills      ${a.skills.map((s) => s.id).join(", ")}`);
  console.log(`   agentURI    ${agentUri}`);
  console.log(`   file        ${path}`);
  console.log(`   calldata    ${calldata.slice(0, 74)}…  (${calldata.length / 2 - 1} bytes)\n`);
  rows.push(`${a.slug}\t${agentUri}`);
}

console.log("to register (one tx per agent, from an address you control):\n");
console.log(`  cast send ${ERC8004.identityRegistry} \\`);
console.log(`    "register(string)" "<agentURI>" \\`);
console.log(`    --rpc-url https://bsc.rpc.blxrbdn.com --private-key $KEY\n`);
console.log("register() returns the new agentId. Record it, then mark the agent first-party:\n");
console.log("  node --experimental-strip-types packages/agents/src/seed.ts --claim <agentId> <slug>\n");

// --claim: record OUR agents as first-party. Set by us, never inferred from
// chain data - which is why the resolver's upsert deliberately never writes it.
const claimAt = process.argv.indexOf("--claim");
if (claimAt >= 0) {
  const agentId = process.argv[claimAt + 1];
  const slug = process.argv[claimAt + 2];
  if (!agentId || !slug) { console.error("usage: --claim <agentId> <slug>"); process.exit(1); }
  const db = openDb();
  const r = db.prepare(`UPDATE agents SET first_party = 1 WHERE agent_id = ?`).run(agentId);
  console.log(r.changes
    ? `marked agent ${agentId} (${slug}) as first-party`
    : `agent ${agentId} is not in the index yet - run the resolver, then re-claim`);
  db.close();
}

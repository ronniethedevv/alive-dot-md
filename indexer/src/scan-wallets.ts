// Build the wallet -> agent index the registry refuses to provide.
//
//   node --experimental-strip-types indexer/src/scan-wallets.ts [--limit N]
//
// WHY (ROADMAP §13): a job on the commerce kernel names a PROVIDER ADDRESS. To
// say "this agent has completed 18 paid jobs" we have to get from that address
// back to an ERC-8004 id, and the registry has no reverse lookup - tested and
// all revert:
//
//   getAgentByWallet(address)     -> revert
//   walletToAgentId(address)      -> revert
//   agentIdByWallet(address)      -> revert
//   tokenOfOwnerByIndex(a,uint)   -> revert   (no ERC-721 Enumerable, §3)
//
// So the map is built forwards, one getAgentWallet per id, and stored. Same
// order of work as the tokenURI sweep §9 already ran, and it only has to be
// done once plus incrementally at the head.
//
// `getAgentWallet` defaults to the owner at registration and can be changed by
// the operator, so this is the field ERC-8183 payments actually key on.
// Resumable: the cursor holds the highest id completed.

import { Rpc } from "./rpc.ts";
import { openDb, makeStatements } from "./db.ts";
import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { encodeUint } from "./abi.ts";

/** getAgentWallet(uint256), computed with the repo keccak, never hand written. */
const SEL_AGENT_WALLET = "0x00339509";

const CURSOR = "agent-wallets";
const BATCH = 250;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}
const LIMIT = Number(arg("--limit") ?? 0) || 0;

const db = openDb();
const st = makeStatements(db);

const maxId = (db.prepare(
  `SELECT MAX(CAST(agent_id AS INTEGER)) m FROM agents`,
).get() as any).m as number;

const insert = db.prepare(
  `INSERT OR REPLACE INTO agent_wallets (wallet, agent_id, scanned_at) VALUES (?, ?, ?)`,
);

const from = Math.max(1, st.getCursor(CURSOR) + 1);
const to = LIMIT ? Math.min(maxId, from + LIMIT - 1) : maxId;

console.log(`registry high-water mark: ${maxId}`);
console.log(`scanning ids ${from} -> ${to}${from > 1 ? "  (resumed)" : ""}`);

const rpc = new Rpc({ perEndpoint: 3 });
let written = 0;
let none = 0;
let failed = 0;
const started = Date.now();

for (let lo = from; lo <= to; lo += BATCH) {
  const ids: number[] = [];
  for (let id = lo; id < lo + BATCH && id <= to; id++) ids.push(id);

  const results = await rpc.ethCallDetailed(
    ids.map((id) => ({
      to: ERC8004.identityRegistry,
      data: encodeUint(SEL_AGENT_WALLET, id),
    })),
  );

  const now = new Date().toISOString();
  st.tx(() => {
    for (let i = 0; i < ids.length; i++) {
      const r = results[i];
      // Rule 0: a read that failed is not "this agent has no wallet". It is
      // left unrecorded and counted, so a re-run picks it up.
      if (!r || r.kind === "error") { failed++; continue; }
      if (r.kind === "revert" || r.data === "0x") { none++; continue; }

      const addr = "0x" + r.data.slice(2).padStart(64, "0").slice(24).toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr) || /^0x0+$/.test(addr)) { none++; continue; }

      insert.run(addr, String(ids[i]), now);
      written++;
    }
    st.setCursor(CURSOR, ids[ids.length - 1]!);
  });

  const done = lo + ids.length - from;
  const rate = done / ((Date.now() - started) / 1000);
  process.stdout.write(
    `\r  ${done}/${to - from + 1}  mapped ${written}  none ${none}` +
    `  failed ${failed}  ${rate.toFixed(0)}/s   `,
  );
}

console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`mapped ${written}, no wallet ${none}, read failed ${failed}`);
if (failed) console.log("re-run to retry failed reads; they were not written.");

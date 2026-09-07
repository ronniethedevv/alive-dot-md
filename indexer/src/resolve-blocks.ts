// Turn registration block numbers into dates.
//
//   node --experimental-strip-types indexer/src/resolve-blocks.ts
//
// WHY THIS IS WORTH AN HOUR.
//
// ROADMAP §3 and §5 record "the registry stores no timestamps" as a fact, and
// the §8.1 data contract froze `createdAt: null` around it (line 684). §14 later
// found `submittedAt` on the commerce kernel, which gave us job times - but
// still nothing about when an AGENT came into existence. So the catalog cannot
// say how old anything is, cannot offer "new this week", and cannot tell a
// three-year-old operator from one registered on Tuesday.
//
// 8004scan hands us `created_block_number` per agent. A block number is a
// timestamp with one lookup: `eth_getBlockByNumber` returns the block's own
// `timestamp` field, and blocks are immutable, so this is resolved ONCE and
// never needs revisiting.
//
// 199 agents, 199 distinct blocks. That is 199 calls, cached forever.
//
// THE CHAIN IS THE AUTHORITY HERE, NOT 8004SCAN. We take the block number from
// them and the time from the chain, so a wrong block number produces a wrong
// date we could catch, rather than a plausible date we could not.

import { openDb } from "./db.ts";

const RPC = process.env.BSC_RPC ?? "https://bsc-rpc.publicnode.com";
const db = openDb();
const started = Date.now();

const rows = db.prepare(`
  SELECT DISTINCT created_block_number AS b
    FROM scan8004_detail
   WHERE created_block_number IS NOT NULL
     AND created_at IS NULL
   ORDER BY b
`).all() as { b: number }[];

if (!rows.length) {
  console.log("every known registration block already has a timestamp. Nothing to do.");
  process.exit(0);
}
console.log(`resolving ${rows.length} distinct blocks against ${RPC}`);

/** One JSON-RPC call, retried: a dropped block read is not a missing block. */
async function blockTime(n: number): Promise<number | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber",
          // `false` - we want the header, not 200 transactions we would discard.
          params: ["0x" + n.toString(16), false],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const j: any = await res.json();
      const hex = j?.result?.timestamp;
      if (typeof hex === "string") return Number(BigInt(hex));
      // A null result means the node does not have that block, which is a
      // different thing from a failed call and is not worth retrying.
      if (j?.result === null) return null;
      throw new Error(j?.error?.message ?? "no timestamp in result");
    } catch (e: any) {
      if (attempt === 3) {
        console.warn(`  block ${n}: ${String(e?.message ?? e).slice(0, 60)}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
    }
  }
  return null;
}

const setTime = db.prepare(`UPDATE scan8004_detail SET created_at = ? WHERE created_block_number = ?`);

let done = 0, failed = 0;
for (const { b } of rows) {
  const t = await blockTime(b);
  if (t === null) { failed++; continue; }
  setTime.run(t, b);
  done++;
  if (done % 25 === 0) console.log(`  ${done}/${rows.length}`);
  // Polite to a public endpoint. 199 calls at this rate is under a minute.
  await new Promise((r) => setTimeout(r, 120));
}

const span = db.prepare(`
  SELECT MIN(created_at) lo, MAX(created_at) hi, COUNT(created_at) n FROM scan8004_detail
`).get() as any;

console.log(`\nresolved ${done}, failed ${failed}, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (span.n) {
  console.log(`registrations span ${new Date(span.lo * 1000).toISOString().slice(0, 10)}`
    + ` to ${new Date(span.hi * 1000).toISOString().slice(0, 10)} (${span.n} agents dated)`);
}

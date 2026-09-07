// Bring the whole index up to date. One command, safe to run on a timer.
//
//   node --experimental-strip-types indexer/src/catch-up.ts
//   node --experimental-strip-types indexer/src/catch-up.ts --dry
//
// WHY THIS EXISTS. Every component of this indexer is individually resumable
// and none of them run themselves, so the index was a photograph, not a feed.
// Measured 2 Sept: the registry head was 330,791 while our highest indexed id
// was 321,016 — **9,775 agents behind, two days after a full sweep**. New
// agents are arriving at roughly 4,900 a day, well above the ~1,300/day §9
// assumed. A marketplace whose catalog silently ages out is worse than one that
// admits it does not know.
//
// DISCOVERY NEEDS NO LOGS. ERC-8004 mints sequential ids, so "what is new" is
// "ids above our watermark" — found by walking `ownerOf` upward until it
// reverts. That is a handful of eth_calls, not `eth_getLogs`, so none of this
// is blocked on the archive-RPC token §9 is waiting for. The token buys
// TIMESTAMPS, which is a different feature.
//
// ORDER MATTERS and each stage feeds the next:
//
//   1. resolve        new ids            -> tokenURI, classify
//   2. fetch-ipfs     new ipfs://        -> registration, endpoint
//   3. scan-jobs      new kernel jobs    -> who got paid
//   4. scan-wallets   new ids            -> wallet -> agent map
//   5. verify         stale endpoints    -> who answers NOW, not who once did
//   6. build-records  join 3 and 4       -> the settlement record
//   7. build-trust    score everything   -> the one number the catalog sorts by
//   8. build-categories  label everything -> what the catalog filters by
//
// Stage 5 depends on 3 AND 4, which is why it is last and why a partial run
// leaves the record stale rather than wrong: `agent_record` is rebuilt whole.
//
// Each stage is a separate process. That is deliberate: a stage that dies takes
// its own resume cursor with it and the next run picks up where it stopped,
// rather than one long-lived process losing everything.

import { spawn } from "node:child_process";
import { Rpc } from "./rpc.ts";
import { openDb } from "./db.ts";
import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { encodeUint, SEL } from "./abi.ts";

const DRY = process.argv.includes("--dry");
const HERE = import.meta.dirname;

const db = openDb();
const rpc = new Rpc({ perEndpoint: 2 });

/**
 * Highest minted id, found by walking up from what we already have.
 *
 * Doubling then bisecting, rather than binary-searching from zero, because the
 * distance from our watermark to the head is small and the whole range is not.
 */
async function liveHead(from: number): Promise<number> {
  const exists = async (id: number) => {
    const [r] = await rpc.ethCallDetailed([
      { to: ERC8004.identityRegistry, data: encodeUint(SEL.ownerOf, id) },
    ]);
    // A read that FAILED is not "this id is absent". Throwing here is correct:
    // treating an RPC error as the end of the registry would silently truncate
    // the catalog (rule 0).
    if (!r || r.kind === "error") throw new Error("rpc failed while probing the registry head");
    return r.kind === "ok" && r.data !== "0x";
  };

  if (!(await exists(from))) return from; // our watermark is already at/past the end
  let lo = from;
  let step = 1024;
  while (await exists(lo + step)) { lo += step; step *= 2; }
  let hi = lo + step;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function run(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", `${HERE}/${script}`, ...args],
      { stdio: "inherit" },
    );
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

const ourMax = (db.prepare(
  `SELECT COALESCE(MAX(CAST(agent_id AS INTEGER)), 0) m FROM agents`,
).get() as any).m as number;

console.log(`indexed up to agent ${ourMax}; probing the registry head…`);
const head = await liveHead(ourMax);
const behind = head - ourMax;
console.log(`registry head is ${head} — ${behind} new agent${behind === 1 ? "" : "s"}\n`);

if (DRY) {
  const jobsSeen = (db.prepare(`SELECT COALESCE(MAX(job_id),0) m FROM jobs`).get() as any).m;
  const records = (db.prepare(`SELECT COUNT(*) n FROM agent_record`).get() as any).n;
  console.log(`dry run. would resolve ids ${ourMax + 1}..${head}`);
  console.log(`jobs stored up to ${jobsSeen}; ${records} agents currently carry a record.`);
  process.exit(0);
}

const stages: [string, string, string[]][] = [];
if (behind > 0) stages.push(["new identities", "resolve.ts", ["--from", String(ourMax + 1), "--to", String(head)]]);
// These are worth running even at zero new agents: ipfs retries what the
// gateways throttled, and job states change on agents we already hold.
stages.push(["ipfs registrations", "fetch-ipfs.ts", []]);
stages.push(["new kernel jobs", "scan-jobs.ts", ["--new"]]);
stages.push(["wallet -> agent map", "scan-wallets.ts", []]);
/**
 * Re-probe before scoring, so a fixed endpoint is reflected in the same run.
 *
 * Its absence here was a real hole: catch-up discovered new agents, resolved
 * them, mapped their wallets and scored them - and never called a single
 * endpoint. Nothing found from that point on could ever enter the `live` tier,
 * and no agent could ever recover from a bad verdict.
 *
 * 12 hours is a compromise between a catalog that lags reality and a probe
 * schedule that hammers other people's servers. Deduped by URL, so the real
 * cost is one request per distinct endpoint.
 */
stages.push(["re-probe endpoints", "verify.ts", ["--stale", "12"]]);
stages.push(["settlement records", "build-records.ts", []]);
stages.push(["trust scores", "build-trust.ts", []]);
stages.push(["categories", "build-categories.ts", []]);

let failedStage: string | null = null;
for (const [label, script, args] of stages) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 56 - label.length))}`);
  const code = await run(script, args);
  if (code !== 0) {
    // Keep going. Each stage owns its own cursor, so a failure costs that
    // stage's progress and nothing else - and build-records must still run so
    // the catalog reflects whatever DID land.
    console.error(`  ! ${label} exited ${code}; continuing`);
    failedStage ??= label;
  }
}

console.log("\n── summary ────────────────────────────────────────────────");
const q = (s: string) => (db.prepare(s).get() as any);
console.log(`agents        ${q("SELECT COUNT(*) n FROM agents").n}`);
console.log(`jobs          ${q("SELECT COUNT(*) n FROM jobs").n}`);
console.log(`wallet map    ${q("SELECT COUNT(*) n FROM agent_wallets").n}`);
console.log(`paid agents   ${q("SELECT COUNT(*) n FROM agent_record").n}`
  + ` (${q("SELECT COUNT(*) n FROM agent_record WHERE completed>0").n} have completed work)`);
if (failedStage) {
  console.log(`\nfirst failing stage: ${failedStage}. Re-run to retry; nothing was lost.`);
  process.exit(1);
}

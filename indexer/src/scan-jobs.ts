// Scan the ERC-8183 commerce kernel into `jobs`.
//
//   node --experimental-strip-types indexer/src/scan-jobs.ts [--limit N] [--rescan]
//
// WHY (ROADMAP §13): the identity registry says who EXISTS. This says who has
// actually been PAID. Those are different sets, and the second one is the one a
// marketplace is supposed to surface. 3,000 sampled jobs showed 76 distinct
// providers and ZERO of them own an agent our catalog lists.
//
// It also supplies the track record §5 gave up on. §5 concluded none was
// obtainable because the reputation registry stores no timestamps - true, and
// the wrong contract. Every job here carries counterparties, state, budget and
// deadline, which is a settlement record per provider needing no log backfill
// and no archive token.
//
// Resumable. `jobs` is keyed by job_id and written with INSERT OR REPLACE, so a
// re-run refreshes states (open -> completed) rather than duplicating. The
// cursor records the lowest id reached so an interrupted scan continues down.

import { Rpc } from "./rpc.ts";
import { openDb, makeStatements } from "./db.ts";
import { ERC8183 } from "../../packages/shared/src/chain.ts";

/** Computed with the repo's own keccak, never hand written (§9). */
const SEL_JOB_COUNTER = "0x50355d76"; // jobCounter()
const SEL_JOBS = "0x180aedf3";        // jobs(uint256)

const CURSOR = "erc8183-jobs";
const BATCH = 250;

/**
 * State enum. CORRECTED 2 Sept against `JOB_STATUS` in @altananetwork/sdk and
 * verified against the kernel's own `getJob` on one live job per state.
 *
 * The previous mapping was derived empirically - "0 and 1 never carry a hash,
 * 2 and 3 always do, and only complete()/reject() write one" - and it was
 * WRONG in the most damaging way available: it read SUBMITTED as completed and
 * COMPLETED as rejected, then binned the two real terminal states as unknown.
 *
 * What that cost: a published claim of a "50% rejection rate" on a kernel where
 * exactly TWO jobs in 56,690 have ever been rejected, and a `proven` tier built
 * on jobs that had been delivered but never settled.
 *
 * The word that misled us is index 10, which is the DELIVERABLE hash, written
 * by submit(). It is present from SUBMITTED onward, which is why both 2 and 3
 * carried one and why the inference looked sound.
 */
const JOB_STATE: Record<number, string> = {
  0: "open", 1: "funded", 2: "submitted", 3: "completed", 4: "rejected", 5: "expired",
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

const RESCAN = process.argv.includes("--rescan");
/**
 * Only jobs we have never seen: from the live head down to our highest stored
 * id. This is the incremental mode a scheduler uses; the default full scan is
 * for a cold start or a state refresh.
 */
const NEW_ONLY = process.argv.includes("--new");
const LIMIT = Number(arg("--limit") ?? 0) || 0;

const db = openDb();
const st = makeStatements(db);

const insert = db.prepare(`
  INSERT OR REPLACE INTO jobs
    (job_id, client, provider, evaluator, state, raw_state, budget, deadline,
     terms, reason_hash, submitted_at, scanned_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Decode one `jobs(uint256)` return.
 *
 * Returns null rather than a partial row on anything it cannot read. Rule 0: a
 * decode failure must never land in a shape indistinguishable from a real job.
 */
function decode(data: string): {
  client: string; provider: string; evaluator: string; state: string;
  rawState: number; budget: string; deadline: number | null;
  terms: string | null; deliverable: string | null; submittedAt: number | null;
} | null {
  const w = data.slice(2).match(/.{64}/g);
  if (!w || w.length < 11) return null;
  const addr = (i: number) => "0x" + w[i]!.slice(24).toLowerCase();
  const num = (i: number) => BigInt("0x" + w[i]!);

  const provider = addr(2);
  // An unset id returns a zeroed struct rather than reverting, so a zero
  // provider means "this job does not exist", not "a job with no provider".
  if (/^0x0+$/.test(provider)) return null;

  const rawState = Number(num(7));
  let terms: string | null = null;
  try {
    const off = Number(num(4)) / 32;
    const len = Number(BigInt("0x" + w[off]!));
    if (Number.isFinite(off) && len >= 0 && len < 200_000) {
      terms = Buffer.from(w.slice(off + 1).join("").slice(0, len * 2), "hex")
        .toString("utf8");
    }
  } catch { /* terms are optional; a job without readable terms is still a job */ }

  // Word 9 is `submittedAt` and word 10 is `deliverable`, per the kernel's own
  // getJob field order: id, client, provider, evaluator, description, budget,
  // expiredAt, status, hook, submittedAt, deliverable.
  //
  // submittedAt is the ONLY timestamp anywhere in this project. §5 concluded no
  // temporal data existed because the reputation registry stores none; it was
  // sitting in the commerce kernel the whole time, and it is what makes
  // "the window" in the TermiX track computable.
  const deliverable = "0x" + w[10];
  const submittedAt = Number(num(9));
  const deadline = Number(num(6));

  return {
    client: addr(1),
    provider,
    evaluator: addr(3),
    state: JOB_STATE[rawState] ?? `unknown_${rawState}`,
    rawState,
    budget: num(5).toString(),
    deadline: deadline || null,
    terms,
    deliverable: /^0x0+$/.test(deliverable) ? null : deliverable,
    submittedAt: submittedAt || null,
  };
}

const rpc = new Rpc({ perEndpoint: 3 });

const [head] = await rpc.ethCallDetailed([
  { to: ERC8183.commerceProxy, data: SEL_JOB_COUNTER },
]);
if (!head || head.kind !== "ok" || head.data === "0x") {
  console.error("could not read jobCounter(); refusing to guess a head. nothing written.");
  process.exit(1);
}
const HEAD = Number(BigInt(head.data));

// Resume from where a previous run stopped, unless told to start over.
const resumeAt = RESCAN ? 0 : st.getCursor(CURSOR);
const from = NEW_ONLY ? HEAD : (resumeAt > 0 && resumeAt < HEAD ? resumeAt : HEAD);

let floor: number;
if (NEW_ONLY) {
  const seen = (db.prepare(`SELECT COALESCE(MAX(job_id), 0) m FROM jobs`).get() as any).m as number;
  // Re-read the last 50 we already have: a job seen as `funded` may since have
  // settled, and states are what change. INSERT OR REPLACE makes that free.
  floor = Math.max(1, seen - 50);
  if (HEAD <= seen) {
    console.log(`nothing new: head ${HEAD}, highest stored ${seen}`);
    process.exit(0);
  }
} else {
  floor = LIMIT ? Math.max(1, from - LIMIT + 1) : 1;
}

console.log(`jobCounter = ${HEAD}`);
console.log(`scanning ${from} down to ${floor}${resumeAt ? "  (resumed)" : ""}`);

let written = 0;
let empty = 0;
let failed = 0;
const started = Date.now();

for (let hi = from; hi >= floor; hi -= BATCH) {
  const ids: number[] = [];
  for (let id = hi; id > hi - BATCH && id >= floor; id--) ids.push(id);

  const results = await rpc.ethCallDetailed(
    ids.map((id) => ({
      to: ERC8183.commerceProxy,
      data: SEL_JOBS + BigInt(id).toString(16).padStart(64, "0"),
    })),
  );

  const now = new Date().toISOString();
  st.tx(() => {
    for (let i = 0; i < ids.length; i++) {
      const r = results[i];
      if (!r || r.kind === "error") { failed++; continue; }
      if (r.kind === "revert" || r.data === "0x") { empty++; continue; }
      const j = decode(r.data);
      if (!j) { empty++; continue; }
      insert.run(
        ids[i]!, j.client, j.provider, j.evaluator, j.state, j.rawState,
        j.budget, j.deadline, j.terms, j.deliverable, j.submittedAt, now,
      );
      written++;
    }
    // Cursor AFTER the batch commits, so an interrupt re-does one batch rather
    // than skipping it.
    st.setCursor(CURSOR, Math.max(1, hi - BATCH));
  });

  const done = from - Math.max(floor, hi - BATCH) + 1;
  const rate = done / ((Date.now() - started) / 1000);
  process.stdout.write(
    `\r  ${done}/${from - floor + 1}  written ${written}  empty ${empty}` +
    `  failed ${failed}  ${rate.toFixed(0)}/s   `,
  );
}

console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`written ${written}, empty ${empty}, read failed ${failed}`);
if (failed) console.log("re-run to retry failed reads: they were not written.");

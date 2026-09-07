// Materialise the per-agent settlement record.
//
//   node --experimental-strip-types indexer/src/build-records.ts
//
// Re-run after scan-jobs.ts or scan-wallets.ts. Cheap: one GROUP BY.
//
// `client != provider` is the whole point of the WHERE clause. Agent 158888 has
// 193 jobs and exactly one client - itself - using the escrow as a tamper-
// evident log of its own buyback runs. Counting that as a track record would be
// counting an agent's diary as customer demand.

import { openDb } from "./db.ts";

const db = openDb();
const started = Date.now();

db.exec("DELETE FROM agent_record");
db.exec(`
  INSERT INTO agent_record
    (agent_id, jobs, completed, rejected, submitted, clients, settled_raw,
     completion_pct, first_seen, last_seen, computed_at)
  SELECT aw.agent_id,
         COUNT(*),
         SUM(j.state = 'completed'),
         SUM(j.state = 'rejected'),
         SUM(j.state = 'submitted'),
         COUNT(DISTINCT j.client),
         -- INTEGER, not REAL. Summing through a float produced
         -- settled_raw = "1.0e+18" - scientific notation in a field the wire
         -- contract calls raw 18-decimal units, which BigInt() throws on - and
         -- silently lost precision above 2^53 besides. SQLite INTEGER is
         -- 64-bit; the largest per-agent sum here is ~1e18, well inside it.
         CAST(COALESCE(SUM(CAST(j.budget AS INTEGER)), 0) AS TEXT),
         CAST(ROUND(100.0 * SUM(j.state = 'completed') / COUNT(*)) AS INTEGER),
         MIN(NULLIF(j.submitted_at, 0)),
         MAX(NULLIF(j.submitted_at, 0)),
         datetime('now')
    FROM jobs j
    JOIN agent_wallets aw ON aw.wallet = j.provider
   WHERE j.client != j.provider
   GROUP BY aw.agent_id
`);

/**
 * PRICE, from settlements rather than from claims.
 *
 * A second pass rather than more columns on the first, because the population
 * is different: the record counts every job including the free ones, while the
 * price may only be drawn from jobs where money actually moved.
 *
 * Three filters, each load-bearing:
 *
 *   client != provider   an agent hiring itself sets its own price, which is
 *                        not a price. Same reason the clients column has it.
 *   budget > 0           505 settled jobs are free trial runs. Averaging them
 *                        in is how a 0.10 U agent displays as free.
 *   state settled        open and funded jobs are amounts someone HOPED would
 *                        be accepted. Only completed and submitted are amounts
 *                        a provider actually took.
 *
 * The median is the middle of the ordered budgets, picked by row number. SQLite
 * has no percentile function and pulling the rows into JS to sort them would
 * mean loading every budget for every provider.
 */
db.exec(`
  WITH paid AS (
    SELECT aw.agent_id AS agent_id, CAST(j.budget AS REAL) AS amt, j.budget AS raw
      FROM jobs j
      JOIN agent_wallets aw ON aw.wallet = j.provider
     WHERE j.client != j.provider
       AND j.state IN ('completed', 'submitted')
       AND CAST(j.budget AS REAL) > 0
  ),
  ranked AS (
    SELECT agent_id, raw, amt,
           ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY amt) AS rn,
           COUNT(*)     OVER (PARTITION BY agent_id)              AS n
      FROM paid
  ),
  stats AS (
    SELECT agent_id,
           MAX(n) AS n,
           -- The lower middle value for an even count. Deterministic, and it
           -- never invents a figure that no job was ever settled at.
           MAX(CASE WHEN rn = (n + 1) / 2 THEN raw END) AS med,
           MAX(CASE WHEN rn = 1           THEN raw END) AS lo,
           MAX(CASE WHEN rn = n           THEN raw END) AS hi
      FROM ranked GROUP BY agent_id
  ),
  zeros AS (
    SELECT aw.agent_id AS agent_id, COUNT(*) AS z
      FROM jobs j
      JOIN agent_wallets aw ON aw.wallet = j.provider
     WHERE j.client != j.provider
       AND j.state IN ('completed', 'submitted')
       AND CAST(j.budget AS REAL) = 0
     GROUP BY aw.agent_id
  )
  UPDATE agent_record SET
    price_med_raw = (SELECT med FROM stats WHERE stats.agent_id = agent_record.agent_id),
    price_min_raw = (SELECT lo  FROM stats WHERE stats.agent_id = agent_record.agent_id),
    price_max_raw = (SELECT hi  FROM stats WHERE stats.agent_id = agent_record.agent_id),
    price_n       = COALESCE((SELECT n FROM stats WHERE stats.agent_id = agent_record.agent_id), 0),
    price_zero_n  = COALESCE((SELECT z FROM zeros WHERE zeros.agent_id = agent_record.agent_id), 0)
`);

/**
 * Repeat business, risk taken, and self-dealing.
 *
 * All three come off the same job rows the record above already counts; none
 * needs a new scan. They exist because the record answered "how much work" and
 * not "from whom, how big, and was it arm's length".
 */
db.exec(`
  WITH j AS (
    SELECT aw.agent_id AS agent_id, j.client AS client, CAST(j.budget AS REAL) AS amt, j.budget AS raw
      FROM jobs j
      JOIN agent_wallets aw ON aw.wallet = j.provider
     WHERE j.client != j.provider
  ),
  repeats AS (
    SELECT agent_id, COUNT(*) AS n FROM (
      SELECT agent_id, client, COUNT(*) c FROM j GROUP BY 1, 2 HAVING c > 1
    ) GROUP BY agent_id
  ),
  biggest AS (
    SELECT agent_id, raw FROM (
      SELECT agent_id, raw, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY amt DESC) rn FROM j
    ) WHERE rn = 1
  ),
  selfdealt AS (
    SELECT aw.agent_id AS agent_id, COUNT(*) AS n
      FROM jobs jb
      JOIN agent_wallets aw ON aw.wallet = jb.provider
      JOIN agents a ON a.agent_id = aw.agent_id
     WHERE jb.client != jb.provider
       AND a.owner IS NOT NULL
       AND lower(jb.client) = lower(a.owner)
     GROUP BY 1
  )
  UPDATE agent_record SET
    repeat_clients = COALESCE((SELECT n   FROM repeats   WHERE repeats.agent_id   = agent_record.agent_id), 0),
    max_job_raw    =          (SELECT raw FROM biggest   WHERE biggest.agent_id   = agent_record.agent_id),
    self_dealt     = COALESCE((SELECT n   FROM selfdealt WHERE selfdealt.agent_id = agent_record.agent_id), 0)
`);

const n = (db.prepare("SELECT COUNT(*) n FROM agent_record").get() as any).n;
const withDone = (db.prepare("SELECT COUNT(*) n FROM agent_record WHERE completed > 0").get() as any).n;
const priced = (db.prepare("SELECT COUNT(*) n FROM agent_record WHERE price_n >= 3").get() as any).n;
console.log(`built ${n} agent records (${withDone} have completed at least one paid job) in ${Date.now() - started}ms`);
console.log(`${priced} have a settled price from 3+ paid jobs and will show one`);
const rep = (db.prepare("SELECT COUNT(*) n FROM agent_record WHERE repeat_clients > 0").get() as any).n;
const sd = (db.prepare("SELECT COUNT(*) n FROM agent_record WHERE self_dealt > 0").get() as any).n;
console.log(`${rep} have at least one repeat client; ${sd} have jobs from their own owner wallet`);

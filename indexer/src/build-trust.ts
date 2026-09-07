// Build `agent_trust`: one score, one tier, computed from evidence.
//
//   node --experimental-strip-types indexer/src/build-trust.ts
//
// Run after build-records.ts. One pass of SQL over the whole corpus.
//
// See schema.sql for the design. The short version: rank by what it costs to
// fake. A completed paid job costs a counterparty real money; a rating costs
// nothing and on this registry 33 addresses wrote 96.7% of them.

import { openDb } from "./db.ts";

const db = openDb();
const started = Date.now();

db.exec("DELETE FROM agent_trust");

/**
 * Weights, gathered here so the scale can be read in one place and argued with.
 *
 * The caps matter as much as the weights. Without them an agent with 40
 * completions would swamp the scale, and the question this product answers is
 * "can I hire this", not "who is biggest".
 */
const W = {
  perCompleted: 12, capCompleted: 48,
  perExtraClient: 6, capClients: 18,
  liveTaskInterface: 18,
  declaredAndValid: 8,
  perCredibleRating: 4, capRatings: 8,
  perRejected: -4, capRejected: -12,
};

db.exec(`
  INSERT INTO agent_trust
    (agent_id, score, tier, completed, clients, rejected, pending,
     credible_ratings, raw_ratings, top_rater_breadth, computed_at)
  WITH
  -- How many agents each rater has rated. A rater who rates everything is a
  -- constant, and a constant carries no information.
  breadth AS (
    SELECT rater, COUNT(*) AS n FROM rater_edges GROUP BY rater
  ),
  -- Inverse-breadth weighted ratings per agent.
  rated AS (
    SELECT re.agent_id,
           SUM(1.0 / b.n) AS credible,
           COUNT(*)       AS raw,
           MAX(b.n)       AS top_breadth
      FROM rater_edges re
      JOIN breadth b ON b.rater = re.rater
     GROUP BY re.agent_id
  ),
  base AS (
    SELECT a.agent_id,
           a.verified_class,
           a.declared_class,
           a.reg_valid,
           COALESCE(ar.completed, 0) AS completed,
           COALESCE(ar.clients, 0)   AS clients,
           COALESCE(ar.rejected, 0)  AS rejected,
           COALESCE(ar.jobs, 0) - COALESCE(ar.completed, 0)
             - COALESCE(ar.rejected, 0) AS pending,
           COALESCE(r.credible, 0)   AS credible,
           COALESCE(r.raw, 0)        AS raw_ratings,
           r.top_breadth             AS top_breadth
      FROM agents a
      LEFT JOIN agent_record ar ON ar.agent_id = a.agent_id
      LEFT JOIN rated r         ON r.agent_id  = a.agent_id
  ),
  scored AS (
    SELECT *,
           MIN(completed * ${W.perCompleted}, ${W.capCompleted})
         + MIN(MAX(clients - 1, 0) * ${W.perExtraClient}, ${W.capClients})
         + CASE WHEN verified_class = 'task-interface' THEN ${W.liveTaskInterface} ELSE 0 END
         + CASE WHEN reg_valid = 1 AND declared_class = 'machine' THEN ${W.declaredAndValid} ELSE 0 END
         + MIN(CAST(credible * ${W.perCredibleRating} AS INTEGER), ${W.capRatings})
         + MAX(rejected * ${W.perRejected}, ${W.capRejected})
           AS raw_score
      FROM base
  )
  SELECT agent_id,
         MAX(0, MIN(100, raw_score)) AS score,
         CASE
           -- Money moved, from someone other than itself. Nothing else earns this.
           WHEN completed > 0                     THEN 'proven'
           -- We called it and it answered as a task interface.
           WHEN verified_class = 'task-interface' THEN 'live'
           -- It publishes a well-formed machine interface we have not confirmed.
           WHEN reg_valid = 1 AND declared_class = 'machine' THEN 'declared'
           ELSE 'unproven'
         END AS tier,
         completed, clients, rejected, MAX(pending, 0), credible, raw_ratings,
         top_breadth, datetime('now')
    FROM scored
`);

const q = (s: string) => (db.prepare(s).get() as any);
const rows = q("SELECT COUNT(*) n FROM agent_trust").n;
console.log(`built ${rows} trust rows in ${Date.now() - started}ms`);
console.table(
  (db.prepare(
    `SELECT tier, COUNT(*) agents, MIN(score) lo, MAX(score) hi
       FROM agent_trust GROUP BY tier ORDER BY hi DESC`,
  ).all() as any[]),
);
console.log("\ntop 10 by score:");
console.table(
  (db.prepare(
    `SELECT t.score, t.tier, substr(COALESCE(a.name,'(unnamed)'),1,38) name,
            t.completed, t.clients, t.rejected, t.pending,
            ROUND(t.credible_ratings, 3) credible, t.raw_ratings
       FROM agent_trust t JOIN agents a ON a.agent_id = t.agent_id
      ORDER BY t.score DESC, t.completed DESC LIMIT 10`,
  ).all() as any[]),
);

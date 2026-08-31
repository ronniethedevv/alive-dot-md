// Counterparty overlap — promoted into the v1 signal set (ROADMAP §5).
//
// It was deferred as expensive. It isn't: only 4,401 agents have any feedback
// at all, so the whole edge list is 4,401 getClients calls and the rest is
// in-memory set arithmetic.
//
// It exists because concentration cannot see the interesting attack. An agent
// with 234 entries from 29 raters at a 9% top share scores as *healthy* by
// concentration — that is what a well-run agent and a well-run rater pool look
// like from the outside, and the registry contains 60 agents with that shape.
// What separates them is who else those raters rate:
//
//   honest:  29 raters who each rate many unrelated agents
//   ring:    29 raters who rate each other and almost nothing else
//
// Closed rings are visible without any trust propagation, which is the whole
// reason this is computable at all.
//
//   node --experimental-strip-types src/overlap.ts

import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { SEL, encodeUint, decodeAddressArray } from "./abi.ts";
import { Rpc, sleep, type CallResult } from "./rpc.ts";
import { openDb } from "./db.ts";

const db = openDb();
db.exec(`
  CREATE TABLE IF NOT EXISTS rater_edges (
    agent_id TEXT NOT NULL,
    rater    TEXT NOT NULL,
    PRIMARY KEY (agent_id, rater)
  );
  CREATE INDEX IF NOT EXISTS idx_edges_rater ON rater_edges (rater);

  -- Per-agent overlap. Every column answers "who else do this agent's raters
  -- rate?", which is the question concentration cannot ask.
  CREATE TABLE IF NOT EXISTS overlap (
    agent_id           TEXT PRIMARY KEY,
    computed_at        TEXT NOT NULL,
    raters             INTEGER NOT NULL,
    -- Distinct other agents rated by this agent's raters.
    neighbour_agents   INTEGER NOT NULL,
    -- Mean number of agents each of this agent's raters rates.
    mean_rater_breadth REAL NOT NULL,
    -- Of this agent's raters, the largest number that ALSO rate one single
    -- other agent, and which agent that is. 29-of-29 is a ring; 3-of-29 is not.
    max_co_rated       INTEGER NOT NULL,
    max_co_rated_agent TEXT,
    -- max_co_rated / raters, as a percentage. The headline number.
    closure_pct        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_overlap_closure ON overlap (closure_pct DESC);
`);

const rated = db.prepare(
  `SELECT agent_id FROM concentration WHERE distinct_raters > 0 ORDER BY CAST(agent_id AS INTEGER)`,
).all() as unknown as { agent_id: string }[];

console.log(`building rater edges for ${rated.length} rated agents`);

const rpc = new Rpc({ perEndpoint: 1 });
const insertEdge = db.prepare(`INSERT OR IGNORE INTO rater_edges (agent_id, rater) VALUES (?, ?)`);

const have = (db.prepare(`SELECT COUNT(DISTINCT agent_id) n FROM rater_edges`).get() as any).n as number;
if (have < rated.length) {
  const t0 = Date.now();
  for (let i = 0; i < rated.length; i += rpc.batchSize) {
    const chunk = rated.slice(i, i + rpc.batchSize);
    let res: CallResult[] = [];
    for (let attempt = 0; ; attempt++) {
      try {
        res = await rpc.ethCallDetailed(chunk.map((r) => ({
          to: ERC8004.reputationRegistry, data: encodeUint(SEL.getClients, Number(r.agent_id)),
        })));
        // Rule 0: an unresolved call must not become "this agent has no raters".
        if (res.some((x) => !x || x.kind === "error")) throw new Error("unresolved call in chunk");
        break;
      } catch (e: any) {
        await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)));
      }
    }
    db.exec("BEGIN");
    try {
      chunk.forEach((r, j) => {
        const x = res[j];
        if (!x || x.kind !== "ok") return;
        for (const rater of decodeAddressArray(x.data)) insertEdge.run(r.agent_id, rater.toLowerCase());
      });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    if (i % 1000 === 0) {
      const done = Math.min(i + rpc.batchSize, rated.length);
      process.stdout.write(`\r  edges ${done}/${rated.length}  ${(done / ((Date.now() - t0) / 1000)).toFixed(0)}/s   `);
    }
  }
  console.log();
}

// ── In-memory overlap. The whole graph is small enough to hold. ──────────────
const edges = db.prepare(`SELECT agent_id, rater FROM rater_edges`).all() as unknown as
  { agent_id: string; rater: string }[];

const ratersOf = new Map<string, string[]>();   // agent -> raters
const ratesOf = new Map<string, string[]>();    // rater -> agents
for (const e of edges) {
  (ratersOf.get(e.agent_id) ?? ratersOf.set(e.agent_id, []).get(e.agent_id)!).push(e.rater);
  (ratesOf.get(e.rater) ?? ratesOf.set(e.rater, []).get(e.rater)!).push(e.agent_id);
}
console.log(`graph: ${ratersOf.size} agents, ${ratesOf.size} distinct raters, ${edges.length} edges`);

const upsert = db.prepare(`
  INSERT INTO overlap (agent_id, computed_at, raters, neighbour_agents, mean_rater_breadth,
                       max_co_rated, max_co_rated_agent, closure_pct)
  VALUES (:agent_id, :computed_at, :raters, :neighbour_agents, :mean_rater_breadth,
          :max_co_rated, :max_co_rated_agent, :closure_pct)
  ON CONFLICT(agent_id) DO UPDATE SET
    computed_at=excluded.computed_at, raters=excluded.raters,
    neighbour_agents=excluded.neighbour_agents, mean_rater_breadth=excluded.mean_rater_breadth,
    max_co_rated=excluded.max_co_rated, max_co_rated_agent=excluded.max_co_rated_agent,
    closure_pct=excluded.closure_pct`);

const now = new Date().toISOString();
db.exec("BEGIN");
for (const [agent, raters] of ratersOf) {
  const coRated = new Map<string, number>();
  let breadth = 0;
  for (const r of raters) {
    const alsoRates = ratesOf.get(r) ?? [];
    breadth += alsoRates.length;
    for (const other of alsoRates) {
      if (other === agent) continue;
      coRated.set(other, (coRated.get(other) ?? 0) + 1);
    }
  }
  let topAgent: string | null = null;
  let topCount = 0;
  for (const [a, c] of coRated) if (c > topCount) { topCount = c; topAgent = a; }
  upsert.run({
    agent_id: agent,
    computed_at: now,
    raters: raters.length,
    neighbour_agents: coRated.size,
    mean_rater_breadth: Number((breadth / raters.length).toFixed(2)),
    max_co_rated: topCount,
    max_co_rated_agent: topAgent,
    closure_pct: Math.round((topCount / raters.length) * 100),
  });
}
db.exec("COMMIT");

console.log(`\noverlap computed for ${ratersOf.size} agents\n`);
console.log("=== the 60 that concentration scores as HEALTHY (>=20 raters, <=15% top share) ===");
for (const r of db.prepare(`
  SELECT o.agent_id, o.raters, o.closure_pct, o.max_co_rated, o.mean_rater_breadth, c.top_rater_share_pct
  FROM overlap o JOIN concentration c ON c.agent_id = o.agent_id
  WHERE c.distinct_raters >= 20 AND c.top_rater_share_pct <= 15
  ORDER BY o.closure_pct DESC LIMIT 8`).all() as any[]) {
  console.log(`  agent ${String(r.agent_id).padStart(6)}  ${String(r.raters).padStart(3)} raters` +
    `  top-rater ${String(r.top_rater_share_pct).padStart(2)}% (looks fine)` +
    `  -> closure ${String(r.closure_pct).padStart(3)}%  (${r.max_co_rated}/${r.raters} also rate one same agent)` +
    `  breadth ${r.mean_rater_breadth}`);
}
db.close();

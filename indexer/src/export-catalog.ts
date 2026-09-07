// Turn the working database into a static snapshot the web can serve alone.
//
//   node --experimental-strip-types indexer/src/export-catalog.ts
//
// WHY THIS EXISTS.
//
// The index is 346 MB of SQLite and it cannot go to production: it is
// gitignored, it exceeds GitHub's 100 MB file limit, and the API that reads it
// is a long-lived process holding an open write handle. Nothing about that
// survives a push to Vercel.
//
// But almost none of it is serve-time data. 74 MB is `token_uri` blobs, 45 MB
// is raw `jobs` already aggregated into `agent_record`, and 330,590 of the
// 330,794 identities are agents nobody can hire. What the product actually
// serves is small enough to be a file.
//
// So the split is: the DATABASE is a build artifact and the SNAPSHOT is the
// product. The indexer keeps the chain as its source of truth and runs on a
// schedule somewhere with a disk; this writes down what it learned; Vercel
// serves that. No machine anywhere needs to stay on.
//
// WHAT GETS EXPORTED, and the rule behind it.
//
// Every agent with EVIDENCE - proven, live, or any settled paid work. That is
// the catalog's own thesis ("agents that have been paid to do work") rather
// than a size compromise, and the corpus stays honest because the denominators
// travel with it: "330,794 registered, N worth listing" is one integer, not
// 330,794 rows.

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";
import {
  toAgentCard, toAgentDetail, getConcentration, type AgentRow,
} from "../../packages/api/src/shape.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// NOT under web-app/public: the snapshot is read by the serverless functions,
// not downloaded by the browser. Putting it in public/ would ship 2.5 MB to
// every visitor AND bundle it into the functions - paying for it twice.
const OUT = process.env.EXPORT_DIR ?? join(HERE, "..", "..", "data");

const db = openDb();
const started = Date.now();

/**
 * The listable set.
 *
 * `completed > 0` is deliberately included alongside the tiers: an agent can
 * have settled paid work while its HTTP endpoint is down, and that agent is
 * more hireable than one that merely answers a ping. AgentCensus - nine
 * completed jobs, a 404 endpoint - is exactly this case, and dropping it
 * because a probe failed would repeat the mistake the catalog row already had
 * to be corrected for.
 *
 * The rule keys on HAVING A JOB RECORD rather than on completed work, because
 * that is what the catalog already lists by default - 862 agents under "Hired
 * before", not the 204 with settled jobs. An agent someone escrowed money at
 * and is waiting on is a real listing; the row says which state it is in.
 */
const LISTABLE = `(t.tier IN ('proven','live') OR r.agent_id IS NOT NULL)`;

const rows = db.prepare(`
  SELECT a.*, p.response_ms AS last_response_ms
    FROM agents a
    JOIN agent_trust t ON t.agent_id = a.agent_id
    LEFT JOIN agent_record r ON r.agent_id = a.agent_id
    LEFT JOIN (
      SELECT agent_id, response_ms,
             ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY probed_at DESC) rn
        FROM probes
    ) p ON p.agent_id = a.agent_id AND p.rn = 1
   WHERE ${LISTABLE}
   ORDER BY t.score DESC, t.completed DESC, a.agent_id
`).all() as unknown as (AgentRow & { last_response_ms: number | null })[];

/**
 * Cards and details come from the SAME functions the live API uses.
 *
 * Re-implementing the wire shape here would give the snapshot its own slow
 * drift away from the contract, and §8.1 exists precisely so there is one
 * definition of it. Calling `toAgentCard`/`toAgentDetail` makes the exported
 * JSON identical to what the server returned, by construction rather than by
 * discipline.
 */
/**
 * Filter fields, attached additively.
 *
 * `toAgentCard`'s `categories` is the OASF block from the registration, which
 * is empty on essentially every agent in this catalog. The derived labels the
 * UI actually filters on live in `agent_category`, and the live API reached
 * them with a SQL EXISTS. A static snapshot has no SQL, so the two fields the
 * filters need have to travel with the card.
 *
 * `operatorHost` mirrors the COALESCE the provenance signal uses, so the
 * operator filter keys the same way in both architectures.
 */
const catsOf = db.prepare(`SELECT category FROM agent_category WHERE agent_id = ?`);
const cards = rows.map((r) => ({
  ...toAgentCard(r, db, getConcentration(db, r.agent_id), r.last_response_ms),
  cats: (catsOf.all(r.agent_id) as any[]).map((c) => c.category),
  operatorHost: r.endpoint_host ?? r.reg_host ?? null,
}));
const details: Record<string, unknown> = {};
for (const r of rows) details[r.agent_id] = toAgentDetail(db, r);

// ── corpus-wide aggregates, so denominators survive without the rows ───────
const one = (sql: string) => (db.prepare(sql).get() as any).n as number;
const corpus = {
  agents: one(`SELECT COUNT(*) n FROM agents`),
  resolved: one(`SELECT COUNT(*) n FROM agents WHERE token_uri IS NOT NULL`),
  listed: cards.length,
  operators: one(`SELECT COUNT(DISTINCT COALESCE(endpoint_host, reg_host)) n FROM agents
                   WHERE COALESCE(endpoint_host, reg_host) IS NOT NULL`),
  unattributed: one(`SELECT COUNT(*) n FROM agents WHERE COALESCE(endpoint_host, reg_host) IS NULL`),
};

/** Category counts, in the three scopes the catalog toggles between. */
function categories(scope: "all" | "paid" | "live") {
  const where = scope === "paid" ? `AND t.completed > 0`
    : scope === "live" ? `AND t.tier IN ('proven','live')` : "";
  return db.prepare(`
    SELECT c.category AS id, COUNT(*) AS agents,
           SUM(CASE WHEN t.completed > 0 THEN 1 ELSE 0 END) AS proven
      FROM agent_category c JOIN agent_trust t ON t.agent_id = c.agent_id
     WHERE 1=1 ${where}
     GROUP BY 1`).all() as any[];
}

/**
 * The operator rollup, precomputed.
 *
 * Same shape and same ordering rule as the live endpoint - money moved leads,
 * then proven agents, then probe results, then size - plus the price and
 * category enrichment. Computed once here rather than per request, which is
 * what makes a static host viable for a page that was grouping 330,794 rows.
 */
const opRows = db.prepare(`
  SELECT COALESCE(a.endpoint_host, a.reg_host) AS host,
         COUNT(*)                                  AS agents,
         SUM(a.verified_class = 'task-interface')  AS live,
         COALESCE(SUM(r.completed), 0)             AS completed,
         COALESCE(SUM(r.clients), 0)               AS clients,
         COUNT(r.agent_id)                         AS paidAgents,
         SUM(CASE WHEN r.completed > 0 THEN 1 ELSE 0 END) AS provenAgents,
         SUM(a.verified_class = 'infrastructure')  AS infrastructure,
         SUM(a.verified_class = 'html')            AS html,
         SUM(a.verified_class = 'testnet')         AS testnet,
         SUM(a.verified_class = 'dead')            AS dead,
         SUM(a.verified_class = 'unreachable')     AS unreachable,
         SUM(a.verified_class = 'no-interface')    AS noInterface,
         SUM(a.verified_class = 'unprobed')        AS unprobed,
         SUM(a.declared_class = 'machine')         AS declaresMachine,
         SUM(a.first_party = 1)                    AS firstParty
    FROM agents a
    LEFT JOIN agent_record r ON r.agent_id = a.agent_id
   WHERE COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL
   GROUP BY 1
   ORDER BY completed DESC, provenAgents DESC, live DESC, agents DESC`).all() as any[];

const priceByHost = new Map<string, bigint[]>();
for (const p of db.prepare(`
  SELECT COALESCE(a.endpoint_host, a.reg_host) AS host, r.price_med_raw AS p
    FROM agents a JOIN agent_record r ON r.agent_id = a.agent_id
   WHERE r.price_med_raw IS NOT NULL AND r.price_n >= 3
     AND COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL`).all() as any[]) {
  const list = priceByHost.get(p.host) ?? [];
  try { list.push(BigInt(p.p)); } catch { /* skip */ }
  priceByHost.set(p.host, list);
}
const catsByHost = new Map<string, { id: string; agents: number }[]>();
for (const c of db.prepare(`
  SELECT COALESCE(a.endpoint_host, a.reg_host) AS host, c.category AS id, COUNT(*) AS n
    FROM agents a JOIN agent_category c ON c.agent_id = a.agent_id
   WHERE COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL
   GROUP BY 1, 2`).all() as any[]) {
  const list = catsByHost.get(c.host) ?? [];
  list.push({ id: c.id, agents: c.n });
  catsByHost.set(c.host, list);
}
for (const row of opRows) {
  const px = (priceByHost.get(row.host) ?? []).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  row.typicalPriceRaw = px.length ? String(px[Math.floor(px.length / 2)]) : null;
  row.pricedAgents = px.length;
  row.categories = (catsByHost.get(row.host) ?? []).sort((a, b) => b.agents - a.agents).slice(0, 4);
}

/** Verified-class and tier histograms, for /api/stats. */
const hist = (col: string, table = "agents") =>
  Object.fromEntries((db.prepare(
    `SELECT ${col} k, COUNT(*) n FROM ${table} GROUP BY 1`
  ).all() as any[]).map((r) => [r.k, r.n]));

const files: Record<string, unknown> = {
  "meta.json": {
    builtAt: new Date().toISOString(),
    chainId: 56,
    // What the indexer had reached when this snapshot was cut. The UI can say
    // how stale it is instead of implying it is live.
    watermarks: {
      highestAgentId: one(`SELECT COALESCE(MAX(CAST(agent_id AS INTEGER)),0) n FROM agents`),
      highestJobId: one(`SELECT COALESCE(MAX(job_id),0) n FROM jobs`),
      lastProbeAt: (db.prepare(`SELECT MAX(probed_at) v FROM probes`).get() as any)?.v ?? null,
    },
    corpus,
  },
  "agents.json": cards,
  "details.json": details,
  "categories.json": { all: categories("all"), paid: categories("paid"), live: categories("live") },
  "operators.json": {
    chainId: 56,
    corpus: corpus.agents,
    unattributed: corpus.unattributed,
    provenOperators: opRows.filter((o: any) => o.provenAgents > 0).length,
    paidOperators: opRows.filter((o: any) => o.paidAgents > 0).length,
    operators: opRows,
  },
  "stats.json": {
    chainId: 56,
    corpus: corpus.agents,
    registrationsResolved: corpus.resolved,
    listed: corpus.listed,
    kernel: {
      jobs: one(`SELECT COUNT(*) n FROM jobs`),
      completed: one(`SELECT COUNT(*) n FROM jobs WHERE state='completed'`),
      submitted: one(`SELECT COUNT(*) n FROM jobs WHERE state='submitted'`),
      rejected: one(`SELECT COUNT(*) n FROM jobs WHERE state='rejected'`),
      expired: one(`SELECT COUNT(*) n FROM jobs WHERE state='expired'`),
      clients: one(`SELECT COUNT(DISTINCT client) n FROM jobs`),
      providers: one(`SELECT COUNT(DISTINCT provider) n FROM jobs`),
      operators: opRows.length,
      operatorsPaid: opRows.filter((o: any) => o.paidAgents > 0).length,
    },
    paidAgents: one(`SELECT COUNT(*) n FROM agent_record`),
    provenAgents: one(`SELECT COUNT(*) n FROM agent_trust WHERE tier='proven'`),
    hireable: one(`SELECT COUNT(*) n FROM agents WHERE verified_class='task-interface'`),
    firstParty: one(`SELECT COUNT(*) n FROM agents WHERE first_party=1`),
    verifiedClass: hist("verified_class"),
    tiers: hist("tier", "agent_trust"),
    reputation: {
      agentsWithFeedback: one(`SELECT COUNT(*) n FROM concentration`),
      distinctRaters: one(`SELECT COUNT(DISTINCT rater) n FROM rater_edges`),
    },
    topOperators: opRows.slice(0, 5).map((o: any) => ({ host: o.host, agents: o.agents })),
  },
};

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, body] of Object.entries(files)) {
  const json = JSON.stringify(body);
  writeFileSync(join(OUT, name), json);
  total += json.length;
  console.log(`  ${(json.length / 1024).toFixed(0).padStart(6)} KB  ${name}`);
}

console.log(`\nexported ${cards.length} listable agents of ${corpus.agents} in the corpus`);
console.log(`total ${(total / 1048576).toFixed(2)} MB into ${OUT} in ${Date.now() - started}ms`);

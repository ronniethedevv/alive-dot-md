// 8004scan (AltLayer) as a second source over the same registry.
//
//   node --experimental-strip-types indexer/src/scan8004.ts            # tip
//   node --experimental-strip-types indexer/src/scan8004.ts --full     # everything
//   node --experimental-strip-types indexer/src/scan8004.ts --reconcile  # offline diff
//
// WHY A SECOND SOURCE AT ALL, given we index the chain ourselves.
//
// Two things we cannot get cheaply from the chain, and one we should not want
// to get from it alone:
//
//   1. `created_at`. §5 concluded no timestamps existed - correct about the
//      identity and reputation registries, and archive `eth_getLogs` is behind
//      a paid token on every free BSC endpoint tested. 8004scan records when it
//      first saw each agent, which is the closest thing to an age this project
//      can have without that token.
//   2. The tip. A sequential `ownerOf` sweep reaches new ids on our schedule;
//      they index them on theirs, and theirs is faster.
//   3. Their reputation numbers, kept so they can be SHOWN AGAINST ours.
//      §13.7 argues raw rating averages here are farmed. That argument is much
//      easier to make standing next to a raw average than in place of one.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not write to `agents`, and it
// does not resolve a disagreement. Where our count and theirs differ, both
// numbers survive in their own tables and `--reconcile` prints the difference.
// A directory that quietly adopts another directory's answer has not added a
// source, it has added a dependency.

import { Agent, fetch as undiciFetch } from "undici";

import { openDb } from "./db.ts";
import { sleep } from "./rpc.ts";

// Load .env if there is one. Node 22 does this natively, so it costs no
// dependency; the file is already gitignored, which is where an API key belongs.
try { process.loadEnvFile(); } catch { /* no .env, use the shell environment */ }

const BASE = process.env.SCAN8004_BASE ?? "https://api.8004scan.io/api/v1";
const CHAIN = Number(process.env.SCAN8004_CHAIN ?? 56);

/**
 * The key is read from the environment and never printed.
 *
 * Anonymous access works - most list endpoints do not require a key - so the
 * absence of one degrades the rate limit rather than the integration. Set it in
 * .env (already gitignored) or the shell:
 *
 *   PowerShell:  $env:SCAN8004_API_KEY = "..."
 *   bash:        export SCAN8004_API_KEY=...
 */
const KEY = process.env.SCAN8004_API_KEY ?? "";

/** Same reasoning as verify.ts: this uplink needs a real connect timeout. */
const dispatcher = new Agent({
  connectTimeout: 30_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

const MODE_FULL = process.argv.includes("--full");
const ENRICH = process.argv.includes("--enrich");
const RECONCILE = process.argv.includes("--reconcile");
const RESET = process.argv.includes("--reset");
const limIdx = process.argv.indexOf("--limit");
const PAGE = limIdx >= 0 ? Number(process.argv[limIdx + 1]) || 100 : 100;
const maxIdx = process.argv.indexOf("--max-pages");
const MAX_PAGES = maxIdx >= 0 ? Number(process.argv[maxIdx + 1]) || 0 : 0;

/**
 * Rate limiting, learned from the response rather than assumed.
 *
 * The tiers run from 30/min anonymous to 10,000/min enterprise and we do not
 * know which one a given key lands in, so the floor is set from
 * X-RateLimit-Limit-Minute as soon as the first response carries it. Until
 * then it assumes the anonymous tier, which is the only safe guess: guessing
 * high and getting 429ed is how an integration becomes an attack.
 */
class Gate {
  private perMinute = Number(process.env.SCAN8004_RPM ?? 0) || 25;
  private learned = false;
  private last = 0;

  /** Learn the real limit, and how much of it is left, from the headers. */
  observe(h: Headers): void {
    const lim = Number(h.get("x-ratelimit-limit-minute") ?? 0);
    if (lim > 0 && !process.env.SCAN8004_RPM) {
      // Leave 10% headroom: the window is theirs to define and ours to respect.
      const next = Math.max(1, Math.floor(lim * 0.9));
      if (!this.learned || next !== this.perMinute) {
        console.log(`rate limit: ${lim}/min reported, pacing at ${next}/min`
          + ` (tier ${h.get("x-ratelimit-tier") ?? "?"})`);
      }
      this.perMinute = next;
      this.learned = true;
    }
  }

  async wait(): Promise<void> {
    const spacing = 60_000 / this.perMinute;
    const due = this.last + spacing;
    const now = Date.now();
    if (now < due) await sleep(due - now);
    this.last = Date.now();
  }
}
const gate = new Gate();

interface Page { items: any[]; total: number; limit: number; offset: number }

async function get(path: string, attempt = 1): Promise<Page> {
  const body = await request(path, attempt);
  return {
    items: body.items ?? [], total: body.total ?? 0,
    limit: body.limit ?? PAGE, offset: body.offset ?? 0,
  };
}

async function request(path: string, attempt = 1): Promise<any> {
  await gate.wait();
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "bnb-mrkt/0.1 (ERC-8004 marketplace; second-source sync)",
  };
  // Both spellings are in the wild; sending each costs nothing and the key
  // never appears in a URL, where it would end up in logs and referrers.
  if (KEY) { headers["x-api-key"] = KEY; headers.authorization = `Bearer ${KEY}`; }

  let res: any;
  try {
    res = await undiciFetch(`${BASE}/${path}`, {
      headers, dispatcher, signal: AbortSignal.timeout(45_000),
    });
  } catch (e: any) {
    if (attempt >= 4) throw e;
    const backoff = 2_000 * attempt * attempt;
    console.log(`  transport ${String(e?.cause?.code ?? e?.name)}, retry ${attempt + 1} in ${backoff / 1000}s`);
    await sleep(backoff);
    return request(path, attempt + 1);
  }

  gate.observe(res.headers as unknown as Headers);

  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || 60_000;
    console.log(`  429, waiting ${wait / 1000}s`);
    await sleep(wait);
    if (attempt >= 5) throw new Error("429 after 5 attempts");
    return request(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`http ${res.status} on ${path.split("?")[0]}`);

  const body = await res.json() as any;
  // The error shape is 200-with-a-body in places, so check it explicitly rather
  // than trusting the status line.
  if (body?.success === false) {
    throw new Error(`api error: ${body?.error?.code ?? "?"} ${body?.error?.message ?? ""}`.trim());
  }
  return body;
}

// ── reconcile is offline; do it before opening any socket ──────────────────
const db = openDb();

if (RECONCILE) {
  const one = (sql: string) => (db.prepare(sql).get() as any);
  const ours = one(`SELECT COUNT(*) n, MAX(CAST(agent_id AS INTEGER)) hi FROM agents`);
  const theirs = one(`SELECT COUNT(*) n, MAX(CAST(agent_id AS INTEGER)) hi FROM scan8004_agents`);
  const both = one(`SELECT COUNT(*) n FROM agents a JOIN scan8004_agents s USING (agent_id)`);
  const onlyThem = one(
    `SELECT COUNT(*) n FROM scan8004_agents s LEFT JOIN agents a USING (agent_id) WHERE a.agent_id IS NULL`);
  const dated = one(`SELECT COUNT(*) n, MIN(created_at) oldest, MAX(created_at) newest
                       FROM scan8004_agents WHERE created_at IS NOT NULL`);
  const x402 = one(`SELECT COUNT(*) n FROM scan8004_agents WHERE x402_supported = 1`);

  console.log("== reconciliation: our index vs 8004scan ==\n");
  console.log(`  ours      ${String(ours.n).padStart(7)} agents, highest id ${ours.hi}`);
  console.log(`  8004scan  ${String(theirs.n).padStart(7)} agents, highest id ${theirs.hi ?? "-"}`);
  console.log(`  in both   ${String(both.n).padStart(7)}`);
  console.log(`  theirs only ${String(onlyThem.n).padStart(5)}   <- ids we have not enumerated yet`);
  console.log(`\n  with created_at ${dated.n}  (${dated.oldest ?? "-"} .. ${dated.newest ?? "-"})`);
  console.log(`  x402_supported  ${x402.n}`);

  const det = one(`SELECT COUNT(*) n, COUNT(created_block_number) blk,
                          SUM(COALESCE(is_endpoint_verified, 0)) ver
                     FROM scan8004_detail`);
  console.log(`\n  detail records  ${det.n}  (${det.blk} with a registration block)`);

  // The comparison that is actually worth publishing: their raw rating average
  // against our farm-discounted one, on agents we have proven took paid work.
  const rows = db.prepare(`
    SELECT t.agent_id, substr(COALESCE(a.name, s.name), 1, 28) name,
           s.average_score, s.total_feedbacks, t.score, t.credible_ratings,
           t.raw_ratings, t.completed
      FROM agent_trust t
      JOIN scan8004_agents s USING (agent_id)
      LEFT JOIN agents a USING (agent_id)
     WHERE t.tier = 'proven'
     ORDER BY t.score DESC LIMIT 15`).all() as any[];
  if (rows.length) {
    console.log("\n== proven agents: their reputation vs ours ==");
    console.table(rows.map((r) => ({
      agent: r.name, completed: r.completed,
      "8004scan avg": r.average_score, "their feedbacks": r.total_feedbacks,
      "our score": r.score, "raw ratings": r.raw_ratings,
      credible: Number(r.credible_ratings ?? 0).toFixed(3),
    })));
  } else {
    console.log("\n(no reputation overlap yet - run --enrich)");
  }

  // WHERE THE TWO VERDICTS DIFFER - and why that is not a contradiction.
  //
  // Their `is_endpoint_verified` checks DOMAIN OWNERSHIP (the errors name
  // x.com, t.me, app.singularry.org), ours checks whether a task interface
  // answers. An agent can be live and unverified, or verified and dead. This
  // table exists so the difference is visible rather than averaged away, and
  // so nobody later cites their 3-of-197 as if it refuted our 196.
  const disagree = db.prepare(`
    SELECT t.agent_id, substr(COALESCE(a.name, ''), 1, 30) name, t.tier,
           a.verified_class ours,
           d.is_endpoint_verified theirs,
           substr(COALESCE(d.endpoint_verification_error, ''), 1, 46) their_error
      FROM scan8004_detail d
      JOIN agent_trust t USING (agent_id)
      LEFT JOIN agents a USING (agent_id)
     WHERE a.verified_class = 'task-interface'
       AND COALESCE(d.is_endpoint_verified, 0) = 0
     ORDER BY CASE t.tier WHEN 'proven' THEN 0 ELSE 1 END, t.score DESC
     LIMIT 12`).all() as any[];
  if (disagree.length) {
    const total = one(`SELECT COUNT(*) n FROM scan8004_detail d JOIN agents a USING (agent_id)
                        WHERE a.verified_class = 'task-interface'
                          AND COALESCE(d.is_endpoint_verified, 0) = 0`);
    console.log(`\n== we say live, they do not (${total.n} agents) ==`);
    console.table(disagree.map((r) => ({
      agent: r.name || r.agent_id, tier: r.tier,
      ours: r.ours, theirs: r.theirs ? "verified" : "not verified",
      "their error": r.their_error || "(none recorded)",
    })));
  }
  process.exit(0);
}

// ── sync ───────────────────────────────────────────────────────────────────
const upsert = db.prepare(`
  INSERT INTO scan8004_agents (
    agent_id, chain_id, contract_address, name, description, owner_address,
    is_verified, x402_supported, supported_protocols, star_count, total_score,
    health_score, rank, network_rank, total_feedbacks, average_score,
    created_at, updated_at, fetched_at
  ) VALUES (
    :agent_id, :chain_id, :contract_address, :name, :description, :owner_address,
    :is_verified, :x402_supported, :supported_protocols, :star_count, :total_score,
    :health_score, :rank, :network_rank, :total_feedbacks, :average_score,
    :created_at, :updated_at, :fetched_at
  )
  ON CONFLICT(agent_id) DO UPDATE SET
    name=excluded.name, description=excluded.description,
    owner_address=excluded.owner_address, is_verified=excluded.is_verified,
    x402_supported=excluded.x402_supported, supported_protocols=excluded.supported_protocols,
    star_count=excluded.star_count, total_score=excluded.total_score,
    health_score=excluded.health_score, rank=excluded.rank,
    network_rank=excluded.network_rank, total_feedbacks=excluded.total_feedbacks,
    average_score=excluded.average_score, updated_at=excluded.updated_at,
    fetched_at=excluded.fetched_at
    -- created_at is never overwritten: it is the field we came for, and the
    -- first answer they gave is the one to keep.
`);

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const bool = (v: unknown): number | null =>
  v === null || v === undefined ? null : (v ? 1 : 0);
/**
 * Text, defensively.
 *
 * Several detail fields are strings on one agent and structures on the next -
 * health_status is null for 270183 and an object elsewhere - and node:sqlite
 * refuses to bind an object rather than coercing it. Stringify instead of
 * dropping: an unexpected shape is information about their API, and discarding
 * it silently is exactly how the probes table lost its http_status.
 */
const text = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : typeof v === "object" ? JSON.stringify(v) : String(v);

function store(items: any[]): { seen: number; fresh: number } {
  const known = db.prepare(`SELECT 1 FROM scan8004_agents WHERE agent_id = ?`);
  const now = new Date().toISOString();
  let fresh = 0;
  db.exec("BEGIN");
  try {
    for (const a of items) {
      const id = String(a.token_id ?? "");
      if (!id) continue;
      if (!known.get(id)) fresh++;
      upsert.run({
        agent_id: id,
        chain_id: Number(a.chain_id ?? CHAIN),
        contract_address: a.contract_address ?? null,
        name: a.name ?? null,
        description: a.description ?? null,
        owner_address: a.owner_address ?? null,
        is_verified: bool(a.is_verified),
        x402_supported: bool(a.x402_supported),
        supported_protocols: Array.isArray(a.supported_protocols) && a.supported_protocols.length
          ? JSON.stringify(a.supported_protocols) : null,
        star_count: num(a.star_count),
        total_score: num(a.total_score),
        health_score: num(a.health_score),
        rank: num(a.rank),
        network_rank: num(a.network_rank),
        total_feedbacks: num(a.total_feedbacks),
        average_score: num(a.average_score),
        created_at: a.created_at ?? null,
        updated_at: a.updated_at ?? null,
        fetched_at: now,
      });
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { seen: items.length, fresh };
}

// ── enrich: the per-agent record, for the agents we actually surface ───────
//
// The list endpoint is cheap but thin. The detail endpoint costs one request
// per agent and carries created_block_number, their endpoint verification, and
// their score decomposition. Restricting it to proven+live is what makes it
// affordable on the anonymous tier: ~200 requests rather than 301,510.
if (ENRICH) {
  const upsertDetail = db.prepare(`
    INSERT INTO scan8004_detail (
      agent_id, agent_wallet, creator_address, agent_type, is_active,
      created_block_number, created_tx_hash, is_endpoint_verified,
      endpoint_verified_at, endpoint_verified_domain, endpoint_verification_error,
      endpoint_last_checked_at, health_status, health_score, health_checked_at,
      a2a_endpoint, a2a_version, mcp_server, agent_url, quality_score,
      popularity_score, activity_score, wallet_score, freshness_score,
      metadata_completeness_score, total_validations, successful_validations,
      watch_count, tags_json, categories_json, trust_models_json, fetched_at
    ) VALUES (
      :agent_id, :agent_wallet, :creator_address, :agent_type, :is_active,
      :created_block_number, :created_tx_hash, :is_endpoint_verified,
      :endpoint_verified_at, :endpoint_verified_domain, :endpoint_verification_error,
      :endpoint_last_checked_at, :health_status, :health_score, :health_checked_at,
      :a2a_endpoint, :a2a_version, :mcp_server, :agent_url, :quality_score,
      :popularity_score, :activity_score, :wallet_score, :freshness_score,
      :metadata_completeness_score, :total_validations, :successful_validations,
      :watch_count, :tags_json, :categories_json, :trust_models_json, :fetched_at
    )
    ON CONFLICT(agent_id) DO UPDATE SET
      agent_wallet=excluded.agent_wallet, is_active=excluded.is_active,
      created_block_number=excluded.created_block_number,
      created_tx_hash=excluded.created_tx_hash,
      is_endpoint_verified=excluded.is_endpoint_verified,
      endpoint_verified_at=excluded.endpoint_verified_at,
      endpoint_verified_domain=excluded.endpoint_verified_domain,
      endpoint_verification_error=excluded.endpoint_verification_error,
      endpoint_last_checked_at=excluded.endpoint_last_checked_at,
      health_status=excluded.health_status, health_score=excluded.health_score,
      health_checked_at=excluded.health_checked_at,
      a2a_endpoint=excluded.a2a_endpoint, a2a_version=excluded.a2a_version,
      mcp_server=excluded.mcp_server, agent_url=excluded.agent_url,
      quality_score=excluded.quality_score, popularity_score=excluded.popularity_score,
      activity_score=excluded.activity_score, wallet_score=excluded.wallet_score,
      freshness_score=excluded.freshness_score,
      metadata_completeness_score=excluded.metadata_completeness_score,
      total_validations=excluded.total_validations,
      successful_validations=excluded.successful_validations,
      watch_count=excluded.watch_count, tags_json=excluded.tags_json,
      categories_json=excluded.categories_json, trust_models_json=excluded.trust_models_json,
      fetched_at=excluded.fetched_at
  `);

  const targets = db.prepare(`
    SELECT agent_id FROM agent_trust
     WHERE tier IN ('proven', 'live')
     ORDER BY CASE tier WHEN 'proven' THEN 0 ELSE 1 END, score DESC
  `).all() as { agent_id: string }[];

  console.log(`enriching ${targets.length} proven+live agents (1 request each)`);
  const jsonOrNull = (v: unknown) =>
    Array.isArray(v) && v.length ? JSON.stringify(v) : null;

  let ok = 0, failed = 0;
  const problems: string[] = [];
  for (const [i, t] of targets.entries()) {
    let a: any;
    try {
      a = await request(`agents/${CHAIN}/${t.agent_id}`);
    } catch (e: any) {
      // Their DATABASE_ERROR is intermittent and per-record - it is not an auth
      // wall and not our bug. Record it and move on; §12 rule 0 applies to
      // their failures too, so it is counted rather than silently skipped.
      failed++;
      if (problems.length < 6) problems.push(`${t.agent_id}: ${String(e?.message ?? e).slice(0, 60)}`);
      continue;
    }
    // The detail response is a superset of the list shape, so fill the list
    // table from it too. Without this, an agent reached only by --enrich has
    // its scores in one table and nothing in the other, and every join that
    // compares their reputation to ours silently returns nothing.
    store([a]);
    upsertDetail.run({
      agent_id: String(a.token_id ?? t.agent_id),
      agent_wallet: text(a.agent_wallet),
      creator_address: text(a.creator_address),
      agent_type: text(a.agent_type),
      is_active: bool(a.is_active),
      created_block_number: num(a.created_block_number),
      created_tx_hash: text(a.created_tx_hash),
      is_endpoint_verified: bool(a.is_endpoint_verified),
      endpoint_verified_at: text(a.endpoint_verified_at),
      endpoint_verified_domain: text(a.endpoint_verified_domain),
      endpoint_verification_error: text(a.endpoint_verification_error),
      endpoint_last_checked_at: text(a.endpoint_last_checked_at),
      health_status: text(a.health_status),
      health_score: num(a.health_score),
      health_checked_at: text(a.health_checked_at),
      a2a_endpoint: text(a.a2a_endpoint),
      a2a_version: text(a.a2a_version),
      mcp_server: text(a.mcp_server),
      agent_url: text(a.agent_url),
      quality_score: num(a.quality_score),
      popularity_score: num(a.popularity_score),
      activity_score: num(a.activity_score),
      wallet_score: num(a.wallet_score),
      freshness_score: num(a.freshness_score),
      metadata_completeness_score: num(a.metadata_completeness_score),
      total_validations: num(a.total_validations),
      successful_validations: num(a.successful_validations),
      watch_count: num(a.watch_count),
      tags_json: jsonOrNull(a.tags),
      categories_json: jsonOrNull(a.categories),
      trust_models_json: jsonOrNull(a.supported_trust_models),
      fetched_at: new Date().toISOString(),
    });
    ok++;
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${targets.length}  ok=${ok} failed=${failed}`);
  }

  console.log(`\nenriched ${ok}, failed ${failed}`);
  for (const p of problems) console.log(`  ${p}`);

  const blocks = (db.prepare(
    `SELECT COUNT(*) n FROM scan8004_detail WHERE created_block_number IS NOT NULL`).get() as any).n;
  const verified = (db.prepare(
    `SELECT COUNT(*) n FROM scan8004_detail WHERE is_endpoint_verified = 1`).get() as any).n;
  console.log(`${blocks} carry a registration block number (-> real on-chain timestamps)`);
  console.log(`${verified} they consider endpoint-verified`);
  process.exit(0);
}

const CURSOR = `scan8004:${CHAIN}`;
const readCursor = (): number => {
  const r = db.prepare(`SELECT block FROM indexer_cursor WHERE stream = ?`).get(CURSOR) as any;
  return r?.block ?? 0;
};
const writeCursor = (n: number) => db.prepare(
  `INSERT INTO indexer_cursor (stream, block) VALUES (?, ?)
   ON CONFLICT(stream) DO UPDATE SET block=excluded.block`).run(CURSOR, n);

if (RESET) { writeCursor(0); console.log("cursor reset to offset 0"); }

console.log(KEY ? "using SCAN8004_API_KEY" : "no API key set - anonymous tier");
console.log(MODE_FULL ? "mode: full sweep (resumable)" : "mode: tip (newest first, stops when nothing is new)");

let offset = MODE_FULL ? readCursor() : 0;
let pages = 0, stored = 0, freshTotal = 0, emptyStreak = 0;
const startedAt = Date.now();

for (;;) {
  const page = await get(`agents?chain_id=${CHAIN}&limit=${PAGE}&offset=${offset}`);
  if (!page.items.length) { console.log("empty page, done"); break; }

  const { seen, fresh } = store(page.items);
  stored += seen; freshTotal += fresh; pages++;

  const ids = page.items.map((i: any) => Number(i.token_id)).filter(Number.isFinite);
  console.log(
    `  offset ${String(offset).padStart(6)}  ${String(seen).padStart(3)} rows`
    + `  ${String(fresh).padStart(3)} new`
    + `  ids ${Math.min(...ids)}..${Math.max(...ids)}`
    + `  of ${page.total}`,
  );

  offset += page.items.length;
  if (MODE_FULL) writeCursor(offset);

  if (page.total && offset >= page.total) { console.log("reached total, done"); break; }
  if (MAX_PAGES && pages >= MAX_PAGES) { console.log(`stopping after ${pages} pages (--max-pages)`); break; }

  if (!MODE_FULL) {
    // TIP MODE. The list comes back newest-first, so once a whole page holds
    // nothing we have not already stored, we have caught up. Two consecutive
    // such pages rather than one, because a page can straddle a boundary.
    emptyStreak = fresh === 0 ? emptyStreak + 1 : 0;
    if (emptyStreak >= 2) { console.log("caught up (2 pages with nothing new)"); break; }
  }
}

const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log(`\n${pages} pages, ${stored} rows stored, ${freshTotal} previously unseen, ${secs}s`);

const total = (db.prepare(`SELECT COUNT(*) n FROM scan8004_agents`).get() as any).n;
const withDate = (db.prepare(
  `SELECT COUNT(*) n FROM scan8004_agents WHERE created_at IS NOT NULL`).get() as any).n;
const newIds = (db.prepare(
  `SELECT COUNT(*) n FROM scan8004_agents s LEFT JOIN agents a USING (agent_id)
    WHERE a.agent_id IS NULL`).get() as any).n;
console.log(`table now holds ${total} agents, ${withDate} with a created_at`);
console.log(`${newIds} of them are ids our own sweep has not enumerated yet`);
console.log(`\nnext: node --experimental-strip-types indexer/src/scan8004.ts --reconcile`);

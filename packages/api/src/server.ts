// DEVELOPMENT ONLY. Production does not run this.
//
// This reads the 346 MB working SQLite index directly and holds it open for
// writes. Nothing about that survives a deploy: the database is gitignored and
// over GitHub's file limit, and Vercel functions are ephemeral and read-only.
//
// Production serves the same routes from api/[...path].ts over the snapshot
// that indexer/src/export-catalog.ts writes into data/. The route names, query
// parameters and response shapes are identical on purpose, so `npm run api`
// stays a faithful local stand-in - if a change works here it works there.
//
// Keep the two in step. A route added here and not there is a route that works
// on your machine and 404s in production.

// The §8.1 API. Zero dependencies: node:http and node:sqlite.
//
// Every field served here is computed from data we actually hold (§12). Where a
// value is not yet computable it is null, and null is a state the UI must
// render - never a zero, never a placeholder, never a hidden row.
//
//   node --experimental-strip-types packages/api/src/server.ts

import { createServer } from "node:http";
import { verifyNow } from "./verify-now.ts";
import { getQuote } from "./quote.ts";
import { openDb } from "../../../indexer/src/db.ts";
import { ERC8183 } from "../../shared/src/chain.ts";
import {
  toAgentCard, toAgentDetail, getConcentration, type AgentRow,
} from "./shape.ts";
import { RULES } from "../../shared/src/categories.ts";
import { matchNeed } from "./match.ts";
import * as x402 from "./x402.ts";

const PORT = Number(process.env.PORT ?? 8787);
const db = openDb();

/** Ratings this agent has, as a scalar. Used by more than one sort. */
const RATING_COUNT =
  `COALESCE((SELECT rating_count FROM concentration c WHERE c.agent_id = agents.agent_id), 0)`;

const SORTS: Record<string, string> = {
  /**
   * The one scale. Reads the same column the badge displays.
   *
   * It used to be a CASE over `verified_class`, which is why "Best" ranked
   * agents with an undelivered funded job above agents with four completed
   * ones: `unprobed` sorted better than `unreachable`, and the score the row
   * showed never entered the ordering at all.
   */
  score: `COALESCE(t.score, 0) DESC, CAST(agents.agent_id AS INTEGER)`,
  /**
   * Tier order, most-established first.
   *
   * `tier` in §8.1 is the field the UI leads with, and until now nothing could
   * sort by it: "Best" ranks on verified_class alone, which is identical for
   * every agent in the live catalog, so the one distinction the tier makes -
   * has anyone actually rated this thing - was invisible in every ordering.
   *
   * established = answered AND has ratings; emerging = answered; unproven = the
   * rest. Within a tier, more ratings first, then id, so the order is total and
   * paging cannot repeat or skip a row.
   */
  established: `CASE t.tier WHEN 'proven' THEN 0 WHEN 'live' THEN 1
                             WHEN 'declared' THEN 2 ELSE 3 END,
                COALESCE(t.score, 0) DESC,
                CAST(agents.agent_id AS INTEGER)`,
  /**
   * Most completed paid jobs first. The only ordering in the product backed by
   * money changing hands rather than by an endpoint answering a call.
   */
  record: `COALESCE(t.completed, -1) DESC, COALESCE(t.score, 0) DESC,
           CAST(agents.agent_id AS INTEGER)`,
  newest: `CAST(agents.agent_id AS INTEGER) DESC`,
  responseTime: `COALESCE((SELECT response_ms FROM probes p WHERE p.agent_id = agents.agent_id), 999999),
                 CAST(agents.agent_id AS INTEGER)`,
};

function json(res: any, code: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    // The probe data is a public good (§4/§11): let anyone read it.
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=15",
  });
  res.end(s);
}

/** GET /api/agents */
function listAgents(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get("perPage") ?? 25) || 25));
  const q = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const sort = SORTS[url.searchParams.get("sort") ?? "score"] ?? SORTS.score;

  // `live` defaults TRUE (§8.2: live-only is the default catalog filter), and
  // "live" means probe-verified, never merely declared.
  const liveParam = url.searchParams.get("live");
  const liveOnly = liveParam === null ? true : liveParam !== "false";

  const where: string[] = [];
  const params: any = {};
  if (liveOnly) where.push(`verified_class = 'task-interface'`);
  if (q) {
    // Search what the agent SAYS IT DOES, not only what it is called.
    //
    // The field asks "What do you need done?" and the landing page promises a
    // ranked list of agents that can do it, but the query matched name and
    // description only, so `categories_json` - the OASF taxonomy that is the
    // closest thing the registry has to a capability - was unsearchable, and
    // `endpoint_service` (the service type: A2A, MCP, q402) was too. Typing a
    // capability returned nothing and the promise on the front page was, for
    // that query, simply untrue.
    where.push(
      `(name LIKE :q OR description LIKE :q OR categories_json LIKE :q
        OR endpoint_service LIKE :q OR agent_id = :qexact)`,
    );
    params.q = `%${q}%`;
    params.qexact = q;
  }
  /**
   * One or more categories, comma separated, matched as OR.
   *
   * Was `categories_json LIKE '%"x"%'`, which searched the OASF block from the
   * registration - present on almost nothing and empty (`[]`) on every agent in
   * the live catalog. It now reads `agent_category`, derived from what agents
   * actually write about themselves.
   */
  const cats = (url.searchParams.get("category") ?? "")
    .split(",").map((c) => c.trim()).filter(Boolean);
  if (cats.length) {
    const names = cats.map((_, i) => `:cat${i}`).join(", ");
    cats.forEach((c, i) => { params[`cat${i}`] = c; });
    where.push(
      `EXISTS (SELECT 1 FROM agent_category ac
                WHERE ac.agent_id = agents.agent_id AND ac.category IN (${names}))`,
    );
  }
  /**
   * Only agents that have been PAID by someone other than themselves.
   *
   * This is a different and much stronger claim than the `live` filter, which
   * only says an endpoint answered. A full scan of the kernel found 856 agents
   * with third-party jobs and zero overlap with the live catalog.
   */
  if (url.searchParams.get("paid") === "true") {
    where.push(`EXISTS (SELECT 1 FROM agent_record ar WHERE ar.agent_id = agents.agent_id)`);
  }

  // Narrow to one operator. Keyed the same way the provenance signal is: the
  // answering host where there is one, the registration host otherwise.
  const operator = (url.searchParams.get("operator") ?? "").trim();
  if (operator) {
    where.push(`COALESCE(endpoint_host, reg_host) = :operator`);
    params.operator = operator;
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // `agent_trust` has a row for every agent, so this is a 1:1 join and lets the
  // ranking use idx_agent_trust_score instead of a correlated subquery per row -
  // which made an unfiltered "Best" page time out entirely.
  const JOIN = `FROM agents LEFT JOIN agent_trust t ON t.agent_id = agents.agent_id`;
  const total = (db.prepare(`SELECT COUNT(*) n ${JOIN} ${w}`).get(params) as any).n as number;
  // The latest probe per agent, joined so cards can show the latency the
  // "Fastest" sort orders by. One indexed lookup per row on idx_probes_agent.
  const rows = db.prepare(
    `SELECT agents.*,
            (SELECT response_ms FROM probes p WHERE p.agent_id = agents.agent_id
              ORDER BY p.probed_at DESC LIMIT 1) AS last_response_ms
       ${JOIN} ${w} ORDER BY ${sort} LIMIT :lim OFFSET :off`,
  ).all({ ...params, lim: perPage, off: (page - 1) * perPage }) as unknown as
    (AgentRow & { last_response_ms: number | null })[];

  // The hidden count is the honest version of a default filter (§9 Day 5). A
  // catalog that quietly drops 99.99% of its corpus is the thing we object to.
  const totalAll = (db.prepare(`SELECT COUNT(*) n FROM agents`).get() as any).n as number;
  const resolved = (db.prepare(
    `SELECT COUNT(*) n FROM agents WHERE reg_fetch_error IS NOT 'pending-fetch'`,
  ).get() as any).n as number;

  /**
   * Who operates the agents in THIS result set.
   *
   * §12: "Provenance fires on our own catalog, and we must say so. It would be
   * indefensible to run it on other people's agents and stay quiet about our
   * own front page." That sentence had no implementation. The signal existed
   * only on the detail screen, one agent at a time, where a reader could page
   * through 177 agents without ever noticing they were all the same operator.
   *
   * Grouped on the answering host, falling back to the registration host, which
   * is the same rule the per-agent signal uses.
   */
  const operators = db.prepare(
    `SELECT COALESCE(endpoint_host, reg_host) host, COUNT(*) n
       ${JOIN} ${w}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
  ).all(params) as { host: string | null; n: number }[];
  const namedOperators = operators.filter((o) => o.host);

  return {
    // NOT `rows.map(toAgentCard)`: map passes the index as the second argument,
    // which lands in the `db` parameter and blows up on the second row.
    results: rows.map((r) =>
      toAgentCard(r, db, getConcentration(db, r.agent_id), r.last_response_ms)),
    total,
    page,
    perPage,
    filter: {
      liveOnly,
      hiddenByLiveFilter: liveOnly ? totalAll - total : 0,
      // Rule 0: the catalog says out loud how much of itself it has not checked.
      corpusResolved: resolved,
      corpusTotal: totalAll,
    },
    composition: {
      // A count of the hosts present, not of the five we return.
      distinctOperators: (db.prepare(
        `SELECT COUNT(DISTINCT COALESCE(endpoint_host, reg_host)) n ${JOIN} ${w}`,
      ).get(params) as any).n as number,
      topOperators: namedOperators,
    },
  };
}

/**
 * Job state enum, derived empirically from 400 live jobs rather than from a
 * doc, because the ABI names the field but not its values:
 *
 *   0 and 1 NEVER carry a reason hash; 2 and 3 ALWAYS do, and a reason hash is
 *   only writable by complete() and reject(). So 2 and 3 are the two terminal
 *   states and 0 and 1 are the two live ones.
 *
 * `submitted` is not separately observable here, so a funded job that has
 * delivered still reads as funded. Better an honest coarse label than a
 * confident wrong one.
 */
const JOB_STATE: Record<number, string> = {
  0: "open", 1: "funded", 2: "completed", 3: "rejected",
};

async function readJob(jobId: string) {
  const { Rpc } = await import("../../../indexer/src/rpc.ts");
  const rpc = new Rpc({ perEndpoint: 1 });
  const data = "0x180aedf3" + BigInt(jobId).toString(16).padStart(64, "0"); // jobs(uint256)
  const [r] = await rpc.ethCallDetailed([{ to: ERC8183.commerceProxy, data }]);
  if (!r || r.kind !== "ok" || r.data === "0x") return null;

  const w = r.data.slice(2).match(/.{64}/g)!;
  const addr = (i: number) => "0x" + w[i]!.slice(24);
  const num = (i: number) => BigInt("0x" + w[i]!);
  const state = Number(num(7));
  // The terms string is a dynamic arg: word 4 holds its offset.
  const off = Number(num(4)) / 32;
  const len = Number(BigInt("0x" + w[off]!));
  const terms = Buffer.from(w.slice(off + 1).join("").slice(0, len * 2), "hex").toString("utf8");
  const reasonHash = "0x" + w[10];
  const zero = /^0x0+$/.test(reasonHash);

  return {
    jobId,
    chainId: 56,
    state: JOB_STATE[state] ?? `unknown_${state}`,
    rawState: state,
    client: addr(1),
    provider: addr(2),
    evaluator: addr(3),
    conditions: terms,
    budget: { amount: num(5).toString(), token: "U", decimals: 18 },
    deadline: Number(num(6)) ? new Date(Number(num(6)) * 1000).toISOString() : null,
    // Only ever set by complete() or reject(), so it is the evaluator's
    // published verdict commitment.
    reasonHash: zero ? null : reasonHash,
    // Resolving the hash to its document needs the evaluator's published file,
    // which we only hold for jobs we judged ourselves.
    reasonText: null,
    parentJobId: null,
    depth: 0,
  };
}

/**
 * Rate limit for on demand verification.
 *
 * The endpoint makes us fetch a third party URL on request, so it is both a way
 * to burn our outbound bandwidth and a way to aim our server at someone else's.
 * One check per agent per minute, and a global ceiling so a script cannot walk
 * the whole registry. In memory is enough: a restart losing the counters is not
 * a security property anyone depends on.
 */
const AGENT_COOLDOWN_MS = 60_000;
const GLOBAL_PER_MIN = 30;
const lastCheck = new Map<string, number>();
let windowStart = Date.now();
let windowCount = 0;

function rateLimit(agentId: string): { ok: true } | { ok: false; retryAfter: number; why: string } {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  if (windowCount >= GLOBAL_PER_MIN) {
    return { ok: false, retryAfter: Math.ceil((windowStart + 60_000 - now) / 1000),
      why: "too many checks are running right now, try shortly" };
  }
  const prev = lastCheck.get(agentId) ?? 0;
  if (now - prev < AGENT_COOLDOWN_MS) {
    return { ok: false, retryAfter: Math.ceil((prev + AGENT_COOLDOWN_MS - now) / 1000),
      why: "this agent was just checked" };
  }
  lastCheck.set(agentId, now);
  windowCount++;
  return { ok: true };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    return res.end();
  }
  try {
    if (url.pathname === "/api/agents") return json(res, 200, listAgents(url));

    const m = url.pathname.match(/^\/api\/agents\/(\d+)$/);
    if (m) {
      const row = db.prepare(`SELECT * FROM agents WHERE agent_id = ?`).get(m[1]) as unknown as AgentRow | undefined;
      if (!row) return json(res, 404, { error: "not_found", agentId: m[1] });
      return json(res, 200, toAgentDetail(db, row));
    }

    // POST /api/agents/:id/quote - ask the agent what it charges.
    const quoteMatch = url.pathname.match(/^\/api\/agents\/(\d+)\/quote$/);
    if (quoteMatch) {
      if (req.method !== "POST") {
        return json(res, 405, { error: "method_not_allowed", expected: "POST" });
      }
      const agentId = quoteMatch[1]!;
      const row = db.prepare(`SELECT endpoint FROM agents WHERE agent_id = ?`).get(agentId) as any;
      if (!row) return json(res, 404, { error: "not_found", agentId });

      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32_000) return json(res, 413, { error: "payload_too_large" });
      }
      let payload: any = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { return json(res, 400, { error: "invalid_json" }); }

      const gate = rateLimit(`quote:${agentId}`);
      if (!gate.ok) {
        res.setHeader("retry-after", String(gate.retryAfter));
        return json(res, 429, { error: "rate_limited", message: gate.why, retryAfter: gate.retryAfter });
      }
      return json(res, 200, await getQuote(
        row.endpoint, String(payload.task ?? ""), String(payload.conditions ?? ""),
        payload.budgetWei ? String(payload.budgetWei) : undefined,
      ));
    }

    // POST /api/agents/:id/verify - check an agent right now.
    const verifyMatch = url.pathname.match(/^\/api\/agents\/(\d+)\/verify$/);
    if (verifyMatch) {
      if (req.method !== "POST") {
        return json(res, 405, { error: "method_not_allowed", expected: "POST" });
      }
      const agentId = verifyMatch[1]!;
      const gate = rateLimit(agentId);
      if (!gate.ok) {
        res.setHeader("retry-after", String(gate.retryAfter));
        return json(res, 429, { error: "rate_limited", message: gate.why, retryAfter: gate.retryAfter });
      }
      try {
        return json(res, 200, await verifyNow(db, agentId));
      } catch (e: any) {
        return json(res, 503, { error: "check_failed", message: String(e?.message ?? e).slice(0, 200) });
      }
    }

    /**
     * GET /api/operators — who is actually behind the registry.
     *
     * The unit here is the HOST, not the agent, because that is the unit the
     * registry collapses onto: hundreds of thousands of identities resolve to a few hundred
     * hosts, and five of them hold most of it. An agent-level catalog cannot
     * show that, and the provenance signal (§5) is meaningless without it.
     *
     * Every column is a count of a state we actually recorded. `unprobed` is
     * given its own column rather than folded into a failure, because §12 rule
     * 0 forbids a pending check from reading as a negative result - and on this
     * table it is the single most load-bearing number: the largest block of
     * candidate agents in the registry is unprobed, not dead.
     */
    /**
     * POST /api/match — the hiring concierge.
     *
     * Deterministic by design; see match.ts. There is no model here to inject a
     * prompt into, the ranking is `agent_trust`, and no price is ever invented.
     */
    if (url.pathname === "/api/match" && req.method === "POST") {
      const body = await new Promise<string>((resolve) => {
        let b = ""; req.on("data", (c: any) => { b += c; if (b.length > 8000) req.destroy(); });
        req.on("end", () => resolve(b));
      });
      let need = "";
      try { need = String(JSON.parse(body || "{}").need ?? ""); } catch { /* empty */ }

      /**
       * Machines pay, people do not.
       *
       * The gate closes only on callers that ASK to be metered - an agent
       * integrating on purpose sends `x-402: 1` or an `x-payment`. Sniffing
       * for bots and billing whatever looked non-human would eventually charge
       * the wrong party, and a browser meeting a surprise 402 is a broken
       * product. See x402.ts for why the fee cannot sit on the human path or on
       * the escrow instead.
       */
      if (x402.enabled() && x402.wantsMetered(req.headers as any)) {
        const resource = `https://${req.headers.host ?? "alive.md"}/api/match`;
        const payment = String((req.headers as any)["x-payment"] ?? "");
        if (!payment) {
          res.setHeader("content-type", "application/json");
          return json(res, 402, x402.requirements(resource));
        }
        const settled = await x402.verify(payment, resource);
        if (!settled.ok) return json(res, 402, { ...x402.requirements(resource), error: settled.reason });
        if (settled.txHash) res.setHeader("x-payment-response", settled.txHash);
      }

      return json(res, 200, matchNeed(db, need.slice(0, 2000)));
    }

    if (url.pathname === "/api/operators") {
      /**
       * Paid work is joined in, not left out.
       *
       * This endpoint predates `agent_record` and ranked purely on probe
       * verdicts, which made it understate the registry by a factor of
       * eighteen: it reported ONE operator "with anything hireable" - the one
       * host answering an HTTP call - while 18 hosts had agents that had
       * actually completed paid jobs and 57 had some paid record. It also
       * sorted `live DESC, agents DESC`, so an operator with 12 completed jobs
       * ranked below one with 107,021 never-checked agents.
       *
       * Money moved is the strongest evidence this project has. It leads.
       */
      const rows = db.prepare(
        `SELECT COALESCE(a.endpoint_host, a.reg_host) AS host,
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
          ORDER BY completed DESC, provenAgents DESC, live DESC, agents DESC`,
      ).all() as any[];

      /**
       * WHAT THIS OPERATOR CHARGES, AND WHAT IT DOES.
       *
       * The page listed identities, clients and probe verdicts - everything
       * about whether an operator is THERE and nothing about whether you would
       * want to hire from it. Two operators reading "4 identities · 12 paid
       * jobs" are indistinguishable until you know one works on rebalancing at
       * 0.10 U and the other screens tokens at 0.05.
       *
       * Both facts already existed. Price landed in `agent_record` when the
       * pricing panel was built and was never surfaced here; categories have
       * been in `agent_category` since the catalog got filters.
       *
       * Fetched as two flat queries and merged in JS rather than as correlated
       * subqueries per row - there are 1,134 operators, and this endpoint has
       * already been the slow one once.
       */
      const priceByHost = new Map<string, bigint[]>();
      for (const p of db.prepare(
        `SELECT COALESCE(a.endpoint_host, a.reg_host) AS host, r.price_med_raw AS p
           FROM agents a JOIN agent_record r ON r.agent_id = a.agent_id
          WHERE r.price_med_raw IS NOT NULL
            AND r.price_n >= 3
            AND COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL`,
      ).all() as any[]) {
        const list = priceByHost.get(p.host) ?? [];
        try { list.push(BigInt(p.p)); } catch { /* skip unparseable */ }
        priceByHost.set(p.host, list);
      }

      const catsByHost = new Map<string, { id: string; agents: number }[]>();
      for (const c of db.prepare(
        `SELECT COALESCE(a.endpoint_host, a.reg_host) AS host, c.category AS id, COUNT(*) AS n
           FROM agents a JOIN agent_category c ON c.agent_id = a.agent_id
          WHERE COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL
          GROUP BY 1, 2`,
      ).all() as any[]) {
        const list = catsByHost.get(c.host) ?? [];
        list.push({ id: c.id, agents: c.n });
        catsByHost.set(c.host, list);
      }

      for (const row of rows) {
        const px = (priceByHost.get(row.host) ?? []).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        // Median of the member agents' own medians. Null rather than a guess
        // when nothing on this host has settled enough paid work to have one -
        // the same floor the agent panel uses, for the same reason.
        row.typicalPriceRaw = px.length ? String(px[Math.floor(px.length / 2)]) : null;
        row.pricedAgents = px.length;
        row.categories = (catsByHost.get(row.host) ?? [])
          .sort((a, b) => b.agents - a.agents)
          .slice(0, 4);
      }

      // Agents that name no host at all: inline registrations with no service
      // entry. Not an operator, but the reader must be told they exist or the
      // totals on this page will not reconcile with the catalog.
      const unattributed = (db.prepare(
        `SELECT COUNT(*) n FROM agents WHERE COALESCE(endpoint_host, reg_host) IS NULL`,
      ).get() as any).n as number;

      const one = (sql: string) => (db.prepare(sql).get() as any).n as number;

      return json(res, 200, {
        chainId: 56,
        readAt: new Date().toISOString(),
        corpus: (db.prepare(`SELECT COUNT(*) n FROM agents`).get() as any).n,
        unattributed,
        /** Hosts with at least one agent that has COMPLETED paid work. */
        provenOperators: one(
          `SELECT COUNT(DISTINCT COALESCE(a.endpoint_host, a.reg_host)) n
             FROM agents a JOIN agent_record r ON r.agent_id = a.agent_id
            WHERE r.completed > 0 AND COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL`),
        /** Hosts with any paid record at all, completed or still pending. */
        paidOperators: one(
          `SELECT COUNT(DISTINCT COALESCE(a.endpoint_host, a.reg_host)) n
             FROM agents a JOIN agent_record r ON r.agent_id = a.agent_id
            WHERE COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL`),
        operators: rows,
      });
    }

    /**
     * GET /api/categories — the vocabulary, with counts that respect the same
     * filters the catalog uses, so a chip never promises rows it cannot show.
     *
     * `proven` is the count that matters: how many agents in this category have
     * actually been paid. A category with 132,792 agents and 6 proven ones is
     * telling you something real about the registry, and the UI shows both.
     */
    if (url.pathname === "/api/categories") {
      const liveParam = url.searchParams.get("live");
      const liveOnly = liveParam === null ? false : liveParam !== "false";
      const paidOnly = url.searchParams.get("paid") === "true";

      const rows = RULES.map((r) => {
        const scope: string[] = [`ac.category = :cat`];
        if (liveOnly) scope.push(`a.verified_class = 'task-interface'`);
        if (paidOnly) {
          scope.push(`EXISTS (SELECT 1 FROM agent_record ar WHERE ar.agent_id = a.agent_id)`);
        }
        const n = (db.prepare(
          `SELECT COUNT(*) n FROM agent_category ac JOIN agents a ON a.agent_id = ac.agent_id
            WHERE ${scope.join(" AND ")}`,
        ).get({ cat: r.id }) as any).n as number;
        const proven = (db.prepare(
          `SELECT COUNT(*) n FROM agent_category ac
             JOIN agent_trust t ON t.agent_id = ac.agent_id
            WHERE ac.category = :cat AND t.tier = 'proven'`,
        ).get({ cat: r.id }) as any).n as number;
        return { id: r.id, label: r.label, agents: n, proven };
      });

      return json(res, 200, {
        readAt: new Date().toISOString(),
        // Categories are self-described. Say so in the payload, not only in the
        // UI, so anyone consuming this API inherits the caveat.
        basis: "self-described: matched against the agent's own name, description and declared skills",
        categories: rows,
      });
    }

    if (url.pathname === "/api/stats") {
      const by = (col: string) => Object.fromEntries(
        (db.prepare(`SELECT ${col} k, COUNT(*) n FROM agents GROUP BY 1`).all() as any[])
          .map((r) => [r.k, r.n]),
      );
      const one = (sql: string) => (db.prepare(sql).get() as any)?.n ?? 0;
      // Everything here is a live count. Nothing on the site is allowed to
      // state a figure this endpoint cannot produce.
      return json(res, 200, {
        chainId: 56,
        readAt: new Date().toISOString(),
        /**
         * When the DATA was gathered, which is not when this response was
         * built.
         *
         * `readAt` is `Date.now()` and the landing page was printing it as
         * "Last updated", so the site claimed to be current no matter how old
         * the index was - it would have said "last updated today" on a database
         * that had not been touched in a month. These are the real high-water
         * marks, taken from the rows themselves.
         */
        freshness: {
          jobsScannedAt: (db.prepare(`SELECT MAX(scanned_at) t FROM jobs`).get() as any)?.t ?? null,
          walletsScannedAt:
            (db.prepare(`SELECT MAX(scanned_at) t FROM agent_wallets`).get() as any)?.t ?? null,
          recordsBuiltAt:
            (db.prepare(`SELECT MAX(computed_at) t FROM agent_record`).get() as any)?.t ?? null,
          lastProbeAt: (db.prepare(`SELECT MAX(verified_at) t FROM agents`).get() as any)?.t ?? null,
          /** Highest identity we hold. The live head is one eth_call away and
           *  deliberately NOT fetched here: a stats endpoint must not depend on
           *  an RPC round trip to answer. `npm run catch-up:dry` reports drift. */
          highestAgentId: (db.prepare(
            `SELECT MAX(CAST(agent_id AS INTEGER)) n FROM agents`).get() as any)?.n ?? null,
          highestJobId: (db.prepare(`SELECT MAX(job_id) n FROM jobs`).get() as any)?.n ?? null,
        },
        /** Agents that have taken paid work from someone other than themselves. */
        /**
         * The commerce kernel, as figures rather than prose.
         *
         * The landing page states these; they must come from the index, not
         * from copy someone typed once. The footer already promises "figures
         * are read live from our own index", and a hardcoded 92% would make
         * that a lie the first time the number moved.
         */
        kernel: (() => {
          const st = (k) => one(`SELECT COUNT(*) n FROM jobs WHERE state = '${k}'`);
          const total = one(`SELECT COUNT(*) n FROM jobs`);
          const top = (db.prepare(
            `SELECT COUNT(*) n FROM jobs WHERE terms LIKE '%social-meme-booster-judge%'`,
          ).get()).n;
          const allEdges = one(`SELECT COUNT(*) n FROM rater_edges`);
          const bulkEdges = (db.prepare(
            `SELECT COALESCE(SUM(n), 0) s FROM (
               SELECT COUNT(*) n FROM rater_edges GROUP BY rater HAVING n >= 100)`,
          ).get()).s;
          return {
            jobs: total,
            completed: st("completed"),
            submitted: st("submitted"),
            rejected: st("rejected"),
            expired: st("expired"),
            clients: one(`SELECT COUNT(DISTINCT client) n FROM jobs`),
            providers: one(`SELECT COUNT(DISTINCT provider) n FROM jobs`),
            topServiceJobs: top,
            topServicePct: total ? Math.round((100 * top) / total) : 0,
            operators: one(
              `SELECT COUNT(DISTINCT COALESCE(endpoint_host, reg_host)) n FROM agents
                WHERE COALESCE(endpoint_host, reg_host) IS NOT NULL`),
            operatorsPaid: one(
              `SELECT COUNT(DISTINCT COALESCE(a.endpoint_host, a.reg_host)) n
                 FROM agents a JOIN agent_record r ON r.agent_id = a.agent_id
                WHERE r.completed > 0 AND COALESCE(a.endpoint_host, a.reg_host) IS NOT NULL`),
            /** Share of all rating edges written by raters with 100+ ratings. */
            bulkRaterPct: allEdges ? Math.round((100 * bulkEdges) / allEdges) : 0,
          };
        })(),
        paidAgents: one(`SELECT COUNT(*) n FROM agent_record`),
        provenAgents: one(`SELECT COUNT(*) n FROM agent_record WHERE completed > 0`),
        jobsIndexed: one(`SELECT COUNT(*) n FROM jobs`),
        corpus: one(`SELECT COUNT(*) n FROM agents`),
        registrationsResolved: one(
          `SELECT COUNT(*) n FROM agents WHERE token_uri NOT LIKE 'http%'
             OR reg_fetch_error IS NULL OR reg_fetch_error NOT IN
             ('pending-fetch','fetch-fail','timeout')`),
        declaredClass: by("declared_class"),
        // Corpus-wide, for completeness.
        verifiedClass: by("verified_class"),
        // Scoped to agents that DECLARED a machine interface - the only ones
        // ever probed. The corpus-wide figure is dominated by agents that were
        // never candidates, so quoting it under "declared a machine interface"
        // would inflate `unprobed` from 24k to 314k and mean nothing.
        verifiedClassOfMachine: Object.fromEntries(
          (db.prepare(
            `SELECT verified_class k, COUNT(*) n FROM agents
             WHERE declared_class = 'machine' GROUP BY 1`).all() as any[])
            .map((r) => [r.k, r.n]),
        ),
        hireable: one(`SELECT COUNT(*) n FROM agents WHERE verified_class = 'task-interface'`),
        firstParty: one(`SELECT COUNT(*) n FROM agents WHERE first_party = 1`),
        reputation: {
          agentsWithFeedback: one(`SELECT COUNT(*) n FROM concentration WHERE distinct_raters > 0`),
          distinctRaters: one(`SELECT COUNT(DISTINCT rater) n FROM rater_edges`),
          singleRaterAgents: one(`SELECT COUNT(*) n FROM concentration WHERE distinct_raters = 1`),
          highClosureAgents: one(`SELECT COUNT(*) n FROM overlap WHERE closure_pct >= 90`),
          ratedAgents: one(`SELECT COUNT(*) n FROM overlap`),
          busiestRater: db.prepare(
            `SELECT rater, COUNT(*) agents FROM rater_edges GROUP BY 1 ORDER BY 2 DESC LIMIT 1`).get() ?? null,
        },
        topOperators: db.prepare(
          `SELECT reg_host host, COUNT(*) agents FROM agents
           WHERE reg_host IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`).all(),
      });
    }

    // GET /api/jobs/:jobId - read one job straight off the commerce kernel.
    const jm = url.pathname.match(/^\/api\/jobs\/(\d+)$/);
    if (jm) {
      return readJob(jm[1]!).then(
        (job) => json(res, job ? 200 : 404, job ?? { error: "not_found", jobId: jm[1] }),
        (e) => json(res, 502, { error: "chain_unreachable", message: String(e?.message ?? e) }),
      );
    }

    if (url.pathname === "/" || url.pathname === "/api") {
      return json(res, 200, {
        service: "bnb-mrkt api",
        endpoints: ["/api/agents", "/api/agents/:agentId", "/api/categories", "/api/operators", "/api/stats"],
      });
    }
    json(res, 404, { error: "not_found" });
  } catch (e: any) {
    // Rule 0 at the edge: never dress a failure as an empty result.
    json(res, 500, { error: "internal", message: String(e?.message ?? e).slice(0, 200) });
  }
});

server.listen(PORT, () => console.log(`api on http://localhost:${PORT}`));

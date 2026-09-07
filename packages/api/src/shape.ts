// DB row -> §8.1 wire shape. The only place that mapping exists, so the
// contract can be checked against one file.

export interface AgentRow {
  agent_id: string;
  owner: string | null;
  token_uri: string | null;
  reg_valid: number;
  reg_fetch_error: string | null;
  name: string | null;
  description: string | null;
  endpoint: string | null;
  endpoint_service: string | null;
  endpoint_host: string | null;
  declared_class: string;
  verified_class: string;
  verified_at: string | null;
  verified_detail: string | null;
  x402_claimed: number;
  first_party: number;
  reg_host: string | null;
  categories_json: string | null;
}

/**
 * Score and tier, read from `agent_trust`.
 *
 * This used to be computed here, in TypeScript, while the catalog's ORDER BY
 * ranked on `verified_class` in SQL. Two formulas, one label: "Best" returned
 * scores of 36, 38, 34, 30, 32, 38 in that order, every one an agent with a
 * funded job that had never delivered. A list ordered by one thing and captioned
 * with another is not a ranking, it is a coincidence.
 *
 * There is now exactly one scale, it lives in the database, and the sort and the
 * badge read the same column. The design and its weights are documented in
 * schema.sql and indexer/src/build-trust.ts, in one place, so the scale can be
 * argued with rather than reverse engineered.
 */
export interface TrustRow {
  score: number;
  tier: string;
  completed: number;
  clients: number;
  rejected: number;
  pending: number;
  credible_ratings: number;
  raw_ratings: number;
  top_rater_breadth: number | null;
}

export function getTrust(db: any, agentId: string): TrustRow | null {
  return db.prepare(
    `SELECT score, tier, completed, clients, rejected, pending,
            credible_ratings, raw_ratings, top_rater_breadth
       FROM agent_trust WHERE agent_id = ?`,
  ).get(agentId) ?? null;
}

/**
 * Who operates this agent, and how many others they operate.
 *
 * Keyed on the REGISTRATION host where there is one, and on the ENDPOINT host
 * where there is not.
 *
 * The fallback is not a nicety, it is the difference between the signal working
 * and not working. `reg_host` is null for every inline `data:` registration,
 * and all 177 agents in the live catalog are inline: the provenance signal -
 * the one §5 exists for - was returning null on 100% of the agents anyone can
 * actually hire, so the detail screen read "self hosted, 1 agent" for each of
 * 177 identities belonging to a single operator. That is the exact claim the
 * signal was built to refuse to let pass.
 *
 * Endpoint host is how DAY0-FINDINGS counts operators for the callable set
 * ("all 5 callable agents come from 2 operators across 2 endpoint hosts"), so
 * this is the existing unit of analysis, not a new one. `source` travels with
 * the count because the two are different claims: a shared registration host is
 * one operator publishing metadata, a shared endpoint host is one operator
 * answering the calls. The UI must say which it means.
 */
export type OperatorSource = "registration" | "endpoint";

function provenanceOf(db: any, r: AgentRow): {
  operatorHost: string | null;
  operatorAgentCount: number | null;
  operatorSource: OperatorSource | null;
} {
  // A real count from the resolver, never an extrapolation (§12 rule 1). It
  // grows while the sweep runs, which is correct: it is a floor, not a guess.
  const count = (col: "reg_host" | "endpoint_host", host: string) =>
    (db.prepare(`SELECT COUNT(*) n FROM agents WHERE ${col} = ?`).get(host) as any).n as number;

  if (!db) return { operatorHost: null, operatorAgentCount: null, operatorSource: null };
  if (r.reg_host) {
    return {
      operatorHost: r.reg_host,
      operatorAgentCount: count("reg_host", r.reg_host),
      operatorSource: "registration",
    };
  }
  if (r.endpoint_host) {
    return {
      operatorHost: r.endpoint_host,
      operatorAgentCount: count("endpoint_host", r.endpoint_host),
      operatorSource: "endpoint",
    };
  }
  return { operatorHost: null, operatorAgentCount: null, operatorSource: null };
}

export interface ConcentrationRow {
  distinct_raters: number;
  rating_count: number;
  top_rater_share_pct: number | null;
  top_rater: string | null;
}

/**
 * When this agent was registered on chain, as an ISO date.
 *
 * §3 and §5 both record that the registry stores no timestamps, and the §8.1
 * contract froze `createdAt: null` around that. The conclusion was right about
 * the REGISTRIES and wrong about what was reachable: 8004scan publishes the
 * registration block, and a block number is a timestamp with one lookup. The
 * dates come from the chain, not from 8004scan - they give us the block, the
 * chain gives it its time - so a wrong block number yields a date we could
 * catch rather than a plausible one we could not.
 *
 * Null where we have not resolved a block for that agent, which is most of the
 * corpus today. Null means unknown, never "new".
 */
function registeredAt(db: any, agentId: string): string | null {
  if (!db) return null;
  try {
    const r = db.prepare(
      `SELECT created_at FROM scan8004_detail WHERE agent_id = ? AND created_at IS NOT NULL`,
    ).get(agentId) as any;
    return r?.created_at ? new Date(r.created_at * 1000).toISOString() : null;
  } catch {
    // The table is optional: a database built before the 8004scan integration
    // simply has no dates, and that is a missing field, not a broken card.
    return null;
  }
}

export function toAgentCard(
  r: AgentRow,
  db?: any,
  conc?: ConcentrationRow | null,
  /**
   * Last probe latency, when the caller already has it.
   *
   * The catalog offers a "Fastest" sort and the cards it sorted showed no time
   * at all, so the ordering was unexplainable: the user reordered a list by a
   * quantity the list never displayed. The list query now joins `probes`, which
   * costs one indexed lookup per page and turns that sort into something a
   * reader can check.
   */
  responseMs?: number | null,
) {
  const probed = r.verified_class !== "unprobed";
  const c = conc ?? null;
  const rec = db ? getJobRecord(db, r.agent_id) : null;
  const trust = db ? getTrust(db, r.agent_id) : null;
  return {
    agentId: r.agent_id,
    chainId: 56,
    name: r.name,
    description: r.description,
    categories: r.categories_json ? JSON.parse(r.categories_json) : [],
    owner: r.owner,
    declaredClass: r.declared_class,
    verifiedClass: r.verified_class,
    verifiedAt: r.verified_at,
    x402Claimed: !!r.x402_claimed,
    firstParty: !!r.first_party,
    live: {
      // `reachable` is verified-only. A declared endpoint is never "live".
      reachable: r.verified_class === "task-interface",
      lastProbedAt: r.verified_at,
      responseTimeMs: responseMs ?? null,
      neverProbed: !probed,
    },
    // The host that answers, which is not always the host that registered.
    endpointHost: r.endpoint_host,
    /** ISO date of on-chain registration, or null when we have not dated it. */
    registeredAt: registeredAt(db, r.agent_id),
    /**
     * Settlement record from the commerce kernel. NULL means this agent has
     * never taken third-party paid work - which is true of every agent our
     * catalog currently lists, and is the single most useful thing we can say.
     */
    record: rec,
    // services[].name: A2A, MCP, q402, web. The kind of interface it exposes,
    // which is one of the few things that genuinely varies between listings.
    serviceName: r.endpoint_service,
    score: {
      value: trust?.score ?? 0,
      tier: trust?.tier ?? "unproven",
      ratingCount: c?.rating_count ?? 0,
      /**
       * Ratings after inverse-breadth weighting. A rater who has rated 924 of
       * the 4,401 rated agents contributes 1/924 per rating, so an agent whose
       * ratings all came from mass-raters shows a raw count with a credible
       * weight near zero - which is the honest description of what it has.
       */
      credibleRatings: trust ? Math.round(trust.credible_ratings * 1000) / 1000 : 0,
      topRaterBreadth: trust?.top_rater_breadth ?? null,
    },
    signals: {
      provenance: {
        ...provenanceOf(db, r),
        sequentialIds: null,
      },
      concentration: {
        // Absent row means "no raters", which is a real answer here: the scan
        // covers every agent, so a missing row is not a gap in coverage.
        distinctRaters: c?.distinct_raters ?? 0,
        ratingCount: c?.rating_count ?? 0,
        // NULL, never 0 - there is no share of nothing.
        topRaterSharePct: c?.top_rater_share_pct ?? null,
        topRater: c?.top_rater ?? null,
      },
    },
  };
}

/**
 * What this agent has actually been paid to do.
 *
 * §5 concluded no track record was obtainable, because the reputation registry
 * stores no timestamps. True, and the wrong contract: the ERC-8183 commerce
 * kernel records every job's counterparties, state and budget, and a full scan
 * of all 56,690 jobs found 856 agents that have taken third-party work — none
 * of which our catalog listed, because our filter selects for HTTP reachability
 * and these agents are reached through the escrow instead.
 *
 * `client != provider` is not a detail. Two of the busiest providers on the
 * kernel hire themselves 100% of the time — one has 193 jobs and exactly one
 * client, itself — using escrow as a tamper-evident log of their own runs.
 * Counting that as a track record would be counting an agent's diary as
 * customer demand.
 */
export interface JobRecord {
  jobs: number;
  completed: number;
  rejected: number;
  /** Distinct paying counterparties. 1 is a very different fact from 20. */
  clients: number;
  /** Raw units of U across all jobs, as a string: 18 decimals overflow a Number. */
  settledRaw: string;
  completionPct: number | null;
  /** What this agent has actually charged. Null when too little has settled. */
  pricing: Pricing | null;
  /**
   * The track record, named the way the TermiX rubric names it.
   *
   * That track asks for "a real record: win rate, the window, and the risk
   * taken to get there". We held every ingredient and made the reader do the
   * translation - `completion_pct` is not a win rate, and nothing said what was
   * ever at stake on a single job. Naming them after the question means a judge
   * reads an answer instead of deriving one.
   */
  trackRecord: {
    /** Delivered vs disputed. Null when nothing has reached a terminal state. */
    winRatePct: number | null;
    delivered: number;
    disputed: number;
    /** First and last job, as ISO dates. The window the rubric asks for. */
    firstJobAt: string | null;
    lastJobAt: string | null;
    /** What has been put at stake: total settled, and the largest single job. */
    settledRaw: string;
    maxJobRaw: string | null;
    /** Clients who came back. 12 jobs from 1 client is not 12 from 12. */
    clients: number;
    repeatClients: number;
    /**
     * Jobs whose client wallet is this agent's own owner - wash trading one
     * level above the `client != provider` filter. Published even when zero,
     * because a check that is never shown cannot be trusted to have run.
     */
    selfDealt: number;
  };
}

/**
 * WHAT THIS AGENT CHARGES - measured, never asked for and never guessed.
 *
 * §15 found that no agent on this registry publishes a price, and concluded the
 * client must therefore propose one. The hire screen has defaulted its budget
 * field to "1" ever since, while the agents it lists settle at 0.05 to 0.10.
 * Accepting that default overpays by 10x to 20x and escrow returns no change.
 *
 * Nobody publishes a price. 51 providers have SETTLED one, and every budget is
 * on the kernel. That is the number to show.
 *
 * `established` is the whole contract with the UI: false means DO NOT PRINT A
 * FIGURE. Three settled jobs is the floor - two agreeing tells you nothing
 * about a third, and a fabricated typical cost in a payment screen is worse
 * than an honest blank.
 */
export interface Pricing {
  /** Median settled budget, raw 18-decimal units. */
  typicalRaw: string;
  typical: string;
  minRaw: string;
  maxRaw: string;
  min: string;
  max: string;
  /** Settled paid jobs behind the figure. */
  jobs: number;
  /** Settled jobs at zero budget, excluded. Free trial runs, disclosed not hidden. */
  freeJobs: number;
  /** Below the floor, the UI must say "not established" and offer to ask. */
  established: boolean;
  /**
   * A suggested authorization: the typical cost with a buffer, so a job is not
   * refused for being a few wei short of a price that moved between quote and
   * signature. It is a STARTING POINT the client edits, never an amount we
   * apply - §6 keeps the irreversible step with the human.
   */
  suggestedRaw: string;
  suggested: string;
}

/** Raw 18-decimal units to a short display string. Trailing zeros trimmed. */
function fmtU(raw: string | null): string {
  if (raw == null) return "0";
  let v: bigint;
  try { v = BigInt(raw); } catch { return "0"; }
  const whole = v / 10n ** 18n;
  // Money, so at least two decimal places and at most four: "0.10" reads as a
  // price and "0.1" reads as a quantity. Trailing zeros beyond the second are
  // trimmed, so 0.075 keeps its third and 0.1 gains a second.
  let frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  frac = frac.padEnd(2, "0");
  return `${whole}.${frac}`;
}

/** Settled paid jobs required before a price is claimed rather than withheld. */
const PRICE_FLOOR = 3;

function toPricing(r: any): Pricing | null {
  const jobs: number = r.price_n ?? 0;
  const free: number = r.price_zero_n ?? 0;
  if (!jobs || r.price_med_raw == null) {
    // Still worth reporting the free runs: an agent with three zero-budget jobs
    // and no paid ones has a track record and no price, and those are separate
    // facts the hire screen needs to state separately.
    return free > 0
      ? { typicalRaw: "0", typical: "0", minRaw: "0", maxRaw: "0", min: "0", max: "0", jobs: 0, freeJobs: free,
          established: false, suggestedRaw: "0", suggested: "0" }
      : null;
  }
  const med = BigInt(r.price_med_raw);
  // Typical plus half again. Round trip through the raw units so the suggestion
  // is an exact amount the client can approve, not a display string reparsed.
  const suggested = (med * 3n) / 2n;
  return {
    typicalRaw: String(med),
    typical: fmtU(String(med)),
    minRaw: String(r.price_min_raw ?? med),
    maxRaw: String(r.price_max_raw ?? med),
    min: fmtU(String(r.price_min_raw ?? med)),
    max: fmtU(String(r.price_max_raw ?? med)),
    jobs,
    freeJobs: free,
    established: jobs >= PRICE_FLOOR,
    suggestedRaw: String(suggested),
    suggested: fmtU(String(suggested)),
  };
}

export function getJobRecord(db: any, agentId: string): JobRecord | null {
  // Reads the materialised table, not the raw jobs. Computing this inline made
  // one catalog page take 110 seconds; see schema.sql for the reasoning.
  const r = db.prepare(
    `SELECT jobs, completed, rejected, clients, settled_raw, completion_pct,
            price_med_raw, price_min_raw, price_max_raw, price_n, price_zero_n,
            repeat_clients, max_job_raw, self_dealt, first_seen, last_seen
       FROM agent_record WHERE agent_id = ?`,
  ).get(agentId) as any;

  if (!r) return null;
  return {
    jobs: r.jobs,
    completed: r.completed,
    rejected: r.rejected,
    clients: r.clients,
    settledRaw: String(r.settled_raw ?? "0"),
    completionPct: r.completion_pct ?? null,
    pricing: toPricing(r),
    trackRecord: {
      // Delivered over delivered-plus-disputed. NOT completed/total: a job
      // sitting funded and undelivered is not a loss, it is an open position,
      // and counting it as one would understate every active agent.
      winRatePct: (r.completed + r.rejected) > 0
        ? Math.round((100 * r.completed) / (r.completed + r.rejected))
        : null,
      delivered: r.completed,
      disputed: r.rejected,
      firstJobAt: r.first_seen ? new Date(r.first_seen * 1000).toISOString() : null,
      lastJobAt: r.last_seen ? new Date(r.last_seen * 1000).toISOString() : null,
      settledRaw: String(r.settled_raw ?? "0"),
      maxJobRaw: r.max_job_raw ?? null,
      clients: r.clients,
      repeatClients: r.repeat_clients ?? 0,
      selfDealt: r.self_dealt ?? 0,
    },
  };
}

export function getConcentration(db: any, agentId: string): ConcentrationRow | null {
  return db.prepare(
    `SELECT distinct_raters, rating_count, top_rater_share_pct, top_rater
     FROM concentration WHERE agent_id = ?`,
  ).get(agentId) ?? null;
}

export function toAgentDetail(db: any, r: AgentRow) {
  const probe = db.prepare(
    `SELECT probed_at, response_ms, error FROM probes WHERE agent_id = ?`,
  ).get(r.agent_id) as any;

  const card = toAgentCard(r, db, getConcentration(db, r.agent_id));
  if (probe) card.live.responseTimeMs = probe.response_ms ?? null;

  return {
    ...card,
    endpoint: r.endpoint,
    endpointServiceName: r.endpoint_service,
    registrationFileValid: !!r.reg_valid,
    identityCreatedAt: null,           // needs the blocked backfill (§9)
    verifiedDetail: r.verified_detail, // why the probe reached its verdict
    registrationError: r.reg_fetch_error,
    feedback: [],                      // wired when getClients lands
    revokedCount: 0,
  };
}

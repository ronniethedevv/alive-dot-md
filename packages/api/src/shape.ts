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
 * Score. Deliberately NOT a trust score.
 *
 * v1 has no transfer discount (needs the blocked backfill) and almost no
 * feedback to work with, so a 0-100 number would be a fabricated precision on
 * top of two facts. It is therefore a direct, explainable function of what we
 * verified - and `tier` is the field the UI should lead with.
 */
function score(r: AgentRow, ratingCount: number) {
  let value: number;
  switch (r.verified_class) {
    case "task-interface": value = 70; break;
    case "testnet": value = 35; break;   // wired, just to the wrong chain
    case "unprobed": value = 20; break;  // unknown, NOT bad
    case "html": value = 10; break;
    case "dead": case "unreachable": value = 0; break;
    default: value = 0;
  }
  if (r.declared_class === "machine" && r.verified_class === "unprobed") value += 5;
  if (r.reg_valid) value += 5;
  // Ratings nudge, they do not dominate: at ~1.3% coverage a feedback-weighted
  // score would rank the corpus by who bothered to farm it.
  value += Math.min(10, ratingCount * 2);

  const tier = r.verified_class === "task-interface" && ratingCount > 0
    ? "established"
    : r.verified_class === "task-interface" ? "emerging" : "unproven";
  return { value: Math.max(0, Math.min(100, value)), tier, ratingCount };
}

function operatorAgentCount(db: any, host: string | null): number | null {
  if (!host) return null;
  // A real count from the resolver, never an extrapolation (§12 rule 1). It
  // grows while the sweep runs, which is correct: it is a floor, not a guess.
  return (db.prepare(`SELECT COUNT(*) n FROM agents WHERE reg_host = ?`).get(host) as any).n;
}

export interface ConcentrationRow {
  distinct_raters: number;
  rating_count: number;
  top_rater_share_pct: number | null;
  top_rater: string | null;
}

export function toAgentCard(r: AgentRow, db?: any, conc?: ConcentrationRow | null) {
  const probed = r.verified_class !== "unprobed";
  const c = conc ?? null;
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
      responseTimeMs: null,
      neverProbed: !probed,
    },
    score: score(r, c?.rating_count ?? 0),
    signals: {
      provenance: {
        operatorHost: r.reg_host,
        operatorAgentCount: db ? operatorAgentCount(db, r.reg_host) : null,
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

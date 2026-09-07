// The marketplace API, as one Vercel function over a static snapshot.
//
// WHAT CHANGED AND WHY.
//
// `packages/api/src/server.ts` is a long-lived Node process holding an open
// SQLite handle on a 346 MB file. None of that survives a push to Vercel: the
// database is gitignored and over GitHub's file limit, functions are ephemeral
// and read-only outside /tmp, and nothing is left running to serve requests.
//
// So the data moved. `indexer/src/export-catalog.ts` writes what the product
// actually serves - 1,039 listable agents, the operator rollup and the corpus
// aggregates, 2.9 MB in total - and this reads that. The routes, the query
// parameters and the response shapes are unchanged, so the frontend did not
// have to move at all.
//
// ONE FUNCTION, NOT SEVEN. The routing here mirrors server.ts deliberately:
// splitting it into api/agents.ts, api/stats.ts and so on would duplicate the
// snapshot into every bundle and let the two routers drift.
//
// WHAT IS NO LONGER POSSIBLE, said plainly rather than faked:
// on-demand re-probing wrote `verified_class` and a `probes` row back to the
// database. A read-only filesystem cannot do that. The probe itself still runs
// and its result is returned live; it simply is not remembered until the next
// scheduled index. See the `/verify` branch.

import agents from "../data/agents.json" with { type: "json" };
import details from "../data/details.json" with { type: "json" };
import categories from "../data/categories.json" with { type: "json" };
import operators from "../data/operators.json" with { type: "json" };
import stats from "../data/stats.json" with { type: "json" };
import meta from "../data/meta.json" with { type: "json" };

import { expandNeed } from "../packages/shared/src/skills.ts";
import { RULES } from "../packages/shared/src/categories.ts";
import { CONDITIONS, CONDITION_FALLBACK } from "../packages/shared/src/conditions.ts";
import { isFetchable } from "../packages/shared/src/fetchable.ts";

type Card = (typeof agents)[number] & Record<string, any>;
const CARDS = agents as unknown as Card[];

/** Sorts, matching the live API's `SORTS` map one for one. */
const SORTS: Record<string, (a: Card, b: Card) => number> = {
  score: (a, b) => (b.score?.value ?? 0) - (a.score?.value ?? 0),
  record: (a, b) => (b.record?.completed ?? 0) - (a.record?.completed ?? 0)
    || (b.record?.clients ?? 0) - (a.record?.clients ?? 0)
    || (b.score?.value ?? 0) - (a.score?.value ?? 0),
  new: (a, b) => Number(b.agentId) - Number(a.agentId),
  established: (a, b) => Number(a.agentId) - Number(b.agentId),
  // Unprobed agents sort last rather than first: a missing latency is not a
  // fast one, and `null` compares low in a naive numeric sort.
  fast: (a, b) => (a.live?.responseTimeMs ?? Infinity) - (b.live?.responseTimeMs ?? Infinity),
};

function listAgents(sp: URLSearchParams) {
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const perPage = Math.min(100, Math.max(1, Number(sp.get("perPage") ?? 25) || 25));
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const cats = (sp.get("category") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const operator = (sp.get("operator") ?? "").trim();
  const liveParam = sp.get("live");
  const liveOnly = liveParam === null ? true : liveParam !== "false";
  const paidOnly = sp.get("paid") === "true";
  const sort = SORTS[sp.get("sort") ?? "score"] ?? SORTS.score;

  let out = CARDS;
  if (liveOnly) out = out.filter((a) => a.verifiedClass === "task-interface");
  if (paidOnly) out = out.filter((a) => a.record != null);
  if (cats.length) out = out.filter((a) => (a.cats ?? []).some((c: string) => cats.includes(c)));
  if (operator) out = out.filter((a) => a.operatorHost === operator);
  if (q) {
    // Same fields the SQL LIKE covered: name, description, service type and an
    // exact agent id.
    out = out.filter((a) =>
      a.agentId === q
      || (a.name ?? "").toLowerCase().includes(q)
      || (a.description ?? "").toLowerCase().includes(q)
      || (a.serviceName ?? "").toLowerCase().includes(q)
      || (a.cats ?? []).some((c: string) => c.includes(q)));
  }

  const total = out.length;
  const sorted = [...out].sort(sort);
  const results = sorted.slice((page - 1) * perPage, page * perPage);

  const byHost = new Map<string, number>();
  for (const a of out) {
    if (!a.operatorHost) continue;
    byHost.set(a.operatorHost, (byHost.get(a.operatorHost) ?? 0) + 1);
  }
  const topOperators = [...byHost.entries()]
    .sort((x, y) => y[1] - x[1]).slice(0, 5).map(([host, n]) => ({ host, n }));

  const totalAll = (meta as any).corpus.agents as number;
  return {
    results, total, page, perPage,
    filter: {
      liveOnly,
      hiddenByLiveFilter: liveOnly ? CARDS.length - total : 0,
      corpusResolved: (meta as any).corpus.resolved,
      corpusTotal: totalAll,
      // The snapshot lists agents with evidence; the corpus is larger and the
      // page has always said so rather than quietly dropping the difference.
      listed: CARDS.length,
    },
    // `namedOperators` is the count of DISTINCT hosts in the whole result set,
    // not the length of the top-five list. Returning the latter made the
    // catalog's meta line read "5 operators" for a result spanning 57 of them.
    composition: { operators: topOperators, namedOperators: byHost.size },
  };
}

/**
 * The concierge, ported from match.ts.
 *
 * Same two rules: it never picks a price and never signs. Ranking is EVIDENCE
 * FIRST - tier, then how many of the matched categories an agent holds, then
 * score - because relevance is a count over self-asserted labels and letting it
 * lead put an agent with 0 completed jobs above two proven ones.
 */
function matchNeed(need: string, limit = 6) {
  const raw = (need ?? "").trim();
  const expansion = expandNeed(raw);
  const text = expansion.text.toLowerCase();

  const matched = RULES
    .map((r) => ({
      id: r.id, label: r.label,
      hits: r.any.filter((t) => {
        const term = t.trim().toLowerCase();
        return /\s/.test(term)
          ? text.includes(term)
          : new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`, "i").test(text);
      }),
    }))
    .filter((m) => m.hits.length > 0)
    .concat(expansion.impliedCategories
      .filter((id) => !RULES.some((r) => r.id === id && false))
      .map((id) => {
        const r = RULES.find((x) => x.id === id);
        return r ? { id: r.id, label: r.label, hits: [] as string[] } : null;
      })
      .filter((m): m is { id: string; label: string; hits: string[] } => m !== null))
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
    .sort((a, b) => b.hits.length - a.hits.length);

  const ids = matched.map((m) => m.id);
  const rank = (t: string) => (t === "proven" ? 0 : t === "live" ? 1 : 2);
  const candidates = (ids.length ? CARDS.filter((a) => (a.cats ?? []).some((c: string) => ids.includes(c))) : CARDS)
    .map((a) => ({
      a, relevance: (a.cats ?? []).filter((c: string) => ids.includes(c)).length,
    }))
    .sort((x, y) =>
      rank(x.a.score?.tier ?? "") - rank(y.a.score?.tier ?? "")
      || y.relevance - x.relevance
      || (y.a.score?.value ?? 0) - (x.a.score?.value ?? 0)
      || (y.a.record?.completed ?? 0) - (x.a.record?.completed ?? 0))
    .slice(0, limit)
    .map(({ a }) => ({
      agentId: a.agentId, name: a.name, description: a.description,
      tier: a.score?.tier, score: a.score?.value,
      completed: a.record?.completed ?? 0, clients: a.record?.clients ?? 0,
      categories: a.cats ?? [],
      hireable: a.score?.tier === "proven" || a.score?.tier === "live",
      because: (a.record?.completed ?? 0) > 0
        ? `Completed ${a.record.completed} paid ${a.record.completed === 1 ? "job" : "jobs"} for ${a.record.clients} ${a.record.clients === 1 ? "client" : "clients"}.`
        : a.score?.tier === "live"
          ? "Answered when we called its endpoint. No paid work on record yet."
          : "Publishes a valid machine interface. We have not confirmed it answers.",
    }));

  const primary = ids[0];
  return {
    need: raw, matched, candidates,
    draft: {
      task: raw,
      conditions: (primary && CONDITIONS[primary]) || CONDITION_FALLBACK,
      days: 3,
    },
    note: matched.length === 0 && raw.length > 0
      ? "Nothing in that matched a category we track, so these are the strongest agents overall rather than a match. Try naming the thing you want done - monitor, yield, audit, rebalance, summarise."
      : null,
    understood: {
      protocols: expansion.protocols, skills: expansion.skills,
      added: [...new Set(expansion.added.map((x) => x.term))],
    },
  };
}

export default async function handler(req: any, res: any) {
  const url = new URL(req.url ?? "/", `https://${req.headers?.host ?? "alive.md"}`);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const send = (code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json; charset=utf-8");
    // The snapshot changes only when the scheduled index republishes, so it is
    // safe to cache hard at the edge and revalidate in the background.
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.end(JSON.stringify(body));
  };

  if (path === "agents") return send(200, listAgents(url.searchParams));

  const m = path.match(/^agents\/(\d+)$/);
  if (m) {
    const d = (details as any)[m[1]!];
    return d ? send(200, d) : send(404, { error: "not_found", agentId: m[1] });
  }

  if (path === "categories") {
    const scope = url.searchParams.get("paid") === "true" ? "paid"
      : url.searchParams.get("live") === "true" ? "live" : "all";
    const list = (categories as any)[scope] as any[];
    const label = Object.fromEntries(RULES.map((r) => [r.id, r.label]));
    return send(200, {
      readAt: (meta as any).builtAt,
      basis: "self-described: matched against the agent's own name, description and declared skills",
      categories: list.map((c) => ({ ...c, label: label[c.id] ?? c.id })),
    });
  }

  if (path === "operators") return send(200, { ...(operators as any), readAt: (meta as any).builtAt });
  if (path === "stats") {
    // meta is merged SELECTIVELY, not spread. Both objects carry a `corpus`
    // key - a number in stats, an object in meta - and a blind spread put the
    // object on top, so /api/stats reported `corpus: [object Object]`.
    const m = meta as any;
    return send(200, {
      ...(stats as any),
      builtAt: m.builtAt,
      freshness: m.watermarks,
      readAt: m.builtAt,
    });
  }
  if (path === "meta" || path === "") return send(200, meta);

  if (path === "match") {
    if (req.method !== "POST") return send(405, { error: "method_not_allowed", expected: "POST" });
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 32_000) break; }
    let need = "";
    try { need = String(JSON.parse(body || "{}").need ?? ""); } catch { /* empty */ }
    return send(200, matchNeed(need.slice(0, 2000)));
  }

  /**
   * On-demand verification, minus the memory.
   *
   * The live API re-probed an agent and WROTE the verdict back. A read-only
   * filesystem cannot, so this probes and returns the result without recording
   * it: the caller gets a fresh answer, and the snapshot catches up at the next
   * scheduled index. Saying so is the point - a verdict that silently failed to
   * persist would be worse than one that never claimed to.
   */
  const v = path.match(/^agents\/(\d+)\/verify$/);
  if (v) {
    const d = (details as any)[v[1]!];
    if (!d) return send(404, { error: "not_found", agentId: v[1] });
    const endpoint: string | null = d.endpoint ?? null;
    if (!endpoint) return send(200, { agentId: v[1], probed: false, reason: "no endpoint declared" });

    /**
     * SSRF guard. This endpoint takes an agent id from the public internet and
     * fetches a URL that the agent's REGISTRANT chose, from inside our
     * infrastructure, and returns what came back. Without this it is a probe
     * anyone can point at 169.254.169.254 - which on a serverless host is the
     * cloud metadata service.
     *
     * The live API had this guard. This function shipped without it because
     * `isFetchable` lived in a module that also imports the database, and the
     * bundle could not take that. It now lives in packages/shared with no
     * imports at all, so there is nothing left to trade off.
     */
    const guard = isFetchable(endpoint);
    if (!guard.ok) {
      return send(400, { agentId: v[1], probed: false, error: "refused", reason: guard.why });
    }
    const t0 = Date.now();
    try {
      const r = await fetch(endpoint, {
        headers: { "user-agent": "alive-md-probe/0.1", accept: "application/json,*/*" },
        redirect: "follow", signal: AbortSignal.timeout(12_000),
      });
      return send(200, {
        agentId: v[1], probed: true, status: r.status, ok: r.ok,
        responseTimeMs: Date.now() - t0,
        persisted: false,
        note: "Live result. Not written to the index - the next scheduled run records it.",
      });
    } catch (e: any) {
      return send(200, {
        agentId: v[1], probed: true, status: null, ok: false,
        responseTimeMs: Date.now() - t0,
        error: e?.name === "TimeoutError" ? "timeout" : String(e?.cause?.code ?? e?.name),
        persisted: false,
      });
    }
  }

  return send(404, { error: "not_found", path });
}

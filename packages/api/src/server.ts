// The §8.1 API. Zero dependencies: node:http and node:sqlite.
//
// Every field served here is computed from data we actually hold (§12). Where a
// value is not yet computable it is null, and null is a state the UI must
// render - never a zero, never a placeholder, never a hidden row.
//
//   node --experimental-strip-types packages/api/src/server.ts

import { createServer } from "node:http";
import { openDb } from "../../../indexer/src/db.ts";
import {
  toAgentCard, toAgentDetail, getConcentration, type AgentRow,
} from "./shape.ts";

const PORT = Number(process.env.PORT ?? 8787);
const db = openDb();

const SORTS: Record<string, string> = {
  // Verified-first, then declared, then id. "Best" means most-established fact,
  // which is the whole editorial position of the product.
  score: `CASE verified_class WHEN 'task-interface' THEN 0 WHEN 'testnet' THEN 1
            WHEN 'unprobed' THEN 2 WHEN 'html' THEN 3 WHEN 'dead' THEN 4 ELSE 5 END,
          CASE declared_class WHEN 'machine' THEN 0 WHEN 'web-only' THEN 1
            WHEN 'template' THEN 2 ELSE 3 END,
          CAST(agent_id AS INTEGER)`,
  newest: `CAST(agent_id AS INTEGER) DESC`,
  responseTime: `COALESCE((SELECT response_ms FROM probes p WHERE p.agent_id = agents.agent_id), 999999),
                 CAST(agent_id AS INTEGER)`,
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
    where.push(`(name LIKE :q OR description LIKE :q OR agent_id = :qexact)`);
    params.q = `%${q}%`;
    params.qexact = q;
  }
  if (category) {
    where.push(`categories_json LIKE :cat`);
    params.cat = `%"${category}"%`;
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) n FROM agents ${w}`).get(params) as any).n as number;
  const rows = db.prepare(
    `SELECT * FROM agents ${w} ORDER BY ${sort} LIMIT :lim OFFSET :off`,
  ).all({ ...params, lim: perPage, off: (page - 1) * perPage }) as unknown as AgentRow[];

  // The hidden count is the honest version of a default filter (§9 Day 5). A
  // catalog that quietly drops 99.99% of its corpus is the thing we object to.
  const totalAll = (db.prepare(`SELECT COUNT(*) n FROM agents`).get() as any).n as number;
  const resolved = (db.prepare(
    `SELECT COUNT(*) n FROM agents WHERE reg_fetch_error IS NOT 'pending-fetch'`,
  ).get() as any).n as number;

  return {
    // NOT `rows.map(toAgentCard)`: map passes the index as the second argument,
    // which lands in the `db` parameter and blows up on the second row.
    results: rows.map((r) => toAgentCard(r, db, getConcentration(db, r.agent_id))),
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
  };
}

const server = createServer((req, res) => {
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

    if (url.pathname === "/api/stats") {
      const by = (col: string) => Object.fromEntries(
        (db.prepare(`SELECT ${col} k, COUNT(*) n FROM agents GROUP BY 1`).all() as any[])
          .map((r) => [r.k, r.n]),
      );
      return json(res, 200, {
        chainId: 56,
        corpus: (db.prepare(`SELECT COUNT(*) n FROM agents`).get() as any).n,
        declaredClass: by("declared_class"),
        verifiedClass: by("verified_class"),
        note: "Counts are live from the resolver and grow while the sweep runs.",
      });
    }

    if (url.pathname === "/" || url.pathname === "/api") {
      return json(res, 200, {
        service: "bnb-mrkt api",
        endpoints: ["/api/agents", "/api/agents/:agentId", "/api/stats"],
      });
    }
    json(res, 404, { error: "not_found" });
  } catch (e: any) {
    // Rule 0 at the edge: never dress a failure as an empty result.
    json(res, 500, { error: "internal", message: String(e?.message ?? e).slice(0, 200) });
  }
});

server.listen(PORT, () => console.log(`api on http://localhost:${PORT}`));

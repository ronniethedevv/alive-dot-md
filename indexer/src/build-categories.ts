// Assign categories to agents from what they say about themselves.
//
//   node --experimental-strip-types indexer/src/build-categories.ts
//
// Multi-label, keyword-matched, deterministic, and re-runnable. See schema.sql:
// these are CLAIMS. The UI must present them as self-described, never as
// verified capability.
//
// THE VOCABULARY WAS MEASURED, NOT IMAGINED. Term frequency over the corpus is
// useless raw - one operator's 102,886 identical registrations put "trading",
// "reputation" and "multi-chain" at the top of any naive count. These rules were
// built from frequencies over DISTINCT description texts among agents in the
// proven/live/declared tiers (26,989 texts), which is what people actually
// wrote rather than what one template repeated.
//
// The four categories the hackathon names as reference - monitoring, grid
// trading, health factor, yield - all map onto rules here, and deliberately are
// not the only ones: an agent marketplace that can only describe DeFi is a DeFi
// directory. Half of these are domain-neutral.

import { openDb } from "./db.ts";

// The vocabulary itself lives in packages/shared so the API and UI import the
// same labels this pass assigns.
import { RULES } from "../../packages/shared/src/categories.ts";

const db = openDb();
const started = Date.now();

/** Word-boundary matcher. Built once per term, reused across 290k rows. */
function matcher(term: string): RegExp {
  const t = term.trim();
  // Escape regex metacharacters; `+` appears in real terms (e.g. "c++").
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A term ending in a space was written that way on purpose ("lp ", "art ",
  // "var ", "dao ") to avoid firing inside longer words. Keep the boundary on
  // the left only.
  return t.endsWith(" ")
    ? new RegExp(`\\b${esc.trimEnd()}\\b`, "i")
    // UNDERSCORE COUNTS AS A WORD CHARACTER HERE.
    //
    // It did not, and that was the whole bug behind "Audit this contract for
    // reentrancy" returning a Singularry trading bot first. OASF taxonomy slugs
    // look like `governance_and_compliance`, and with `_` outside the excluded
    // class the lookarounds saw `compliance` and `governance` as free-standing
    // words - so a generic taxonomy label made 177 identical trading agents
    // claim Security & audit AND Gaming & social. `evaluation_and_monitoring`
    // did the same for Monitoring.
    : new RegExp(`(?<![a-z0-9_])${esc}(?![a-z0-9_])`, "i");
}

const compiled = RULES.map((r) => ({ id: r.id, terms: r.any.map(matcher) }));

const rows = db.prepare(`
  -- categories_json is DELIBERATELY not in here.
  --
  -- It holds the OASF domain taxonomy - coarse slugs like
  -- governance_and_compliance and advanced_reasoning_and_planning - which
  -- describe a field of activity, not a capability. On this registry it is also
  -- boilerplate: all 177 Singularry agents carry the identical seven slugs, so
  -- matching it made every one of them claim seven categories it had never
  -- mentioned in its own description. §5 bars active:true from scoring on
  -- exactly this ground - a field true of everything carries no information.
  --
  -- What an operator actually TYPED about their agent is the honest input.
  SELECT agent_id,
         LOWER(
           COALESCE(name, '') || ' ' || COALESCE(description, '') || ' ' ||
           COALESCE(endpoint_service, '')
         ) AS t
    FROM agents
   WHERE name IS NOT NULL OR description IS NOT NULL
`).all() as { agent_id: string; t: string }[];

console.log(`scanning ${rows.length} agents against ${RULES.length} categories…`);

db.exec("DELETE FROM agent_category");
const insert = db.prepare(
  `INSERT OR IGNORE INTO agent_category (agent_id, category) VALUES (?, ?)`,
);

const counts = new Map<string, number>();
let labelled = 0;

db.exec("BEGIN");
for (const r of rows) {
  let any = false;
  for (const c of compiled) {
    if (!c.terms.some((re) => re.test(r.t))) continue;
    insert.run(r.agent_id, c.id);
    counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    any = true;
  }
  if (any) labelled++;
}
db.exec("COMMIT");

console.log(
  `\n${labelled} of ${rows.length} agents matched at least one category `
  + `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

console.table(
  RULES.map((r) => ({
    category: r.label,
    id: r.id,
    agents: counts.get(r.id) ?? 0,
    // The number that actually matters for a catalog: how many of these have
    // ever been paid.
    proven: (db.prepare(
      `SELECT COUNT(*) n FROM agent_category c JOIN agent_trust t ON t.agent_id = c.agent_id
        WHERE c.category = ? AND t.tier = 'proven'`,
    ).get(r.id) as any).n,
  })).sort((a, b) => b.proven - a.proven || b.agents - a.agents),
);

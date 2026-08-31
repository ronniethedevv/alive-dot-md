// Rule 1 reporting (ROADMAP section 12): every figure the submission quotes,
// counted rather than extrapolated from the 300-agent sample.
//
// Prints the sample figure beside the true count so the drift is visible. If a
// direction flips - not just a magnitude moving - that is a finding, and the
// roadmap section resting on it needs rewriting, not the number patching.

import { openDb } from "./db.ts";

const db = openDb();
const one = (sql: string, ...a: unknown[]) =>
  Number((db.prepare(sql).get(...(a as any)) as any)?.n ?? 0);
const rows = (sql: string) => db.prepare(sql).all() as any[];

const total = one(`SELECT COUNT(*) n FROM agents`);
const resolved = one(`SELECT COUNT(*) n FROM agents WHERE reg_fetch_error IS NOT 'pending-fetch'`);
const pending = one(`SELECT COUNT(*) n FROM agents WHERE reg_fetch_error = 'pending-fetch'`);

console.log(`\nagents in db      ${total.toLocaleString()}`);
console.log(`fully classified  ${resolved.toLocaleString()}`);
if (pending) console.log(`awaiting phase 2  ${pending.toLocaleString()}  (counts below are provisional)`);

const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : "-";

console.log(`\n== endpointClass ==                      sample(300)`);
const SAMPLE: Record<string, number> = { callable: 5, "web-only": 95, template: 25, none: 175 };
for (const r of rows(`SELECT endpoint_class c, COUNT(*) n FROM agents GROUP BY 1 ORDER BY 2 DESC`)) {
  const s = SAMPLE[r.c] ?? 0;
  console.log(
    `  ${String(r.c).padEnd(10)} ${String(r.n).padStart(8)}  ${pct(r.n, total).padStart(6)}` +
    `   vs ${pct(s, 300).padStart(6)}`,
  );
}

console.log(`\n== registration hosts (provenance signal) ==`);
for (const r of rows(`
  SELECT COALESCE(reg_host,'(inline/none)') h, COUNT(*) n,
         SUM(endpoint_class='callable') callable
  FROM agents GROUP BY 1 ORDER BY 2 DESC LIMIT 12`)) {
  console.log(`  ${String(r.n).padStart(8)}  ${pct(r.n, total).padStart(6)}  callable=${String(r.callable).padStart(5)}  ${r.h}`);
}

console.log(`\n== the callable set: operator spread ==`);
const callable = one(`SELECT COUNT(*) n FROM agents WHERE endpoint_class='callable'`);
const callOps = one(`SELECT COUNT(DISTINCT COALESCE(reg_host,'(inline)')) n FROM agents WHERE endpoint_class='callable'`);
const callHosts = one(`SELECT COUNT(DISTINCT endpoint_host) n FROM agents WHERE endpoint_class='callable'`);
const callUrls = one(`SELECT COUNT(DISTINCT endpoint) n FROM agents WHERE endpoint_class='callable'`);
console.log(`  callable agents            ${callable.toLocaleString()}`);
console.log(`  distinct registration ops  ${callOps}`);
console.log(`  distinct endpoint hosts    ${callHosts}`);
console.log(`  distinct endpoint URLs     ${callUrls}`);
console.log(`  -> sample said 5 agents / 2 operators / 2 hosts / 2 URLs.`);
console.log(`     Diversity is the judged criterion; this sets the seeding budget (section 9).`);

console.log(`\n  top endpoint hosts among callable agents:`);
for (const r of rows(`
  SELECT endpoint_host h, COUNT(*) n, COUNT(DISTINCT endpoint) urls
  FROM agents WHERE endpoint_class='callable' AND endpoint_host IS NOT NULL
  GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)) {
  console.log(`    ${String(r.n).padStart(6)} agents / ${String(r.urls).padStart(5)} urls   ${r.h}`);
}

console.log(`\n== probe workload implied (section 4 cadence) ==`);
const webHosts = one(`SELECT COUNT(DISTINCT endpoint_host) n FROM agents WHERE endpoint_class='web-only' AND endpoint_host IS NOT NULL`);
const webAgents = one(`SELECT COUNT(*) n FROM agents WHERE endpoint_class='web-only'`);
console.log(`  callable, probed per agent every 15m : ${callable.toLocaleString()} probes`);
console.log(`  web-only, probed per HOST daily      : ${webHosts.toLocaleString()} probes`);
console.log(`     (covering ${webAgents.toLocaleString()} agents - probing them individually would be`);
console.log(`      ${webAgents.toLocaleString()} requests/day at ~${webHosts} hosts, i.e. abuse)`);

console.log(`\n== other Rule 1 figures ==`);
const x402 = one(`SELECT COUNT(*) n FROM agents WHERE x402_claimed=1`);
const x402none = one(`SELECT COUNT(*) n FROM agents WHERE x402_claimed=1 AND endpoint_class='none'`);
const valid = one(`SELECT COUNT(*) n FROM agents WHERE reg_valid=1`);
const tmpl = one(`SELECT COUNT(*) n FROM agents WHERE endpoint_class='template'`);
const tmplTermix = one(`SELECT COUNT(*) n FROM agents WHERE endpoint_class='template' AND reg_host LIKE '%termix%'`);
console.log(`  valid registration-v1 files  ${valid.toLocaleString()}  ${pct(valid, total)}`);
console.log(`  x402Support claimed          ${x402.toLocaleString()}  (of which ${x402none.toLocaleString()} publish NO endpoint)`);
console.log(`  uncallable templates         ${tmpl.toLocaleString()}  (TermiX-hosted: ${tmplTermix.toLocaleString()})`);
console.log(`     -> the TermiX figure gates the disclosure line in section 11.`);
console.log(`        Report privately BEFORE it appears in the submission.\n`);

db.close();

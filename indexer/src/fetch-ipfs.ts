// Resolve `ipfs://` registrations. Phase 3.
//
//   node --experimental-strip-types indexer/src/fetch-ipfs.ts [--limit N] [--all]
//
// WHY (ROADMAP §13.2): phase 1 and 2 handle `data:` and `http(s):` only.
// Anything else is recorded `not-a-uri` and never read. That quietly excluded
// 1,328 agents - and 776 of the 856 agents that have taken PAID work on the
// commerce kernel are in that set. Every agent with a settlement record was
// invisible to the catalog because of a URI scheme check.
//
// Default order is by job record, most-hired first: an agent someone has
// actually paid is worth more than an agent someone registered.
//
// GATEWAYS. Public IPFS gateways are in the middle of a migration and most now
// answer 429 with a service-worker notice instead of content - ipfs.io,
// dweb.link and w3s.link all did when tested on 2 Sept. The pool below is
// ordered by what actually answered. A gateway failure is recorded as a
// TRANSPORT error (`ipfs-unreachable`), never as an invalid registration:
// rule 0 - our inability to fetch is not a fact about the operator.

import { openDb, makeStatements } from "./db.ts";
import { classifyDoc } from "./classify.ts";

const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
];

const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;
const UA = "alive-indexer/1.0 (ERC-8004 registration resolver; contact via repo)";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}
const LIMIT = Number(arg("--limit") ?? 0) || 0;
const ALL = process.argv.includes("--all");

const db = openDb();
const st = makeStatements(db);

/**
 * Paid agents first, then everything else.
 *
 * `paid_jobs` comes from the kernel scan, so this ordering means an interrupted
 * run has still resolved the rows the catalog most needs.
 */
const rows = db.prepare(`
  SELECT a.agent_id, a.token_uri,
         COALESCE((SELECT COUNT(*) FROM jobs j
                    JOIN agent_wallets aw ON aw.wallet = j.provider
                   WHERE aw.agent_id = a.agent_id AND j.client != j.provider), 0) AS paid_jobs
    FROM agents a
   WHERE a.token_uri LIKE 'ipfs://%'
     ${ALL ? "" : "AND (a.reg_valid = 0 OR a.declared_class = 'none')"}
   ORDER BY paid_jobs DESC, CAST(a.agent_id AS INTEGER)
   ${LIMIT ? `LIMIT ${LIMIT}` : ""}
`).all() as { agent_id: string; token_uri: string; paid_jobs: number }[];

if (rows.length === 0) {
  console.log("no ipfs registrations to resolve.");
  process.exit(0);
}

const withJobs = rows.filter((r) => r.paid_jobs > 0).length;
console.log(`resolving ${rows.length} ipfs registrations (${withJobs} have a paid job record)`);

/** `ipfs://<cid>[/path]` -> gateway URL. Also tolerates `ipfs://ipfs/<cid>`. */
function toGatewayUrl(uri: string, gateway: string): string {
  let p = uri.slice("ipfs://".length);
  if (p.startsWith("ipfs/")) p = p.slice(5);
  return gateway + p;
}

/**
 * A gateway answering 429, or serving the migration notice as text/plain, is a
 * gateway problem. Try the next one before concluding anything about the file.
 */
function looksLikeGatewayNotice(text: string): boolean {
  return /gateway is switching|gatewaychanges\.ipfs\.io|rate limit/i.test(text.slice(0, 400));
}

async function fetchDoc(uri: string): Promise<{ doc: unknown; error: string | null }> {
  let lastError = "ipfs-unreachable";
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(toGatewayUrl(uri, gw), {
        headers: { accept: "application/json,*/*", "user-agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = (await res.text()).slice(0, 200_000);

      if (res.status === 429 || looksLikeGatewayNotice(text)) { lastError = "ipfs-throttled"; continue; }
      if (!res.ok) { lastError = `ipfs-http-${res.status}`; continue; }

      try { return { doc: JSON.parse(text), error: null }; }
      catch { return { doc: null, error: "body-parse" }; } // the FILE is bad, not the gateway
    } catch (e: any) {
      lastError = e?.name === "TimeoutError" ? "timeout" : "ipfs-unreachable";
    }
  }
  return { doc: null, error: lastError };
}

const update = db.prepare(`
  UPDATE agents SET
    reg_valid=:reg_valid, reg_fetch_error=:reg_fetch_error, name=:name,
    description=:description, endpoint=:endpoint, endpoint_service=:endpoint_service,
    endpoint_host=:endpoint_host, declared_class=:declared_class,
    x402_claimed=:x402_claimed, categories_json=:categories_json
  WHERE agent_id = :agent_id
`);

const tally = new Map<string, number>();
const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);

let done = 0;
let cursor = 0;
const started = Date.now();

async function worker() {
  while (cursor < rows.length) {
    const p = rows[cursor++]!;
    const { doc, error } = await fetchDoc(p.token_uri);

    // agentId is threaded through so URI templates inside the document can be
    // filled rather than condemned - the defect that produced the withdrawn
    // TermiX disclosure.
    const r = classifyDoc(doc, {
      kind: "http", regHost: null, error, agentId: p.agent_id,
    });
    bump(error ? `err:${error}` : r.declaredClass);

    update.run({
      agent_id: p.agent_id,
      reg_valid: r.registrationFileValid ? 1 : 0,
      reg_fetch_error: error,
      name: r.name,
      description: r.description,
      endpoint: r.endpoint,
      endpoint_service: r.endpointServiceName,
      endpoint_host: r.endpointHost,
      declared_class: r.declaredClass,
      x402_claimed: r.x402Claimed ? 1 : 0,
      categories_json: r.categories.length ? JSON.stringify(r.categories) : null,
    });

    done++;
    if (done % 20 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      process.stdout.write(`\r  ${done}/${rows.length}  ${rate.toFixed(1)}/s   `);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.table([...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ outcome: k, n })));

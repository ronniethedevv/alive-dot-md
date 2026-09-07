// Is anything on this registry actually hireable?
//
// ROADMAP section 9 pulls the third-party hire attempt forward to Day 1 so that
// a rejection surfaces while the plan can still absorb it. Spot-checking the
// q402 agents answered faster than expected and in a way the plan did not
// anticipate: the blocker is upstream of the job shape. So this probes the
// whole candidate set instead of generalising from five agents.
//
// `callable` (section 4) means "declares a concrete non-web URL". That is
// necessary for hireability and, it turns out, nowhere near sufficient. This
// pass sorts callable endpoints into what they actually are.

// fetch comes from the undici PACKAGE, not the global.
//
// Node bundles its own private copy of undici, and the two instances do not
// interoperate: passing this Agent to the global fetch fails instantly with
// UND_ERR_INVALID_ARG, so the dispatcher below would be silently ignored and
// the 10s ceiling would still be in force. Measured both ways against
// agent.brainonbnb.com - global fetch + this Agent: UND_ERR_INVALID_ARG in
// 13ms; undici.fetch + the same Agent: HTTP 200 in 608ms.
import { Agent, fetch as undiciFetch } from "undici";

import { openDb } from "./db.ts";
import { sleep } from "./rpc.ts";

const UA = "bnb-mrkt-probe/0.1 (ERC-8004 liveness probe; contact via repo)";

/**
 * WHY THIS DISPATCHER EXISTS - and it is the most important thing in the file.
 *
 * undici's DEFAULT connect timeout is 10s, it is NOT reachable through fetch's
 * options, and it was silently deciding what this project publishes about other
 * people's agents.
 *
 * Measured 2026-09-03: all 27 `proven` agents were recorded `unreachable` with
 * response_ms clustered at 10.3-10.8s - undici's ceiling, not our 15s
 * AbortSignal - while curl fetched 20 of them at HTTP 200 from this same
 * machine seconds later. agent.brainonbnb.com answers in 8.9-9.9s on a good
 * day, so it sat ON the ceiling and fell off whenever the local link was busy.
 *
 * The catalog was therefore printing "Could not be reached" on the AgentCensus
 * Health Factor Monitor, Grid Trader, Portfolio Rebalancer and Yield Scout -
 * the agents this marketplace exists to surface - under a headline claiming we
 * only list agents that are alive.
 *
 * That is a fact about our uplink recorded as a fact about them, which is
 * exactly the failure §12 rule 0 exists to prevent. Rule 0 stopped the value
 * being recorded as SILENCE; it never asked whether the silence was ours.
 */
const dispatcher = new Agent({
  connectTimeout: 30_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

/** Errno or timeout, kept separable from the verdict we draw from it. */
const errDetail = (e: any): string =>
  e?.name === "TimeoutError" || /aborted due to timeout/i.test(String(e?.message ?? ""))
    ? "timeout"
    : String(e?.cause?.code ?? e?.code ?? e?.message ?? "fetch-fail").slice(0, 40);

/**
 * TRANSPORT FAILURES ARE RETRIED, because they were measured to be intermittent.
 *
 * Probing twelve endpoints sequentially - no concurrency at all - produced
 * UND_ERR_CONNECT_TIMEOUT on ten of them, then 18/18 successes minutes later
 * with nothing changed at either end. One attempt does not measure an agent, it
 * samples our own uplink.
 */
const RETRIES = Number(process.env.PROBE_RETRIES ?? 3);
async function politeFetch(url: string, ms = 20_000, init: Record<string, unknown> = {}) {
  let last: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await undiciFetch(url, {
        method: "GET",
        headers: { "user-agent": UA, accept: "application/json,*/*" },
        redirect: "follow",
        dispatcher,
        signal: AbortSignal.timeout(ms),
        ...init,
      });
    } catch (e) {
      last = e;
      if (attempt < RETRIES) await sleep(1_000 * attempt * attempt);
    }
  }
  throw last;
}

import type { VerifiedClass } from "./classify.ts";

// Finer-grained than VerifiedClass: the detail column keeps the nuance, while
// verified_class stays small enough to filter and render on.
type Outcome =
  | "dead" | "unreachable" | "not-json"
  | "no-interface"      // valid JSON, but names no task URL
  | "self-referential"  // an "agent card" whose service endpoint is itself
  | "testnet"           // mainnet identity pointing at a TESTNET service.
                        // Its own class, never folded into `dead`: this is a
                        // fixable deployment mistake, not an abandoned agent,
                        // and telling an operator about it is the marketplace
                        // demonstrating what it is for. 21 of 212 is not noise.
  | "infrastructure"    // payment rails/tooling, not a task service
  | "task-interface";   // live, mainnet, declares a task endpoint

// One outcome per finding. These were briefly collapsed into `html`, which
// made the published claim "4,881 served a web page" wrong: 4,457 of them were
// payment infrastructure and 168 were valid JSON declaring no task URL.
// Neither is a web page, and lumping them together overstated sloppiness where
// the truth was "not a service you can hire".
const TO_VERIFIED: Record<Outcome, VerifiedClass> = {
  "task-interface": "task-interface",
  testnet: "testnet",
  dead: "dead",
  unreachable: "unreachable",
  infrastructure: "infrastructure",
  "no-interface": "no-interface",
  "self-referential": "no-interface",
  "not-json": "html",
};

interface Row { agent_id: string; name: string | null; endpoint: string; endpoint_service: string | null }

const INFRA_HINTS = /facilitator|relay\/info|\/mcp\/info|payment|wallet\/agentic/i;
const TESTNET_HINTS = /testnet|goerli|sepolia|-test\.|\.test\./i;

/** Cheap reachability + content-type check on a declared task URL. */
/**
 * A method name that cannot exist. Asking for it is the whole safety argument.
 */
const LIVENESS_METHOD = "__erc8004_liveness_probe__";

/**
 * Is this URL a live JSON-RPC task interface?
 *
 * WHY THIS EXISTS. A2A agents publish a card whose `url` is a JSON-RPC endpoint
 * that accepts POST and nothing else. A GET against it correctly answers 405,
 * and this verifier read 405 as `dead` - so a CORRECTLY BUILT A2A agent was
 * indistinguishable from an abandoned one, and the better an operator followed
 * the spec the worse we rated them.
 *
 * Measured 2026-09-04: seven of the 27 `proven` agents were classed
 * `dead: task url http-405`. agents.chainhelix.io/gridtrader/ - Grid Trader, five
 * completed paid jobs - answers a POST with
 * {"jsonrpc":"2.0","error":{"code":-32601,...}}, which is a conforming server
 * saying "that method does not exist". It was never dead.
 *
 * WHY IT IS SAFE. The method asked for is deliberately non-existent, so a
 * conforming server does NO WORK and answers -32601. That matters here more
 * than usual: several of these agents execute real positions, and §9 forbids
 * poking them. This is the strongest liveness evidence obtainable without
 * asking an agent to actually do something.
 */
async function jsonRpcPing(url: string): Promise<{ alive: boolean; status: number | null; detail: string }> {
  try {
    const res = await politeFetch(url, 20_000, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json,*/*" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "liveness", method: LIVENESS_METHOD, params: {} }),
    });
    const text = (await res.text()).slice(0, 4_000);
    let doc: any;
    try { doc = JSON.parse(text); } catch { return { alive: false, status: res.status, detail: "post: not json" }; }
    // A JSON-RPC envelope back - error OR result - proves a live RPC handler.
    const alive = doc?.jsonrpc === "2.0"
      || typeof doc?.error?.code === "number"
      || (doc !== null && typeof doc === "object" && "result" in doc);
    return {
      alive,
      status: res.status,
      detail: alive ? `jsonrpc ${doc?.error?.code ?? "result"}` : "post: not jsonrpc",
    };
  } catch (e) {
    return { alive: false, status: null, detail: `post: ${errDetail(e)}` };
  }
}

async function headOrGet(url: string): Promise<{ status: number; contentType: string; detail: string }> {
  try {
    const res = await politeFetch(url);
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", detail: "" };
  } catch (e: any) {
    return { status: 0, contentType: "", detail: errDetail(e) };
  }
}

interface ProbeResult { outcome: Outcome; detail: string; ms: number; status: number | null }

async function probe(r: Row): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await politeFetch(r.endpoint);
    const ms = Date.now() - t0;
    // The status the server actually returned, recorded verbatim next to the
    // verdict, so a later reader can tell "we never connected" from "it
    // answered 404" without re-running the sweep.
    const status: number | null = res.status;
    if (!res.ok) return { outcome: "dead", detail: `http-${res.status}`, ms, status };
    const text = (await res.text()).slice(0, 60_000);
    let doc: any;
    try { doc = JSON.parse(text); } catch {
      return { outcome: "not-json", detail: (res.headers.get("content-type") ?? "?").split(";")[0]!, ms, status };
    }

    if (INFRA_HINTS.test(r.endpoint) || /payment agent|facilitator/i.test(JSON.stringify(doc).slice(0, 400))) {
      return { outcome: "infrastructure", detail: "payment/tooling, not a task service", ms, status };
    }

    // An A2A agent card should name the URL its tasks go to. When that URL is
    // the card itself, the agent has published a document, not an interface.
    const svcUrl: string | null = typeof doc?.url === "string" ? doc.url : null;
    const services = Array.isArray(doc?.services) ? doc.services : [];
    const selfRef = services.some((s: any) =>
      typeof s?.endpoint === "string" && s.endpoint.replace(/\/$/, "") === r.endpoint.replace(/\/$/, ""));

    if (svcUrl && TESTNET_HINTS.test(svcUrl)) {
      return { outcome: "testnet", detail: svcUrl.slice(0, 70), ms, status };
    }
    if (!svcUrl && selfRef) return { outcome: "self-referential", detail: "card points at itself", ms, status };
    if (svcUrl) {
      // FOLLOW THROUGH to the declared task URL. Checking only that the CARD is
      // JSON was the same mistake as trusting `declaredClass`, one level down:
      // a well-formed agent card can point its `url` at a marketing site.
      // Arca publishes a complete A2A card with four skills whose `url` is
      // https://arcabot.ai - which serves HTML. So does bitagent's mainnet
      // endpoint. A card is a claim about an interface, not the interface.
      const t = await headOrGet(svcUrl);
      if (t.status === 0) return { outcome: "unreachable", detail: `task url: ${t.detail}`, ms, status: null };
      // 405/501 to a GET is what a HEALTHY POST-only JSON-RPC endpoint says, and
      // a card declaring JSONRPC transport is telling us so in advance. Ask
      // properly before calling anything dead.
      if (t.status === 405 || t.status === 501 || /jsonrpc/i.test(String(doc?.preferredTransport ?? ""))) {
        const ping = await jsonRpcPing(svcUrl);
        if (ping.alive) {
          return {
            outcome: "task-interface",
            detail: `${svcUrl.slice(0, 50)} (${ping.detail})`,
            ms, status: ping.status,
          };
        }
      }
      if (t.status >= 400) return { outcome: "dead", detail: `task url http-${t.status}`, ms, status: t.status };
      if (/text\/html/i.test(t.contentType)) {
        return { outcome: "not-json", detail: `task url serves html: ${svcUrl.slice(0, 50)}`, ms, status: t.status };
      }
      return { outcome: "task-interface", detail: svcUrl.slice(0, 70), ms, status: t.status };
    }
    if (selfRef) return { outcome: "self-referential", detail: "card points at itself", ms, status };
    // Before concluding "declares no task url", ask whether THIS url is itself
    // the interface. agent.brainonbnb.com/a2a answers a GET with
    // {"endpoint":"A2A JSON-RPC, POST only","method":"message/send",...} - it is
    // documenting itself, not failing to declare anything. Five agents with
    // completed paid jobs were being filtered out on this branch.
    const selfPing = await jsonRpcPing(r.endpoint);
    if (selfPing.alive) {
      return {
        outcome: "task-interface",
        detail: `endpoint is the interface (${selfPing.detail})`,
        ms, status: selfPing.status,
      };
    }
    return { outcome: "no-interface", detail: "json, but declares no task url", ms, status };
  } catch (e: any) {
    const ms = Date.now() - t0;
    // Rule 0: our inability to reach a host is its own state, never silence.
    // No status: nothing answered. Recording that distinctly is the point.
    return { outcome: "unreachable", detail: errDetail(e), ms, status: null };
  }
}

const db = openDb();
/**
 * WHAT GETS PROBED, and why "never again" was the wrong default.
 *
 * This used to select `verified_class = 'unprobed'` unless given `--all`. That
 * makes every verdict PERMANENT: an agent recorded `unreachable` because its
 * host was down for ten minutes stays unreachable forever, and an operator who
 * fixes their endpoint can never earn their way back into the catalog. A
 * directory that cannot change its mind is not measuring anything, it is just
 * remembering.
 *
 * Three modes now:
 *
 *   --all        every machine endpoint, ignore what we already think
 *   --stale N    unprobed, plus anything last checked more than N hours ago
 *   (default)    unprobed only, for a first pass over new agents
 *
 * `--stale` is what the scheduler runs. Failures are re-checked FIRST within
 * that set: an agent we already list is not going to improve by being probed
 * again, while an agent we excluded might have been fixed, and that is the
 * error worth correcting quickly. The dedupe-by-URL below keeps the cost of
 * this flat - it is one request per distinct endpoint however many agents
 * declare it.
 */
const ALL = process.argv.includes("--all");
const staleIdx = process.argv.indexOf("--stale");
const STALE_HOURS = staleIdx >= 0 ? Number(process.argv[staleIdx + 1] ?? 24) || 24 : null;
const perHostIdx = process.argv.indexOf("--per-host");
/**
 * Hard cap on how many endpoints we touch on any ONE host per run.
 *
 * Without it `--stale` is an attack. The dedupe below collapses 4,457 q402
 * agents onto two URLs, but TermiX publishes one URL PER AGENT - 24,315 of
 * them - so a stale sweep selected 24,434 distinct URLs, ~24,300 of which point
 * at a single host. Running that twice a day is a denial-of-service against a
 * live platform, and §4's whole tiered-cadence design exists to stop us doing
 * exactly this.
 *
 * With a cap, every host is SAMPLED each run and the oldest verdicts rotate to
 * the front, so a large operator is fully re-checked over days rather than
 * flattened in one pass. Correctness is unchanged; only the rate is.
 */
const PER_HOST = perHostIdx >= 0 ? Number(process.argv[perHostIdx + 1] ?? 40) || 40 : 40;

/**
 * Restrict the whole run to one host.
 *
 * For repairing a specific operator's verdicts without touching anyone else -
 * which is exactly what is needed after a bad sweep, and what its absence made
 * impossible without re-probing the entire registry.
 */
const hostIdx = process.argv.indexOf("--host");
const ONLY_HOST = hostIdx >= 0 ? (process.argv[hostIdx + 1] ?? "") : null;

const selection = ALL
  ? ""
  : STALE_HOURS !== null
    ? `AND (verified_class = 'unprobed'
           OR verified_at IS NULL
           OR verified_at < datetime('now', '-${STALE_HOURS} hours'))`
    : "AND verified_class = 'unprobed'";

const rows = db.prepare(`
  WITH candidates AS (
    SELECT agent_id, name, endpoint, endpoint_service, verified_class, verified_at,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(endpoint_host, endpoint)
             ORDER BY
               -- Agents we currently EXCLUDE go first: those are the verdicts
               -- most likely to be wrong and the ones an operator is waiting on.
               CASE WHEN verified_class = 'task-interface' THEN 1 ELSE 0 END,
               -- Then oldest-checked, so the queue rotates instead of starving.
               COALESCE(verified_at, '')
           ) AS rn
      FROM agents
     WHERE declared_class = 'machine' AND endpoint IS NOT NULL
       ${ONLY_HOST ? `AND endpoint_host = '${ONLY_HOST.replace(/'/g, "''")}'` : ""}
       ${selection}
  )
  SELECT agent_id, name, endpoint, endpoint_service, verified_class
    FROM candidates
   -- The cap applies to --all too. It did not, and that footgun fired twice in
   -- one session: --all selected 24,000 URLs on a single host and had to be
   -- killed mid-flight both times. --all means "ignore the staleness window",
   -- never "ignore politeness". Raise --per-host deliberately if you need more.
   WHERE rn <= ${PER_HOST}
   ORDER BY agent_id
`).all() as unknown as Row[];

console.log(
  ALL ? "probing every machine endpoint (no per-host cap)"
    : STALE_HOURS !== null
      ? `probing unprobed agents and anything older than ${STALE_HOURS}h, max ${PER_HOST} per host`
      : `probing unprobed agents only, max ${PER_HOST} per host`,
);

// Dedupe by resolved URL before probing (ROADMAP §4). q402 alone declares
// 4,457 agents against the SAME two URLs; probing each agent separately would
// fire 4,457 identical requests at one host, prove nothing 4,456 times over,
// and be indistinguishable from an attack. One probe per distinct URL, fanned
// out to every agent that declares it.
const byUrl = new Map<string, Row[]>();
for (const r of rows) {
  if (!byUrl.has(r.endpoint)) byUrl.set(r.endpoint, []);
  byUrl.get(r.endpoint)!.push(r);
}
let unique = [...byUrl.values()].map((g) => g[0]!);

// Cap probes per host.
//
// TermiX alone declares 24,326 agents at 24,326 DISTINCT urls on one host, so
// dedupe does not help: at the polite 1 req/s that is ~7 hours of sustained
// traffic aimed at a single operator. We probe a bounded sample per host and
// leave the remainder `unprobed`.
//
// Rule 0 is what makes that acceptable: `unprobed` is its own state and never
// a verdict. Recording 24,000 agents as dead because we chose not to ask would
// be exactly the failure this project exists to catch.
const MAX_PER_HOST = Number(process.env.MAX_PER_HOST ?? 250);
const perHost = new Map<string, number>();
const capped: typeof unique = [];
let skipped = 0;
for (const r of unique) {
  const h = (() => { try { return new URL(r.endpoint).host; } catch { return "?"; } })();
  const n = perHost.get(h) ?? 0;
  if (n >= MAX_PER_HOST) { skipped++; continue; }
  perHost.set(h, n + 1);
  capped.push(r);
}
if (skipped) {
  console.log(`capped at ${MAX_PER_HOST}/host: probing ${capped.length}, leaving ${skipped} unprobed`);
}
unique = capped;
console.log(`verifying ${unique.length} distinct endpoints on behalf of ${rows.length} agents`);
console.log(`(dedupe avoided ${rows.length - unique.length} redundant requests)\n`);

// One request at a time per host, politely - these are other people's servers
// and the whole set collapses onto a handful of them (section 4).
const byHost = new Map<string, Row[]>();
for (const r of unique) {
  const h = (() => { try { return new URL(r.endpoint).host; } catch { return "?"; } })();
  if (!byHost.has(h)) byHost.set(h, []);
  byHost.get(h)!.push(r);
}

const tally: Record<string, number> = {};
const examples: Record<string, string[]> = {};
const insert = db.prepare(
  `INSERT OR REPLACE INTO probes (agent_id, probed_at, reachable, response_ms, http_status, error)
   VALUES (?, ?, ?, ?, ?, ?)`);
// The prober is the ONLY writer of verified_*. The resolver never touches it.
const setVerified = db.prepare(
  `UPDATE agents SET verified_class=?, verified_at=?, verified_detail=?, consec_fails=0
    WHERE agent_id=?`);

/**
 * A transport failure against an agent we currently LIST does not demote it.
 *
 * It records the failure and leaves the verdict standing until three in a row.
 * The reason is written in blood: an uncapped sweep put 24,000 requests at one
 * host, every one timed out, and 97 agents that were answering perfectly well
 * an hour earlier were recorded `unreachable`. Every one of those downgrades
 * was a statement about our own rate limiting.
 *
 * An HTTP ANSWER still demotes immediately - `dead`, `html`, `no-interface` are
 * things the server actually said, and there is nothing ambiguous about them.
 * Only silence is treated as inconclusive, because silence is the one outcome
 * we can cause ourselves.
 */
const TRANSPORT = new Set(["unreachable"]);
const bumpFail = db.prepare(
  `UPDATE agents SET consec_fails = consec_fails + 1, verified_at = ? WHERE agent_id = ?`);
const failCount = db.prepare(`SELECT consec_fails, verified_class FROM agents WHERE agent_id = ?`);
const FAILS_BEFORE_DEMOTION = 3;

/**
 * Hosts are worked by a BOUNDED pool, not all at once.
 *
 * Promise.all over every host launched one task per distinct host with no cap.
 * The per-host rate (1 req/s, below) was carefully designed; the CROSS-host
 * axis had no limit at all, so a sweep touching 200 hosts opened 200
 * concurrent connections and queued their DNS behind libuv's 4-thread pool.
 * It is visible in the recorded data: five agents on five unrelated hosts share
 * a response_ms of 28,960ms to the millisecond, and another five share
 * 39,184ms. Unrelated hosts do not fail in lockstep; one starved local resource
 * does.
 */
// Default 4, not 8. Measured on this build machine: a pool of 8 across seven
// distinct workers.dev hosts starved them all into timeouts; the same seven at
// HOST_POOL=1 came back task-interface 7/7. On a constrained uplink set it to
// 1-2. This bounds OUR concurrency, not politeness to any one host - that is
// the 1 req/s sleep below.
const HOST_POOL = Number(process.env.HOST_POOL ?? 4);
const hostQueue = [...byHost.entries()];
await Promise.all(Array.from({ length: Math.min(HOST_POOL, hostQueue.length) }, async () => {
  for (;;) {
    const entry = hostQueue.shift();
    if (!entry) return;
    const [host, list] = entry;
    for (const r of list) {
    const { outcome, detail, ms, status } = await probe(r);
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    (examples[outcome] ??= []).length < 3 &&
      examples[outcome]!.push(`${r.agent_id} ${String(r.name ?? "").slice(0, 24)} -> ${detail}`);
    const now = new Date().toISOString();
    const detailText = `${outcome}: ${detail}`.slice(0, 200);
    // Fan the single result out to every agent declaring this exact URL.
    for (const peer of byUrl.get(r.endpoint) ?? [r]) {
      // The probe row is always written: it is the raw observation, and the
      // history of what we saw must not be edited by how we chose to read it.
      // http_status and the errno were BOTH being discarded here: status was
      // hardcoded null, and the error column was handed the outcome, which the
      // verdict column already holds. So the probe history could not tell
      // "connect timed out" from "answered 404" - and the 10s-ceiling bug above
      // stayed invisible for as long as it did precisely because of that.
      insert.run(peer.agent_id, now, outcome === "task-interface" ? 1 : 0, ms, status, detailText);

      const prior = failCount.get(peer.agent_id) as
        { consec_fails: number; verified_class: string } | undefined;
      const fails = (prior?.consec_fails ?? 0) + 1;

      // SILENCE NEVER DEMOTES ON ITS OWN, whatever we thought before.
      //
      // This also required wasGood - a prior verdict of task-interface - so the
      // safeguard covered only agents we had ALREADY succeeded against, and any
      // agent whose FIRST probe timed out was branded on that single failure
      // and stayed branded. All 27 proven agents were in exactly that state.
      // The guard was protecting the case that could best afford it and missing
      // the one that actually happened.
      if (TRANSPORT.has(TO_VERIFIED[outcome]!) && fails < FAILS_BEFORE_DEMOTION) {
        bumpFail.run(now, peer.agent_id);
        continue;
      }
      setVerified.run(TO_VERIFIED[outcome], now, detailText, peer.agent_id);
    }
      await sleep(1000); // 1 req/s per host, per section 4
    }
  }
}));

console.log("== what the DECLARED-machine endpoints actually are ==");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
  for (const e of examples[k] ?? []) console.log(`         e.g. ${e}`);
}
const hireable = tally["task-interface"] ?? 0;
console.log(`\nagents exposing a live mainnet task interface: ${hireable} / ${rows.length}`);
db.close();

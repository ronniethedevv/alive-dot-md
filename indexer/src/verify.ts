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

import { openDb } from "./db.ts";
import { sleep } from "./rpc.ts";

const UA = "bnb-mrkt-probe/0.1 (ERC-8004 liveness probe; contact via repo)";

import type { VerifiedClass } from "./classify.ts";

// Finer-grained than VerifiedClass: the detail column keeps the nuance, while
// verified_class stays small enough to filter and render on.
type Outcome =
  | "dead" | "unreachable" | "not-json"
  | "self-referential"  // an "agent card" whose service endpoint is itself
  | "testnet"           // mainnet identity pointing at a TESTNET service.
                        // Its own class, never folded into `dead`: this is a
                        // fixable deployment mistake, not an abandoned agent,
                        // and telling an operator about it is the marketplace
                        // demonstrating what it is for. 21 of 212 is not noise.
  | "infrastructure"    // payment rails/tooling, not a task service
  | "task-interface";   // live, mainnet, declares a task endpoint

const TO_VERIFIED: Record<Outcome, VerifiedClass> = {
  "task-interface": "task-interface",
  testnet: "testnet",
  dead: "dead",
  unreachable: "unreachable",
  "not-json": "html",
  "self-referential": "html",
  infrastructure: "html",
};

interface Row { agent_id: string; name: string | null; endpoint: string; endpoint_service: string | null }

const INFRA_HINTS = /facilitator|relay\/info|\/mcp\/info|payment|wallet\/agentic/i;
const TESTNET_HINTS = /testnet|goerli|sepolia|-test\.|\.test\./i;

/** Cheap reachability + content-type check on a declared task URL. */
async function headOrGet(url: string): Promise<{ status: number; contentType: string; detail: string }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "user-agent": UA, accept: "application/json,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", detail: "" };
  } catch (e: any) {
    return { status: 0, contentType: "", detail: String(e?.cause?.code ?? e?.message ?? "fetch-fail").slice(0, 40) };
  }
}

async function probe(r: Row): Promise<{ outcome: Outcome; detail: string; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(r.endpoint, {
      headers: { "user-agent": UA, accept: "application/json,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { outcome: "dead", detail: `http-${res.status}`, ms };
    const text = (await res.text()).slice(0, 60_000);
    let doc: any;
    try { doc = JSON.parse(text); } catch {
      return { outcome: "not-json", detail: (res.headers.get("content-type") ?? "?").split(";")[0]!, ms };
    }

    if (INFRA_HINTS.test(r.endpoint) || /payment agent|facilitator/i.test(JSON.stringify(doc).slice(0, 400))) {
      return { outcome: "infrastructure", detail: "payment/tooling, not a task service", ms };
    }

    // An A2A agent card should name the URL its tasks go to. When that URL is
    // the card itself, the agent has published a document, not an interface.
    const svcUrl: string | null = typeof doc?.url === "string" ? doc.url : null;
    const services = Array.isArray(doc?.services) ? doc.services : [];
    const selfRef = services.some((s: any) =>
      typeof s?.endpoint === "string" && s.endpoint.replace(/\/$/, "") === r.endpoint.replace(/\/$/, ""));

    if (svcUrl && TESTNET_HINTS.test(svcUrl)) {
      return { outcome: "testnet", detail: svcUrl.slice(0, 70), ms };
    }
    if (!svcUrl && selfRef) return { outcome: "self-referential", detail: "card points at itself", ms };
    if (svcUrl) {
      // FOLLOW THROUGH to the declared task URL. Checking only that the CARD is
      // JSON was the same mistake as trusting `declaredClass`, one level down:
      // a well-formed agent card can point its `url` at a marketing site.
      // Arca publishes a complete A2A card with four skills whose `url` is
      // https://arcabot.ai - which serves HTML. So does bitagent's mainnet
      // endpoint. A card is a claim about an interface, not the interface.
      const t = await headOrGet(svcUrl);
      if (t.status === 0) return { outcome: "unreachable", detail: `task url: ${t.detail}`, ms };
      if (t.status >= 400) return { outcome: "dead", detail: `task url http-${t.status}`, ms };
      if (/text\/html/i.test(t.contentType)) {
        return { outcome: "not-json", detail: `task url serves html: ${svcUrl.slice(0, 50)}`, ms };
      }
      return { outcome: "task-interface", detail: svcUrl.slice(0, 70), ms };
    }
    if (selfRef) return { outcome: "self-referential", detail: "card points at itself", ms };
    return { outcome: "not-json", detail: "json, but declares no task url", ms };
  } catch (e: any) {
    const ms = Date.now() - t0;
    // Rule 0: our inability to reach a host is its own state, never silence.
    return {
      outcome: "unreachable",
      detail: e?.name === "TimeoutError" ? "timeout" : String(e?.cause?.code ?? e?.message ?? "fetch-fail").slice(0, 40),
      ms,
    };
  }
}

const db = openDb();
const onlyUnverified = !process.argv.includes("--all");
const rows = db.prepare(`
  SELECT agent_id, name, endpoint, endpoint_service FROM agents
  WHERE declared_class = 'machine' AND endpoint IS NOT NULL
    ${onlyUnverified ? "AND verified_class = 'unprobed'" : ""}
  ORDER BY agent_id
`).all() as unknown as Row[];

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
const unique = [...byUrl.values()].map((g) => g[0]!);
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
  `UPDATE agents SET verified_class=?, verified_at=?, verified_detail=? WHERE agent_id=?`);

await Promise.all([...byHost.entries()].map(async ([host, list]) => {
  for (const r of list) {
    const { outcome, detail, ms } = await probe(r);
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    (examples[outcome] ??= []).length < 3 &&
      examples[outcome]!.push(`${r.agent_id} ${String(r.name ?? "").slice(0, 24)} -> ${detail}`);
    const now = new Date().toISOString();
    const detailText = `${outcome}: ${detail}`.slice(0, 200);
    // Fan the single result out to every agent declaring this exact URL.
    for (const peer of byUrl.get(r.endpoint) ?? [r]) {
      insert.run(peer.agent_id, now, outcome === "task-interface" ? 1 : 0, ms, null, outcome);
      setVerified.run(TO_VERIFIED[outcome], now, detailText, peer.agent_id);
    }
    await sleep(1000); // 1 req/s per host, per section 4
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

// On demand verification: "my agent is live, list it now".
//
// An operator should not have to wait for a sweep to come round. This re-reads
// the agent from chain, resolves its registration, calls its endpoint, and
// writes the result, all in one request.
//
// It takes NOTHING on trust. The caller supplies only an agent id; every fact
// used comes from the chain or from calling the endpoint ourselves. There is no
// field here an operator can set to make their agent look verified, because the
// whole product falls over the moment there is one.

import { ERC8004 } from "../../shared/src/chain.ts";
import { SEL, encodeUint, decodeString } from "../../../indexer/src/abi.ts";
import { Rpc } from "../../../indexer/src/rpc.ts";
import { classifyDoc, readTokenUri } from "../../../indexer/src/classify.ts";

const rpc = new Rpc({ perEndpoint: 1 });

/**
 * The guard moved to packages/shared/src/fetchable.ts.
 *
 * It is re-exported here so every existing caller keeps working, but the
 * definition had to leave: this module imports the RPC pool, the classifier and
 * the database, so the serverless verify path could not reach the guard without
 * bundling all three - and it shipped unguarded instead. A safety check that is
 * expensive to import is a safety check that gets skipped.
 */
export { isFetchable } from "../../shared/src/fetchable.ts";
const BLOCKED = [
  /^localhost$/i,
  /^127\./, /^0\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,            // link local, including cloud metadata
  /^\[?::1\]?$/, /^\[?fc00:/i, /^\[?fe80:/i,
  /\.internal$/i, /\.local$/i, /\.localdomain$/i,
];

export function isFetchable(url: string): { ok: true } | { ok: false; why: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, why: "not a valid URL" }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, why: "only http and https are fetched" };
  const host = u.hostname;
  if (BLOCKED.some((re) => re.test(host))) {
    return { ok: false, why: "endpoint points at a private or loopback address" };
  }
  // Bare IPv4 literals outside the blocked ranges are still refused: a public
  // agent should have a name, and this closes the decimal and octal encodings
  // that slip past a pattern match.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { ok: false, why: "endpoint must be a hostname, not a raw IP address" };
  }
  return { ok: true };
}

export interface VerifyResult {
  agentId: string;
  declaredClass: string;
  verifiedClass: string;
  detail: string;
  listed: boolean;
  checkedAt: string;
}

const UA = "alive-verifier/1.0 (on demand check; contact via repo)";

/** Fetch with a hard ceiling on time and size. */
async function fetchBounded(url: string, ms = 12_000) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
  const text = (await res.text()).slice(0, 200_000);
  return { res, text };
}

/**
 * Verify one agent, right now. Returns what we found, whether that is good news
 * or not: an operator asking us to check is entitled to the real answer.
 */
export async function verifyNow(db: any, agentId: string): Promise<VerifyResult> {
  const at = new Date().toISOString();
  const fail = (verifiedClass: string, detail: string, declaredClass = "none"): VerifyResult => {
    db.prepare(
      `UPDATE agents SET verified_class=?, verified_at=?, verified_detail=? WHERE agent_id=?`,
    ).run(verifiedClass, at, detail.slice(0, 200), agentId);
    return { agentId, declaredClass, verifiedClass, detail, listed: false, checkedAt: at };
  };

  // 1. Read the registration URI from chain. Never from the request body.
  const [res] = await rpc.ethCallDetailed([{
    to: ERC8004.identityRegistry, data: encodeUint(SEL.tokenURI, Number(agentId)),
  }]);
  if (!res || res.kind === "error") throw new Error("could not reach the chain, try again");
  if (res.kind === "revert") {
    return { agentId, declaredClass: "none", verifiedClass: "unprobed",
      detail: "no agent with that id is registered on chain", listed: false, checkedAt: at };
  }

  const raw = decodeString(res.data);
  const u = readTokenUri(raw);

  // 2. Resolve the registration document.
  let doc: unknown = u.doc;
  let regError: string | null = u.error;
  if (u.kind === "http" && u.url) {
    const guard = isFetchable(u.url);
    if (!guard.ok) return fail("unreachable", `registration ${guard.why}`);
    try {
      const { res: r, text } = await fetchBounded(u.url);
      if (!r.ok) regError = `http-${r.status}`;
      else { try { doc = JSON.parse(text); } catch { regError = "body-parse"; } }
    } catch { regError = "fetch-fail"; }
  }

  const c = classifyDoc(doc, { kind: u.kind, regHost: u.host, error: regError, agentId });

  // Persist what the registration says, whatever it says.
  db.prepare(`
    UPDATE agents SET token_uri=?, reg_valid=?, reg_fetch_error=?, name=?, description=?,
      endpoint=?, endpoint_service=?, endpoint_host=?, declared_class=?, x402_claimed=?,
      reg_host=?, categories_json=? WHERE agent_id=?
  `).run(
    raw, c.registrationFileValid ? 1 : 0, regError, c.name, c.description,
    c.endpoint, c.endpointServiceName, c.endpointHost, c.declaredClass,
    c.x402Claimed ? 1 : 0, c.regHost,
    c.categories.length ? JSON.stringify(c.categories) : null, agentId,
  );

  if (c.declaredClass !== "machine" || !c.endpoint) {
    return fail("no-interface",
      c.declaredClass === "web-only"
        ? "the registration declares only a web page, not a machine interface"
        : "the registration declares no callable endpoint",
      c.declaredClass);
  }

  // 3. Call it.
  const guard = isFetchable(c.endpoint);
  if (!guard.ok) return fail("unreachable", guard.why, c.declaredClass);

  let card: any = null;
  try {
    const { res: r, text } = await fetchBounded(c.endpoint);
    if (!r.ok) return fail("dead", `the endpoint answered http ${r.status}`, c.declaredClass);
    if (/text\/html/i.test(r.headers.get("content-type") ?? "")) {
      return fail("html", "the endpoint served a web page rather than an interface", c.declaredClass);
    }
    try { card = JSON.parse(text); }
    catch { return fail("html", "the endpoint did not return JSON", c.declaredClass); }
  } catch (e: any) {
    return fail("unreachable",
      e?.name === "TimeoutError" ? "the endpoint did not respond in time" : "the endpoint could not be reached",
      c.declaredClass);
  }

  // 4. An agent card must name the URL work is sent to. Follow through to it,
  //    because a card is a claim about an interface, not the interface.
  const taskUrl: string | null = typeof card?.url === "string" ? card.url : null;
  if (!taskUrl) {
    return fail("no-interface", "the endpoint answered but names no task url", c.declaredClass);
  }
  if (/testnet|sepolia|goerli/i.test(taskUrl)) {
    return fail("testnet", `the task url points at a test network: ${taskUrl}`, c.declaredClass);
  }
  const taskGuard = isFetchable(taskUrl);
  if (!taskGuard.ok) return fail("unreachable", `task url ${taskGuard.why}`, c.declaredClass);
  try {
    const { res: t } = await fetchBounded(taskUrl, 10_000);
    if (t.status >= 400) return fail("dead", `the task url answered http ${t.status}`, c.declaredClass);
  } catch {
    return fail("unreachable", "the task url could not be reached", c.declaredClass);
  }

  const detail = `task-interface: ${taskUrl}`;
  db.prepare(
    `UPDATE agents SET verified_class='task-interface', verified_at=?, verified_detail=? WHERE agent_id=?`,
  ).run(at, detail.slice(0, 200), agentId);
  db.prepare(
    `INSERT OR REPLACE INTO probes (agent_id, probed_at, reachable, response_ms, http_status, error)
     VALUES (?, ?, 1, NULL, 200, 'task-interface')`,
  ).run(agentId, at);

  return {
    agentId, declaredClass: c.declaredClass, verifiedClass: "task-interface",
    detail, listed: true, checkedAt: at,
  };
}

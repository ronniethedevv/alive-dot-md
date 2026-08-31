// The classifier. This is the product's core logic: everything the catalog
// claims about an agent that is not a raw chain read comes from here.
//
// Rules are from ROADMAP §4, which was written from a 300-agent sample:
//   - 125/300 declare an endpoint, but only 5/300 declare a CALLABLE one
//   - 96 of those endpoints are `web`, i.e. a human page, not an interface
//   - 24 publish a literal "{agentId}" template and are not callable as written
//   - 13 claim x402Support while publishing no URL at all
//
// Never throw. A malformed registration is data, not an error: the tail of this
// registry contains hackathon config blobs, free text, and the string `""`.

/**
 * What the REGISTRATION FILE says. A claim by the operator, nothing more.
 *
 *   machine   - declares a non-web service with a concrete, structurally valid URL
 *   web-only  - declares only `web` services: a human page, not an interface
 *   template  - declares a URL that cannot resolve by construction: an
 *               unsubstituted "{agentId}" placeholder, or an RFC 2606 reserved
 *               name. Provably invalid without asking DNS.
 *   none      - no endpoint, non-conformant registration, or empty URI
 *
 * `machine` is deliberately NOT called "callable". Probing 212 declared machine
 * endpoints found 150 serving text/html and only 7 exposing a real task
 * interface. Declaration does not establish callability, and a product whose
 * whole argument is "we show what the score is made of" cannot assert one.
 */
export type DeclaredClass = "machine" | "web-only" | "template" | "none";

/**
 * What the PROBE found. The only tier that supports a hireability claim.
 *
 *   unprobed        - not yet checked. NOT a synonym for "bad" (Rule 0).
 *   task-interface  - live, mainnet, declares a task URL. Hireable.
 *   html            - answered with a web page. Declared machine, is not.
 *   testnet         - mainnet identity pointing at a testnet service. A fixable
 *                     deployment mistake, NOT an abandoned agent - kept
 *                     separate from `dead` for exactly that reason.
 *   dead            - host answered 4xx/5xx. Declared but not there.
 *   unreachable     - DNS/TLS/timeout. Includes invented TLDs (.agent, .bsc).
 *                     "We could not reach it" is our failure to ask, and is
 *                     kept distinct from the host answering (Rule 0).
 */
export type VerifiedClass =
  | "unprobed"        // not checked. NOT a synonym for bad (Rule 0).
  | "task-interface"  // live, mainnet, declares a task URL. Hireable.
  | "infrastructure"  // answered, but it is a payment rail or tooling, not a
                      // service you can commission work from. q402 alone is
                      // 4,457 of these.
  | "no-interface"    // answered with valid JSON that declares no task URL.
                      // Well-formed and not hireable, which is a different
                      // finding from serving a web page.
  | "html"            // served a web page (or a PDF, or a JPEG). Declared a
                      // machine interface; is not one.
  | "testnet"         // mainnet identity pointing at a testnet service.
  | "dead"            // host answered 4xx/5xx.
  | "unreachable";    // DNS/TLS/timeout. Our failure to ask, kept distinct
                      // from the host answering (Rule 0).

/** Kept as an alias so older call sites read clearly during the migration. */
export type EndpointClass = DeclaredClass;

export type UriKind = "inline" | "http" | "malformed" | "empty";

export interface Resolved {
  uriKind: UriKind;
  /** Host of an http(s) registration URI. The provenance signal's raw input. */
  regHost: string | null;
  /** Fetch/parse outcome. Non-null means we could not read a document. */
  regError: string | null;
  registrationFileValid: boolean;
  name: string | null;
  description: string | null;
  categories: string[];
  endpoint: string | null;
  endpointServiceName: string | null;
  endpointHost: string | null;
  declaredClass: DeclaredClass;
  /** Claims x402 payment support. NOT reachability - see §4. */
  x402Claimed: boolean;
}

/**
 * Names that are reserved by specification, so they are provably unusable
 * without asking DNS anything: RFC 2606 / RFC 6761.
 *
 * Deliberately NOT a list of "TLDs that look fake". The registry contains 100
 * endpoints on `.agent` and 3 on `.bsc`, which are not delegated - but it also
 * contains `.one`, `.bot`, `.app`, `.fun` and `.today`, which are real. Sorting
 * those apart is a DNS question, and guessing at it here would be the same
 * unsupported verdict the declared/verified split exists to remove. The prober
 * resolves them definitively as `unreachable`.
 */
const RESERVED_HOSTS = [
  "example.com", "example.org", "example.net", "example-agent.ai",
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
  "your-domain", "yourdomain", "changeme", "<your", "placeholder",
];
const RESERVED_TLDS = ["example", "invalid", "test", "localhost"];

const EMPTY: Resolved = {
  uriKind: "empty", regHost: null, regError: null, registrationFileValid: false,
  name: null, description: null, categories: [], endpoint: null,
  endpointServiceName: null, endpointHost: null, declaredClass: "none",
  x402Claimed: false,
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isReserved(host: string): boolean {
  if (RESERVED_HOSTS.some((p) => host.includes(p))) return true;
  const tld = host.split(".").pop() ?? "";
  return RESERVED_TLDS.includes(tld);
}

/**
 * URI templates (RFC 6570-style) are RESOLVABLE, not broken.
 *
 * This was got wrong, expensively. TermiX publishes
 * ".../a2a/agents/{agentId}/card" across 24,642 registrations, and the
 * classifier filed all of them as `template`, meaning "cannot resolve as
 * written". A disclosure was drafted telling TermiX their agents were
 * undiscoverable. Substituting the ERC-8004 token id resolves the URL and
 * returns a real agent card, on every agent tested. The placeholder is a
 * convention the caller fills in, and it names the exact value to use.
 *
 * So: substitute what we can, and only call it a template when the placeholder
 * is one we cannot fill.
 */
const SUBSTITUTABLE = /\{\s*(agentId|agent_id|tokenId|token_id|id|nfaTokenId)\s*\}/gi;

export function substituteTemplate(url: string, agentId: string | null): string {
  if (!agentId) return url;
  return url.replace(SUBSTITUTABLE, agentId);
}

/** A placeholder we cannot fill, so the URL genuinely cannot be requested. */
function isTemplate(url: string): boolean {
  return /[{}]/.test(url) || /(^|\/):[A-Za-z_]\w*(\/|$)/.test(url) || url.includes("<");
}

/**
 * What kind of URI is in tokenURI, and if it is inline, the document itself.
 * http(s) URIs are NOT fetched here - that is phase 2 (see fetch-registrations).
 */
export function readTokenUri(raw: string | null): {
  kind: UriKind; host: string | null; doc: unknown; error: string | null; url: string | null;
} {
  const s = (raw ?? "").trim();
  // The registry contains agents whose tokenURI is the literal two-char string.
  if (!s || s === '""' || s === "''") {
    return { kind: "empty", host: null, doc: null, error: null, url: null };
  }
  if (s.startsWith("data:")) {
    try {
      const comma = s.indexOf(",");
      if (comma < 0) return { kind: "malformed", host: null, doc: null, error: "data-uri-no-comma", url: null };
      const meta = s.slice(0, comma);
      const payload = s.slice(comma + 1);
      const text = meta.includes("base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      return { kind: "inline", host: null, doc: JSON.parse(text), error: null, url: null };
    } catch (e) {
      return { kind: "malformed", host: null, doc: null, error: "data-uri-parse", url: null };
    }
  }
  if (/^https?:\/\//i.test(s)) {
    return { kind: "http", host: hostOf(s), doc: null, error: null, url: s };
  }
  // Some agents put bare JSON straight in tokenURI with no data: prefix.
  if (s.startsWith("{")) {
    try {
      return { kind: "inline", host: null, doc: JSON.parse(s), error: null, url: null };
    } catch {
      return { kind: "malformed", host: null, doc: null, error: "raw-json-parse", url: null };
    }
  }
  // Free text. Real example in the registry: an NFT advert with emoji.
  return { kind: "malformed", host: null, doc: null, error: "not-a-uri", url: null };
}

function asRecord(doc: unknown): Record<string, unknown> | null {
  return doc && typeof doc === "object" && !Array.isArray(doc)
    ? (doc as Record<string, unknown>)
    : null;
}

function truthy(v: unknown): boolean {
  return v === true || (typeof v === "string" && ["true", "yes", "1"].includes(v.toLowerCase()));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Categories, preferring the OASF taxonomy where an agent declares one.
 * Still self-asserted either way - the UI must label it as a claim.
 */
function extractCategories(services: unknown[]): string[] {
  const out = new Set<string>();
  for (const s of services) {
    const e = asRecord(s);
    if (!e) continue;
    for (const key of ["domains", "skills"]) {
      const v = e[key];
      if (!Array.isArray(v)) continue;
      for (const item of v) {
        // OASF paths look like "technology/artificial_intelligence". Take the
        // top-level segment: it is the part that behaves like a category.
        const t = str(item);
        if (t) out.add(t.split("/")[0]!);
      }
    }
  }
  return [...out].slice(0, 8);
}

/** Classify a parsed registration document. Pure, total, never throws. */
export function classifyDoc(
  doc: unknown,
  ctx: { kind: UriKind; regHost: string | null; error?: string | null; agentId?: string | null },
): Resolved {
  const base: Resolved = {
    ...EMPTY,
    uriKind: ctx.kind,
    regHost: ctx.regHost,
    regError: ctx.error ?? null,
  };
  const j = asRecord(doc);
  if (!j) return base;

  base.registrationFileValid = String(j.type ?? "").endsWith("registration-v1");
  base.name = str(j.name);
  base.description = str(j.description);
  base.x402Claimed = truthy(j.x402Support);

  const services = Array.isArray(j.services) ? j.services : [];
  base.categories = extractCategories(services);

  // Walk services once, remembering why each candidate was rejected. The
  // rejection reason IS the classification when nothing callable is found.
  let sawWeb = false;
  let sawTemplate = false;
  for (const s of services) {
    const e = asRecord(s);
    if (!e) continue;
    const nm = str(e.name) ?? "";
    const raw = str(e.endpoint);
    if (!raw) continue;
    if (nm.toLowerCase() === "web") { sawWeb = true; continue; }
    // Fill placeholders that name the agent before judging the URL.
    const url = substituteTemplate(raw, ctx.agentId ?? null);
    if (isTemplate(url)) { sawTemplate = true; continue; }
    const host = hostOf(url);
    if (!host) { sawTemplate = true; continue; }
    if (isReserved(host)) { sawTemplate = true; continue; }
    // First concrete, non-web, structurally valid endpoint wins. Note a service
    // entry with no `name` still counts: we cannot know from the file whether
    // it is an interface or a page, and pretending otherwise is the verdict we
    // are removing. The probe decides. (100 such entries sit on `.agent`.)
    base.endpoint = url;
    base.endpointServiceName = nm || null;
    base.endpointHost = host;
    base.declaredClass = "machine";
    return base;
  }

  if (sawTemplate) base.declaredClass = "template";
  else if (sawWeb) {
    base.declaredClass = "web-only";
    // Keep the web URL for the host-level daily probe (§4), but never as a
    // callable endpoint - endpointClass is what gates hireability.
    for (const s of services) {
      const e = asRecord(s);
      const url = e ? str(e.endpoint) : null;
      if (url && str(e!.name)?.toLowerCase() === "web") {
        base.endpoint = url;
        base.endpointServiceName = "web";
        base.endpointHost = hostOf(url);
        break;
      }
    }
  }
  return base;
}

/** Full inline path: tokenURI string in, Resolved out. */
export function resolveInline(
  rawTokenUri: string | null,
  agentId: string | null = null,
): Resolved & { httpUrl: string | null } {
  const r = readTokenUri(rawTokenUri);
  if (r.kind === "http") {
    // Deferred to phase 2. Classified `none` until fetched, and the resolver
    // records the pending state so nothing counts it as decided.
    return {
      ...EMPTY, uriKind: "http", regHost: r.host, regError: "pending-fetch",
      httpUrl: r.url,
    };
  }
  return {
    ...classifyDoc(r.doc, { kind: r.kind, regHost: r.host, error: r.error, agentId }),
    httpUrl: null,
  };
}

// First-party agents. The supply side (ROADMAP §9 Days 3-4).
//
// Across ~1,600 verified third-party endpoints the registry yielded ZERO live
// mainnet task interfaces, so the catalog cannot be populated by discovery
// alone. These three exist to make the marketplace demonstrable - and every
// surface must say plainly that they are ours (§8.2). An unlabelled first-party
// agent in a product whose thesis is "catalogs hide their composition" would
// hand a judge our own argument.
//
// Design constraint that is doing real work: all three return a DECLARED OUTPUT
// SHAPE. §6's evaluator table routes "output has a declared shape" to a schema
// check, which is the cheapest honest evaluator there is - no timer, no UMA, no
// human. Choosing schema-checkable capabilities is what makes the hire flow
// verifiable end to end inside the remaining days.
//
//   PORT=8080 node --experimental-strip-types packages/agents/src/service.ts

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Rpc } from "../../../indexer/src/rpc.ts";

const PORT = Number(process.env.PORT ?? 8080);
/** Public base URL once deployed. Registration files are generated from this. */
const BASE = (process.env.AGENT_BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const rpc = new Rpc({ perEndpoint: 1 });

interface Skill {
  id: string;
  description: string;
  /** JSON Schema of the result. Published so an evaluator can check delivery. */
  outputSchema: Record<string, unknown>;
  run(input: any): Promise<unknown>;
}

interface Agent {
  slug: string;
  /**
   * What this agent charges, in raw U units (18 decimals).
   *
   * ERC-8183 has a negotiation layer and this is its `service_price`: the floor
   * below which the provider rejects with PRICE_TOO_LOW. Publishing it means a
   * client is quoted rather than left to guess a budget and discover the floor
   * by having a funded job refused.
   */
  priceWei: bigint;
  name: string;
  description: string;
  categories: string[];
  skills: Skill[];
}

const num = (h: string | null) => (h && h !== "0x" ? Number(BigInt(h)) : 0);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ─── Agent 1: on-chain address inspector ────────────────────────────────────
// Deterministic, verifiable by anyone against the same chain. The ideal shape
// for the "duplicate" evaluator too: hire two, compare, escalate on mismatch.

const inspector: Agent = {
  slug: "bsc-address-inspector",
  priceWei: 200_000_000_000_000_000n, // 0.2 U
  name: "BSC Address Inspector",
  description:
    "Reports whether a BNB Smart Chain address is a contract, its bytecode size, "
    + "and ERC-20 metadata where present. Deterministic and independently checkable.",
  categories: ["blockchain-data", "analysis"],
  skills: [{
    id: "inspect_address",
    description: "Inspect a BSC address. Input: { address }.",
    outputSchema: {
      type: "object",
      required: ["address", "isContract", "bytecodeBytes", "checkedAtBlock"],
      properties: {
        address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        isContract: { type: "boolean" },
        bytecodeBytes: { type: "integer", minimum: 0 },
        checkedAtBlock: { type: "integer", minimum: 0 },
        erc20: {
          type: ["object", "null"],
          properties: {
            name: { type: "string" }, symbol: { type: "string" },
            decimals: { type: "integer" },
          },
        },
      },
    },
    async run(input: any) {
      const address = str(input?.address);
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("address must be a 0x-prefixed 20-byte hex string");
      const [nameR, symR, decR] = await rpc.ethCallDetailed([
        { to: address, data: "0x06fdde03" },
        { to: address, data: "0x95d89b41" },
        { to: address, data: "0x313ce567" },
      ]);
      const code = await rpc.getCode(address);
      const decodeStr = (r: any) => {
        if (!r || r.kind !== "ok" || r.data === "0x") return null;
        try {
          const b = Buffer.from(r.data.slice(2), "hex");
          const len = Number(BigInt("0x" + b.subarray(32, 64).toString("hex")));
          return b.subarray(64, 64 + len).toString("utf8") || null;
        } catch { return null; }
      };
      const nm = decodeStr(nameR), sym = decodeStr(symR);
      return {
        address,
        isContract: code.length > 2,
        bytecodeBytes: Math.max(0, (code.length - 2) / 2),
        checkedAtBlock: await rpc.blockNumber(),
        erc20: nm || sym
          ? { name: nm ?? "", symbol: sym ?? "", decimals: decR && decR.kind === "ok" ? num(decR.data) : 18 }
          : null,
      };
    },
  }],
};

// ─── Agent 2: endpoint liveness checker ─────────────────────────────────────
// The capability this whole project needed and could not buy. Deliberately the
// same check the marketplace runs on the registry (§4), offered as a service.

const liveness: Agent = {
  slug: "endpoint-liveness",
  priceWei: 100_000_000_000_000_000n, // 0.1 U
  name: "Endpoint Liveness Checker",
  description:
    "Probes an HTTP endpoint and reports reachability, status, latency and content type. "
    + "Distinguishes 'the host answered with an error' from 'we could not reach it'.",
  categories: ["monitoring", "infrastructure"],
  skills: [{
    id: "check_endpoint",
    description: "Probe a URL. Input: { url }.",
    outputSchema: {
      type: "object",
      required: ["url", "outcome", "checkedAt"],
      properties: {
        url: { type: "string" },
        // Mirrors VerifiedClass: a failure is never dressed as a result (Rule 0).
        outcome: { enum: ["ok", "http-error", "unreachable", "timeout"] },
        httpStatus: { type: ["integer", "null"] },
        responseMs: { type: ["integer", "null"] },
        contentType: { type: ["string", "null"] },
        checkedAt: { type: "string" },
      },
    },
    async run(input: any) {
      const url = str(input?.url);
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new Error("url must be an absolute http(s) URL"); }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("only http(s) is supported");
      const t0 = Date.now();
      try {
        const res = await fetch(url, {
          redirect: "follow",
          headers: { "user-agent": "bnb-mrkt-agent/0.1 (endpoint-liveness)" },
          signal: AbortSignal.timeout(15_000),
        });
        return {
          url,
          outcome: res.ok ? "ok" : "http-error",
          httpStatus: res.status,
          responseMs: Date.now() - t0,
          contentType: (res.headers.get("content-type") ?? "").split(";")[0] || null,
          checkedAt: new Date().toISOString(),
        };
      } catch (e: any) {
        return {
          url,
          outcome: e?.name === "TimeoutError" ? "timeout" : "unreachable",
          httpStatus: null,
          responseMs: Date.now() - t0,
          contentType: null,
          checkedAt: new Date().toISOString(),
        };
      }
    },
  }],
};

// ─── Agent 3: ERC-8004 registration auditor ─────────────────────────────────
// Tells an operator why their own agent is unlisted. Directly useful to the
// 21 testnet-pointing and 150 HTML-serving agents found in §4 - the audience
// for the TermiX disclosure in §11, served as a callable tool.

const auditor: Agent = {
  slug: "erc8004-registration-auditor",
  priceWei: 500_000_000_000_000_000n, // 0.5 U
  name: "ERC-8004 Registration Auditor",
  description:
    "Audits an ERC-8004 registration file and reports what a marketplace can and cannot "
    + "verify about it: file validity, declared services, and whether the endpoint is a "
    + "machine interface, a web page, an unsubstituted template, or a testnet URL.",
  categories: ["analysis", "developer-tools"],
  skills: [{
    id: "audit_registration",
    description: "Audit a registration file. Input: { registrationUri } or { agentId }.",
    outputSchema: {
      type: "object",
      required: ["declaredClass", "registrationFileValid", "findings"],
      properties: {
        declaredClass: { enum: ["machine", "web-only", "template", "none"] },
        registrationFileValid: { type: "boolean" },
        endpoint: { type: ["string", "null"] },
        endpointServiceName: { type: ["string", "null"] },
        findings: { type: "array", items: { type: "string" } },
      },
    },
    async run(input: any) {
      const { classifyDoc, readTokenUri } = await import("../../../indexer/src/classify.ts");
      let uri = str(input?.registrationUri);
      if (!uri && input?.agentId != null) {
        const { ERC8004 } = await import("../../shared/src/chain.ts");
        const { SEL, encodeUint, decodeString } = await import("../../../indexer/src/abi.ts");
        const [r] = await rpc.ethCallDetailed([{
          to: ERC8004.identityRegistry, data: encodeUint(SEL.tokenURI, Number(input.agentId)),
        }]);
        if (!r || r.kind !== "ok") throw new Error(`agent ${input.agentId} has no readable tokenURI`);
        uri = decodeString(r.data) ?? "";
      }
      if (!uri) throw new Error("provide registrationUri or agentId");

      const u = readTokenUri(uri);
      let doc = u.doc, error = u.error;
      if (u.kind === "http" && u.url) {
        try {
          const res = await fetch(u.url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) error = `http-${res.status}`;
          else doc = JSON.parse(await res.text());
        } catch { error = "fetch-failed"; }
      }
      const c = classifyDoc(doc, { kind: u.kind, regHost: u.host, error });

      const findings: string[] = [];
      if (!c.registrationFileValid) findings.push("The `type` field is not eip-8004#registration-v1, so this does not parse as a registration file.");
      if (c.declaredClass === "none") findings.push("No services[] endpoint is declared, so no marketplace can route work to this agent.");
      if (c.declaredClass === "web-only") findings.push("Only a `web` service is declared. That is a page for humans, not an interface an agent can call.");
      if (c.declaredClass === "template") findings.push("The declared endpoint contains an unsubstituted placeholder or a reserved name, so it cannot resolve as written.");
      if (c.endpoint && /testnet|sepolia|goerli/i.test(c.endpoint)) findings.push("The declared endpoint points at a TESTNET host while the identity is registered on mainnet.");
      if (c.x402Claimed && !c.endpoint) findings.push("x402Support is claimed but no endpoint is declared, so there is nothing to pay.");
      if (!findings.length) findings.push("Declares a concrete machine endpoint. Whether it answers is a separate question - probe it.");

      return {
        declaredClass: c.declaredClass,
        registrationFileValid: c.registrationFileValid,
        endpoint: c.endpoint,
        endpointServiceName: c.endpointServiceName,
        findings,
      };
    },
  }],
};

export const AGENTS: Agent[] = [inspector, liveness, auditor];

/** ERC-8183 standard rejection codes. */
const REASON = {
  PRICE_TOO_LOW: "0x01",
  DEADLINE_TOO_TIGHT: "0x02",
  INCAPABLE: "0x03",
  AMBIGUOUS_TERMS: "0x04",
  TASK_TOO_LONG: "0x07",
} as const;

/** Seconds a quote stays good for. Short enough to be honest about drift. */
const QUOTE_TTL = 15 * 60;

/**
 * Single round negotiation, per ERC-8183: the client sends requirements, the
 * agent returns a price or refuses with a reason.
 *
 * Refusing is a first class answer here, not an error. An agent that declines
 * work it cannot price or cannot do is behaving correctly, and the client gets
 * a machine readable reason rather than a failed transaction.
 */
export function negotiate(a: Agent, req: { task?: string; conditions?: string; skill?: string; budgetWei?: string }) {
  const task = (req.task ?? "").trim();
  const now = Math.floor(Date.now() / 1000);

  if (task.length < 8) {
    return { accepted: false, reasonCode: REASON.AMBIGUOUS_TERMS,
      reason: "The task description is too short to price. Say what you want done." };
  }
  if (task.length > 900) {
    return { accepted: false, reasonCode: REASON.TASK_TOO_LONG,
      reason: "The task and terms exceed what fits in the on chain description." };
  }
  const skill = a.skills.find((s) => s.id === req.skill) ?? a.skills[0]!;

  // A client may propose a budget. If it is below the floor, say so and say by
  // how much, rather than accepting and failing later.
  if (req.budgetWei) {
    try {
      if (BigInt(req.budgetWei) < a.priceWei) {
        return { accepted: false, reasonCode: REASON.PRICE_TOO_LOW,
          reason: `This agent charges ${fmtU(a.priceWei)} U for this work.`,
          priceWei: a.priceWei.toString(), price: fmtU(a.priceWei) };
      }
    } catch { /* unparseable budget: quote normally */ }
  }

  return {
    accepted: true,
    agent: a.slug,
    skill: skill.id,
    priceWei: a.priceWei.toString(),
    price: fmtU(a.priceWei),
    currency: "U",
    quotedAt: now,
    quoteExpiresAt: now + QUOTE_TTL,
    terms: {
      deliverables: skill.description,
      qualityStandards: "The result must match the published output schema for this skill.",
      outputSchema: skill.outputSchema,
    },
  };
}

/** Raw 18 decimal units to a short human string. */
function fmtU(wei: bigint) {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * ERC-8004 registration file + A2A-style card. What goes in tokenURI.
 *
 * `base` is a parameter rather than the module constant because seed.ts writes
 * these files for a host it is not itself running on. When it closed over BASE,
 * `seed.ts --base https://…` printed fly.dev calldata while writing localhost
 * files, and the preflight's localhost guard - reading seed's own variable -
 * stayed silent about it.
 */
export function registrationFile(a: Agent, base: string = BASE) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: a.name,
    description: a.description,
    // Disclosure travels WITH the agent, not just in our UI. Anyone indexing
    // this registry sees who operates it without asking us (§8.2).
    operator: "bnb-mrkt (first-party marketplace agent)",
    services: [
      {
        name: "A2A",
        endpoint: `${base}/agents/${a.slug}/.well-known/agent-card.json`,
        version: "0.3.0",
        skills: a.skills.map((s) => s.id),
        domains: a.categories,
      },
      { name: "tasks", endpoint: `${base}/agents/${a.slug}/tasks`, version: "1" },
    ],
    x402Support: false,
    active: true,
    supportedTrust: ["reputation"],
    // Published so a client can be quoted before committing anything on chain.
    pricing: {
      priceWei: a.priceWei.toString(),
      price: fmtU(a.priceWei),
      currency: "U",
      negotiate: `${base}/agents/${a.slug}/negotiate`,
    },
  };
}

function agentCard(a: Agent) {
  return {
    ...registrationFile(a),
    // A2A cards name the URL work is sent to. Ours points at a real task
    // endpoint - not back at the card, which is how 24 registry agents
    // published a document and called it an interface (§4).
    url: `${BASE}/agents/${a.slug}/tasks`,
    skills: a.skills.map((s) => ({
      id: s.id, description: s.description, outputSchema: s.outputSchema,
    })),
  };
}

function send(res: any, code: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "access-control-allow-origin": "*",
  });
  res.end(s);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    return res.end();
  }
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/" || url.pathname === "/agents") {
    return send(res, 200, {
      service: "bnb-mrkt first-party agents",
      disclosure: "Operated by the bnb-mrkt marketplace. Listed as firstParty in its catalog.",
      agents: AGENTS.map((a) => ({
        slug: a.slug, name: a.name, categories: a.categories,
        card: `${BASE}/agents/${a.slug}/.well-known/agent-card.json`,
      })),
    });
  }

  if (parts[0] === "agents" && parts[1]) {
    const a = AGENTS.find((x) => x.slug === parts[1]);
    if (!a) return send(res, 404, { error: "unknown_agent", slug: parts[1] });

    if (url.pathname.endsWith("/.well-known/agent-card.json")) return send(res, 200, agentCard(a));
    if (url.pathname.endsWith("/registration.json")) return send(res, 200, registrationFile(a));

    if (parts[2] === "negotiate") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed", expected: "POST" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32_000) return send(res, 413, { error: "payload_too_large" });
      }
      let payload: any = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { return send(res, 400, { error: "invalid_json" }); }
      const quote = negotiate(a, payload);
      // A refusal is a valid answer, so it is 200 with accepted false rather
      // than an error status the client has to special case.
      return send(res, 200, quote);
    }

    if (parts[2] === "tasks") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed", expected: "POST" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64_000) return send(res, 413, { error: "payload_too_large" });
      }
      let payload: any = {};
      try { payload = body ? JSON.parse(body) : {}; }
      catch { return send(res, 400, { error: "invalid_json" }); }

      const skill = a.skills.find((s) => s.id === payload.skill) ?? a.skills[0]!;
      const t0 = Date.now();
      try {
        const result = await skill.run(payload.input ?? payload);
        return send(res, 200, {
          agent: a.slug, skill: skill.id, status: "completed",
          result, outputSchema: skill.outputSchema, elapsedMs: Date.now() - t0,
        });
      } catch (e: any) {
        // A refusal is a first-class outcome, not a 500. This is the §6
        // `declined` state at the service layer: the agent is fine, the request
        // was not actionable, and it must never read as a failed delivery.
        return send(res, 400, {
          agent: a.slug, skill: skill.id, status: "declined",
          reason: String(e?.message ?? e).slice(0, 300), elapsedMs: Date.now() - t0,
        });
      }
    }
  }
  send(res, 404, { error: "not_found" });
});

// Only listen when this file IS the program. seed.ts imports registrationFile
// from here, and an unconditional listen() left it holding an open port so it
// never exited - the run had to be killed, after writing its files.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(PORT, () => {
    console.log(`first-party agents on ${BASE}`);
    for (const a of AGENTS) console.log(`  ${a.slug.padEnd(30)} ${a.skills.length} skill(s)`);
  });
}

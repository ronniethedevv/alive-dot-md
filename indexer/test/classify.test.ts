// Golden test. The fixture is 300 real agents sampled uniformly from the live
// BSC registry (seed 8004), captured on 2026-08-30 with their tokenURI and,
// where the URI was http(s), the fetched registration body.
//
// SCOPE: this file tests the DECLARED class only - what the registration file
// says. It cannot test verifiedClass, because that requires probing live hosts,
// and a unit test that reaches the network is not a unit test. The verified
// numbers are measured by src/verify.ts and recorded in ROADMAP section 4.
//
// That split is the point. An earlier version of this file asserted a class
// literally named `callable` over declaration data alone. Probing then found
// that of 212 declared-machine endpoints, 150 served HTML, 29 were dead, 21
// pointed at testnet, 5 did not resolve, and 7 were real task interfaces. The
// test was asserting a verdict the data could not support - the exact failure
// the product exists to expose in other people's catalogs.
//
// If a classifier change moves these numbers, that is a product decision, not a
// refactor: update ROADMAP section 4 in the same commit (section 12).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyDoc, readTokenUri, resolveInline, type DeclaredClass } from "../src/classify.ts";

interface Row { agentId: string; tokenUri: string; fetchedBody: string | null }

const rows: Row[] = JSON.parse(
  readFileSync(new URL("./fixtures/sample-300.json", import.meta.url), "utf8"),
);

/** Classify one fixture row, using the captured body for http(s) URIs. */
function classifyRow(r: Row) {
  const u = readTokenUri(r.tokenUri);
  if (u.kind !== "http") return resolveInline(r.tokenUri, r.agentId);
  if (r.fetchedBody == null) {
    return classifyDoc(null, { kind: "http", regHost: u.host, error: "http-fail", agentId: r.agentId });
  }
  let doc: unknown = null;
  let error: string | null = null;
  try { doc = JSON.parse(r.fetchedBody); } catch { error = "body-parse"; }
  // agentId must be threaded here: without it, URI templates naming the agent
  // are misclassified as unresolvable. That error produced a bug report to an
  // operator whose endpoints were fine.
  return classifyDoc(doc, { kind: "http", regHost: u.host, error, agentId: r.agentId });
}

const results = rows.map((r) => ({ row: r, res: classifyRow(r) }));
const tally = (f: (x: (typeof results)[number]) => boolean) => results.filter(f).length;
const declared = (c: DeclaredClass) => results.filter((r) => r.res.declaredClass === c);

test("sample size is intact", () => {
  assert.equal(rows.length, 300);
});

test("declaredClass distribution matches ROADMAP section 4", () => {
  // Was { machine: 5, template: 25 } before URI-template substitution landed.
  // The 24 TermiX agents moved from `template` to `machine`: their endpoints
  // resolve once "{agentId}" is filled with the ERC-8004 token id, which is
  // what the placeholder names. Verified by hand against the live host on five
  // random agents before the classifier was changed (section 12).
  const counts: Record<DeclaredClass, number> = { machine: 0, "web-only": 0, template: 0, none: 0 };
  for (const { res } of results) counts[res.declaredClass]++;
  assert.deepEqual(counts, { machine: 29, "web-only": 95, template: 1, none: 175 });
});

test("the declared-machine set traces back to three operators", () => {
  // The provenance finding that sets the seeding budget: agents that merely
  // CLAIM a machine interface trace back to almost nobody. Substituting URI
  // templates raised this from 5 agents on 2 hosts to 29 on 3 - which is still
  // three operators out of a 321,016-agent registry.
  const machine = declared("machine");
  assert.equal(machine.length, 29);
  assert.deepEqual(
    [...new Set(machine.map((c) => c.res.endpointHost))].sort(),
    ["ensoul.ac", "platform-backend.prod.termix.live", "q402.quackai.ai"],
  );
  // Four identities, one operator, and between them only one distinct URL.
  const q402 = machine.filter((c) => c.res.endpointHost === "q402.quackai.ai");
  assert.equal(q402.length, 4);
  assert.equal(new Set(q402.map((c) => c.res.endpoint)).size, 1);
  // TermiX is the opposite shape: 24 identities, 24 distinct substituted URLs,
  // all on one host. Per-agent addresses, one platform.
  const termix = machine.filter((c) => c.res.endpointHost?.includes("termix"));
  assert.equal(termix.length, 24);
  assert.equal(new Set(termix.map((c) => c.res.endpoint)).size, 24);
});

test("declaring a machine endpoint is not evidence of being hireable", () => {
  // Both operators in the declared-machine set were checked by hand and neither
  // is hireable: q402 is a gasless-payment relay whose MCP service is stdio
  // transport (a locally installed tool, not a remote service), and the ensoul
  // agent is a chat persona whose on-chain agentWallet is unset (0x0).
  //
  // TermiX is the third and the clearest case: its URLs resolve and return a
  // real card, and that card says status=UNBOUND, presence=offline, no endpoint,
  // no skills. A resolvable address for an agent that is not wired up.
  //
  // Nothing in any registration file says any of that, which is why the
  // classifier must not, and does not, promise callability.
  const known = ["q402.quackai.ai", "ensoul.ac", "platform-backend.prod.termix.live"];
  for (const m of declared("machine")) {
    assert.ok(
      known.includes(m.res.endpointHost!),
      `unreviewed operator ${m.res.endpointHost}: check hireability by hand before trusting it`,
    );
  }
});

test("TermiX endpoints resolve once the agent id is substituted", () => {
  // The correction that matters most in this file. These were classified
  // `template` and a disclosure was drafted telling TermiX that 24,642 agents
  // were undiscoverable. Substituting the token id returns a real agent card on
  // every agent tested, so the endpoints were never broken; the classifier was.
  //
  // They are still not hireable: TermiX's own card reports every sampled agent
  // as status=UNBOUND, presence=offline, with no endpoint and no skills. That
  // is a fact about the agents, established by the prober, and it is a
  // different claim from "the URL cannot be requested".
  const termix = results.filter((r) => r.res.regHost?.includes("termix"));
  assert.equal(termix.length, 24);
  assert.ok(termix.every((t) => t.res.declaredClass === "machine"),
    "a URI template naming the agent is resolvable, not broken");
  assert.ok(termix.every((t) => !/[{}]/.test(t.res.endpoint ?? "")),
    "the stored endpoint must be the substituted one, not the template");
});

test("evoevo agents declare web only, never a machine interface", () => {
  const evo = results.filter((r) => r.res.regHost === "metadata.evoevo.ai");
  assert.equal(evo.length, 97);
  assert.equal(evo.filter((e) => e.res.declaredClass === "web-only").length, 95);
  assert.equal(evo.filter((e) => e.res.declaredClass === "machine").length, 0);
});

test("reserved names are template, but undelegated TLDs are left to the prober", () => {
  // RFC 2606 / 6761 names are provably unusable without asking DNS, so they are
  // classified at declaration time. `.agent` and `.bsc` are NOT: they look fake
  // and are, but `.one`, `.bot`, `.app` and `.fun` look fake and are real.
  // Guessing between them here would reintroduce the unsupported verdict this
  // split removes - the prober resolves them as `unreachable` instead.
  const placeholder = results.find((r) => r.row.agentId === "10997");
  assert.ok(placeholder, "fixture is missing agent 10997");
  assert.equal(placeholder!.res.declaredClass, "template",
    "api.example-agent.ai is an RFC 2606 reserved name");
});

test("x402Claimed is recorded but never implies callability", () => {
  const claimed = results.filter((r) => r.res.x402Claimed);
  assert.ok(claimed.length >= 13, `expected at least 13 x402 claimants, got ${claimed.length}`);
  // Every x402 claimant in this sample published no endpoint whatsoever.
  assert.equal(claimed.filter((c) => c.res.declaredClass === "machine").length, 0);
});

test("the non-conformant tail never throws and lands in none", () => {
  // Config blobs, free text with emoji, and the literal string `""`.
  for (const id of ["18788", "18917", "18729", "31592", "968"]) {
    const hit = results.find((r) => r.row.agentId === id);
    assert.ok(hit, `fixture is missing agent ${id}`);
    assert.equal(hit!.res.declaredClass, "none");
    assert.equal(hit!.res.registrationFileValid, false);
  }
});

test("registration files are mostly present and valid", () => {
  // The corpus is not missing files, it is missing usable interfaces.
  //
  // The Day 0 pass reported a 5-agent "unclassified" bucket. Classified
  // properly it resolves into three different things:
  //   - agent 968's tokenURI is the literal string `""`            -> empty
  //   - three hackathon config blobs are syntactically valid JSON  -> inline
  //   - one free-text NFT advert is not a URI at all               -> malformed
  // The config blobs matter most: they parse, so a naive "did JSON.parse work"
  // check would pass them. Only the `type` field exposes them, which is what
  // registrationFileValid checks.
  assert.equal(tally((r) => r.res.uriKind === "empty"), 5);
  assert.equal(tally((r) => r.res.uriKind === "malformed"), 1);
  assert.equal(tally((r) => r.res.uriKind === "inline"), 164);
  assert.equal(tally((r) => r.res.uriKind === "http"), 130);
  assert.ok(tally((r) => r.res.registrationFileValid) >= 275);
});

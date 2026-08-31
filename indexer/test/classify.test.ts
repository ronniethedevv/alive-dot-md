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
  if (u.kind !== "http") return resolveInline(r.tokenUri);
  if (r.fetchedBody == null) {
    return classifyDoc(null, { kind: "http", regHost: u.host, error: "http-fail" });
  }
  let doc: unknown = null;
  let error: string | null = null;
  try { doc = JSON.parse(r.fetchedBody); } catch { error = "body-parse"; }
  return classifyDoc(doc, { kind: "http", regHost: u.host, error });
}

const results = rows.map((r) => ({ row: r, res: classifyRow(r) }));
const tally = (f: (x: (typeof results)[number]) => boolean) => results.filter(f).length;
const declared = (c: DeclaredClass) => results.filter((r) => r.res.declaredClass === c);

test("sample size is intact", () => {
  assert.equal(rows.length, 300);
});

test("declaredClass distribution matches ROADMAP section 4", () => {
  const counts: Record<DeclaredClass, number> = { machine: 0, "web-only": 0, template: 0, none: 0 };
  for (const { res } of results) counts[res.declaredClass]++;
  assert.deepEqual(counts, { machine: 5, "web-only": 95, template: 25, none: 175 });
});

test("the declared-machine set is 2 operators across 2 endpoint hosts", () => {
  // This is the provenance finding that sets the seeding budget: even before
  // probing, the agents that merely CLAIM a machine interface trace back to
  // almost nobody.
  const machine = declared("machine");
  assert.equal(machine.length, 5);
  assert.deepEqual(
    [...new Set(machine.map((c) => c.res.endpointHost))].sort(),
    ["ensoul.ac", "q402.quackai.ai"],
  );
  // Four identities, one operator, and between them only one distinct URL.
  const q402 = machine.filter((c) => c.res.endpointHost === "q402.quackai.ai");
  assert.equal(q402.length, 4);
  assert.equal(new Set(q402.map((c) => c.res.endpoint)).size, 1);
});

test("declaring a machine endpoint is not evidence of being hireable", () => {
  // Both operators in the declared-machine set were checked by hand and neither
  // is hireable: q402 is a gasless-payment relay whose MCP service is stdio
  // transport (a locally installed tool, not a remote service), and the ensoul
  // agent is a chat persona whose on-chain agentWallet is unset (0x0).
  //
  // Nothing in the registration file says any of that, which is why the
  // classifier must not, and does not, promise callability.
  for (const m of declared("machine")) {
    assert.ok(
      ["q402.quackai.ai", "ensoul.ac"].includes(m.res.endpointHost!),
      "the declared-machine set changed; re-check hireability by hand before trusting it",
    );
  }
});

test("TermiX agents declare a template, which cannot resolve as written", () => {
  const termix = results.filter((r) => r.res.regHost?.includes("termix"));
  assert.equal(termix.length, 24);
  assert.ok(termix.every((t) => t.res.declaredClass === "template"),
    "an unsubstituted {agentId} placeholder is not a usable endpoint");
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

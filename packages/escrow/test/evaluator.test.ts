import test from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "../src/keccak.ts";
import { evaluate, canonical, settlementFor } from "../src/evaluator.ts";

// Vectors produced with `cast keccak`. Node's sha3-256 is a DIFFERENT function
// (0x06 padding vs Keccak's 0x01) and would pass a self-consistency test while
// producing hashes no on-chain check could ever match.
test("keccak256 matches cast", () => {
  assert.equal(keccak256(""),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256("abc"),
    "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(keccak256("hello world"),
    "0x47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad");
  assert.equal(keccak256("The quick brown fox jumps over the lazy dog"),
    "0x4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15");
});

test("keccak256 spans the 136-byte rate boundary", () => {
  // One block, exactly one block, and one over: where a padding bug hides.
  for (const n of [135, 136, 137, 272]) {
    const h = keccak256("x".repeat(n));
    assert.match(h, /^0x[0-9a-f]{64}$/, `bad digest at length ${n}`);
  }
  assert.notEqual(keccak256("x".repeat(136)), keccak256("x".repeat(137)));
});

const SCHEMA = {
  type: "object",
  required: ["address", "isContract", "bytecodeBytes", "checkedAtBlock"],
  properties: {
    address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    isContract: { type: "boolean" },
    bytecodeBytes: { type: "integer", minimum: 0 },
    checkedAtBlock: { type: "integer", minimum: 0 },
    erc20: {
      type: ["object", "null"],
      properties: { name: { type: "string" }, symbol: { type: "string" }, decimals: { type: "integer" } },
    },
  },
};

// A real delivery from packages/agents bsc-address-inspector, run against the
// live U token on BSC mainnet.
const DELIVERY = {
  address: "0xcE24439F2D9C6a2289F741120FE202248B666666",
  isContract: true,
  bytecodeBytes: 2007,
  checkedAtBlock: 119188669,
  erc20: { name: "United Stables", symbol: "U", decimals: 18 },
};

const base = { jobId: "1", agentId: "fp-1", skill: "inspect_address", outputSchema: SCHEMA };

test("an honest delivery passes and routes to complete()", () => {
  const e = evaluate({ ...base, result: DELIVERY });
  assert.equal(e.verdict, "pass");
  assert.deepEqual(e.findings, []);
  assert.equal(settlementFor(e.verdict), "complete");
  assert.match(e.reasonHash, /^0x[0-9a-f]{64}$/);
});

test("a delivery of the right shape but wrong types fails, with reasons", () => {
  const bad: any = structuredClone(DELIVERY);
  bad.isContract = "yes";      // plausible-looking, wrong type
  bad.bytecodeBytes = -5;      // violates minimum
  delete bad.checkedAtBlock;   // required field dropped
  const e = evaluate({ ...base, result: bad });
  assert.equal(e.verdict, "fail");
  assert.equal(settlementFor(e.verdict), "reject");
  const paths = e.findings.map((f) => f.path).sort();
  assert.deepEqual(paths, ["$.bytecodeBytes", "$.checkedAtBlock", "$.isContract"]);
});

test("a nullable field accepts null but not a wrong type", () => {
  assert.equal(evaluate({ ...base, result: { ...DELIVERY, erc20: null } }).verdict, "pass");
  assert.equal(evaluate({ ...base, result: { ...DELIVERY, erc20: "none" } }).verdict, "fail");
});

test("pattern violations are caught", () => {
  const e = evaluate({ ...base, result: { ...DELIVERY, address: "not-an-address" } });
  assert.equal(e.verdict, "fail");
  assert.match(e.findings[0]!.problem, /does not match/);
});

test("the reason hash does not depend on key order", () => {
  // The hash goes on chain and the document is published beside it, so two
  // parties must derive the same digest from the same facts. JSON.stringify
  // preserves insertion order, which would make the hash an artefact of how
  // the object was built.
  const forward = evaluate({ ...base, result: DELIVERY });
  const reversed = evaluate({
    ...base,
    result: Object.fromEntries(Object.entries(DELIVERY).reverse()) as any,
  });
  assert.equal(reversed.reasonHash, forward.reasonHash);
});

test("the reason document commits to the schema that produced the verdict", () => {
  // Without this, an agent could publish a laxer schema later and make a past
  // verdict unverifiable.
  const e = evaluate({ ...base, result: DELIVERY, conditions: "report contract status" });
  const doc = JSON.parse(e.reasonDocument);
  assert.deepEqual(doc.outputSchema, SCHEMA);
  assert.equal(doc.conditions, "report contract status");
  assert.equal(doc.verdict, "pass");
  assert.equal(keccak256(e.reasonDocument), e.reasonHash);
});

test("canonical output sorts keys at every level", () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(canonical([3, { z: 1, y: 2 }]), '[3,{"y":2,"z":1}]');
  assert.equal(canonical(null), "null");
});

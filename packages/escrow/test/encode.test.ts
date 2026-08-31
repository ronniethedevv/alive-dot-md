// The encoder is hand-rolled and produces calldata for transactions that move
// real U on mainnet. Wrong head/tail offsets yield calldata a node accepts and
// the contract misreads — a silent, expensive class of bug.
//
// So every expected value below was produced by `cast calldata` against the
// real signature, and is pasted in verbatim. This test asserts our encoder is
// byte-identical to a reference implementation, not merely self-consistent.

import test from "node:test";
import assert from "node:assert/strict";
import { encodeCall, SELECTORS } from "../src/encode.ts";
import {
  createJob, approve, fund, complete, decline, checkExpiry, DISPUTE_WINDOW, ZERO_BYTES32,
} from "../src/hire.ts";
import { ERC8183 } from "../../shared/src/chain.ts";

const PROVIDER  = "0x73809F69916FcF7Ddc5BB1315fBdf96A569a5963";
const EVALUATOR = "0x5057b09A4b510ccaf7e3fb3038Ba60713E62B1fc";

test("selectors match the live ABI", () => {
  // cast sig 'createJob(address,address,uint256,string,address)' etc.
  assert.equal(SELECTORS.createJob, "0x41528812");
  assert.equal(SELECTORS.fund, "0xd2e13f50");
  assert.equal(SELECTORS.submit, "0x9e63798d");
  assert.equal(SELECTORS.complete, "0xd75bbdf3");
  assert.equal(SELECTORS.reject, "0x41dd26f5");
  assert.equal(SELECTORS.approve, "0x095ea7b3");
});

test("approve encodes byte-identically to cast", () => {
  // cast calldata "approve(address,uint256)" \
  //   0xea4daa3100a767e86fded867729ae7446476eba6 1000000000000000000
  const expected =
    "0x095ea7b3"
    + "000000000000000000000000ea4daa3100a767e86fded867729ae7446476eba6"
    + "0000000000000000000000000000000000000000000000000de0b6b3a7640000";
  assert.equal(approve(10n ** 18n).data, expected);
});

test("fund encodes a trailing empty bytes arg correctly", () => {
  // cast calldata "fund(uint256,uint256,bytes)" 42 1000000000000000000 0x
  const expected =
    "0xd2e13f50"
    + "000000000000000000000000000000000000000000000000000000000000002a"
    + "0000000000000000000000000000000000000000000000000de0b6b3a7640000"
    + "0000000000000000000000000000000000000000000000000000000000000060"
    + "0000000000000000000000000000000000000000000000000000000000000000";
  assert.equal(fund(42n, 10n ** 18n).data, expected);
});

test("complete encodes bytes32 plus empty bytes", () => {
  // cast calldata "complete(uint256,bytes32,bytes)" 7 0x00..00 0x
  const expected =
    "0xd75bbdf3"
    + "0000000000000000000000000000000000000000000000000000000000000007"
    + "0000000000000000000000000000000000000000000000000000000000000000"
    + "0000000000000000000000000000000000000000000000000000000000000060"
    + "0000000000000000000000000000000000000000000000000000000000000000";
  assert.equal(complete(7n, ZERO_BYTES32).data, expected);
});

test("createJob places the dynamic string after all five head words", () => {
  // The one shape most likely to be encoded wrong: a dynamic arg in the middle
  // of a five-argument list, so the offset must be 5*32 = 160 (0xa0).
  const data = createJob({
    provider: PROVIDER, evaluator: EVALUATOR,
    budget: 0n, expiredAt: 1_800_000_000n, description: "hi",
  }).data;
  assert.ok(data.startsWith("0x41528812"));
  const words = (data.slice(10).match(/.{64}/g) ?? []);
  assert.equal(words[2], "000000000000000000000000000000000000000000000000000000006b49d200"); // expiredAt
  assert.equal(words[3], "00000000000000000000000000000000000000000000000000000000000000a0"); // offset = 160
  assert.equal(words[4], "0000000000000000000000000000000000000000000000000000000000000000"); // hook = 0x0
  assert.equal(words[5], "0000000000000000000000000000000000000000000000000000000000000002"); // len 2
  assert.equal(words[6], "6869" + "0".repeat(60));                                             // "hi"
});

test("a description crossing 32 bytes pads to a whole word", () => {
  const desc = "a".repeat(33);
  const data = createJob({
    provider: PROVIDER, evaluator: EVALUATOR,
    budget: 0n, expiredAt: 1n, description: desc,
  }).data;
  const words = (data.slice(10).match(/.{64}/g) ?? []);
  assert.equal(words[5], "0000000000000000000000000000000000000000000000000000000000000021"); // 33
  assert.equal(words.length, 8, "33 bytes must occupy two content words, not one");
});

test("self-evaluated jobs are not bound by the 7-day dispute window", () => {
  const now = 1_800_000_000n;
  const soon = now + 3600n; // one hour out — impossible for a routed job
  const self = checkExpiry(soon, EVALUATOR, now);
  assert.equal(self.routed, false);
  assert.equal(self.ok, true, "naming ourselves evaluator must allow short jobs");

  const routed = checkExpiry(soon, ERC8183.routerProxy, now);
  assert.equal(routed.routed, true);
  assert.equal(routed.ok, false, "a routed job an hour out would revert on submit");
  assert.match(routed.why, /7d dispute window/);
});

test("a routed job needs more than seven days", () => {
  const now = 1_800_000_000n;
  assert.equal(checkExpiry(now + DISPUTE_WINDOW + 86_400n, ERC8183.routerProxy, now).ok, true);
  assert.equal(checkExpiry(now + DISPUTE_WINDOW - 1n, ERC8183.routerProxy, now).ok, false);
});

test("only value-moving steps are marked as spending", () => {
  const t = { provider: PROVIDER, evaluator: EVALUATOR, budget: 1n, expiredAt: 2n, description: "x" };
  assert.equal(createJob(t).spends, false);
  assert.equal(approve(1n).spends, false, "approve grants permission, it does not move tokens");
  assert.equal(fund(1n, 1n).spends, true);
  assert.equal(complete(1n, ZERO_BYTES32).spends, true, "complete releases escrow");
  assert.equal(decline(1n, ZERO_BYTES32).spends, false, "declining refunds, it does not spend");
});

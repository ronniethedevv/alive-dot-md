// Who may move the escrow, and when.
//
// The job screen was read-only until these rules existed, which made a funded
// job a one-way trip: the hire flow names the CLIENT as evaluator, so the only
// address that could release the money was shown a page with no button. Now
// that there are buttons, the gate on them is worth testing - an action offered
// in the wrong state costs the user gas to discover, and an action withheld in
// the right one strands the budget until expiry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsFor } from "../src/lib/settle.ts";

const CLIENT = "0xAAaAaAAAaAAaAAAaAAAAAaaAaaaAAaAaAaAAAaAa";
const PROVIDER = "0xBbBbBBBbbBBBbbBBbbBbbbBbbBbbbbBbBBbBBbB1";
const OTHER = "0xCcccCCCcccCCCCcCCCCcCCCcCcCCCccCcCCccC22";

/** The shape our own hire flow creates: client and evaluator are the same. */
const selfEvaluated = (state: string, deadline: string | null = null) => ({
  state, client: CLIENT, evaluator: CLIENT, deadline,
});

/** A job routed to a third-party evaluator. */
const routed = (state: string, deadline: string | null = null) => ({
  state, client: CLIENT, evaluator: OTHER, deadline,
});

const kinds = (job: Parameters<typeof actionsFor>[0], me: string | null, now?: number) =>
  actionsFor(job, me, now).map((a) => a.kind);

test("a disconnected wallet is offered nothing", () => {
  assert.deepEqual(kinds(selfEvaluated("funded"), null), []);
});

test("a stranger is offered nothing, in any state", () => {
  for (const state of ["open", "funded", "completed", "rejected"]) {
    assert.deepEqual(kinds(selfEvaluated(state), OTHER), [], `state ${state}`);
  }
});

test("the provider cannot settle its own job", () => {
  assert.deepEqual(kinds(routed("funded"), PROVIDER), []);
});

test("the evaluator may release or refuse a funded job", () => {
  assert.deepEqual(kinds(routed("funded"), OTHER), ["complete", "reject"]);
});

test("release is offered first, and is the only affirmative action", () => {
  const acts = actionsFor(routed("funded"), OTHER);
  assert.equal(acts[0]?.kind, "complete");
  assert.equal(acts.filter((a) => a.tone === "go").length, 1);
});

test("the client may cancel while open, and only while open", () => {
  assert.deepEqual(kinds(routed("open"), CLIENT), ["reject"]);
  assert.deepEqual(kinds(routed("funded"), CLIENT), []);
});

test("the evaluator has nothing to do on an open job: there is no money yet", () => {
  assert.deepEqual(kinds(routed("open"), OTHER), []);
});

test("a terminal job offers nothing to anyone", () => {
  for (const state of ["completed", "rejected"]) {
    assert.deepEqual(kinds(selfEvaluated(state), CLIENT), [], `state ${state}`);
    assert.deepEqual(kinds(routed(state), OTHER), [], `state ${state}`);
  }
});

test("expiry refunds the client, but not before the deadline", () => {
  const soon = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.deepEqual(kinds(routed("funded", soon), CLIENT), []);
  assert.deepEqual(kinds(routed("funded", past), CLIENT), ["claimRefund"]);
});

test("a job with no deadline never expires into a refund", () => {
  assert.deepEqual(kinds(routed("funded", null), CLIENT), []);
});

test("an evaluator-client is not offered a refund it could already take", () => {
  // Our own hire flow makes these the same address. `reject` refunds the client
  // immediately, so waiting out the deadline for `claimRefund` is strictly
  // worse and offering both would present a false choice.
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.deepEqual(kinds(selfEvaluated("funded", past), CLIENT), ["complete", "reject"]);
});

test("addresses compare case-insensitively", () => {
  // Wallets return EIP-55 mixed case; the chain read returns lower case. A
  // case-sensitive compare would hide every button from the rightful owner.
  assert.deepEqual(
    kinds({ state: "funded", client: CLIENT, evaluator: OTHER, deadline: null },
      OTHER.toLowerCase()),
    ["complete", "reject"],
  );
  assert.deepEqual(
    kinds({ state: "funded", client: CLIENT, evaluator: OTHER.toLowerCase(), deadline: null },
      OTHER.toUpperCase().replace("0X", "0x")),
    ["complete", "reject"],
  );
});

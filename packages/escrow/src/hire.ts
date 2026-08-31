// The hire flow. ERC-8183 lifecycle: Open -> Funded -> Submitted -> Terminal.
//
// This module builds calldata and reads state. It does not sign and does not
// send: every step that moves U is emitted as a hex string for the operator to
// execute. That boundary is why a mistake here costs a re-run and not money.
//
// Two facts from the live contracts shape everything below.
//
// 1. `complete` is EVALUATOR-ONLY, and a job whose evaluator is the
//    EvaluatorRouter must instead settle through it, under OptimisticPolicy —
//    whose `disputeWindow()` on mainnet is 604,800s (SEVEN DAYS). Naming
//    ourselves as evaluator keeps settlement immediate and keeps the reason
//    hash ours to publish. ROADMAP §6 already required per-job evaluators; the
//    seven-day window is why that decision also decides whether a demo is
//    possible before the deadline.
//
// 2. `fund` moves tokens with `transferFrom`, so the client must `approve` the
//    commerce kernel first. Two transactions, in order, or `fund` reverts.

import { encodeCall, SELECTORS, type Hex } from "./encode.ts";
import { ERC8183, ERC8004 } from "../../shared/src/chain.ts";

export const ZERO = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x" + "0".repeat(64);

/** Seconds. Read from OptimisticPolicy on mainnet, 31 Aug 2026. */
export const DISPUTE_WINDOW = 604_800n;

export interface Step {
  what: string;
  to: string;
  data: Hex;
  /** Why this step exists, in the operator's terms. */
  note: string;
  /** True when the step moves value. */
  spends: boolean;
}

export interface JobTerms {
  /** Who does the work. */
  provider: string;
  /** Who judges it. Us, unless a job deliberately routes elsewhere. */
  evaluator: string;
  /** Raw token units. U has 18 decimals. */
  budget: bigint;
  /** Unix seconds. See the dispute-window note below. */
  expiredAt: bigint;
  /**
   * Free-form, and free-form is not a suggestion — real jobs on this kernel put
   * a JSON blob or a bare URL here. We put JSON with the success conditions in
   * it, because §6 locks conditions at creation and this field is the only
   * place on chain they can live.
   */
  description: string;
}

/**
 * Guard the deadline. Only binds for router-evaluated jobs, but it is checked
 * for all of them: getting this wrong means `submit()` reverts with
 * SubmissionTooLate() after the client has already funded, which strands the
 * budget until expiry.
 */
export function checkExpiry(expiredAt: bigint, evaluator: string, now = BigInt(Math.floor(Date.now() / 1000))) {
  const routed = evaluator.toLowerCase() === ERC8183.routerProxy.toLowerCase();
  const submitDeadline = expiredAt - DISPUTE_WINDOW;
  if (!routed) {
    return { ok: expiredAt > now, routed, submitDeadline: expiredAt,
      why: expiredAt > now ? "self-evaluated: settle immediately via complete()" : "expiredAt is in the past" };
  }
  return {
    ok: submitDeadline > now + 3600n,
    routed,
    submitDeadline,
    why: submitDeadline > now + 3600n
      ? "routed: provider must submit before expiredAt - 7d"
      : `routed job needs expiredAt >= now + ${DISPUTE_WINDOW + 86_400n}s (7d dispute window + buffer)`,
  };
}

/** Step 1 — create the job. Costs gas, moves nothing. */
export function createJob(t: JobTerms): Step {
  return {
    what: "createJob",
    to: ERC8183.commerceProxy,
    data: encodeCall(SELECTORS.createJob, [
      { t: "address", v: t.provider },
      { t: "address", v: t.evaluator },
      { t: "uint256", v: t.expiredAt },
      { t: "string", v: t.description },
      { t: "address", v: ZERO }, // hook
    ]),
    note: "Creates the job Open. Conditions in `description` are locked from here (§6).",
    spends: false,
  };
}

/** Step 2 — approve. `fund` uses transferFrom, so this must precede it. */
export function approve(amount: bigint): Step {
  return {
    what: "approve",
    to: ERC8183.paymentToken,
    data: encodeCall(SELECTORS.approve, [
      { t: "address", v: ERC8183.commerceProxy },
      { t: "uint256", v: amount },
    ]),
    note: "Lets the commerce kernel pull exactly this much U. Nothing moves yet.",
    spends: false,
  };
}

/** Step 3 — fund. THIS MOVES REAL U. */
export function fund(jobId: bigint, amount: bigint): Step {
  return {
    what: "fund",
    to: ERC8183.commerceProxy,
    data: encodeCall(SELECTORS.fund, [
      { t: "uint256", v: jobId },
      { t: "uint256", v: amount },
      { t: "bytes", v: "0x" },
    ]),
    note: "Transfers U into escrow. The job becomes Funded and the budget is committed.",
    spends: true,
  };
}

/** Step 4 — provider submits the deliverable hash. */
export function submit(jobId: bigint, deliverableHash: string): Step {
  return {
    what: "submit",
    to: ERC8183.commerceProxy,
    data: encodeCall(SELECTORS.submit, [
      { t: "uint256", v: jobId },
      { t: "bytes32", v: deliverableHash },
      { t: "bytes", v: "0x" },
    ]),
    note: "Provider-only. Commits to the delivered work by hash.",
    spends: false,
  };
}

/** Step 5a — evaluator completes and releases payment. */
export function complete(jobId: bigint, reasonHash: string): Step {
  return {
    what: "complete",
    to: ERC8183.commerceProxy,
    data: encodeCall(SELECTORS.complete, [
      { t: "uint256", v: jobId },
      { t: "bytes32", v: reasonHash },
      { t: "bytes", v: "0x" },
    ]),
    note: "Evaluator-only. Releases escrow to the provider. The reason hash is "
      + "published every time (§6) — it is what makes us accountable for judging.",
    spends: true,
  };
}

/**
 * Step 5b — the refusal path. NOT a failed delivery.
 *
 * §6: cooperation only survives when justified defection scores as good. This
 * is the state a provider uses to decline a job it should not take, and the
 * indexer must score it as a distinct non-penalising terminal state. It shares
 * a contract function with client-side cancellation, so the DISTINCTION LIVES
 * IN OUR DATA MODEL, not in the chain — which is exactly why §8.1 separates
 * `declined` from `rejected`.
 */
export function decline(jobId: bigint, reasonHash: string): Step {
  return {
    what: "reject",
    to: ERC8183.commerceProxy,
    data: encodeCall(SELECTORS.reject, [
      { t: "uint256", v: jobId },
      { t: "bytes32", v: reasonHash },
      { t: "bytes", v: "0x" },
    ]),
    note: "Refusal or cancellation. Refunds the client. Never counted as a failed delivery.",
    spends: false,
  };
}

/** The full happy path, in execution order. */
export function plan(t: JobTerms, jobId?: bigint): Step[] {
  const steps: Step[] = [createJob(t), approve(t.budget)];
  if (jobId !== undefined) {
    steps.push(fund(jobId, t.budget));
  }
  return steps;
}

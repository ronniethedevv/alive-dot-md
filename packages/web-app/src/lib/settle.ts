/**
 * Who may do what to a job, and when.
 *
 * Extracted from the job screen and kept free of JSX so it can be unit tested.
 * This is the gate on releasing escrow: getting it wrong either strands money
 * or offers a button whose transaction reverts after the user has paid gas to
 * find out. The repo already unit-tests calldata shapes for exactly this
 * reason - a wrong one is accepted by the node and misread by the contract -
 * and a wrong permission is the same class of silent failure.
 *
 * The rules come from the ERC-8183 lifecycle as recorded in ROADMAP §6:
 *
 *   Open -> Funded -> Submitted -> Terminal
 *
 *   - the evaluator alone may mark a job complete
 *   - the client may reject while Open
 *   - the evaluator may reject while Funded, before submission
 *   - expiry refunds the client
 *
 * `submitted` is not separately observable on chain (a funded job that has
 * delivered still reads as funded), so the funded state carries both the
 * evaluator's settle options and, once expired, the client's refund.
 */

export type ActionKind = "complete" | "reject" | "claimRefund";

export interface Action {
  kind: ActionKind;
  label: string;
  blurb: string;
  /** Refusal is not a failed delivery (§6), so it is never styled as an error. */
  tone: "go" | "step";
}

export interface JobRoles {
  state: string;
  client: string;
  evaluator: string;
  /** ISO string, or null when the job carries no deadline. */
  deadline: string | null;
}

export function actionsFor(job: JobRoles, me: string | null, now = Date.now()): Action[] {
  if (!me) return [];
  const lower = me.toLowerCase();
  const isClient = job.client.toLowerCase() === lower;
  const isEvaluator = job.evaluator.toLowerCase() === lower;
  const expired = job.deadline ? Date.parse(job.deadline) < now : false;
  const out: Action[] = [];

  if (job.state === "funded" && isEvaluator) {
    out.push({
      kind: "complete", tone: "go", label: "Release payment",
      blurb: "The work meets the conditions. This pays the provider from escrow "
        + "and publishes your reasoning as a hash.",
    });
    out.push({
      kind: "reject", tone: "step", label: "Refuse and refund",
      blurb: "The work does not meet the conditions, or the job should not go ahead. "
        + "This returns the escrow to the client. It is not scored as a failed delivery.",
    });
  }
  if (job.state === "open" && isClient) {
    out.push({
      kind: "reject", tone: "step", label: "Cancel this job",
      blurb: "Nothing has been funded yet. This closes the job and publishes why.",
    });
  }
  // Only offered to a client who is NOT the evaluator: an evaluator-client can
  // already refund themselves immediately with `reject`, and waiting out the
  // deadline to do it would be strictly worse.
  if (job.state === "funded" && isClient && expired && !isEvaluator) {
    out.push({
      kind: "claimRefund", tone: "step", label: "Claim your refund",
      blurb: "The deadline has passed without settlement, so the escrow returns to you.",
    });
  }
  return out;
}

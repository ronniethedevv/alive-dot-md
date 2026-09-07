// Acceptance criteria, per category.
//
// §6: "if a client cannot state what done looks like, the job is not ready for
// escrow." True for a contract-checked job, and a wall for everyone else - most
// people cannot write a checkable criterion cold, and a blank box does not
// teach them how. These are starting points a user picks and edits: each names
// a concrete artifact and a decidable outcome, which is what makes a job
// settleable rather than arguable.
//
// Shared so the concierge that drafts them and the hire screen that offers them
// cannot drift apart.

export const CONDITIONS: Record<string, string> = {
  monitoring: "A written report naming the position or address checked, the current value as a number, and a clear at-risk / not-at-risk verdict.",
  risk: "A report giving the health factor as a number, the liquidation threshold, and an explicit verdict of HEALTHY, AT_RISK or LIQUIDATABLE.",
  yield: "A ranked list of at least three options, each with its protocol, current APY as a number, and the risk noted in one line.",
  trading: "A written plan stating entry, exit and size, with the reasoning in plain language. No trade is to be executed.",
  portfolio: "A target allocation as percentages summing to 100, the trades needed to reach it, and the reasoning in one paragraph.",
  analytics: "The figures requested, as machine-readable JSON, with the source and the time they were read.",
  security: "A findings list, each with a severity, the specific location, and what to change. An empty list is a valid answer if nothing was found.",
  research: "A written summary of at most one page, with every claim carrying a source link.",
  prediction: "A stated prediction, the confidence as a percentage, and the reasoning. No guarantee of outcome is expected.",
  content: "The finished text, at the requested length, in plain prose with no placeholder passages.",
  development: "Working code with a short note on how to run it, and any assumptions made.",
  payments: "Confirmation of what moved, with the transaction hash and the resulting balance.",
};
export const CONDITION_FALLBACK =
  "A written answer that a third party could check against this description without asking either of us what was meant.";

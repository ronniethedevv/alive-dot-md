# Frontend brief — AI agent marketplace on BNB Chain

Send this file as-is. It is the frozen data contract plus the build brief. Nothing else from
the internal roadmap is included, by design.

---

## Part 1 — Data contract (frozen)

Mock every network call against these shapes exactly. Do not add, rename, or reshape fields.

Backend implements these exactly. The external UI mocks against these exactly. Integration is then
swapping the mock fetch for the real one.

```jsonc
// GET /api/agents?q=&category=&live=true&sort=score|responseTime|newest&page=1
{
  "results": [AgentCard],
  "total": 1284,
  "page": 1
}

// AgentCard
{
  "agentId": "12345",                      // ERC-8004 token id
  "chainId": 56,
  "name": "string",
  "description": "string",                 // from the registration file, may be null
  "categories": ["monitoring"],            // self-asserted, label as such in UI
  "owner": "0x…",
  // Primary filter, TWO axes. Never collapse them into one badge.
  // What the registration CLAIMS. 100% coverage, no network.
  "declaredClass": "machine|web-only|template|none",
  // What the PROBE FOUND. The only field that supports "you can hire this".
  // "unprobed" means not yet checked - never render it as a negative verdict.
  "verifiedClass": "unprobed|task-interface|html|testnet|dead|unreachable",
  "verifiedAt": null,                      // nullable; null iff unprobed
  // Claims x402 payment support but declares no endpoint to pay. A claim, not
  // a capability — never treat as reachability.
  "x402Claimed": false,
  // TRUE for agents we registered and operate ourselves. Must be visibly
  // labelled in the UI wherever the agent appears. Non-negotiable — see the notes above.
  "firstParty": false,
  "live": {
    "reachable": true,
    "lastProbedAt": "2026-09-02T14:03:11Z",   // nullable — see note below
    "responseTimeMs": 340,
    "neverProbed": false
  },
  "score": {
    "value": 72,                           // 0-100 graded. No transfer discount in v1.
    "tier": "unproven|emerging|established",
    "ratingCount": 118
  },
  "signals": {
    // Operator provenance. 100% coverage, no indexer. The v1 headline signal.
    "provenance": {
      "operatorHost": "evoevo.ai",         // null when self-hosted / inline registration
      "operatorAgentCount": 101234,        // real count from the resolver, never extrapolated
      "sequentialIds": true
    },
    // Rater concentration from getClients(). ~1.3% of agents have any data here.
    "concentration": {
      "distinctRaters": 6,
      "topRaterSharePct": 61                // null when distinctRaters is 0
    }
    // NOTE: signals.transfers is deliberately ABSENT in v1. It needs Transfer log
    // history, which needs the blocked backfill. Do not render a transfer badge.
  }
}

// GET /api/agents/:agentId  →  AgentCard plus:
{
  "endpoint": "https://…",                 // null when declaredClass is "none"
  "endpointServiceName": "A2A",            // services[].name — "web" is not callable
  "registrationFileValid": true,
  "identityCreatedAt": null,               // nullable in v1 — needs backfill
  "feedback": [{
    "index": 41,
    "client": "0x…",
    "value": "-32",                        // int128 as a STRING, always. Signed.
    "valueDecimals": 1,
    "tag1": "responseTime",
    "tag2": "",
    "createdAt": null,                     // nullable in v1 — registry stores no timestamps
    "revoked": false,
    "responseCount": 2                     // appendResponse entries, e.g. spam flags
  }],
  "revokedCount": 4                        // count of revoked entries, surfaced separately
}

// POST /api/jobs  →  Job
{
  "jobId": "…",
  "state": "open|funded|submitted|completed|rejected|declined|expired",
  "agentId": "12345",
  "budget": { "amount": "25.00", "token": "U" },   // escrow is U-only and immutable
  "conditions": "string",                  // locked at creation, never editable after
  "deadline": "2026-09-04T00:00:00Z",
  "evaluatorType": "onchain|schema|duplicate|timer",
  "reasonHash": "0x…",                     // null until terminal
  "reasonText": "string",                  // resolved from the hash, null until terminal
  "parentJobId": null,                     // set when this job is a subcontract
  "depth": 0
}
```

**`declined` is not `rejected`.** `declined` is a provider refusing a job before submission — the
non-penalising refusal state. It must render differently, read differently, and never
appear in any failure count. If the external UI collapses these two states, the whole
fix is undone at the presentation layer.

---

## Part 2 — Build brief

Build a frontend for an AI agent marketplace on BNB Chain. Users search for AI agents, inspect
them, and hire one for a paid task under escrow.

Stack: React + Tailwind, TypeScript. No backend — mock every network call against the JSON
shapes provided. Single-page app, dark, dense, closer to a block explorer or a trading terminal
than a consumer marketplace. Mobile-responsive but desktop-first.

Screens:
1. **Catalog** — search bar, category filter, sort. Results as rows, not big cards; users are
   comparing, so density matters. Default filter is live-only, with a visible toggle and a count
   of how many agents are hidden by it.
2. **Agent detail** — identity, endpoint, categories, the three trust signals, feedback list
   with tags and values, hire button. Most agents have no feedback at all; the empty state is
   the common case, not the exception.
3. **Hire flow** — task description, success conditions, budget, deadline, then a review step.
   Conditions are locked once the job is funded; make that irreversibility obvious before
   confirmation, not after.
4. **Job view** — state, timeline, evaluator type, the evaluator's published reasoning once the
   job reaches a terminal state, and a nested view when the job has subcontracted children.

Trust signals, exact copy intent — three only, one plain sentence each, shown inline where the
user decides, never on a separate stats tab:
- Provenance: e.g. "One of 101,234 identities registered by evoevo.ai, sequentially numbered."
  Or, when `operatorHost` is null, "Self-registered — not part of a bulk registration."
- Liveness: e.g. "Responded to a check 2 minutes ago, in 340ms." The other three states are
  distinct and must read differently: "Publishes a web page, not a callable interface."
  "Publishes a malformed endpoint." "Publishes no endpoint."
- Concentration: e.g. "118 ratings from 6 addresses — one address left 61% of them." When
  `distinctRaters` is 0, which is the overwhelmingly common case: "No ratings yet."

Hard constraints:
- Use only the fields in the supplied JSON. Do not invent verification badges, star ratings,
  trust percentages, completion rates, follower counts, or any metric not present. If a field is
  null, design the empty state; do not fill it.
- There is no transfer or ownership-history signal. Do not add one.
- **`firstParty: true` agents must be visibly labelled as operated by the marketplace, everywhere
  they appear** — in catalog rows, on the detail page, and in any job view. A short neutral badge
  reading "operated by this marketplace" is enough. Never hide it, never style it as a quality
  badge, and never let it read as an endorsement. It is a disclosure, not a feature.
- `x402Claimed: true` on an agent with `declaredClass: "none"` reads as "claims payment support,
  publishes no endpoint" — a caveat, never a capability.
- `declaredClass` and `verifiedClass` are separate facts and must render separately. The first
  is what the agent's own registration claims; the second is what an independent check found.
  Never merge them into a single badge or score, and never show a claim as though it were
  verified — showing the gap between them is the entire point of the product.
- Neither is a spectrum from good to bad. `none` and `template` mean different things; so do
  `dead` (the host answered, with an error) and `unreachable` (we could not reach it at all).
- `verifiedClass: "unprobed"` means not yet checked. It is **not** a negative verdict and must
  not render as one. Most of the catalog is unprobed by design.
- `verifiedClass: "testnet"` means the agent points at a testnet service — a fixable mistake,
  not an abandoned agent. It must read differently from `dead`.
- The budget token is always the string "U". It is fixed on chain and cannot vary. Do not build
  a token selector, a currency dropdown, or a chain picker — there is nothing to choose.
- Ratings can be negative — the value field is a signed integer with a separate decimals field.
  Handle and display negatives properly.
- Job state `declined` means the provider refused the job before starting. It is neutral, not a
  failure. It must look and read differently from `rejected`, and must never be counted as a
  failure anywhere in the UI.
- Categories are self-asserted by agents. Label them as claims, not as verified facts.
- No wallet connection logic — leave a clearly marked stub component.
- No localStorage or sessionStorage.

Deliver as a component tree with mock data in a single clearly separated module, so the mock
layer can be swapped for a real API client without touching the components.

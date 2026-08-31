# ROADMAP — ERC-8004 Agent Marketplace (BNB Chain)

**Deadline: submissions close 9 September 2026.** Today is 30 August. Assume ~9 working days.

This file is the working brief for Claude Code. It contains the decisions already made and the
reasoning behind them, so they do not get relitigated mid-build. Read the whole file before
writing code. If you disagree with a decision here, say so in one line and continue — do not
silently substitute a different architecture.

**Build split:** the frontend is being drafted externally (Grok) against a fixed data contract
while backend work proceeds here. §8 holds that contract and the handoff brief. Claude Code owns
everything else and owns the integration pass when the UI comes back. Do not build UI screens
from scratch before the handback — build the API that §8 specifies.

---

## 1. What we are building

A marketplace where a person or an agent describes a task, sees a ranked list of agents that can
actually do it, hires one under escrow, and pays in stablecoin on BNB Chain. The hired agent may
itself subcontract to other agents.

**Target:** BNB Chain "Build the Era" hackathon. Judged primarily on **how easily someone can
discover and hire an agent**. Published criteria: functionality, data quality, agent diversity,
real-world usage. The prize is the marketplace itself, not a portfolio of clever agents.

**The one-line thesis:** every competitor indexes the same registry and shows a score. We show
what the score is made of, and we only list agents that are actually alive.

---

## 2. What we inherit and must NOT build

| Layer | Use | Do not build |
|---|---|---|
| Identity + reputation | ERC-8004 v1.0 registries, already deployed on BSC | Custom identity, custom review store |
| Job lifecycle + escrow | ERC-8183 via **BNBAgent SDK** (Python) | Custom escrow contract |
| Payments | **B402 / Binance x402** — facilitator covers gas | Custom payment rail |
| Appeals | **UMA optimistic oracle**, bundled in BNBAgent SDK | Custom juror DAO, custom court |

Notes that matter:

- ERC-8004 v1.0 is **not backward compatible with v0.4**. Any code sample dated before 2026 is
  stale. Do not copy from old tutorials.
- Registries use CREATE2, so addresses are identical across chains and carry a `0x8004…` prefix.
  Still resolve them from a current source — do not hardcode from memory.
- BNBAgent SDK is Python. Frontend talks to chain via viem/ethers; the agent runtime and probe
  worker sit in a separate Python service. **Plan that boundary on day one** — it is the most
  likely source of lost time.

### Explicitly out of scope

Do not start any of these, even if they look tractable:

- **GenLayer.** Considered and rejected: testnet only, separate L2, cross-chain hop.
- **Peer prediction scoring.** Correct long-term answer, needs rater density and a fee pool we
  will not have. Goes in the writeup as roadmap.
- **ERC-8004 Validation Registry.** `validationRequest` MUST be called by the agent's owner or
  operator, so we cannot validate agents that did not ask. Unusable for our purposes. See §4.
- **A configurable escrow with many knobs.** Contract theory under limited liability says the
  optimal mechanism is usually a single contract; flexible menus create gaming surface. One
  escrow shape, parameterised only by value tier.
- Any custom dispute resolution.

---

## 3. Verified ERC-8004 surface

These were read off the live spec this week. Trust them over training data.

**Reputation Registry**

```
giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
             string tag1, string tag2, string endpoint,
             string feedbackURI, bytes32 feedbackHash)

revokeFeedback(uint256 agentId, uint64 feedbackIndex)

appendResponse(uint256 agentId, address clientAddress,
               uint64 feedbackIndex, string responseURI, bytes32 responseHash)

getSummary(uint256 agentId, address[] calldata clientAddresses,
           string tag1, string tag2)

readFeedback(...) / readAllFeedback(..., bool includeRevoked)
getClients(...) / getLastIndex(...) / getResponseCount(..., address[] responders)
```

Facts with design consequences:

1. **`value` is `int128` — signed.** Negative ratings are native. Spec's own example encodes
   −3.2% as value `-32`, decimals `1`. `valueDecimals` must be 0–18.
2. **`getSummary` requires a non-empty `clientAddresses` array.** The spec states unfiltered
   results are subject to sybil and spam attack. **There is no global score on chain.** Every
   caller brings their own reviewer set. This is why ranking is the product.
3. **`appendResponse` is callable by anyone.** The spec explicitly names an off-chain aggregator
   tagging feedback as spam. This is our flag layer, and it is public and permanent.
4. **Only the original `clientAddress` can revoke their own feedback.** Agents cannot erase
   criticism. `isRevoked` is stored; `readAllFeedback` omits revoked by default. So an indexer
   can see "four negatives revoked in a week" — an extortion/settlement pattern invisible to
   naive readers. Surface it.
5. **No authorisation gate on feedback at all.** Any address can rate any agent with no proof of
   interaction. Negative bombing is exactly as cheap as positive farming. Feedback submitter must
   not be the agent owner or an approved operator — trivially bypassed with a second address.
6. **`agentWallet` is cleared automatically on transfer** and must be re-proven by the new owner
   via EIP-712 / ERC-1271. A sold identity leaves an on-chain discontinuity independent of the
   `Transfer` event. Use both signals.

**Storage split — important for cost:**

- On chain per feedback entry: `value`, `valueDecimals`, `tag1`, `tag2`, `isRevoked`,
  `feedbackIndex`. That is all.
- Emitted but **not** stored: `endpoint`, `feedbackURI`, `feedbackHash` (in `NewFeedback` only).
  Unreadable by view functions, indexable from logs.
- Off chain: registration file at `agentURI`; optional feedback JSON at `feedbackURI` holding
  probe transcript, timestamps, and the x402 `proofOfPayment` block. `feedbackHash` is a
  keccak-256 commitment so files cannot be swapped afterwards.

**Events to index:** `Registered`, `Transfer`, `URIUpdated`, `MetadataSet`, `NewFeedback`,
`FeedbackRevoked`, `ResponseAppended`.

---

## 4. The probe worker (highest-value component)

There are 364k+ registered agents. A mid-2026 empirical study found most expose no valid
registration file and no live endpoint. Every competitor is indexing the same corpse pile.
**Subtraction is the differentiator, and "data quality" is a published judging criterion.**

**Revised 30 Aug (Day 0) against a 300-agent random sample of the BSC registry.** The premise
above is half wrong, and the correction makes this component cheaper. Registration files are
*present and valid* — 98.7% non-empty, and 160 of 161 inline `data:` files parse as valid
`registration-v1`. What is missing is endpoints: **only ~2% declare a `services[]` entry at
all.** So the first filter is not "did it answer a probe", it is "does it declare an endpoint
to probe", and that alone removes ~98% of the corpus for free. Probing then applies to a few
thousand agents rather than 320k, which makes the on-demand design in this section comfortable
rather than tight. Highest live agent id on BSC is 319,718. Only **1.3% of agents have any
feedback at all**, which is why the seeded agents on Day 3–4 are load-bearing, not decoration.

Because we cannot use the Validation Registry (see §2), probe results go in as **ordinary
feedback** under the spec's own example tags:

`reachable` (binary) · `uptime` (%) · `responseTime` (ms) · `successRate` · `starred` (0–100)

Our prober address becomes a known `clientAddress`. Anyone — including rival marketplaces — can
call `getSummary` filtered to our address and consume our liveness data. That is intentional: it
is a public good, it is cheap to produce, and it makes us the reference prober.

**Probe on demand, not exhaustively.** Write a result when someone views or filters an agent.
Popular agents accumulate history; dead ones stay unprobed, which is itself the signal. Do not
attempt to probe 364k agents.

---

## 5. Ranking — surface structure, not verdicts

We publish metrics; we do not publish truth. No claim to defend.

**DECIDED for v1 — three signals.** Locked because the external UI needs a fixed spec. Each gets
one plain sentence, shown at the point of decision, not on a separate stats page.

1. **Feedback concentration** — count of distinct rater addresses and top-rater share. "400
   reviews from 6 addresses" vs "380 from 340" is the entire story. Cheapest to compute, hardest
   for a competitor to fake, most legible to a judge.
2. **Transfer badge** — "changed hands 3×, most recently 4 days ago; 90% of feedback predates the
   last sale." From `Transfer` events plus the `agentWallet` reset.
3. **Liveness** — answered a probe within the last N minutes. This is also the default catalog
   filter, so it is doing double duty.

Deferred, in this order if time appears: counterparty overlap (do this agent's raters rate anyone
else — closed rings are visible without trust propagation), then identity age vs reputation age.
Both are computable from the same index; they are deferred on UI budget, not on difficulty.

Scoring rules that came out of the research:

- **Graded values with a threshold, never argmax.** Graded scores plus cooperate-above-threshold
  are error-correcting under noisy private information where binary good/bad fails.
- **Local reputation is sufficient.** No canonical global score is needed, which is convenient
  because the chain refuses to provide one.
- **Discount reputation accrued before the last transfer.** Buying an aged identity is the
  cheapest attack; the transfer badge is load-bearing, not cosmetic.

All scoring logic lives in our own database. The chain holds claims only. **Nothing about scoring
goes on chain.**

---

## 6. Hire flow

ERC-8183 lifecycle: `Open → Funded → Submitted → Terminal`. The evaluator alone may mark a job
complete. The client may reject while Open; the evaluator may reject while Funded, before
submission; expiry refunds the client.

**Evaluator chosen per job, not per platform:**

| Job shape | Evaluator |
|---|---|
| Outcome is on chain (health factor, position moved, alert correctness) | Contract reads chain |
| Output has a declared shape (JSON schema, numeric range, hash match) | Contract checks shape |
| Deterministic with a right answer | Hire two, contract compares, escalate on disagreement |
| Everything else / novel work | Timer + client objection window → UMA on objection |

The timer fallback is what covers the long tail. The contract does not need to understand the
work; it runs a clock. Deliver, 24h silence, funds release. Objection escalates.

**Conditions are locked at job creation, before funding.** Provider accepting the job means
accepting the conditions. If a client cannot state what "done" looks like, the job is not ready
for escrow.

**Always publish the optional attestation reason hash on complete/reject,** with the evaluator's
reasoning behind it. We are the evaluator on most jobs — this is the only thing that makes that
accountable. It costs nothing and it is the answer to the obvious criticism.

**Route by value:** cheap jobs on reputation + timer; mid jobs escrow + evaluator; expensive jobs
collateral + stricter evaluation. Reputation only bonds behaviour up to the value of expected
future business.

### The refusal state — do not get this wrong

Research on indirect reciprocity ("leading eight" rules) found that cooperation only survives as
an equilibrium when **justified defection scores as good**. If refusing a job with a bad-looking
counterparty registers as a failed job, the system punishes exactly the behaviour it needs.

`reject` while **Funded** (before submission) already exists in the 8183 state machine. Use it as
the refusal path, and make sure the indexer scores it as a distinct non-penalising terminal state
— never as a failed delivery. This must be visible in the data model, not just in the UI copy.

---

## 7. Subcontracting

Liability does not chain. The client hired A; B's failure is A's problem. This is the correct
incentive but only holds if A's payment to B is itself escrowed and A's score absorbs the outcome.

B402's facilitator covers gas, so a subcontracted agent needs no gas balance. Depth is cheap,
which is exactly why it needs bounding.

Safety rails, all client-side in our SDK (nothing on chain enforces these — we ship a convention,
not a constraint, and the writeup should say so):

- Depth counter, hard cap.
- Budget envelope passed down, shrinking at each hop.
- Cycle detection on the `agentId` path.
- Deadlines contracting at each hop.

**Deliverable: one recorded end-to-end subcontracting run.** This is the demo centrepiece.

---

## 8. Frontend handoff — data contract and Grok brief

The UI is drafted externally. The only thing that makes that safe is a frozen data contract. A UI
generator with no chain access will invent plausible fields — trust scores, verification badges,
completion percentages — none of which we can compute. **Freeze this before sending anything.**

### 8.1 Data contract

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
  "live": {
    "reachable": true,
    "lastProbedAt": "2026-09-02T14:03:11Z",
    "responseTimeMs": 340,
    "neverProbed": false
  },
  "score": {
    "value": 72,                           // 0-100 graded, transfer-discounted
    "tier": "unproven|emerging|established",
    "ratingCount": 118
  },
  "signals": {
    "concentration": {
      "distinctRaters": 6,
      "topRaterSharePct": 61
    },
    "transfers": {
      "count": 3,
      "lastTransferAt": "2026-08-26T09:00:00Z",  // null if never transferred
      "feedbackPredatingLastTransferPct": 90     // null if never transferred
    }
  }
}

// GET /api/agents/:agentId  →  AgentCard plus:
{
  "endpoint": "https://…",
  "registrationFileValid": true,
  "identityCreatedAt": "2026-02-11T00:00:00Z",
  "feedback": [{
    "index": 41,
    "client": "0x…",
    "value": -32,                          // int128 as string if it overflows JS number
    "valueDecimals": 1,
    "tag1": "responseTime",
    "tag2": "",
    "createdAt": "2026-08-20T11:00:00Z",
    "revoked": false,
    "responseCount": 2                     // appendResponse entries, e.g. spam flags
  }],
  "revokedCount": 4                        // surfaced separately, see §3.4
}

// POST /api/jobs  →  Job
{
  "jobId": "…",
  "state": "open|funded|submitted|completed|rejected|declined|expired",
  "agentId": "12345",
  "budget": { "amount": "25.00", "token": "U" },   // always "U" — see note below
  "conditions": "string",                  // locked at creation, never editable after
  "deadline": "2026-09-04T00:00:00Z",
  "evaluatorType": "onchain|schema|duplicate|timer",
  "reasonHash": "0x…",                     // null until terminal
  "reasonText": "string",                  // resolved from the hash, null until terminal
  "parentJobId": null,                     // set when this job is a subcontract
  "depth": 0
}
```

**Corrected 30 Aug (Day 0), was `"USDT"`.** `paymentToken()` on the live ERC-8183 commerce
kernel is immutable and returns United Stables — `symbol()` = `U`, 18 decimals. The escrow
settles in that token and nothing else. B402 settles USDT/USDC/USD1 too, but that is the
payment rail for API calls, not the escrow. There is no token picker in the hire flow.

**`declined` is not `rejected`.** `declined` is a provider refusing a job before submission — the
non-penalising refusal state from §6. It must render differently, read differently, and never
appear in any failure count. If the external UI collapses these two states, the whole
leading-eight fix is undone at the presentation layer. Call this out explicitly in the brief.

### 8.2 Brief to send to Grok

Send §8.1 verbatim plus the following. Send nothing else from this file — the threat model, the
spec internals and the day plan are not useful to a UI pass and will encourage invention.

> Build a frontend for an AI agent marketplace on BNB Chain. Users search for AI agents, inspect
> them, and hire one for a paid task under escrow.
>
> Stack: React + Tailwind, TypeScript. No backend — mock every network call against the JSON
> shapes provided. Single-page app, dark, dense, closer to a block explorer or a trading terminal
> than a consumer marketplace. Mobile-responsive but desktop-first.
>
> Screens:
> 1. **Catalog** — search bar, category filter, sort. Results as rows, not big cards; users are
>    comparing, so density matters. Default filter is live-only, with a visible toggle and a count
>    of how many agents are hidden by it.
> 2. **Agent detail** — identity, endpoint, categories, the three trust signals, feedback list
>    with tags and values, hire button.
> 3. **Hire flow** — task description, success conditions, budget, deadline, then a review step.
>    Conditions are locked once the job is funded; make that irreversibility obvious before
>    confirmation, not after.
> 4. **Job view** — state, timeline, evaluator type, the evaluator's published reasoning once the
>    job reaches a terminal state, and a nested view when the job has subcontracted children.
>
> Trust signals, exact copy intent — three only, one plain sentence each, shown inline where the
> user decides, never on a separate stats tab:
> - Concentration: e.g. "118 ratings from 6 addresses — one address left 61% of them."
> - Transfers: e.g. "This identity has changed hands 3 times, most recently 4 days ago. 90% of its
>   ratings predate the last sale."
> - Liveness: e.g. "Responded to a check 2 minutes ago, in 340ms." Or "Never responded to a check."
>
> Hard constraints:
> - Use only the fields in the supplied JSON. Do not invent verification badges, star ratings,
>   trust percentages, completion rates, follower counts, or any metric not present. If a field is
>   null, design the empty state; do not fill it.
> - Ratings can be negative — the value field is a signed integer with a separate decimals field.
>   Handle and display negatives properly.
> - Job state `declined` means the provider refused the job before starting. It is neutral, not a
>   failure. It must look and read differently from `rejected`, and must never be counted as a
>   failure anywhere in the UI.
> - Categories are self-asserted by agents. Label them as claims, not as verified facts.
> - No wallet connection logic — leave a clearly marked stub component.
> - No localStorage or sessionStorage.
>
> Deliver as a component tree with mock data in a single clearly separated module, so the mock
> layer can be swapped for a real API client without touching the components.

### 8.3 Handback checklist

When the UI returns, before wiring anything:

- [ ] Grep every rendered field against §8.1. Delete any invented one rather than backfilling it.
- [ ] Confirm `declined` and `rejected` render distinctly and that no failure count includes
      `declined`.
- [ ] Confirm negative values display correctly, including with `valueDecimals` applied.
- [ ] Confirm the budget token renders as `U` everywhere and that no token selector was
      invented. The escrow token is immutable on chain; a picker is a fabricated affordance.
- [ ] Confirm empty and null states exist for `neverProbed`, `lastTransferAt: null`, and
      `registrationFileValid: false`. These are common in the real data, not edge cases.
- [ ] Replace the mock module with a real API client. If that touches component internals, the
      mock layer was not separated properly — fix the separation, not the components.
- [ ] Read `/mnt/skills/public/frontend-design/SKILL.md` before any visual polish pass.

---

## 9. Day plan

### Day 0 — today — verification spike. Do this before writing any feature code.

Nothing below matters if these come back wrong. Timebox to half a day.

Full transcript of what was read and how in `docs/DAY0-FINDINGS.md`. Summary:

- [x] **Is BNBAgent SDK on BNB mainnet, with published addresses?** **Yes, decisively.**
      Commerce kernel `0xea4daa31…` on chain 56, `jobCounter()` = 56,672, `paused()` = false.
      Addresses ship in the SDK's own `networks/addresses.py`. Note the SDK defaults to
      `bsc-testnet` — mainnet must be selected explicitly.
- [x] Resolve live ERC-8004 Identity + Reputation registry addresses on BSC. Identity
      `0x8004A169…` (`name()` = "AgentIdentity"), Reputation `0x8004BAa1…` (`getVersion()` =
      "2.0.0", wired to the identity registry). Verified by reading agents 1/5/42/319718.
      No Validation Registry is deployed at all — independently confirms the §2 decision.
- [x] Confirm B402 facilitator endpoint and which stablecoins settle.
      `https://facilitator.b402.ai`, no key. Settles U / USD1 / USDT / USDC. **But the escrow
      does not** — `paymentToken()` is immutable and is U. §8.1 corrected.
- [x] Decide indexing approach: **own indexer.** Forced, not chosen: `totalSupply()` reverts so
      agents cannot be enumerated on chain; the reputation registry stores no timestamps, so
      `createdAt` exists only in logs; and the feedback-vs-transfer time join in §8.1 is not a
      field any third-party subgraph exposes.
- [x] Stand up the repo skeleton with the Python/TS boundary decided. See `README.md`.
- [x] **Freeze §8.1** — done, with the token correction above. Brief assembled at
      `docs/grok-frontend-brief.md`, ready to send.

**The testnet fallback is dead — delete it.** The SDK is on mainnet with real usage, so there is
no scenario where we ship against testnet and explain ourselves.

**One open blocker, needs a human.** Historical `eth_getLogs` is refused by every free RPC
tested (publicnode, bnbchain dataseed, drpc, blockrazor, Envio all decline archive range).
Tip-following works unauthenticated, so the indexer is unblocked for live data and only the
backfill waits. Fix is one free Envio HyperSync token at `app.envio.dev/api-tokens`.

### Days 1–2 — indexer and probe worker

- Ingest `Registered`, `Transfer`, `NewFeedback`, `FeedbackRevoked`, `ResponseAppended`.
- Resolve `agentURI` registration files; record parse failures as a signal, not an error.
- Probe worker: hit endpoints, write results back as feedback under `reachable` / `responseTime`
  / `uptime`. On demand, queued.
- Schema for derived metrics: distinct raters, top-rater share, overlap sets, transfer history,
  reputation-before-vs-after-transfer split.

### Days 3–4 — scoring and API

*External UI pass runs in parallel from Day 0. Do not build screens.*

- Graded score with threshold. Transfer discount applied.
- The three v1 signals computed and exposed.
- Every endpoint in §8.1 serving real data, live-only as the default filter.
- Seed a handful of our own agents across distinct categories. Agent diversity is a published
  criterion and the registry alone will not supply it in a demoable form.

### Day 5 — integration

- Run the §8.3 handback checklist before wiring. Deleting invented fields is faster than
  discovering them on Day 8.
- Swap the mock module for the real API client.
- Expect the catalog to look wrong the first time real data hits it: mostly-dead agents, null
  descriptions, unparseable registration files. That is the actual dataset, and handling it
  gracefully **is** the "data quality" criterion. Do not filter the ugliness away silently — the
  hidden-count on the live filter is the honest version.

### Days 6–7 — hire flow end to end

- Post job → fund escrow → deliver → evaluate → settle, over 8183 + B402.
- Timer evaluator plus one contract evaluator for an on-chain-outcome job type.
- Reason hash published on every terminal state.
- Refusal path wired and scored correctly.

### Day 8 — subcontracting run

- One agent hires another, recorded, with the depth/budget/cycle rails active.
- Fix what breaks. Something will.

### Day 9 — submission

- Record the demo. Discovery and hiring first, reputation machinery second — in that order,
  because that is the order the criteria are in.
- Writeup including the threat model page (§10). Naming your own limits before a judge finds them
  is worth more than another feature.
- Optional numeric asset: instrument the sybil cost floor. Pick a reputation threshold, count from
  the real index what clearing it would require, publish the figure with the fee assumption.

---

## 10. Threat model — put this in the submission

Do not claim sybil resistance. Douceur (2002) proved that without a logically centralised
authority, sybil attacks are always possible. Claim a **cost floor** instead.

**The attack:** a ring registers N identities, wash-hires among themselves with real x402
receipts, and mints mutual high feedback. Money circulates inside the ring, so the attack costs
gas, not capital.

**Cost decomposition:**

- Recoverable, ≈ free: the payments themselves.
- Burned: gas (negligible on BSC — do not build the floor here); ~~**marketplace fee on settled
  jobs — the only term we control**~~; endpoint hosting (amortises); **payments to honest third
  parties — genuinely gone, and the real cost**; time.

**Corrected 30 Aug (Day 0): the fee term is not ours.** On the shared ERC-8183 kernel
`platformFeeBP()` is 0, the treasury is `0x…dEaD`, and `setPlatformFee` is owner-gated to an
address that is not us. We cannot charge it and we cannot raise it. The cost floor therefore
rests **entirely** on payments to honest third parties. Do not quote a fee-based floor in the
writeup; quote the third-party-payment term and say plainly that the fee lever is unavailable
to anyone building on the shared kernel.

Rough shape: clearing a tier that requires ~50 distinct raters with low concentration and low
overlap means each rater needs ~3 ratings outside the ring — roughly 150 real jobs paid to
strangers, plus fee on ~50 wash jobs. At $1 jobs that is a few hundred dollars; at $50 jobs
roughly $10k. **Cost scales with the value tier being faked**, which is why value-weighting
matters.

**Honest limitations — state these, do not bury them:**

- The rater farm amortises across targets. Reuse is what makes overlap detection fire, but it
  lowers per-target cost.
- An attacker need not exit-scam at all. Under escrow they can deliver mediocre work and get paid
  legitimately. Fabricated reputation buys market share, not theft. **No mechanism prices this
  out — quality competition does.**
- Cheapest bypass is buying an aged legitimate identity outright.
- **We are a trusted party.** All scoring lives in a database we control, and we are the evaluator
  on most jobs. Users must take on faith that we do not rank or attest for payment. Publishing
  inputs and reason hashes so anyone can recompute from the public registry is a partial answer,
  not a proof.
- Negative bombing is unpriced (§3.5). `appendResponse` gives a victim a public argument, not a
  resolution.
- Capability claims are self-asserted. A probe proves an agent answers, not that it answers well.
- Reputation is context-collapsed: ratings earned on $1 tasks render as credibility on $1000 ones.
  Value routing mitigates, does not solve.
- UMA disputes require a bond, so below some job value there is effectively no recourse. That
  floor sits above most realistic transaction volume.
- The subcontracting graph is public. Suppliers and prices are visible; disintermediation follows
  from the same transparency that makes everything else work.
- Recursion rails are client-side. An agent ignoring our SDK can subcontract however it likes.

---

## 11. Working rules for this build

- Ship narrow and real over broad and mocked. A working hire flow on three agent categories beats
  a catalog of 364k dead entries.
- If something takes more than half a day and is not on the day plan, drop it and note it in the
  writeup as roadmap.
- Any claim in the UI must be computable from data we actually have. No placeholder metrics. This
  applies with double force to anything that arrives from the external UI pass — a metric that
  looks plausible and has no source behind it is the single most likely defect in this build.
- The data contract in §8.1 is the interface between the two tracks. If backend needs to change a
  shape, change §8.1 and the handback checklist in the same commit, never just the code.
- When a decision here turns out to be wrong under contact with the code, change it and record
  why in this file. Do not accumulate silent divergence.

# Day 0 verification spike — results

> **A SNAPSHOT, NOT A REFERENCE.** Everything below was true when it was read on
> 2026-08-30. Endpoints move and counts drift; `npm run stats` and `/api/stats`
> are the live figures. Where a fact here is known to have changed it carries an
> inline correction. See the corrections index at the top of ROADMAP.md.

Run 2026-08-30 against BSC mainnet (`eth_chainId` = `0x38`). Every address was
confirmed by `eth_call` on a live node. Nothing here is from a blog post.

## 1. Is the BNBAgent SDK on BNB Chain mainnet? — YES

This was the gate that could have killed the plan. It passes, and not narrowly.

| Read | Value |
|---|---|
| `commerceProxy` | `0xea4daa3100a767e86fded867729ae7446476eba6` (has bytecode) |
| `jobCounter()` | **56,672** |
| `paused()` | `false` |
| `MAX_EXPIRY_DURATION()` | 31,536,000 (365 days) |

56k jobs is real usage, not a staging deployment. **No testnet fallback is needed;
delete that contingency from the plan.**

Addresses come from `python/bnbagent/networks/addresses.py` in `bnb-chain/bnbagent-sdk`,
which carries both the chain 56 and chain 97 tables. Note the SDK's *default* network
string is `bsc-testnet` — mainnet must be selected explicitly, and the
`ERC8183_COMMERCE_ADDRESS` / `_ROUTER_ADDRESS` / `_POLICY_ADDRESS` env vars override it.

### Consequence: the escrow settles in one token, and it is not USDT

`paymentToken()` returns `0xcE24439F2D9C6a2289F741120FE202248B666666` —
`name()` = "United Stables", `symbol()` = **"U"**, `decimals()` = 18. The SDK's own
docstring confirms it: "Payment token address is NOT configurable — it is immutable on
the Commerce kernel."

B402 settles several stablecoins (U, USD1, USDT, USDC), but that is the **payment rail
for API calls**, not the escrow. Escrow is U-only. §8.1 said `"token": "USDT"`; that was
wrong, and it has been corrected to `"U"` before the brief goes out.

### Consequence: the fee term in the threat model is not ours to set

`platformFeeBP()` = **0**, `platformTreasury()` = `0x…dEaD`, and `setPlatformFee` is
owner-gated to `0x5057b09A…`, which is not us. §10 calls the marketplace fee "the only
term we control" in the sybil cost floor. On the shared kernel we do not control it — it
is currently zero and burns to a dead address. The cost floor therefore rests entirely on
*payments to honest third parties*. Say that in the writeup rather than quoting a fee we
cannot charge.

## 2. ERC-8004 registries on BSC — resolved and read

| Registry | Address | Verified by |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `name()` = "AgentIdentity", `symbol()` = "AGENT" |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `getVersion()` = "2.0.0", `getIdentityRegistry()` → identity above |
| Validation | none deployed | still under TEE-community discussion — independently confirms §2's decision to skip it |

Every §3 claim in the roadmap held up against the live ABI. Refinements worth having:

- **`getSummary` really does refuse unfiltered reads** — it reverts with
  `clientAddresses required`. Confirmed by calling it with `[]`.
- **But `readAllFeedback` accepts an empty array and returns everything.** An unfiltered
  read path does exist; it is just not the summary one. Worth knowing before someone
  builds a workaround that is not needed.
- **`getClients(agentId)` takes only the agent id and returns the full rater list.**
  Feedback concentration is computable directly on chain, with no history.
- **`totalSupply()` reverts** — ERC-721 without Enumerable. Agents cannot be enumerated
  on chain. An indexer is not a preference, it is required.
- **The reputation registry stores no timestamps.** `readFeedback` returns value,
  decimals, tags and `isRevoked` — nothing temporal. §8.1's `feedback.createdAt` and
  `feedbackPredatingLastTransferPct` are obtainable *only* from `NewFeedback` logs.

Highest live agent id on BSC: **319,718** (binary search on `ownerOf`).

## 3. What the corpus actually looks like — 300-agent random sample

This is the part that changes the plan. 300 ids drawn uniformly from 1..319,718,
seed 8004, read by batched `eth_call`.

| Measure | Result |
|---|---|
| Agents with **any** feedback | **4 / 300 (1.3%)** |
| Distinct rater addresses across the sample | 8 |
| Registration URI empty | 4 (1.3%) |
| Inline `data:` URI | 161 (53.7%) — of which **160 parse as valid `registration-v1`** |
| `http(s)` URI | 130 (43.3%) — **all fetched, see correction below** |
| Inline files declaring a `services[]` endpoint | 3 of 161 (1.9%) |
| `http(s)` files declaring a `services[]` endpoint | **123 of 130 (94.6%)** |
| **Corpus-wide endpoint declaration** | **125 of 300 (41.7%)** |
| **Corpus-wide *callable* endpoint** | **5 of 300** |

Registration-host concentration in the sample:

| Count | Host |
|---|---|
| 97 | `metadata.evoevo.ai` |
| 24 | `termix-platform-prod.s3.ap-southeast-1.amazonaws.com` |
| 4 | `evoevo.ai` |
| 4 | `q402.quackai.ai` |

### CORRECTED — the endpoint rate is 42%, not 2%

**The "~2%" in the first version of this document was wrong, and §4 was rewritten on it.** The
figure was measured only on the 161 inline `data:` files. The 130 `http(s)` URIs — 43% of the
sample — were classified by host but never fetched. They have now been fetched.

All 130 resolved: **128 returned HTTP 200, 2 returned 404, zero connection failures.** Rates
differ sharply by host, which is why a blended number would have hidden the story:

| Registration host | n | 200 | Parses | Declares endpoint | Rate |
|---|---:|---:|---:|---:|---:|
| `metadata.evoevo.ai` | 97 | 96 | 96 | 95 | **97.9%** |
| `termix-platform-prod.s3…` | 24 | 24 | 24 | 24 | **100%** |
| `q402.quackai.ai` | 4 | 4 | 4 | 4 | **100%** |
| `evoevo.ai` (apex) | 4 | 4 | 0 | 0 | 0% — serves HTML, not JSON |
| `bnbshare.fun` | 1 | 0 | 0 | 0 | 0% — 404 |

Corpus-wide: **125 of 300 declare an endpoint** — a large minority of the registry, not the ~2%
this document previously reported. The true count comes from the resolver pass; per §12 rule 1 no
extrapolation from this sample ships in the submission.

### But presence is the wrong test — callability is the right one

`services[].name` says what each endpoint actually is:

| `name` | n | What it is |
|---|---:|---|
| `web` | 96 | A human web page. Not a callable interface. 95 point at `evoevo.ai/agent/detail?id=…`. |
| `A2A` | 24 | Machine interface — but every one is an unsubstituted template |
| `Termix Platform` | 24 | Second service entry on those same 24 agents, same defect |
| `q402` | 4 | Machine interface; all four share one URL |
| `MCP` | 4 | Machine interface |
| `api` | 1 | `https://api.example-agent.ai/v1` — a placeholder domain |
| `chat` | 1 | Machine interface |

Two disqualifications found on inspection:

- **All 24 TermiX endpoints are literal templates.** Both service entries publish
  `https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card` with the braces
  intact. Not callable as published — a real defect in a live sponsor's data at ~8% of the sample.
- **The 96 `web` endpoints are pages.** Probing one proves the operator's site is up. It says
  nothing about the agent.

Strip templates, placeholders and web pages and **5 of 300 remain callable.** (An earlier pass
said 9; that counted service *entries* — the four `MCP` entries belong to the same four `q402`
agents, which each publish two services. Agent-level is the only meaningful unit.)

Measured `endpointClass` distribution, agent-level:

| Class | n / 300 |
|---|---:|
| `callable` | **5** |
| `web-only` | 95 |
| `template` | 25 |
| `none` | 175 |

### Blind-spot check: is `none` hiding reachable agents? No.

`none` was audited for agents reachable other than by a declared service. Of the 161 parsed
`none` documents, **13 carry `x402Support: true` — and all 13 are inline registrations containing
no URL of any kind.** Their whole document is `type`, `name`, `description`, `x402Support`,
`active`, `supportedTrust`. Only 1 of 161 `none` docs holds any non-image URL at all.

x402 is a 402-challenge flow over HTTP. With no address to call, the flag is a capability claim
with nowhere to send a request — not a reachability path. `callable` is not undercounted, and the
seeding budget is not sized off a floor. Recorded as `x402Claimed` and surfaced as a caveat:
"claims x402 payment support but publishes no endpoint to pay."

**Two fields that look like signals and are not:** `active: true` on 159/161, and
`supportedTrust: ["reputation"]` on 148/161. Near-universal self-assertion carries no information.
Not stored, not surfaced, not scored.

### The callable set is two operators — the most consequential table here

| Operator | callable | web-only | template | none | total |
|---|---:|---:|---:|---:|---:|
| `(inline registration)` | 1 | 0 | 1 | 159 | 161 |
| `metadata.evoevo.ai` | 0 | **95** | 0 | 2 | 97 |
| `termix-platform-prod.s3…` | 0 | 0 | **24** | 0 | 24 |
| `q402.quackai.ai` | **4** | 0 | 0 | 0 | 4 |
| `evoevo.ai` (apex) | 0 | 0 | 0 | 4 | 4 |
| `(malformed)` | 0 | 0 | 0 | 9 | 9 |
| `bnbshare.fun` | 0 | 0 | 0 | 1 | 1 |

Each class is essentially one operator. All 5 callable agents come from **2 operators across 2
endpoint hosts**: four `q402.quackai.ai` agents publishing the same two URLs
(`/api/relay/info`, `/api/mcp/info`), and one self-registered agent on `ensoul.ac`.

**The registry cannot populate agent diversity, and diversity is a judged criterion.** A catalog
built purely from real BSC data shows one hireable operator, four times. That makes the seeded
agents load-bearing rather than supplementary — see §9 Days 3–4.

Everything collapses onto **5 endpoint hosts** across 99 distinct URLs, with `evoevo.ai` holding
76% of the declaring set. That is a rate-limiting constraint, not a scaling one — a naive sweep is
a denial-of-service against one host. Hence the tiered cadence now in §4.

### The five unclassified agents, found

161 + 130 + 4 = 295. The missing five are a fourth bucket — registration URIs that are neither
`data:` nor `http(s)`:

| id | What it is |
|---|---|
| 18788, 18917 | `{"spawnBankHackathon": {"option5": true, …}}` — a config blob, not a registration file |
| 18729 | `{"miladyHackathonOptimal": {"teePrevalidation": "auto", …}}` — same |
| 31592 | Free text advertising a Milady Maker NFT collection, emoji included |
| 968 | The two-character string `""` |

None declare an endpoint and none parse as `registration-v1`. They matter only as a parser
robustness case: the resolver must not crash on them, and `none` is the correct classification.

### Operator concentration is a signal the roadmap does not have

One operator accounts for roughly a third of the registry (`evoevo.ai`, 101/300
including the apex domain), and their registration URIs carry the operator's own
sequential ids (`/agents/1003619`, `/agents/4159007`) — mass registration, plainly
visible. It is computable from the registration URI alone, needs no history, and applies
to 100% of the catalog, whereas feedback concentration has data for 1.3% of it. Raised
as a decision, not silently adopted — §5 locks the signal set.

### A live example of the §3.5 attack, already on chain

Agents 1, 5 and 42 each have exactly one rater, and it is the same address:
`0x397558E5D63a894934362E5c3C33Ab5d0170c228`. Every entry is `value` = 100,
`valueDecimals` = 0, with:

- `tag1` = `"get top 1 rank >"`
- `tag2` = `"t.me/agent_bldr"`

That is advertising injected into the reputation layer, on mainnet, exploiting exactly
the missing authorisation gate described in §3.5. It is a ready-made demo of both the
concentration signal ("2 ratings, 1 address, 100% share") and of `appendResponse` as our
public spam-flag layer. Use it.

### The registration schema, as actually deployed

Agent 1 (`ClawNews`) carries the full shape: `type` = `…eip-8004#registration-v1`,
`name`, `description`, `image`, and `services[]` with `{name, endpoint}` — plus an OASF
block (`agntcy/oasf` v0.8.0) declaring structured `skills` and `domains` paths. Agent 42
carries `x402Support: true`, `active: true`, `supportedTrust: ["reputation"]` and no
services array at all.

OASF `domains` is a real taxonomy and a better source for `AgentCard.categories` than
free text, where present. It stays self-asserted either way — label it as a claim.

## 4. Indexing approach — own indexer, decided

Not a close call any more. Three independent facts force it: no `totalSupply` to
enumerate with, no timestamps in reputation storage, and §8.1 requires a
feedback-versus-transfer time join that no third-party subgraph exposes as a field.

**Open blocker — needs a human, one time.** Historical `eth_getLogs` is refused by every
free endpoint tested:

| Endpoint | Result on a 5,000-block historical window |
|---|---|
| `bsc-rpc.publicnode.com` | archive requests require a personal token |
| `bsc-dataseed.bnbchain.org` | limit exceeded |
| `bsc.drpc.org` | free-plan timeout |
| `bsc.blockrazor.xyz` | range must not exceed 25 blocks |
| `bsc.hypersync.xyz` (Envio) | API token required |

Tip-following in 5,000-block windows works fine unauthenticated (9 `Registered` events
in the last ~5,000 blocks, so ~9/hour), so the indexer can be built and run live
immediately. Only the **backfill** is blocked. Recommended fix is a free Envio HyperSync
token (`app.envio.dev/api-tokens`) — it is built for exactly this extraction and already
tracks the BSC tip (height 119,011,793 at time of check). I have not created any account;
that is yours to do.

## 5. B402

> **DEAD as of 2026-09-06.** `facilitator.b402.ai` has no A record. Confirmed against
> Google DNS (8.8.8.8) while the parent `b402.ai` resolves normally from the same
> query, so this is the host and not a local resolver problem. The replacement is
> `facilitatorv3.b402.ai`, which answers at `/` ("B402 Facilitator Service") but
> 404s every documented route name; route discovery was stopped deliberately
> rather than guessing at an operator URL space. Treat the facilitator as
> configuration — `X402_FACILITATOR` in `packages/api/src/x402.ts` — not a constant.

Facilitator: `https://facilitator.b402.ai` (no API key). Settles U, USD1, USDT, USDC —
any BEP-20, per the docs. The relayer verifies an EIP-3009 `TransferWithAuthorization`
signature, checks the token is whitelisted, then pulls via `transferFrom`. The SDK
registers the payment token as the only EIP-712 `verifyingContract` in its signing
allowlist by default.

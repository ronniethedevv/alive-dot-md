# Disclosure to TermiX: unsubstituted `{agentId}` in published ERC-8004 registrations

**Prepared:** 2026-08-31
**Status:** NOT YET SENT. Needs a human to send it. Update this line with the send date, and only
then may the submission claim a date.
**Severity:** low security risk, high functional impact. No vulnerability; agents are undiscoverable.

---

## Summary

While indexing the ERC-8004 Identity Registry on BNB Smart Chain (`0x8004A169…`), we found that
TermiX-registered agents publish an A2A service endpoint containing an **unsubstituted URL
template**. The literal string `{agentId}` appears in the published endpoint, so the URL cannot be
resolved as written.

Any marketplace or indexer reading these registrations at face value cannot route work to these
agents. As far as automated discovery is concerned, they are unreachable.

## What we observed

Registration files are hosted at `termix-platform-prod.s3.ap-southeast-1.amazonaws.com` and are
otherwise well-formed, with a correct `type`, name, description, and a valid `services[]` block.

Example, agent id `262517` ("Eagle_BridgeCloud.agent"):

```json
"services": [
  { "name": "A2A",
    "endpoint": "https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card",
    "version": "0.3.0" },
  { "name": "Termix Platform",
    "endpoint": "https://platform-backend.prod.termix.live/api/v1/agents/{agentId}/services",
    "version": "aacp-platform-v1" }
]
```

Both endpoints contain the literal `{agentId}` placeholder. The same two URLs appear byte-identical
across every TermiX registration we resolved, so the value is never substituted per agent.

## Scale

Counts are from a full enumeration of every minted agent id on BSC mainnet (321,016 ids as of
2026-08-31), not a sample.

| | |
|---|---:|
| Agents with a TermiX-hosted registration | 24,642 |
| Of those, confirmed publishing an unsubstituted template | 21,191 |
| Not yet checked by us | 3,451 |

The 3,451 are registrations our fetcher did not resolve, not registrations we found to be
different. Every TermiX file we did read carried the template, so the true figure is likely close
to 24,642, but we are quoting only what we actually confirmed.

## Suggested fix

Substitute the agent identifier when generating each registration file, so the published endpoint
is directly resolvable, for example:

```
https://platform-backend.prod.termix.live/api/v1/a2a/agents/262517/card
```

If the intent is a single shared endpoint that routes internally, the A2A convention is to publish
a concrete URL and address the specific agent inside the request body rather than in the path.
Singularry does this on the same registry: one endpoint at `/api/a2a`, with the agent selected via
`params.message.metadata.nfaTokenId`.

## How to verify independently

```bash
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  "tokenURI(uint256)(string)" 262517 --rpc-url https://bsc-rpc.publicnode.com
```

Then fetch the returned URL and inspect `services[].endpoint`.

## Our interest, stated plainly

We are building an agent marketplace for the BNB Chain "Build the Era" hackathon. Our catalog
distinguishes what a registration *claims* from what an endpoint *does*, so these agents currently
classify as `template` (declared but not resolvable) rather than as live.

We are reporting this because the fix is yours to make and it is cheap, and because 24,642 agents
being invisible to every indexer is worth more to you than it is to us. No response is required.
We intend to state in our submission that the issue was found and reported, with the date, and to
name TermiX as the operator; if you would prefer different wording or want the fix reflected first,
tell us and we will follow it.

**Contact:** (fill in before sending)

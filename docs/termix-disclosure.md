# WITHDRAWN: TermiX disclosure

**Status: DO NOT SEND. The finding was wrong.**

**Drafted:** 2026-08-31
**Withdrawn:** 2026-08-31, before sending. Nothing was ever sent to TermiX.

---

## What the draft claimed

That 24,642 TermiX-registered agents published an endpoint containing an unsubstituted
`{agentId}` placeholder, and were therefore unreachable by any indexer:

```
https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card
```

## Why it was wrong

`{agentId}` is a URI template, and the placeholder names exactly what to put in it. Substituting
the ERC-8004 token id resolves the URL and returns a real agent card:

```
$ curl https://platform-backend.prod.termix.live/api/v1/a2a/agents/262517/card
{"id":"cmsmyn16326cbtc01dtzhzp09","agentTokenId":"262517",
 "name":"Eagle_BridgeCloud.agent", ... }
```

Tested on five further TermiX agents chosen at random (306164, 302118, 318444, 308129, 298020).
All five resolved. The endpoints were never broken. **Our classifier was**: it treated any URL
containing braces as unresolvable, without ever attempting the substitution the placeholder asks
for.

Had this been sent, we would have told a team their entire agent fleet was broken, on the strength
of a bug in our own code, in a document that also announced we intended to publish the finding.

## What is actually true, and what it is worth

TermiX's own agent card reports every agent we sampled as:

```
"status": "UNBOUND", "presence": "offline", "endpoint": null, "skills": []
```

So the agents are addressable but not wired up. That is a fact about the agents rather than about
the registration, and it is TermiX's own status field saying so plainly. **It is not a defect and
not news to them.** There is nothing here worth reporting: an operator knows which of its agents
are bound.

The `template` class remains correct for placeholders we genuinely cannot fill. It was applied to
one we could.

## What changed as a result

- `indexer/src/classify.ts` substitutes `{agentId}`, `{tokenId}`, `{nfaTokenId}` and similar with
  the ERC-8004 token id before judging a URL. `agentId` is threaded through `resolveInline` and
  `classifyDoc` from both resolver phases.
- The golden test asserted TermiX agents were `template`. It now asserts they are `machine` with a
  substituted endpoint, and the sample's declared-machine count moves from 5 to 29.
- ROADMAP §4 and §11, and the published findings document, are corrected.

## The pattern this belongs to

Three claims in this build have been wrong, and all three failed in the same direction:

1. "U has no market" — checked PancakeSwap V2, missed the V3 pool holding ~$21M.
2. "Nothing on the registry is hireable" — twice, both times over an unresolved denominator.
3. "TermiX published 24,642 broken endpoints" — a bug in our classifier.

Each one made the registry look deader and our filter look sharper. None was invented; each came
from a real measurement read too confidently. This is the bias the project has to be most careful
about, because it is the one nobody here is motivated to go looking for, and it is why §12 rule 0
exists.

This file is kept rather than deleted. A withdrawn disclosure is part of the method.

---

## Addendum, 2026-09-02 — a fourth entry, same operator, same shape

Found while auditing the `dead` verdicts. Nothing was sent this time either.

Ten agents sit on `platform-backend-bnb8183.prod.termix.live` and were recorded
`dead: http-404`. Every part of that measurement is correct:

- the URL we stored is **exactly what TermiX publishes**, with `{agentId}`
  substituted — verified by re-fetching the live registration and round-tripping
  the substitution;
- that host really does answer `404 default backend`, an ingress with no service
  routed behind it;
- `headOrGet` sends GET, follows redirects, and uses a permissive `Accept`, so
  the 404 is not an artefact of how we asked.

**And the agents are alive anyway.** The same ids resolve 200 with real cards on
the operator's main host:

```
https://platform-backend.prod.termix.live/api/v1/a2a/agents/285862/card
  -> 200  {"agentTokenId":"285862","name":"btc-minter.agent", ...}
```

Confirmed on 285862, 285947, 285985, 287920, 292058. TermiX published a hostname
with no backend on ten registrations. That is a typo in their data, not a dead
fleet — and our own database already holds **245** agents on their working host
classified `no-interface`, the unbound state §3 describes. Probed at the host
that works, these ten would read *"well formed, not yet bound"*, not *"answered
with an error"*.

**What was wrong was the label, not the probe.** `verified_class = 'dead'` is a
fact about a URL; the UI rendered it as `"declared but not there"`, which is a
claim about an agent. Fixed: the copy now reads *"Its published endpoint returns
an error / the URL is broken; the agent may not be"*, and the operators page says
*"published endpoints return errors"*. The stored verdicts are unchanged, because
they are correct.

**Scope, measured rather than assumed.** A random 18 of the 297 `dead` agents
were re-audited: registration still declares the URL we stored, and it still
404s. **18/18 confirmed, 0 stale, 0 moved.** bitagent's 235 are genuinely gone at
both `api.bitagent.io` and `www.app.bitagent.io`, and have no working sibling
host in our data. The TermiX ten are the exception — and they are the ones that
made it into a summary table.

### The pattern list, updated

This is the fourth, and the operator is the same one all three times it involved
an operator at all:

4. "TermiX has ten dead endpoints" — the endpoints are dead, the agents are not,
   and the sentence a reader takes away is false.

The tell is unchanged: **every one of these made the registry look deader and our
filter look sharper.** Rule 0 stops a failure being recorded as a fact. It does
not stop a fact being *worded* as a bigger fact, which is what happened here and
what §12 should now say out loud.

### Still open, deliberately not done

The tempting fix is to try the working hostname when the published one 404s.
**Do not.** That is guessing a URL on an operator's behalf, it would be applied
unevenly across operators, and it is how the first TermiX finding was born. If a
`misconfigured` class is ever added it must key on evidence already in the
database — a sibling host of the same operator that we independently verified —
and never on editing a hostname to see if it works.

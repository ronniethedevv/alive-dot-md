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

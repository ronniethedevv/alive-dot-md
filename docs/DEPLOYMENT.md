# Deployment — how this runs with every laptop switched off

The requirement: push to GitHub, deploy to Vercel, turn the PC off, and the
marketplace keeps working and keeps updating for weeks.

## The shape

```
BNB Chain  ──►  GitHub Actions (every 6h)  ──►  data/*.json  ──►  Vercel
(truth)         indexer, on a hosted runner     committed         static site
                                                only when          + one function
                                                it changed
```

Three properties make it autonomous:

- **The chain is the source of truth.** Nothing is hand-maintained. New agents
  are found by sweeping identity ids from our watermark to the chain head; new
  settlements by scanning kernel jobs from the last job id.
- **The database is a build artifact, not a service.** It lives in the Actions
  cache, never in git and never in production.
- **A commit is the deploy trigger.** The workflow writes `data/` and pushes;
  Vercel's GitHub integration does the rest. Nothing has to be told anything.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Frontend | Vercel static | `packages/web-app`, built by `npm run web:build` |
| API | Vercel function | `api/[...path].ts`, reads `data/*.json` |
| Indexer | GitHub Actions | `.github/workflows/index.yml`, every 6 hours |
| Working index | Actions cache | 346 MB SQLite, restored and rewritten each run |
| Snapshot | Git | `data/`, ~2.9 MB, 1,039 listable agents |

`packages/api/src/server.ts` is **development only**. It serves the same routes
from SQLite so `npm run api` is a faithful local stand-in. It is never deployed.

## One-time setup

**1. Seed the index.** The workflow is incremental; a cold start with no cache
would re-sweep 330,000 ids and may exceed the 6-hour job limit. Publish the
database you already have, once:

```bash
gh release create index-seed bnb-mrkt.db --title "Index seed"
```

The workflow downloads this only when the cache is empty. After the first
successful run the cache takes over and the release is just a fallback.

**2. Repository secrets** (Settings → Secrets → Actions). Both optional:

| Secret | Effect if unset |
|---|---|
| `BSC_RPC` | Falls back to public endpoints. Slower, more rate limiting. |
| `SCAN8004_API_KEY` | 8004scan enrichment runs anonymously at 30 req/min. |

**3. Connect Vercel** to the repo. `vercel.json` carries the build command,
output directory and the SPA rewrite; no dashboard configuration is needed.

## Freshness, and what is not live

The snapshot is at most six hours old, and `meta.json` records exactly when it
was cut so the UI can say so rather than implying it is live.

Genuinely live, read straight from the chain in the browser: job state, escrow
balances, allowances — anything `packages/web-app/src/lib/chain.ts` reads.

`POST /api/agents/:id/verify` still probes an endpoint on demand and returns a
fresh result, but **does not persist it** — a read-only filesystem cannot write
the verdict back. The response says `persisted: false`. The next scheduled run
records it properly.

## Failure modes, and why none of them need a human

| If | Then |
|---|---|
| A run fails | The next one picks up from the same watermark. Nothing is lost. |
| The cache is evicted (7 days idle) | Falls back to the seed release. |
| 8004scan is down | Enrichment step is `continue-on-error`. Publishing continues. |
| The export shrinks | The sanity check refuses to commit a catalog that lost more than a fifth of its agents. |
| Nothing changed on chain | No commit, no deploy. |

## Verified locally

The whole stack was run with the SQLite API stopped and the Vercel function
serving `data/` in its place. Catalog, agent detail, operators, pricing and the
concierge all returned identical results — `862 agents / 57 operators`, the
same ranking, the same prices.

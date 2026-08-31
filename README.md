# bnb-mrkt — ERC-8004 agent marketplace on BNB Chain

Describe a task, see a ranked list of agents that can actually do it, hire one under escrow,
pay in stablecoin. `ROADMAP.md` is the working brief and the decision record.
`docs/DAY0-FINDINGS.md` is what the chain actually said when we checked.

## The Python/TS boundary

The roadmap calls this the most likely source of lost time, so it is settled here on day one.
The rule is one sentence:

> **Python owns anything that signs a transaction or touches a foreign endpoint.
> TypeScript owns the database and everything the UI can see.**

| Dir | Lang | Owns |
|---|---|---|
| `indexer/` | TS | Log ingest → SQLite. The only writer of chain-derived tables. |
| `api/` | TS | Serves the §8.1 contract from SQLite. The only thing the frontend talks to. |
| `worker/` | Python | BNBAgent SDK job lifecycle, escrow, evaluators, and the probe worker. |
| `packages/shared/` | TS | The §8.1 types and the verified chain addresses. |

Python is not a choice — the BNBAgent SDK is Python-only, and it is the one component we
refuse to reimplement. TypeScript is not a choice either — the frontend is TS, and the §8.1
contract should be one set of types, not two that drift.

**Data flows one way.** `api` never calls `worker` for a read. `worker` writes rows; `api`
reads them. The single synchronous crossing is hiring — `POST /api/jobs` calls the worker's
internal HTTP endpoint, because that action must sign. Everything else is the database.

**SQLite, WAL mode**, not Postgres: there is no Docker on the build machine, and both runtimes
read SQLite with zero driver setup. Schema in `indexer/src/schema.sql` uses Postgres-portable
types, so the port is available if concurrency ever bites.

## Chain facts worth knowing before you write code

All verified on mainnet 2026-08-30, not read off a doc. Full transcript in `docs/DAY0-FINDINGS.md`.

- **Escrow settles in `U` (United Stables), 18 decimals, and only `U`.** `paymentToken()` is
  immutable on the commerce kernel. There is no token choice anywhere in the product.
- **`totalSupply()` reverts.** Agents cannot be enumerated on chain. Highest live id is 319,718.
- **The reputation registry stores no timestamps.** Anything time-based about feedback comes
  from `NewFeedback` logs or it does not exist.
- **`getSummary` reverts on an empty `clientAddresses` array** (`clientAddresses required`), but
  `readAllFeedback` accepts one and returns everything.
- **`getClients(agentId)` returns the full rater list on chain** — concentration needs no history.
- **~2% of agents declare a service endpoint.** That is the first filter, and it is nearly free.
- **1.3% of agents have any feedback at all.**

## Status

Day 0 complete. The blocking question — is the BNBAgent SDK really on mainnet — is answered
yes, with 56,672 jobs on the live kernel.

One thing needs a human: a free archive-RPC token so the indexer can backfill. Live
tip-following works without one. See `docs/DAY0-FINDINGS.md` §4.

`docs/grok-frontend-brief.md` is assembled and self-contained, ready to send.

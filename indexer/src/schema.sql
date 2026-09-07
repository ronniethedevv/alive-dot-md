-- SQLite, WAL mode. Chosen over Postgres because there is no Docker on the
-- build machine and both the TS indexer and the Python worker read SQLite with
-- zero driver setup. Column types are Postgres-portable.

PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS agents (
  agent_id            TEXT PRIMARY KEY,
  -- Nullable: the sweep reads tokenURI only (it already distinguishes minted
  -- from unminted), and owner is backfilled lazily for agents that survive the
  -- endpointClass filter. NULL means "not yet fetched", never "no owner".
  owner               TEXT,
  agent_wallet        TEXT,
  token_uri           TEXT,
  -- Parse outcome of the registration file. A failure is a signal, not an error.
  reg_valid           INTEGER NOT NULL DEFAULT 0,
  reg_fetch_error     TEXT,
  name                TEXT,
  description         TEXT,
  -- First services[].endpoint, if the file declares one. ~42% of the corpus
  -- declares one; only ~3% declares one that is actually callable.
  endpoint            TEXT,
  -- services[].name for that endpoint. "web" means a human page, not an interface.
  endpoint_service    TEXT,
  -- Resolved host of the endpoint. Everything collapses onto ~5 hosts, so this
  -- is the rate-limiting key for the probe worker, not just a display field.
  endpoint_host       TEXT,
  -- What the REGISTRATION SAYS: machine | web-only | template | none.
  -- A claim by the operator. Cheap, 100% coverage, and NOT a verdict.
  declared_class      TEXT NOT NULL DEFAULT 'none',
  -- What the PROBE FOUND: unprobed | task-interface | html | testnet | dead |
  -- unreachable. The only column that supports a hireability claim. Probing 212
  -- declared-machine endpoints found 150 serving HTML and 7 real interfaces, so
  -- these two columns disagree by design and the disagreement is the product.
  verified_class      TEXT NOT NULL DEFAULT 'unprobed',
  verified_at         TEXT,
  verified_detail     TEXT,
  -- Claims x402 support but declares no endpoint. A claim, not reachability.
  x402_claimed        INTEGER NOT NULL DEFAULT 0,
  -- Registered and operated by us. Must be disclosed in the UI wherever shown.
  first_party         INTEGER NOT NULL DEFAULT 0,
  -- Near-universal self-assertions (active, supportedTrust) are deliberately
  -- NOT stored: 159/161 and 148/161 of sampled agents set them. No information.
  -- Host of an http(s) registration URI. One host owns ~1/3 of the registry.
  reg_host            TEXT,
  -- Consecutive TRANSPORT failures (timeout, connect refused) against this
  -- agent's endpoint. Not a verdict: it is how many times in a row we failed to
  -- get an answer at all, which is a fact about us as much as about them.
  --
  -- Exists because a burst of our own making downgraded 97 healthy agents in
  -- eighteen minutes: an uncapped re-probe hammered one host, every request
  -- timed out, and each timeout overwrote a good `task-interface` verdict with
  -- `unreachable`. Rule 0 in its purest form - our inability to reach a host is
  -- not a fact about the host - and the write path had no way to express it.
  consec_fails        INTEGER NOT NULL DEFAULT 0,
  categories_json     TEXT,
  registered_block    INTEGER,
  registered_at       TEXT,
  UNIQUE (agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agents_host ON agents (reg_host);
CREATE INDEX IF NOT EXISTS idx_agents_endpoint ON agents (endpoint);
CREATE INDEX IF NOT EXISTS idx_agents_declared ON agents (declared_class);
CREATE INDEX IF NOT EXISTS idx_agents_verified ON agents (verified_class);
CREATE INDEX IF NOT EXISTS idx_agents_firstparty ON agents (first_party);
CREATE INDEX IF NOT EXISTS idx_agents_ephost ON agents (endpoint_host);

CREATE TABLE IF NOT EXISTS transfers (
  agent_id    TEXT NOT NULL,
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  block       INTEGER NOT NULL,
  ts          TEXT NOT NULL,
  log_index   INTEGER NOT NULL,
  PRIMARY KEY (agent_id, block, log_index)
);

-- createdAt exists ONLY here. The reputation registry stores no timestamps,
-- so §8.1's feedback.createdAt is unobtainable without indexing these logs.
CREATE TABLE IF NOT EXISTS feedback (
  agent_id        TEXT NOT NULL,
  client          TEXT NOT NULL,
  feedback_index  INTEGER NOT NULL,
  value           TEXT NOT NULL,          -- int128, string to survive JS
  value_decimals  INTEGER NOT NULL,
  tag1            TEXT,
  tag2            TEXT,
  endpoint        TEXT,                   -- emitted, never stored on chain
  feedback_uri    TEXT,
  feedback_hash   TEXT,
  revoked         INTEGER NOT NULL DEFAULT 0,
  revoked_block   INTEGER,
  block           INTEGER NOT NULL,
  ts              TEXT NOT NULL,
  PRIMARY KEY (agent_id, client, feedback_index)
);
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback (agent_id);
CREATE INDEX IF NOT EXISTS idx_feedback_client ON feedback (client);

CREATE TABLE IF NOT EXISTS responses (
  agent_id        TEXT NOT NULL,
  client          TEXT NOT NULL,
  feedback_index  INTEGER NOT NULL,
  responder       TEXT NOT NULL,
  response_uri    TEXT,
  response_hash   TEXT,
  block           INTEGER NOT NULL,
  ts              TEXT NOT NULL,
  PRIMARY KEY (agent_id, client, feedback_index, responder, block)
);

-- Probe results. The `callable` tier is probed per agent every 15 min; the
-- `web-only` tier is probed once per HOST per day (one row per host, agent_id
-- null) because probing 95,000 pages on one host proves nothing and is abuse.
CREATE TABLE IF NOT EXISTS probes (
  agent_id        TEXT NOT NULL,
  probed_at       TEXT NOT NULL,
  reachable       INTEGER NOT NULL,
  response_ms     INTEGER,
  http_status     INTEGER,
  error           TEXT,
  -- set once the result has been written back on chain as feedback
  onchain_tx      TEXT,
  PRIMARY KEY (agent_id, probed_at)
);
CREATE INDEX IF NOT EXISTS idx_probes_agent ON probes (agent_id, probed_at DESC);

-- Feedback concentration, computed from the reputation registry's VIEW
-- functions rather than from logs: getClients(agentId) returns the full rater
-- list from the agent id alone, and getLastIndex(agentId, client) returns that
-- client's entry count. So this signal needs no log history and no Envio token
-- (ROADMAP 3.8) - which is exactly why it survived into the v1 signal set.
--
-- No timestamps here, deliberately. The registry stores none, so anything
-- temporal about feedback stays null until the backfill lands (ROADMAP 3.10).
CREATE TABLE IF NOT EXISTS concentration (
  agent_id            TEXT PRIMARY KEY,
  computed_at         TEXT NOT NULL,
  distinct_raters     INTEGER NOT NULL,
  -- Sum of getLastIndex across raters. NOTE: indices are monotonic, so this
  -- INCLUDES revoked entries. It is "entries ever written", not "live ratings".
  rating_count        INTEGER NOT NULL,
  -- NULL when distinct_raters = 0. Never 0 - "no raters" is not "0% share".
  top_rater_share_pct INTEGER,
  top_rater           TEXT
);
CREATE INDEX IF NOT EXISTS idx_conc_raters ON concentration (distinct_raters DESC);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  stream  TEXT PRIMARY KEY,
  block   INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- ERC-8183 commerce kernel. Added 2 Sept after ROADMAP §13.
--
-- The registry says who EXISTS. This says who has actually been PAID, and it
-- turns out to be a different and much smaller set. §5 concluded no track
-- record was obtainable because the reputation registry stores no timestamps;
-- that was the wrong contract. The kernel records every job's counterparties,
-- state, budget and deadline, which is a settlement record per provider and
-- needs no log backfill.
--
-- Deliberately stores jobs, not a pre-aggregated provider table: the
-- aggregation is one GROUP BY and keeping the rows means a new question can be
-- asked without re-scanning 56k jobs.
CREATE TABLE IF NOT EXISTS jobs (
  job_id        INTEGER PRIMARY KEY,
  client        TEXT NOT NULL,
  provider      TEXT NOT NULL,
  evaluator     TEXT,
  -- open | funded | completed | rejected, decoded from the state word. Anything
  -- else is stored as unknown_<n> rather than guessed.
  state         TEXT NOT NULL,
  raw_state     INTEGER NOT NULL,
  -- Raw units of U, 18 decimals, kept as TEXT to survive JS number precision.
  budget        TEXT NOT NULL,
  deadline      INTEGER,
  terms         TEXT,
  -- Only ever written by complete() or reject(), so its presence means settled.
  reason_hash   TEXT,
  scanned_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_provider ON jobs (provider);
CREATE INDEX IF NOT EXISTS idx_jobs_client   ON jobs (client);
CREATE INDEX IF NOT EXISTS idx_jobs_state    ON jobs (state);

-- Maps a payment wallet back to its ERC-8004 identity.
--
-- The registry has NO reverse lookup - getAgentByWallet, walletToAgentId,
-- agentIdByWallet and tokenOfOwnerByIndex all revert - so the only way from a
-- provider address on a job to the agent that earned it is to build this index
-- forwards, one getAgentWallet per id.
CREATE TABLE IF NOT EXISTS agent_wallets (
  wallet     TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (wallet, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_wallets_agent ON agent_wallets (agent_id);

-- Per-agent settlement record, materialised.
--
-- Computed from `jobs` + `agent_wallets` by `indexer/src/build-records.ts`.
-- It exists purely for speed and the reason is worth recording: expressing this
-- as correlated subqueries in the catalog's ORDER BY made a single page take
-- 110 SECONDS, because ranking 320,357 agents by job count means running two
-- subqueries against 56,690 jobs per agent. Materialised, the same page is a
-- single indexed join.
--
-- Derived data only. Nothing here is a source of truth; drop it and rebuild.
CREATE TABLE IF NOT EXISTS agent_record (
  agent_id       TEXT PRIMARY KEY,
  jobs           INTEGER NOT NULL,
  completed      INTEGER NOT NULL,
  rejected       INTEGER NOT NULL,
  -- Distinct PAYING counterparties, self-hire excluded. One is a very different
  -- fact from twenty, and two of the busiest providers on the kernel hire
  -- themselves 100% of the time.
  clients        INTEGER NOT NULL,
  settled_raw    TEXT NOT NULL,
  completion_pct INTEGER,

  -- WHAT THIS AGENT CHARGES, measured rather than asked for.
  --
  -- ROADMAP §15 established that no agent on this registry publishes a price
  -- or a way to ask for one: 20 of 20 sampled returned "does not publish".
  -- The conclusion drawn at the time was that the client must therefore
  -- propose a figure. That was answering the wrong question. Nobody publishes
  -- a price, but 51 providers have SETTLED one, and the kernel records every
  -- budget. An observed settlement is a better guide than a stranger's guess
  -- and it cannot be inflated without a counterparty spending real money.
  --
  -- Median, not mean: one 1.0 U outlier should not move a 0.10 U agent.
  -- Zero-budget jobs are excluded and counted separately - they are free trial
  -- runs, and averaging them in makes a paid agent look free.
  price_med_raw  TEXT,
  price_min_raw  TEXT,
  price_max_raw  TEXT,
  price_n        INTEGER NOT NULL DEFAULT 0,
  price_zero_n   INTEGER NOT NULL DEFAULT 0,

  computed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_record_completed ON agent_record (completed DESC, jobs DESC);

-- Trust. Materialised by `indexer/src/build-trust.ts`.
--
-- The catalog needs ONE number it can sort by and display, and until now it had
-- two: a `score` computed in the API and a completely different `ORDER BY` in
-- SQL that ranked on `verified_class` alone. "Best" therefore returned rows
-- scoring 36, 38, 34, 30, 32, 38 — in that order — every one of them an agent
-- with a funded job that had never delivered anything.
--
-- The scale is ordered by WHAT IT COSTS TO FAKE:
--
--   a completed paid job   costs a counterparty real money      (heaviest)
--   several distinct clients   costs several counterparties
--   an answering endpoint  costs running a server               (cheap)
--   a valid registration   costs nothing
--   a rating               costs nothing, and is demonstrably farmed here
--
-- Ratings are weighted by INVERSE RATER BREADTH. §5 already bars `active: true`
-- from scoring because a field true of 98.8% of agents carries no information;
-- a rater who has rated 924 of 4,401 agents is the same thing wearing a
-- different hat. Weighting by 1/breadth means the 33 mass-raters behind 96.7%
-- of all edges contribute almost nothing, and the 69 raters who rated one to
-- four agents contribute most of what little signal exists. No threshold, no
-- blocklist, and nothing to tune.
--
-- PENDING JOBS SCORE ZERO. 811 of 856 agents with a job have only funded/open
-- ones: escrow posted, nothing delivered. Counting that as a track record is
-- how "0 of 1 jobs completed" reached the top of the catalog.
CREATE TABLE IF NOT EXISTS agent_trust (
  agent_id          TEXT PRIMARY KEY,
  score             INTEGER NOT NULL,
  -- proven > live > declared > unproven. The tier is the claim; the score only
  -- orders within it.
  tier              TEXT NOT NULL,
  completed         INTEGER NOT NULL DEFAULT 0,
  clients           INTEGER NOT NULL DEFAULT 0,
  rejected          INTEGER NOT NULL DEFAULT 0,
  pending           INTEGER NOT NULL DEFAULT 0,
  -- Sum of 1/breadth over this agent's raters. A weighted count, not a count.
  credible_ratings  REAL NOT NULL DEFAULT 0,
  raw_ratings       INTEGER NOT NULL DEFAULT 0,
  -- Breadth of this agent's most prolific rater. High means its ratings came
  -- from someone who rates everything.
  top_rater_breadth INTEGER,
  computed_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_trust_score ON agent_trust (score DESC, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_trust_tier  ON agent_trust (tier, score DESC);

-- Categories, multi-label, derived by `indexer/src/build-categories.ts`.
--
-- These are CLAIMS, not verifications. They are matched against what an agent
-- says about itself in its name, description, declared skills and OASF domains,
-- so they answer "what does this say it does", never "what can it do". §4 bars
-- self-assertions from SCORING for good reason; navigation is a different job
-- and the UI labels these as self-described.
--
-- Multi-label on purpose: a "Venus Health Factor Monitor" is genuinely
-- monitoring AND risk AND lending, and forcing one bucket would hide it from
-- two thirds of the people looking for it.
CREATE TABLE IF NOT EXISTS agent_category (
  agent_id   TEXT NOT NULL,
  category   TEXT NOT NULL,
  PRIMARY KEY (agent_id, category)
);
CREATE INDEX IF NOT EXISTS idx_agent_category_cat ON agent_category (category, agent_id);

-- 8004scan (AltLayer), mirrored by `indexer/src/scan8004.ts`.
--
-- A SECOND SOURCE, KEPT SEPARATE ON PURPOSE. Nothing here is merged into
-- `agents`: that table is ours, derived from the chain by our own reads, and a
-- third party's view of the same registry is evidence about the registry AND
-- about them. Keeping it in its own table means every claim stays attributable,
-- disagreements stay visible instead of being silently resolved in someone's
-- favour, and dropping the integration is a DELETE rather than an unpick.
--
-- What it is actually for, in order of value:
--
--   created_at   The only per-agent timestamp available to this project. §5
--                concluded none existed - true of the identity and reputation
--                registries, and archive eth_getLogs is token-gated on every
--                free BSC endpoint we tested. This is that gap closed, and it
--                costs one API call per page.
--   token_id     They index the tip sooner than a sequential ownerOf sweep
--                reaches it, so this is cheap discovery of new registrations.
--   average_score / total_feedbacks
--                Their reputation layer, stored to be DISPLAYED BESIDE ours,
--                never folded into it. §13.7's whole argument is that raw
--                rating averages on this registry are farmed; the gap between
--                their number and our inverse-breadth-weighted one is the
--                clearest way to show that, and it only works if both survive.
--   x402_supported, supported_protocols
--                Declared capability, saving a registration fetch.
--
-- `agent_id` is the ERC-8004 token id as TEXT, so it joins `agents` directly -
-- 8004scan indexes the same identity registry contract on chain 56.
CREATE TABLE IF NOT EXISTS scan8004_agents (
  agent_id            TEXT PRIMARY KEY,
  chain_id            INTEGER NOT NULL,
  contract_address    TEXT,
  name                TEXT,
  description         TEXT,
  owner_address       TEXT,
  is_verified         INTEGER,
  x402_supported      INTEGER,
  supported_protocols TEXT,
  star_count          INTEGER,
  total_score         REAL,
  health_score        REAL,
  rank                INTEGER,
  network_rank        INTEGER,
  total_feedbacks     INTEGER,
  average_score       REAL,
  -- ISO-8601 as returned. Stored verbatim rather than parsed to unix seconds:
  -- it is someone else's field and reformatting it loses the ability to say
  -- exactly what they told us.
  created_at          TEXT,
  updated_at          TEXT,
  fetched_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan8004_created ON scan8004_agents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan8004_x402 ON scan8004_agents (x402_supported);

-- The per-agent detail record, which carries much more than the list does.
-- Populated by `scan8004.ts --enrich` for the agents we actually surface,
-- because it costs one request each and the catalog leads with ~200 of them.
--
-- Two fields here are worth the integration on their own:
--
--   created_block_number
--     The block the agent was registered in. §9 records the backfill as
--     "blocked on a human" because historical eth_getLogs needs a paid archive
--     token - but a BLOCK NUMBER needs no logs at all. One eth_getBlockByNumber
--     turns this into a real on-chain registration timestamp, which is a
--     stronger fact than either their created_at or anything we had.
--
--   is_endpoint_verified / endpoint_verification_error
--     A DIFFERENT CHECK FROM OURS, and the difference is the point. Their
--     errors read `app.singularry.org: HTTP 404`, `x.com: Connection error`,
--     `t.me: Invalid` - they are verifying DOMAIN OWNERSHIP against the
--     domains an agent claims, not whether a task interface answers. Only 3 of
--     197 agents we surface pass it.
--
--     So this neither corroborates nor contradicts our prober; it measures
--     something we do not measure at all, and we measure something they do
--     not. Recording it as a second opinion on liveness would be the same
--     error as reading a 405 as death - assuming another party's field means
--     what our field means because the names are similar.
--
-- Their score decomposition (quality/popularity/activity/wallet/freshness) is
-- kept whole rather than reduced to one number, for the same reason §5 refuses
-- to publish a composite: the parts are inspectable and the total is not.
CREATE TABLE IF NOT EXISTS scan8004_detail (
  agent_id                    TEXT PRIMARY KEY,
  agent_wallet                TEXT,
  creator_address             TEXT,
  agent_type                  TEXT,
  is_active                   INTEGER,
  created_block_number        INTEGER,
  created_tx_hash             TEXT,
  is_endpoint_verified        INTEGER,
  endpoint_verified_at        TEXT,
  endpoint_verified_domain    TEXT,
  endpoint_verification_error TEXT,
  endpoint_last_checked_at    TEXT,
  health_status               TEXT,
  health_score                REAL,
  health_checked_at           TEXT,
  a2a_endpoint                TEXT,
  a2a_version                 TEXT,
  mcp_server                  TEXT,
  agent_url                   TEXT,
  quality_score               REAL,
  popularity_score            REAL,
  activity_score              REAL,
  wallet_score                REAL,
  freshness_score             REAL,
  metadata_completeness_score REAL,
  total_validations           INTEGER,
  successful_validations      INTEGER,
  watch_count                 INTEGER,
  tags_json                   TEXT,
  categories_json             TEXT,
  trust_models_json           TEXT,
  fetched_at                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan8004_detail_block
  ON scan8004_detail (created_block_number);

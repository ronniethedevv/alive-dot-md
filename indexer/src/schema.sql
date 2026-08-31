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

// SQLite via node:sqlite - built into Node 22, so no native module to compile
// on Windows and no install step before the resolver can run.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.ALIVE_MD_DB ?? join(HERE, "..", "..", "alive-md.db");

/**
 * Additive column migrations.
 *
 * schema.sql is `exec`d on every open, so it may only contain statements that
 * are safe to run repeatedly - CREATE TABLE IF NOT EXISTS and friends. SQLite
 * has no ADD COLUMN IF NOT EXISTS, so anything additive lives here and is
 * applied by checking the table first. Putting an ALTER in schema.sql throws on
 * the second open and takes every script down with it.
 */
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  // The only timestamp anywhere in this project. §5 concluded none existed
  // because the reputation registry stores none; the commerce kernel records
  // one per job, and it is what makes "the window" computable.
  { table: "jobs", column: "submitted_at", ddl: "ALTER TABLE jobs ADD COLUMN submitted_at INTEGER" },
  // Delivered but not yet settled. Nearly half the kernel sits here (27,161 of
  // 56,690), so folding it into "not completed" would misdescribe the market.
  { table: "agent_record", column: "submitted", ddl: "ALTER TABLE agent_record ADD COLUMN submitted INTEGER NOT NULL DEFAULT 0" },
  // The window criterion 3 asks for, as unix seconds.
  { table: "agent_record", column: "first_seen", ddl: "ALTER TABLE agent_record ADD COLUMN first_seen INTEGER" },
  { table: "agent_record", column: "last_seen", ddl: "ALTER TABLE agent_record ADD COLUMN last_seen INTEGER" },
  // Consecutive transport failures. Lets the prober tell "we could not reach
  // it" apart from "it is not there": an uncapped sweep once timed out against
  // one host 24,000 times and demoted 97 healthy agents on the strength of our
  // own rate limiting.
  { table: "agents", column: "consec_fails", ddl: "ALTER TABLE agents ADD COLUMN consec_fails INTEGER NOT NULL DEFAULT 0" },
  // WHAT THIS AGENT HAS ACTUALLY BEEN PAID.
  //
  // The hire screen defaulted its budget field to "1" - one whole U - while
  // every proven agent on the kernel settles at 0.05 to 0.10. A client who
  // accepted the default overpaid by 10x to 20x, and escrow releases the whole
  // budget, so there is no change. The number to show them was already in the
  // jobs table; it had simply never been aggregated.
  //
  // Raw 18-decimal units as TEXT, like settled_raw, because these overflow a
  // JS Number and must survive the round trip exactly.
  { table: "agent_record", column: "price_med_raw", ddl: "ALTER TABLE agent_record ADD COLUMN price_med_raw TEXT" },
  { table: "agent_record", column: "price_min_raw", ddl: "ALTER TABLE agent_record ADD COLUMN price_min_raw TEXT" },
  { table: "agent_record", column: "price_max_raw", ddl: "ALTER TABLE agent_record ADD COLUMN price_max_raw TEXT" },
  // How many settled jobs the figures above are drawn from. Published next to
  // the price, because "0.10 from six jobs" and "0.10 from one" are different
  // claims and the UI must not flatten them.
  { table: "agent_record", column: "price_n", ddl: "ALTER TABLE agent_record ADD COLUMN price_n INTEGER NOT NULL DEFAULT 0" },
  // Settled jobs with a ZERO budget, counted and excluded from the price.
  // 505 exist. AgentCensus Health Factor Monitor has enough of them that its
  // median is 0.0000 - the agent looks free, and it is not.
  { table: "agent_record", column: "price_zero_n", ddl: "ALTER TABLE agent_record ADD COLUMN price_zero_n INTEGER NOT NULL DEFAULT 0" },
  // WHEN AN AGENT CAME INTO EXISTENCE, which §3 and §5 both record as
  // unobtainable. 8004scan gives the registration BLOCK; the chain gives that
  // block its time. Unix seconds, resolved once by resolve-blocks.ts - blocks
  // are immutable, so this never needs recomputing.
  { table: "scan8004_detail", column: "created_at", ddl: "ALTER TABLE scan8004_detail ADD COLUMN created_at INTEGER" },
  // THE TERMIX RUBRIC, IN THE FIELD NAMES.
  //
  // That track scores "a real record: win rate, the window, and the risk taken
  // to get there". We held the ingredients and made a reader translate:
  // completion_pct is not a win rate, and nothing anywhere said what was at
  // stake on a single job. These name the things the rubric names.
  //
  // Clients who came back. One client hiring twelve times is a very different
  // market signal from twelve clients hiring once, and both read as "12 jobs".
  { table: "agent_record", column: "repeat_clients", ddl: "ALTER TABLE agent_record ADD COLUMN repeat_clients INTEGER NOT NULL DEFAULT 0" },
  // The largest single escrow this agent has ever been trusted with - "the
  // risk taken", in raw units of U.
  { table: "agent_record", column: "max_job_raw", ddl: "ALTER TABLE agent_record ADD COLUMN max_job_raw TEXT" },
  // Jobs where the CLIENT is the agent's own owner wallet. `client != provider`
  // already bars an agent hiring its own payment address, but an operator can
  // hire its own agent from a different wallet it also controls, and that is
  // wash trading one level up. Counted, never silently dropped.
  { table: "agent_record", column: "self_dealt", ddl: "ALTER TABLE agent_record ADD COLUMN self_dealt INTEGER NOT NULL DEFAULT 0" },
];

export function openDb(path = DB_PATH): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf8"));

  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (cols.length && !cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
  return db;
}

export interface AgentRow {
  agent_id: string;
  owner: string | null;
  token_uri: string | null;
  reg_valid: number;
  reg_fetch_error: string | null;
  name: string | null;
  description: string | null;
  endpoint: string | null;
  endpoint_service: string | null;
  endpoint_host: string | null;
  declared_class: string;
  verified_class: string;
  x402_claimed: number;
  first_party: number;
  reg_host: string | null;
  categories_json: string | null;
}

export function makeStatements(db: DatabaseSync) {
  const upsertAgent = db.prepare(`
    INSERT INTO agents (
      agent_id, owner, token_uri, reg_valid, reg_fetch_error, name, description,
      endpoint, endpoint_service, endpoint_host, declared_class, x402_claimed,
      first_party, reg_host, categories_json
    ) VALUES (
      :agent_id, :owner, :token_uri, :reg_valid, :reg_fetch_error, :name, :description,
      :endpoint, :endpoint_service, :endpoint_host, :declared_class, :x402_claimed,
      :first_party, :reg_host, :categories_json
    )
    ON CONFLICT(agent_id) DO UPDATE SET
      owner=excluded.owner,
      token_uri=excluded.token_uri,
      reg_valid=excluded.reg_valid,
      reg_fetch_error=excluded.reg_fetch_error,
      name=excluded.name,
      description=excluded.description,
      endpoint=excluded.endpoint,
      endpoint_service=excluded.endpoint_service,
      endpoint_host=excluded.endpoint_host,
      declared_class=excluded.declared_class,
      x402_claimed=excluded.x402_claimed,
      reg_host=excluded.reg_host,
      categories_json=excluded.categories_json
      -- first_party is deliberately NOT overwritten: it is set by us, not by
      -- anything the chain or a registration file says. verified_* is likewise
      -- untouched here - only the prober may write what it found.
  `);

  const setCursor = db.prepare(
    `INSERT INTO indexer_cursor (stream, block) VALUES (?, ?)
     ON CONFLICT(stream) DO UPDATE SET block=excluded.block`,
  );
  const getCursor = db.prepare(`SELECT block FROM indexer_cursor WHERE stream = ?`);

  return {
    upsertAgent,
    setCursor: (stream: string, n: number) => setCursor.run(stream, n),
    getCursor: (stream: string): number => {
      const r = getCursor.get(stream) as { block?: number } | undefined;
      return r?.block ?? 0;
    },
    tx<T>(fn: () => T): T {
      db.exec("BEGIN");
      try { const v = fn(); db.exec("COMMIT"); return v; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

// SQLite via node:sqlite - built into Node 22, so no native module to compile
// on Windows and no install step before the resolver can run.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.BNB_MRKT_DB ?? join(HERE, "..", "..", "bnb-mrkt.db");

export function openDb(path = DB_PATH): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf8"));
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

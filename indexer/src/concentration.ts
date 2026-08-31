// Feedback concentration — signal 3 of the v1 set (ROADMAP §5).
//
// "400 reviews from 6 addresses" vs "380 from 340" is the entire story, and the
// registry hands it over without any log history: getClients(agentId) returns
// the full rater list from the agent id alone (§3.8), and getLastIndex(agentId,
// client) returns that client's entry count. No backfill, no Envio token.
//
// Two passes, because the second is only worth making for agents that have any
// raters at all — measured at ~1.3% of the corpus:
//   1. getClients over every agent          (1 call per agent)
//   2. getLastIndex per (agent, rater) pair (only for the ~1.3%)
//
//   node --experimental-strip-types src/concentration.ts [--from N] [--to N] [--limit N]

import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { SEL, encodeUint, decodeAddressArray } from "./abi.ts";
import { Rpc, sleep, type CallResult } from "./rpc.ts";
import { openDb } from "./db.ts";

const CURSOR = "concentration:scan";
const CHUNK = 1000;

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
}

/** uint64 return -> number. Entry counts are far below 2^53. */
function decodeUint(hex: string | null): number {
  if (!hex || hex === "0x") return 0;
  return Number(BigInt(hex));
}

/** Retry a batch until every call resolves. Rule 0: stall, never guess. */
async function resolved(rpc: Rpc, calls: { to: string; data: string }[], label: string) {
  const batches: (typeof calls)[] = [];
  for (let i = 0; i < calls.length; i += rpc.batchSize) batches.push(calls.slice(i, i + rpc.batchSize));
  for (let attempt = 0; ; attempt++) {
    try {
      const out = (await rpc.pool(batches, (b) => rpc.ethCallDetailed(b))).flat() as CallResult[];
      const bad = out.findIndex((r) => !r || r.kind === "error");
      if (bad >= 0) {
        const r = out[bad];
        throw new Error(r && r.kind === "error" ? r.message : "missing result");
      }
      return out;
    } catch (e: any) {
      const wait = Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
      process.stdout.write(`\n  ${label} failed (${e?.message ?? e}); retry in ${(wait / 1000).toFixed(0)}s\n`);
      await sleep(wait);
    }
  }
}

async function main() {
  const rpc = new Rpc({ perEndpoint: Number(process.env.RPC_PER_ENDPOINT ?? 1) });
  const db = openDb();

  const from = arg("from", 0) || (db.prepare(
    `SELECT block FROM indexer_cursor WHERE stream = ?`).get(CURSOR) as any)?.block + 1 || 1;
  const limit = arg("limit", 0);
  let to = arg("to", 0) || (db.prepare(
    `SELECT MAX(CAST(agent_id AS INTEGER)) m FROM agents`).get() as any).m as number;
  if (limit) to = Math.min(to, from + limit - 1);

  const upsert = db.prepare(`
    INSERT INTO concentration (agent_id, computed_at, distinct_raters, rating_count,
                               top_rater_share_pct, top_rater)
    VALUES (:agent_id, :computed_at, :distinct_raters, :rating_count, :share, :top_rater)
    ON CONFLICT(agent_id) DO UPDATE SET
      computed_at=excluded.computed_at, distinct_raters=excluded.distinct_raters,
      rating_count=excluded.rating_count, top_rater_share_pct=excluded.top_rater_share_pct,
      top_rater=excluded.top_rater`);
  const setCursor = db.prepare(
    `INSERT INTO indexer_cursor (stream, block) VALUES (?, ?)
     ON CONFLICT(stream) DO UPDATE SET block=excluded.block`);

  console.log(`concentration scan: ids ${from}..${to}  (${to - from + 1} agents)`);
  const t0 = Date.now();
  let done = 0, withAny = 0, rowsWritten = 0;

  for (let start = from; start <= to; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, to);
    const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    // Pass 1 - who rated each agent.
    const clientsRes = await resolved(rpc, ids.map((id) => ({
      to: ERC8004.reputationRegistry, data: encodeUint(SEL.getClients, id),
    })), `chunk ${start}-${end} getClients`);

    const rated: { id: number; clients: string[] }[] = [];
    ids.forEach((id, i) => {
      const r = clientsRes[i];
      // A revert here means the agent id does not exist in the reputation
      // registry's view, which is simply "no feedback" - not a failure.
      if (!r || r.kind !== "ok") return;
      const clients = decodeAddressArray(r.data);
      if (clients.length) rated.push({ id, clients });
    });
    withAny += rated.length;

    // Pass 2 - how many entries each rater left. Only for agents with raters.
    const pairs = rated.flatMap((a) => a.clients.map((c) => ({ id: a.id, client: c })));
    let counts: number[] = [];
    if (pairs.length) {
      const res = await resolved(rpc, pairs.map((p) => ({
        to: ERC8004.reputationRegistry,
        data: SEL.getLastIndex + p.id.toString(16).padStart(64, "0") + p.client.slice(2).padStart(64, "0"),
      })), `chunk ${start}-${end} getLastIndex`);
      counts = res.map((r) => (r && r.kind === "ok" ? decodeUint(r.data) : 0));
    }

    const byAgent = new Map<number, { clients: string[]; counts: number[] }>();
    let k = 0;
    for (const a of rated) {
      const cs = a.clients.map(() => counts[k++] ?? 0);
      byAgent.set(a.id, { clients: a.clients, counts: cs });
    }

    db.exec("BEGIN");
    try {
      for (const [id, v] of byAgent) {
        const total = v.counts.reduce((x, y) => x + y, 0);
        let topIdx = 0;
        for (let i = 1; i < v.counts.length; i++) if (v.counts[i]! > v.counts[topIdx]!) topIdx = i;
        upsert.run({
          agent_id: String(id),
          computed_at: new Date().toISOString(),
          distinct_raters: v.clients.length,
          rating_count: total,
          // NULL, not 0, when there is nothing to take a share of.
          share: total > 0 ? Math.round((v.counts[topIdx]! / total) * 100) : null,
          top_rater: v.clients[topIdx] ?? null,
        });
        rowsWritten++;
      }
      setCursor.run(CURSOR, end);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }

    done += ids.length;
    const rate = done / ((Date.now() - t0) / 1000);
    process.stdout.write(
      `\r  ${end}/${to}  ${(100 * (end - from + 1) / (to - from + 1)).toFixed(1)}%` +
      `  ${rate.toFixed(0)}/s  eta ${((to - end) / Math.max(rate, 0.001) / 60).toFixed(1)}m` +
      `  [rated ${withAny}]   `);
  }

  console.log(`\n\ndone in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`agents with any feedback: ${withAny} of ${done} (${(100 * withAny / done).toFixed(3)}%)`);
  console.log(`rows written: ${rowsWritten}`);
  db.close();
}

main().catch((e) => { console.error("\nfatal:", e); process.exit(1); });

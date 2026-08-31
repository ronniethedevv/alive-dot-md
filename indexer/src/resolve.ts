// Resolver, phase 1: the eth_call sweep.
//
// ROADMAP section 4/9: enumerate every agent id by sequential eth_call. No
// logs, no archive access, no Envio dependency - this pass is what takes the
// blocked backfill off the critical path.
//
// It reads tokenURI + ownerOf for every id, classifies everything that resolves
// inline (~54% of the corpus, zero network cost beyond RPC), and queues the
// http(s) URIs for phase 2. Resumable: progress is checkpointed per chunk, so
// killing it and restarting costs at most one chunk.
//
//   node --experimental-strip-types src/resolve.ts [--from N] [--to N] [--limit N]

import { ERC8004 } from "../../packages/shared/src/chain.ts";
import { SEL, encodeUint, decodeString } from "./abi.ts";
import { Rpc, sleep, type CallResult } from "./rpc.ts";
import { openDb, makeStatements } from "./db.ts";
import { resolveInline } from "./classify.ts";

const CURSOR = "resolve:identity";
const CHUNK = 1000;

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
}

/** Highest minted id. Binary search on ownerOf, which reverts past the end. */
async function findMaxId(rpc: Rpc, hint = 400_000): Promise<number> {
  const exists = async (id: number) => {
    const [r] = await rpc.ethCallBatch([
      { to: ERC8004.identityRegistry, data: encodeUint(SEL.ownerOf, id) },
    ]);
    return r != null && r !== "0x";
  };
  let lo = 1;
  let hi = hint;
  if (await exists(hi)) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

async function main() {
  const rpc = new Rpc({ perEndpoint: Number(process.env.RPC_PER_ENDPOINT ?? 1) });
  const db = openDb();
  const st = makeStatements(db);

  const from = arg("from", 0) || st.getCursor(CURSOR) + 1;
  const limit = arg("limit", 0);
  let to = arg("to", 0);
  if (!to) {
    process.stdout.write("finding max agent id ... ");
    to = await findMaxId(rpc);
    console.log(to);
  }
  if (limit) to = Math.min(to, from + limit - 1);

  console.log(`resolving ids ${from}..${to}  (${to - from + 1} agents)`);
  console.log(`rpc: ${rpc.endpoints.length} endpoints, concurrency ${rpc.concurrency}, batch ${rpc.batchSize}`);

  const t0 = Date.now();
  let done = 0;
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };

  for (let start = from; start <= to; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, to);
    const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    // tokenURI ALONE, not tokenURI + ownerOf.
    //
    // Both revert with the same ERC721NonexistentToken error (0x7e273289) on an
    // unminted id, and a minted agent with no registration returns "" rather
    // than reverting. So tokenURI already distinguishes minted from unminted,
    // and calling ownerOf too was doubling a 640k-call sweep for a field we do
    // not need until an agent is actually displayed. Owner is backfilled lazily
    // for the small set that survives the endpointClass filter.
    //
    // Halving the calls is also the polite change: this is free public
    // infrastructure and the first attempt at full concurrency earned sustained
    // rate limiting from every endpoint in the pool.
    const calls = ids.map((id) => (
      { to: ERC8004.identityRegistry, data: encodeUint(SEL.tokenURI, id) }
    ));
    const batches: (typeof calls)[] = [];
    for (let i = 0; i < calls.length; i += rpc.batchSize) {
      batches.push(calls.slice(i, i + rpc.batchSize));
    }
    // A chunk must either resolve completely or not advance the cursor. An RPC
    // failure that reached here would otherwise decode as "ownerOf reverted"
    // and silently record live agents as unminted, corrupting every denominator
    // in stats.ts. So retry the chunk indefinitely with backoff; this pass is
    // long-running and resumable, and a stalled chunk is always better than a
    // wrong one.
    let results: CallResult[] = [];
    for (let attempt = 0; ; attempt++) {
      try {
        results = (await rpc.pool(batches, (b) => rpc.ethCallDetailed(b))).flat();
        // Validate INSIDE the retry loop. An unresolved call is exactly the
        // condition this loop exists to wait out, so checking it after the loop
        // (as this did) turns a retryable stall into a crash - the whole point
        // of Rule 0 is that we wait rather than record, and waiting has to be
        // reachable from here.
        const bad = results.findIndex((r) => !r || r.kind === "error");
        if (bad >= 0) {
          const r = results[bad];
          throw new Error(
            `unresolved call for id ${ids[bad]}: ${r && r.kind === "error" ? r.message : "missing"}`,
          );
        }
        break;
      } catch (e: any) {
        const wait = Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 5));
        process.stdout.write(`
  chunk ${start}-${end} failed (${e?.message ?? e}); retry in ${(wait / 1000).toFixed(0)}s
`);
        await sleep(wait);
      }
    }

    const rows: any[] = [];
    {
      ids.forEach((id, i) => {
        const res = results[i];
        // Rule 0. Dropping ownerOf left tokenURI as the SOLE signal for
        // "unminted", so the revert/error distinction has to carry that weight
        // alone - there is no second call to cross-check against any more.
        //
        //   revert -> the contract said this id does not exist. A fact.
        //   error  -> we failed to ask. NOT a fact, and recording it as
        //             "unminted" would shrink the corpus in the direction that
        //             flatters every scarcity figure we publish.
        // Unreachable: the retry loop above refuses to exit while any call is
        // unresolved. Kept as a guard so a future refactor cannot quietly
        // reintroduce "transport failure recorded as unminted".
        if (!res || res.kind === "error") {
          throw new Error(`unresolved call for id ${id}: ${res?.message ?? "missing"}`);
        }
        if (res.kind === "revert") { bump("unminted"); return; }
        const rawUri = decodeString(res.data);
        const r = resolveInline(rawUri, String(id));
        bump(r.uriKind === "http" ? "http:pending" : r.declaredClass);
        rows.push({
          agent_id: String(id),
          owner: null, // backfilled lazily; see the note on the call stream above
          token_uri: rawUri,
          reg_valid: r.registrationFileValid ? 1 : 0,
          reg_fetch_error: r.regError,
          name: r.name,
          description: r.description,
          endpoint: r.endpoint,
          endpoint_service: r.endpointServiceName,
          endpoint_host: r.endpointHost,
          declared_class: r.declaredClass,
          x402_claimed: r.x402Claimed ? 1 : 0,
          first_party: 0,
          reg_host: r.regHost,
          categories_json: r.categories.length ? JSON.stringify(r.categories) : null,
        });
      });
    }

    st.tx(() => {
      for (const row of rows) st.upsertAgent.run(row);
      st.setCursor(CURSOR, end);
    });

    done += ids.length;
    const rate = done / ((Date.now() - t0) / 1000);
    const eta = (to - end) / Math.max(rate, 0.001);
    process.stdout.write(
      `\r  ${end}/${to}  ${(100 * (end - from + 1) / (to - from + 1)).toFixed(1)}%` +
      `  ${rate.toFixed(0)}/s  eta ${(eta / 60).toFixed(1)}m` +
      `  [machine ${tally.machine ?? 0} web ${tally["web-only"] ?? 0}` +
      ` tmpl ${tally.template ?? 0} none ${tally.none ?? 0} http ${tally["http:pending"] ?? 0}]   `,
    );
  }

  console.log("\n\ndone in", ((Date.now() - t0) / 1000).toFixed(0), "s");
  console.log("this run:", tally);
  console.log("rpc stats:", rpc.stats);
  console.log("endpoints:", rpc.health());
  db.close();
}

main().catch((e) => { console.error("\nfatal:", e); process.exit(1); });

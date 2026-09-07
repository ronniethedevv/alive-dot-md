// Resolver, phase 2: fetch the http(s) registration files.
//
// ROADMAP section 9 is explicit about why this is not a simple queue. In the
// Day 0 sample 43% of registration URIs were http(s), and ~76% of those sat on
// a single host. At the prober's fixed 1 req/s that is ~29 hours against
// evoevo.ai alone, which would eat Days 1-2 whole and block every true count
// Rule 1 depends on.
//
// The prober's fixed cap is right for a SUSTAINED loop. This pass runs once, so
// it gets adaptive concurrency instead: ramp up per host while the host is
// happy, collapse on 429/5xx, honour Retry-After, and never let one slow host
// stall the others. A host that can take 32 concurrent requests should be
// allowed to; a host returning 429 should be backed off hard.
//
//   node --experimental-strip-types src/fetch-registrations.ts [--limit N]

import { openDb, makeStatements } from "./db.ts";
import { classifyDoc, hostOf } from "./classify.ts";
import { sleep } from "./rpc.ts";

const UA = "alive-md-resolver/0.1 (ERC-8004 registration resolver; contact via repo)";

interface Pending { agent_id: string; token_uri: string; reg_host: string }

/**
 * AIMD concurrency controller, one per host.
 * Additive increase on success, multiplicative decrease on pushback - the same
 * shape TCP uses, for the same reason: it finds the ceiling without knowing it.
 */
class HostLimiter {
  limit = 2;
  inFlight = 0;
  private okStreak = 0;
  pausedUntil = 0;
  stats = { ok: 0, fail: 0, rateLimited: 0 };

  host: string;
  maxLimit: number;
  constructor(host: string, maxLimit = 24) {
    this.host = host;
    this.maxLimit = maxLimit;
  }

  canStart(): boolean {
    return this.inFlight < this.limit && Date.now() >= this.pausedUntil;
  }

  onSuccess() {
    this.stats.ok++;
    this.okStreak++;
    // Additive increase, but only after a run of clean responses so a single
    // lucky request does not ramp us into a limit.
    if (this.okStreak >= 5 && this.limit < this.maxLimit) {
      this.limit++;
      this.okStreak = 0;
    }
  }

  onPushback(retryAfterMs: number | null) {
    this.stats.rateLimited++;
    this.okStreak = 0;
    this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.pausedUntil = Date.now() + (retryAfterMs ?? 5_000);
  }

  onError() {
    this.stats.fail++;
    this.okStreak = 0;
  }
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(60_000, secs * 1000);
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.max(0, Math.min(60_000, when - Date.now())) : null;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const cap = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : 0;

  const db = openDb();
  const st = makeStatements(db);

  // --retry also re-fetches TRANSIENT failures. A fetch-fail or timeout is our
  // inability to ask, not the agent's answer, and leaving it lands the agent in
  // declaredClass `none` - which reads as "declares no endpoint" and understates
  // the registry in the direction that flatters us (Rule 0). 22,882 rows failed
  // this way while two fetcher processes were competing for the same hosts;
  // spot-checking them by hand afterwards returned HTTP 200. Permanent answers
  // (404, parse failures) are NOT retried - those are real findings.
  const retry = process.argv.includes("--retry") ? 1 : 0;
  const pending = db.prepare(`
    SELECT agent_id, token_uri, reg_host FROM agents
    WHERE token_uri LIKE 'http%'
      AND (
        reg_fetch_error = 'pending-fetch'
        OR (:retry = 1 AND (
              reg_fetch_error IN ('fetch-fail', 'timeout')
              OR reg_fetch_error LIKE 'http-5%'))
      )
    ORDER BY reg_host, agent_id
    ${cap ? "LIMIT " + cap : ""}
  `).all({ retry }) as unknown as Pending[];

  if (pending.length === 0) {
    console.log("nothing pending. run resolve.ts first.");
    db.close();
    return;
  }

  // Bucket by host so each host advances at its own measured pace.
  const byHost = new Map<string, Pending[]>();
  for (const p of pending) {
    const h = p.reg_host || hostOf(p.token_uri) || "?";
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(p);
  }
  const limiters = new Map<string, HostLimiter>();
  for (const h of byHost.keys()) limiters.set(h, new HostLimiter(h));

  console.log(`phase 2: ${pending.length} registration files across ${byHost.size} hosts`);
  for (const [h, list] of [...byHost].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    console.log(`  ${String(list.length).padStart(7)}  ${h}`);
  }

  const t0 = Date.now();
  let done = 0;
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  const cursors = new Map<string, number>([...byHost.keys()].map((h) => [h, 0]));
  let writeBuf: any[] = [];

  const flush = () => {
    if (!writeBuf.length) return;
    const rows = writeBuf;
    writeBuf = [];
    st.tx(() => { for (const r of rows) st.upsertAgent.run(r); });
  };

  async function fetchOne(p: Pending, lim: HostLimiter) {
    let doc: unknown = null;
    let error: string | null = null;
    try {
      const res = await fetch(p.token_uri, {
        headers: { "user-agent": UA, accept: "application/json,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 429 || res.status === 503) {
        lim.onPushback(retryAfterMs(res));
        return false; // requeue: not this agent's fault
      }
      if (!res.ok) {
        error = `http-${res.status}`;
        lim.onSuccess(); // the host answered; the file is simply not there
      } else {
        const text = await res.text();
        try { doc = JSON.parse(text); } catch { error = "body-parse"; }
        lim.onSuccess();
      }
    } catch (e: any) {
      error = e?.name === "TimeoutError" ? "timeout" : "fetch-fail";
      lim.onError();
    }

    // agentId is passed so URI templates like ".../agents/{agentId}/card" can be
    // filled in rather than condemned as unresolvable. See classify.ts.
    const r = classifyDoc(doc, {
      kind: "http", regHost: p.reg_host, error, agentId: p.agent_id,
    });
    bump(error ? `err:${error}` : r.declaredClass);
    // NB: no `owner` and no `first_party` here. Phase 2 uses an UPDATE that
    // touches only registration-derived columns, because owner is known solely
    // from phase 1's ownerOf and first_party is set by us, never by a fetch.
    writeBuf.push({
      agent_id: p.agent_id,
      reg_valid: r.registrationFileValid ? 1 : 0,
      reg_fetch_error: error,
      name: r.name,
      description: r.description,
      endpoint: r.endpoint,
      endpoint_service: r.endpointServiceName,
      endpoint_host: r.endpointHost,
      declared_class: r.declaredClass,
      x402_claimed: r.x402Claimed ? 1 : 0,
      reg_host: p.reg_host,
      categories_json: r.categories.length ? JSON.stringify(r.categories) : null,
    });
    done++;
    return true;
  }

  // owner must not be clobbered by phase 2 - it is only known from phase 1.
  const upsertKeepOwner = db.prepare(`
    UPDATE agents SET
      reg_valid=:reg_valid, reg_fetch_error=:reg_fetch_error, name=:name,
      description=:description, endpoint=:endpoint, endpoint_service=:endpoint_service,
      endpoint_host=:endpoint_host, declared_class=:declared_class,
      x402_claimed=:x402_claimed, reg_host=:reg_host, categories_json=:categories_json
    WHERE agent_id = :agent_id
  `);
  st.upsertAgent = upsertKeepOwner as any;

  const inFlight = new Set<Promise<void>>();
  // Per-host retry queue. A rate-limited item goes to the BACK of this queue,
  // never back into the main list: the previous version rewound the host cursor
  // to `list.indexOf(p)`, which was an O(n) scan of a 111,000-entry array run
  // once per 429, and which re-fetched everything after that point. Together
  // that stalled the pass completely at ~52% while the host itself was healthy.
  const retryQ = new Map<string, typeof pending>();
  const attempts = new Map<string, number>();
  for (const h of byHost.keys()) retryQ.set(h, []);
  let allDone = false;

  while (!allDone) {
    let started = false;
    allDone = true;
    for (const [host, list] of byHost) {
      const lim = limiters.get(host)!;
      let idx = cursors.get(host)!;
      const rq = retryQ.get(host)!;
      if (idx < list.length || rq.length) allDone = false; else continue;
      while (lim.canStart() && (rq.length || idx < list.length)) {
        const p = rq.length ? rq.shift()! : list[idx++]!;
        cursors.set(host, idx);
        lim.inFlight++;
        started = true;
        const task = (async () => {
          const ok = await fetchOne(p, lim);
          if (!ok) {
            // Rate limited. Requeue at the back, with a cap so a host that
            // refuses forever ends the pass instead of looping in it. Giving up
            // is recorded as its own state by fetchOne, never as "no endpoint".
            const n = (attempts.get(p.agent_id) ?? 0) + 1;
            attempts.set(p.agent_id, n);
            if (n <= 5) retryQ.get(host)!.push(p);
          }
        })().finally(() => { lim.inFlight--; inFlight.delete(task); });
        inFlight.add(task);
      }
    }
    if (writeBuf.length >= 500) flush();
    if (!started) {
      if (inFlight.size) await Promise.race(inFlight);
      else await sleep(250);
    } else if (inFlight.size >= 64) {
      await Promise.race(inFlight);
    }
    if (done && done % 2000 < 2) {
      const rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  ${done}/${pending.length}  ${rate.toFixed(0)}/s   `);
    }
  }
  await Promise.all(inFlight);
  flush();

  console.log(`\n\nphase 2 done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log("outcomes:", tally);
  console.log("\nper-host limiter state:");
  for (const [h, l] of [...limiters].sort((a, b) => b[1].stats.ok - a[1].stats.ok).slice(0, 10)) {
    console.log(`  ${h.padEnd(46)} limit=${String(l.limit).padStart(2)} ok=${l.stats.ok} fail=${l.stats.fail} 429=${l.stats.rateLimited}`);
  }
  db.close();
}

main().catch((e) => { console.error("\nfatal:", e); process.exit(1); });

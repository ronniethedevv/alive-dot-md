// Batched JSON-RPC across a pool of public BSC endpoints.
//
// Phase 1 of the resolver makes ~640k eth_calls (tokenURI + ownerOf over
// 319,718 agents). Measured on 2026-08-30:
//
//   concurrency 8 on ONE endpoint -> 126 retries per 198 requests, 12 agents/s
//
// The binding constraint is calls per second per endpoint, NOT batch size. That
// looked like a size cap at first because a bigger batch trips a rate limit
// sooner, but the endpoints say so outright when pushed:
//
//   defibit @50 -> [{"id":null,"error":{"code":-32005,
//                    "message":"method eth_call in batch triggered rate limit"}}]
//   1rpc    @50 -> {"error":{"code":-32001,"message":"reached the usage limit"}}
//
// So the answer to a rate limit is to WAIT, not to shrink the batch: shrinking
// makes it strictly worse by needing more requests for the same work. Batches
// only downshift on a genuine short-array response. The throughput win is
// horizontal - a modest batch spread across several endpoints, each backed off
// independently. That mirrors the per-host rule the prober follows (ROADMAP 4).

export interface RpcCall { to: string; data: string }

/**
 * Per-call outcome. The three cases are deliberately NOT collapsible.
 *
 * Rule 0 (ROADMAP section 12): a transport failure must never be recordable in
 * a shape indistinguishable from an on-chain fact. This matters most on the
 * resolver's tokenURI path: a revert means "this id was never minted", which is
 * a fact about the chain, while a node error means "we failed to ask", which is
 * a fact about us. Returning null for both is what would let a bad hour of RPC
 * silently shrink the corpus - and shrinking the corpus flatters every scarcity
 * figure we report.
 */
export type CallResult =
  | { kind: "ok"; data: string }
  | { kind: "revert"; data: string | null }   // the contract answered: no
  | { kind: "error"; message: string };       // we failed to ask

/** JSON-RPC error codes that mean "the EVM reverted", not "the node failed". */
function isRevert(err: any): boolean {
  if (!err) return false;
  if (err.code === 3) return true;                     // eth_call execution revert
  return /execution reverted|revert/i.test(String(err.message ?? ""));
}

class RateLimited extends Error {
  // Written out longhand: `readonly x` constructor parameters are a TypeScript
  // parameter property, which Node's strip-only mode rejects.
  retryAfterMs: number | null;
  constructor(url: string, retryAfterMs: number | null = null) {
    super(`rate limited: ${url}`);
    this.retryAfterMs = retryAfterMs;
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

/** Node-agnostic rate-limit detection. Codes vary; the wording does not. */
function isRateLimit(err: any): boolean {
  if (!err) return false;
  if (err.code === -32005 || err.code === -32001 || err.code === -32029) return true;
  // Wording varies by provider and the codes are not reliable. blastapi says
  // "exceeded its compute units per second capacity" with no rate-limit code at
  // all, which sailed through as a plain per-call error and stalled the sweep.
  return /rate limit|too many|usage limit|quota|throttl|compute unit|capacity|exceeded/i
    .test(String(err.message ?? ""));
}

const DEFAULT_ENDPOINTS = [
  // Re-measured 2026-08-31 after a full session of sweeping. Public BSC RPC
  // health is a moving target and the pool must be re-tested, not assumed:
  // every endpoint used earlier in the sweep now answers 200 with an EMPTY
  // result array (or 429), which is throttling dressed as success. Both of
  // these serve batch=50 in under 500ms.
  "https://bsc.rpc.blxrbdn.com",
  "https://bsc-mainnet.public.blastapi.io",
  // Benched, all verified dead-to-us on 2026-08-31:
  //   defibit1/2/3, publicnode, ninicoin, bnbchain 1-4 -> 0/25 results or 429
  //   drpc -> http 500 | llamarpc, therpc, subquery -> connection failure
  //   meowrpc -> "Bad request" | pokt.nodies -> HTML | 1rpc -> -32001 quota
  //   blockrazor -> partial (21/25), usable only as a fallback
];

interface Endpoint {
  url: string;
  batchSize: number;
  inFlight: number;
  /** Consecutive failures. Endpoint is benched once this trips the threshold. */
  strikes: number;
  /** Epoch ms before which this endpoint is not eligible. */
  benchedUntil: number;
  ok: number;
  fail: number;
}

export interface RpcOpts {
  urls?: string[];
  batchSize?: number;
  /** Concurrent in-flight requests PER endpoint. Keep low; they rate limit. */
  perEndpoint?: number;
  maxRetries?: number;
}

export class Rpc {
  private eps: Endpoint[];
  readonly perEndpoint: number;
  readonly maxRetries: number;
  stats = { requests: 0, retries: 0, rpcErrors: 0, downshifts: 0, benched: 0, rateLimited: 0 };

  constructor(o: RpcOpts = {}) {
    const urls = o.urls ?? (process.env.BSC_RPC ? [process.env.BSC_RPC] : DEFAULT_ENDPOINTS);
    this.eps = urls.map((url) => ({
      url, batchSize: o.batchSize ?? 50, inFlight: 0, strikes: 0, benchedUntil: 0, ok: 0, fail: 0,
    }));
    this.perEndpoint = o.perEndpoint ?? 2;
    this.maxRetries = o.maxRetries ?? 6;
  }

  /** Total concurrent requests this pool will keep in flight. */
  get concurrency(): number { return this.eps.length * this.perEndpoint; }
  get endpoints(): string[] { return this.eps.map((e) => e.url); }
  /** Smallest batch size across live endpoints - the safe chunking unit. */
  get batchSize(): number { return Math.min(...this.eps.map((e) => e.batchSize)); }

  private pick(): Endpoint {
    const now = Date.now();
    const live = this.eps.filter((e) => e.benchedUntil <= now);
    const pool = live.length ? live : this.eps; // all benched: use anyway
    return pool.reduce((a, b) => (a.inFlight <= b.inFlight ? a : b));
  }

  private async post(ep: Endpoint, body: unknown): Promise<any> {
    ep.inFlight++;
    this.stats.requests++;
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      // 429 is pushback, not an error: bench this endpoint instead of burning
      // retries into the same limit. Letting it fall through as a generic
      // error is what killed the first full run at agent 3,000.
      if (res.status === 429) throw new RateLimited(ep.url, retryAfterMs(res));
      if (res.status >= 500) throw new Error(`http ${res.status}`);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const j = await res.json();
      ep.ok++; ep.strikes = 0;
      return j;
    } finally {
      ep.inFlight--;
    }
  }

  /**
   * eth_call a batch of calls. Results are positional; a per-call revert comes
   * back as null rather than throwing, because reverts are expected and
   * meaningful (ownerOf reverts on an unminted id, which is how gaps are found).
   */
  /** Back-compat shape: nulls conflate revert and error. Prefer ethCallDetailed. */
  async ethCallBatch(calls: RpcCall[], block = "latest"): Promise<(string | null)[]> {
    const rs = await this.ethCallDetailed(calls, block);
    return rs.map((r) => (r.kind === "ok" ? r.data : null));
  }

  /**
   * eth_call a batch, preserving the revert/error distinction per call.
   * Batch-level failures still throw so the caller can retry the whole chunk.
   */
  async ethCallDetailed(calls: RpcCall[], block = "latest"): Promise<CallResult[]> {
    if (calls.length === 0) return [];
    const out: CallResult[] = new Array(calls.length).fill(null).map(() => (
      { kind: "error", message: "no response" } as CallResult
    ));

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ep = this.pick();
      // Respect this endpoint's measured ceiling.
      if (calls.length > ep.batchSize) {
        const mid = Math.ceil(calls.length / 2);
        const [a, b] = await Promise.all([
          this.ethCallDetailed(calls.slice(0, mid), block),
          this.ethCallDetailed(calls.slice(mid), block),
        ]);
        return [...a, ...b];
      }
      try {
        const json = await this.post(ep, calls.map((c, i) => ({
          jsonrpc: "2.0", id: i, method: "eth_call",
          params: [{ to: c.to, data: c.data }, block],
        })));
        if (!Array.isArray(json)) throw new Error("non-array batch response");

        // A rate-limited batch comes back as a short array carrying one error
        // with a null id. Back the endpoint off; do NOT shrink the batch.
        if (json.length < calls.length && json.some((x: any) => isRateLimit(x?.error))) {
          throw new RateLimited(ep.url);
        }
        let got = 0;
        for (const item of json) {
          const i = typeof item?.id === "number" ? item.id : -1;
          if (i < 0 || i >= out.length) continue;
          if (item.error) {
            if (isRateLimit(item.error)) throw new RateLimited(ep.url);
            if (isRevert(item.error)) {
              // The contract answered. This is data.
              out[i] = { kind: "revert", data: item.error.data ?? null };
            } else {
              // The node failed. This is NOT data - see Rule 0 above.
              this.stats.rpcErrors++;
              out[i] = { kind: "error", message: String(item.error.message ?? "rpc error").slice(0, 120) };
            }
            got++; continue;
          }
          if (typeof item.result === "string") { out[i] = { kind: "ok", data: item.result }; got++; }
        }
        // A well-formed but short array is a genuine size cap. This is the only
        // condition that justifies shrinking.
        if (json.length < calls.length && calls.length > 1) {
          ep.batchSize = Math.max(5, Math.floor(calls.length / 2));
          this.stats.downshifts++;
          throw new Error(`short batch, downshift ${ep.url} -> ${ep.batchSize}`);
        }
        if (got === 0 && calls.length > 1) throw new Error("empty batch response");
        return out;
      } catch (e) {
        ep.fail++;
        ep.strikes++;
        this.stats.retries++;
        if (e instanceof RateLimited) {
          // Told to slow down: sit this endpoint out rather than retrying into
          // the same limit. The pool routes to a quieter host meanwhile.
          ep.benchedUntil = Date.now() + (e.retryAfterMs ?? 10_000);
          ep.strikes = 0;
          this.stats.rateLimited++;
        } else if (ep.strikes >= 3 && this.eps.length > 1) {
          ep.benchedUntil = Date.now() + 20_000;
          ep.strikes = 0;
          this.stats.benched++;
        }
        if (attempt === this.maxRetries) throw e;
        const wait = Math.min(8_000, 250 * 2 ** attempt) * (0.5 + Math.random());
        await sleep(wait);
      }
    }
    return out;
  }

  /** eth_getCode. "0x" means an externally owned account, not a failure. */
  async getCode(address: string, block = "latest"): Promise<string> {
    const j = await this.post(this.pick(), {
      jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, block],
    });
    if (j?.error) throw new Error(String(j.error.message ?? "eth_getCode failed"));
    return typeof j?.result === "string" ? j.result : "0x";
  }

  async blockNumber(): Promise<number> {
    const j = await this.post(this.pick(), { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
    return parseInt(j.result, 16);
  }

  /** Run jobs with a bounded pool, preserving input order in the output. */
  async pool<T, R>(jobs: T[], fn: (job: T, i: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(jobs.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, jobs.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        out[i] = await fn(jobs[i]!, i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  health(): string {
    return this.eps.map((e) => `${new URL(e.url).host}:${e.ok}/${e.ok + e.fail}@${e.batchSize}`).join(" ");
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

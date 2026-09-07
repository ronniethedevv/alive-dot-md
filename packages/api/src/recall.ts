// Widen the candidate set with 8004scan's semantic search.
//
//   node --experimental-strip-types packages/api/src/recall.ts "keep my lp in range"
//
// WHAT THIS IS FOR, AND WHAT IT IS EXPLICITLY NOT FOR.
//
// `expandNeed` (packages/shared/src/skills.ts) fixed retrieval for phrasings a
// table can anticipate. It cannot help with wording nobody thought to list.
// 8004scan runs embeddings over the same registry, so it can reach agents whose
// descriptions are semantically close to a request that shares none of its
// words - which is precisely the long tail the table gives up on.
//
// RECALL ONLY. NEVER RANKING.
//
// The ids that come back widen WHICH agents are considered and have no vote on
// the order. Ordering stays with `agent_trust`, because we measured 8004scan's
// reputation score at 0 for every one of our 25 proven agents - including ones
// with nine completed paid jobs. A system that cannot see settled money is a
// fine way to find candidates and a terrible way to rank them.
//
// Ids are also DATA, not instruction: they are integers, validated as integers,
// and every field the UI shows about a recalled agent still comes from our own
// index. Nothing 8004scan returns is rendered or scored directly.
//
// ── STATUS, 2026-09-06: THE UPSTREAM IS DOWN ──────────────────────────────
//
// Every 8004scan query carrying a filter or a search term returns
// `500 DATABASE_ERROR`. Verified across five shapes:
//
//   /agents/search/semantic?q=yield                        500
//   /agents/search/semantic?q=lending&semantic_weight=0    500   (pure full-text)
//   /agents?search=pancakeswap+liquidity&search_type=text  500
//   /agents?oasf_skill=analytical_skills/market_insights   500
//   /agents?has_a2a=true&x402_supported=true               500
//   /agents?chain_id=56&limit=1                            200   (no WHERE clause)
//
// Only unfiltered pagination works, so this is their query layer rather than
// our tier: anonymous is 30 req/min and we were nowhere near it. An API key
// does not fix a server-side database error, which is why one was not obtained.
//
// So this module is written, tested against the live endpoint, and OFF. It
// turns itself on when SCAN8004_RECALL=1 and stays silent-empty until then.
// Deliberately NOT yet joined into match.ts's ranking SQL: that query was just
// repaired (evidence before self-asserted relevance) and adding an OR branch
// for ids with no category match would let recalled agents bypass the exact
// guarantee the repair restored. Wiring it in is a ranking change and deserves
// to be made when it can be measured against a working endpoint.

const BASE = process.env.SCAN8004_BASE ?? "https://api.8004scan.io/api/v1";
const KEY = process.env.SCAN8004_API_KEY ?? "";
const CHAIN = Number(process.env.SCAN8004_CHAIN ?? 56);

/** Off unless asked for. See the status note above. */
export const enabled = () => process.env.SCAN8004_RECALL === "1";

let warned = false;

export interface RecallResult {
  /** ERC-8004 token ids, as strings, ready to join against `agents.agent_id`. */
  ids: string[];
  /** Why the list is empty, when it is. Never thrown, always reportable. */
  note: string | null;
}

/**
 * Ask 8004scan which agents are semantically near this request.
 *
 * Never throws and never blocks for long: a widener that can fail the search it
 * was meant to improve is worse than no widener. Every failure path returns an
 * empty list plus a reason, and the caller carries on with its own candidates.
 */
export async function recall(need: string, limit = 20): Promise<RecallResult> {
  if (!enabled()) return { ids: [], note: "recall disabled" };
  const q = (need ?? "").trim().slice(0, 500);
  if (!q) return { ids: [], note: "empty query" };

  const headers: Record<string, string> = { accept: "application/json", "user-agent": "alive-md/1.0" };
  if (KEY) { headers["x-api-key"] = KEY; headers.authorization = `Bearer ${KEY}`; }

  const url = `${BASE}/agents/search/semantic`
    + `?q=${encodeURIComponent(q)}&chain_id=${CHAIN}&limit=${Math.min(limit, 100)}`;

  try {
    // Short. This sits in front of a user waiting on a search, and our own
    // answer is already complete without it.
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(4_000) });
    if (!res.ok) {
      if (!warned) {
        warned = true;
        console.warn(`[recall] 8004scan semantic search http ${res.status} - recall is off for this process`);
      }
      return { ids: [], note: `upstream http ${res.status}` };
    }
    const j: any = await res.json();
    const items: any[] = j.items ?? j.data ?? j.results ?? [];
    // Integers only. A token id is the whole contract with this API; anything
    // that is not one is dropped rather than coerced.
    const ids = items
      .map((it) => String(it?.token_id ?? ""))
      .filter((id) => /^\d+$/.test(id));
    return { ids, note: ids.length ? null : "no semantic matches" };
  } catch (e: any) {
    if (!warned) {
      warned = true;
      console.warn(`[recall] 8004scan unreachable (${String(e?.name)}) - recall is off for this process`);
    }
    return { ids: [], note: `unreachable: ${String(e?.name)}` };
  }
}

// ── CLI: prove the degradation path without a working upstream ─────────────
if (import.meta.filename === process.argv[1]) {
  const q = process.argv.slice(2).filter((a) => !a.startsWith("-")).join(" ") || "keep my lp position in range";
  console.log(`query      ${JSON.stringify(q)}`);
  console.log(`enabled    ${enabled()}  (SCAN8004_RECALL=${process.env.SCAN8004_RECALL ?? "unset"})`);
  console.log(`key        ${KEY ? "set" : "none - anonymous"}`);
  const t0 = Date.now();
  const r = await recall(q);
  console.log(`result     ${r.ids.length} ids in ${Date.now() - t0}ms${r.note ? `  (${r.note})` : ""}`);
  if (r.ids.length) console.log(`ids        ${r.ids.slice(0, 12).join(", ")}`);
}

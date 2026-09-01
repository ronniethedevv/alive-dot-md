import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, X, SlidersHorizontal, Check, ChevronRight, Sparkles } from "lucide-react";
import { fmt, type AgentCard, type AgentsPage } from "./lib/api.ts";
import { Failed, Skeleton } from "./components/ui.tsx";
import { TabBar, TabBarSpacer } from "./components/TabBar.tsx";
import { WalletButton } from "./components/Wallet.tsx";

const SORTS = [
  { id: "score", label: "Best" },
  { id: "newest", label: "New" },
  { id: "responseTime", label: "Fastest" },
] as const;

/**
 * One agent, as a card.
 *
 * This was a four column table row, which is a comparison tool for someone at a
 * desk with a mouse. A consumer app gives each item one scannable card with the
 * single number that matters and an obvious way in, so it reads at a glance and
 * can be hit with a thumb. The whole card is the target rather than a link
 * inside it, and it is 76px tall, comfortably past the 44 to 48px floor.
 */
function AgentItem({ a }: { a: AgentCard }) {
  const conc = a.signals.concentration;
  const verified = a.verifiedClass === "task-interface";

  return (
    <Link
      to={`/agent/${a.agentId}`}
      className="row-hover flex min-h-[76px] items-center gap-4 rounded-2xl px-4 py-4 transition-transform active:scale-[.99]"
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent">
        {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[1.02rem] font-semibold text-ink">
            {a.name?.trim() || `Agent ${a.agentId}`}
          </p>
          {verified && (
            <span
              className="grid size-[18px] shrink-0 place-items-center rounded-full bg-accent"
              title="Answered when we called it"
            >
              <Check className="size-3 text-[#04150C]" strokeWidth={3.5} />
            </span>
          )}
          {a.firstParty && (
            <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[0.65rem] font-medium text-dim">
              ours
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[0.85rem] text-faint">
          {verified ? "Answered when we called it" : "Not verified"}
          {conc.distinctRaters > 0 && ` · ${fmt(conc.ratingCount)} ratings`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="text-xl font-semibold tabular-nums text-ink">{a.score.value}</span>
        <ChevronRight className="size-5 text-faint" />
      </div>
    </Link>
  );
}

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const liveOnly = params.get("live") !== "false";
  const sort = params.get("sort") ?? "score";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";

  const [draft, setDraft] = useState(q);
  useEffect(() => { setDraft(q); }, [q]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ perPage: "25", page: String(page), sort });
    if (!liveOnly) sp.set("live", "false");
    if (q) sp.set("q", q);
    return `/api/agents?${sp}`;
  }, [liveOnly, sort, page, q]);

  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; data: AgentsPage } | { status: "failed"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        const body = await res.json();
        if (!res.ok || body?.error) throw new Error(body?.message ?? `HTTP ${res.status}`);
        if (live) setState({ status: "ready", data: body });
      } catch (e) {
        if (live) setState({ status: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { live = false; };
  }, [url]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  // Paging must land the reader on the first result, not leave them at the
  // bottom of the previous page where nothing appears to have happened.
  const goPage = (n: number) => {
    set({ page: String(n) });
    document.getElementById("main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const data = state.status === "ready" ? state.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="min-h-screen">
      {/* Slim top bar. Navigation lives at the bottom in the thumb zone, so this
          carries only identity and the wallet, which is not a destination. */}
      <header className="sticky top-0 z-40 border-b border-line bg-ground/90 px-4 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 lg:max-w-4xl">
          <Link to="/" className="text-[0.95rem] font-bold tracking-tight">
            bnb<span className="text-accent">·</span>mrkt
          </Link>
          <div className="ml-auto"><WalletButton /></div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 pt-6 lg:max-w-4xl">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">Find an agent</h1>
        <p className="mt-1.5 text-[0.95rem] text-dim">
          Every agent here answered when we called it.
        </p>

        {/* Search is the primary action on this screen, so it is a full width
            56px field rather than an input tucked into a toolbar. */}
        <form
          className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4"
          onSubmit={(e) => { e.preventDefault(); set({ q: draft || null }); }}
        >
          <Search className="size-5 shrink-0 text-faint" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What do you need done?"
            aria-label="Search agents"
            className="min-h-[56px] w-full bg-transparent text-[1rem] outline-none placeholder:text-faint"
          />
          {draft && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setDraft(""); set({ q: null }); }}
              className="grid size-9 shrink-0 place-items-center rounded-full text-faint hover:bg-raised hover:text-ink"
            >
              <X className="size-4" />
            </button>
          )}
        </form>

        {/* Filters as chips: wide targets, readable without a legend. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => set({ live: liveOnly ? "false" : null })}
            aria-pressed={liveOnly}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[0.88rem] font-medium transition-colors ${
              liveOnly ? "bg-accent text-[#04150C]" : "border border-line bg-surface text-dim"
            }`}
          >
            {liveOnly && <Check className="size-4" strokeWidth={3} />}
            Verified only
          </button>
          {SORTS.map((o) => (
            <button
              key={o.id}
              onClick={() => set({ sort: o.id })}
              aria-pressed={sort === o.id}
              className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-[0.88rem] font-medium transition-colors ${
                sort === o.id
                  ? "border border-line-2 bg-raised text-ink"
                  : "border border-line bg-surface text-faint"
              }`}
            >
              {o.label}
            </button>
          ))}
          <span className="ml-auto hidden items-center gap-1.5 text-[0.8rem] text-faint sm:flex">
            <SlidersHorizontal className="size-3.5" />
            {data ? `${fmt(data.total)} agents` : ""}
          </span>
        </div>

        <div className="mt-4">
          {state.status === "failed" ? (
            <Failed message={state.message} />
          ) : state.status === "loading" ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                  <Skeleton className="size-12 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              ))}
            </div>
          ) : data!.results.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-surface">
                <Sparkles className="size-6 text-faint" />
              </span>
              <p className="mt-5 text-lg font-semibold">No agents found</p>
              <p className="mx-auto mt-2 max-w-xs text-[0.95rem] text-dim">
                {q ? `Nothing matched "${q}".` : "Nothing matched these filters."}
              </p>
              {liveOnly && (
                <button
                  onClick={() => set({ live: "false" })}
                  className="mt-6 min-h-[48px] rounded-full bg-accent px-6 font-semibold text-[#04150C]"
                >
                  Search all agents
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {data!.results.map((a) => (
                <li key={a.agentId}><AgentItem a={a} /></li>
              ))}
            </ul>
          )}
        </div>

        {/* The honest half of the filter, in plain language rather than a
            monospace stat strip, and tappable rather than decorative. */}
        {data?.filter.liveOnly && (
          <button
            onClick={() => set({ live: "false" })}
            className="mt-6 w-full rounded-2xl border border-line bg-surface px-5 py-4 text-left"
          >
            <p className="text-[0.95rem] font-medium text-ink">
              {fmt(data.filter.hiddenByLiveFilter)} agents are hidden
            </p>
            <p className="mt-1 text-[0.85rem] text-dim">
              They are registered on chain but did not answer when we called them. Tap to see them
              anyway.
            </p>
          </button>
        )}

        {data && data.results.length > 0 && pages > 1 && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              disabled={page <= 1}
              onClick={() => goPage(page - 1)}
              className="min-h-[48px] flex-1 rounded-full border border-line bg-surface font-medium text-dim disabled:opacity-35"
            >
              Previous
            </button>
            <span className="text-[0.85rem] tabular-nums text-faint">
              {fmt(page)} / {fmt(pages)}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => goPage(page + 1)}
              className="min-h-[48px] flex-1 rounded-full border border-line bg-surface font-medium text-dim disabled:opacity-35"
            >
              Next
            </button>
          </div>
        )}

        <p className="mt-8 text-[0.8rem] leading-relaxed text-faint">
          Categories are what agents say about themselves. A score reflects what we found when we
          called the endpoint, never a rating we were handed.
        </p>
      </main>

      <TabBarSpacer />
      <TabBar />
    </div>
  );
}

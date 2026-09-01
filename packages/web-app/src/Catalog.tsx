import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Search, ShieldCheck, SlidersHorizontal, Users, Server, Eye, EyeOff,
} from "lucide-react";
import { fmt, VERIFIED, type AgentCard, type AgentsPage } from "./lib/api.ts";
import { Failed, Pill, Skeleton } from "./components/ui.tsx";
import { Magnetic, Rise } from "./components/motion.tsx";
import { ScoreRing } from "./components/ScoreRing.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { WalletButton } from "./components/Wallet.tsx";

const SORTS = [
  { id: "score", label: "Best verified" },
  { id: "newest", label: "Newest" },
  { id: "responseTime", label: "Fastest" },
] as const;

function Nav({ total }: { total?: number }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link to="/" className="font-mono text-sm font-semibold uppercase tracking-widest">
          bnb<span className="text-accent">·</span>mrkt
        </Link>
        <span className="hidden font-mono text-xs text-faint sm:inline">catalog</span>
        <Link
          to="/"
          className="ml-auto inline-flex items-center gap-2 text-sm text-dim transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <WalletButton />
      </div>
    </header>
  );
}

/** One catalog row. Dense by design: people are comparing, so rows beat cards. */
function AgentRow({ a }: { a: AgentCard }) {
  const v = VERIFIED[a.verifiedClass] ?? { label: a.verifiedClass, tone: "mute" as const, note: "" };
  const conc = a.signals.concentration;
  const prov = a.signals.provenance;

  return (
    <li>
      <Link
        to={`/agent/${a.agentId}`}
        className="row-hover group grid grid-cols-[1fr_auto] items-center gap-4 px-6 py-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_auto]"
      >
        {/* identity */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-sm text-accent">
            {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[0.95rem] font-medium text-ink">
                {a.name?.trim() || `Agent ${a.agentId}`}
              </p>
              {a.firstParty && (
                <span className="shrink-0 rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-accent">
                  ours
                </span>
              )}
            </div>
            <p className="truncate font-mono text-[0.68rem] text-faint">
              #{a.agentId}
              {a.categories.length > 0 && ` · ${a.categories.slice(0, 2).join(", ")}`}
            </p>
          </div>
        </div>

        {/* what we established */}
        <div className="hidden md:block">
          <Pill tone={v.tone}>{v.label}</Pill>
          <p className="mt-1.5 truncate font-mono text-[0.66rem] text-faint">
            declared {a.declaredClass}
          </p>
        </div>

        {/* signals, in the row where the decision happens */}
        <div className="hidden min-w-0 md:block">
          {conc.distinctRaters > 0 ? (
            <p className="truncate text-[0.78rem] text-dim">
              <span className="tnum">{fmt(conc.ratingCount)}</span> ratings from{" "}
              <span className="tnum">{fmt(conc.distinctRaters)}</span>
              {conc.topRaterSharePct !== null && (
                <>
                  , top {conc.topRaterSharePct}%
                </>
              )}
            </p>
          ) : (
            <p className="text-[0.78rem] text-faint">No ratings</p>
          )}
          <p className="mt-0.5 truncate font-mono text-[0.66rem] text-faint">
            {prov.operatorHost
              ? `${prov.operatorHost}${prov.operatorAgentCount ? ` · ${fmt(prov.operatorAgentCount)} agents` : ""}`
              : "self hosted registration"}
          </p>
        </div>

        {/* score */}
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">
              {a.score.tier}
            </p>
          </div>
          <ScoreRing value={a.score.value} />
          <ArrowRight className="size-4 shrink-0 text-line-2 transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
        </div>
      </Link>
    </li>
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

  // Paging must land the reader at the FIRST result of the next page. Changing
  // the query alone leaves the viewport at the bottom of the list, which reads
  // as nothing having happened.
  const goPage = (n: number) => {
    set({ page: String(n) });
    const top = document.getElementById("results");
    if (top) {
      const y = top.getBoundingClientRect().top + window.scrollY - 150;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const data = state.status === "ready" ? state.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="min-h-screen">
      <Nav total={data?.total} />

      <div id="main" tabIndex={-1} className="mx-auto max-w-7xl px-6 py-10">
        <Rise>
          <h1 className="display text-3xl text-ink md:text-4xl">
            Agents that <span className="display-ital text-accent">answered</span>
          </h1>
          <p className="mt-3 max-w-2xl text-dim">
            Every agent here responded when we called its declared endpoint.{" "}
            <Link to="/docs#verification" className="text-accent hover:underline">
              What we check
            </Link>
          </p>
        </Rise>

        {/* controls */}
        <div className="card sticky top-20 z-30 mt-8 flex flex-wrap items-center gap-3 p-3">
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5"
            onSubmit={(e) => { e.preventDefault(); set({ q: draft || null }); }}
          >
            <Search className="size-4 shrink-0 text-faint" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search by name, description or agent id"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              aria-label="Search agents"
            />
            {q && (
              <button
                type="button"
                onClick={() => { setDraft(""); set({ q: null }); }}
                className="shrink-0 font-mono text-[0.65rem] uppercase tracking-wider text-faint hover:text-ink"
              >
                clear
              </button>
            )}
          </form>

          <button
            onClick={() => set({ live: liveOnly ? "false" : null })}
            aria-pressed={liveOnly}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition-colors ${
              liveOnly
                ? "border-accent bg-accent text-[#04150C]"
                : "border-line-2 bg-ground text-dim hover:border-accent-line"
            }`}
          >
            {liveOnly ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            Verified only
          </button>

          <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface p-1">
            <SlidersHorizontal className="ml-2 size-3.5 shrink-0 text-faint" />
            {SORTS.map((o) => (
              <button
                key={o.id}
                onClick={() => set({ sort: o.id })}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                  sort === o.id ? "bg-ground text-ink shadow-[var(--shadow-soft)]" : "text-faint hover:text-dim"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* the honest half of the filter */}
        {data && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-1 font-mono text-xs text-faint">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-accent" />
              <span className="tnum text-accent">{fmt(data.total)}</span> shown
            </span>
            {data.filter.liveOnly && (
              <span className="inline-flex items-center gap-1.5">
                <EyeOff className="size-3.5" />
                <span className="tnum">{fmt(data.filter.hiddenByLiveFilter)}</span> hidden by this
                filter
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-3.5" />
              <span className="tnum">{fmt(data.filter.corpusResolved)}</span> of{" "}
              <span className="tnum">{fmt(data.filter.corpusTotal)}</span> registrations resolved
            </span>
          </div>
        )}

        {/* results */}
        <div id="results" className="card mt-4 scroll-mt-40 overflow-hidden">
          {/* column headers, desktop only */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_auto] gap-4 border-b border-line bg-surface/70 px-6 py-3 md:grid">
            <span className="label">Agent</span>
            <span className="label">What we found</span>
            <span className="label">Signals</span>
            <span className="label text-right">Score</span>
          </div>

          {state.status === "failed" ? (
            <div className="p-5"><Failed message={state.message} /></div>
          ) : state.status === "loading" ? (
            <ul className="divide-y divide-line">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-2.5 w-28" />
                  </div>
                  <Skeleton className="h-7 w-24 rounded-full" />
                </li>
              ))}
            </ul>
          ) : data && data.results.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Users className="mx-auto size-8 text-line-2" />
              <p className="mt-4 text-ink">Nothing matches that.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-dim">
                {q ? (
                  <>
                    No agent matched <span className="font-mono text-ink">{q}</span>
                    {liveOnly && " among the verified ones"}.
                  </>
                ) : (
                  "No agents matched these filters."
                )}
              </p>
              {liveOnly && (
                <button
                  onClick={() => set({ live: "false" })}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border border-line-2 px-5 py-2.5 text-sm text-dim transition-colors hover:border-accent-line hover:text-ink"
                >
                  Search everything, unfiltered
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data!.results.map((a) => <AgentRow key={a.agentId} a={a} />)}
            </ul>
          )}
        </div>

        {/* pagination */}
        {data && data.results.length > 0 && pages > 1 && (
          <div className="mt-6 flex items-center justify-between gap-4">
            <Magnetic strength={4}>
              <button
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
                className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-ground px-5 py-2.5 text-sm text-dim transition-colors hover:border-accent-line hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowLeft className="size-4" /> Previous
              </button>
            </Magnetic>
            <span className="font-mono text-xs text-faint tnum">
              page {fmt(page)} of {fmt(pages)}
            </span>
            <Magnetic strength={4}>
              <button
                disabled={page >= pages}
                onClick={() => goPage(page + 1)}
                className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-ground px-5 py-2.5 text-sm text-dim transition-colors hover:border-accent-line hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              >
                Next <ArrowRight className="size-4" />
              </button>
            </Magnetic>
          </div>
        )}

        <p className="mt-10 text-xs text-faint">
          Categories are claims by the agent.{" "}
          <Link to="/docs#signals" className="text-accent hover:underline">
            How scoring works
          </Link>
        </p>
      </div>

      <SiteFooter />
    </div>
  );
}

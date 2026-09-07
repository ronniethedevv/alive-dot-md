import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, X, Check, ChevronDown, ChevronRight, Sparkles, SlidersHorizontal } from "lucide-react";
import { fmt, ms, useApi, VERIFIED, type AgentCard, type AgentsPage,
  type CategoriesPayload } from "./lib/api.ts";
import { Failed, Skeleton } from "./components/ui.tsx";
import { AppShell } from "./components/AppShell.tsx";

/**
 * What the catalog is showing.
 *
 * Three states rather than one "verified only" toggle, because a full scan of
 * the commerce kernel found these are DIFFERENT SETS with no overlap: 856
 * agents have been paid by a third party, 177 answer an HTTP call, and none of
 * them are the same agent. A single toggle implied one axis where there are
 * two, and the axis that was missing is the one about money.
 */
const SHOW = [
  { id: "paid", label: "Hired before", hint: "has completed paid work for someone" },
  { id: "live", label: "Answers a call", hint: "endpoint responded when we called it" },
  // NOT "everything on the registry". The catalog serves a snapshot of the
  // agents there is evidence for; the other 329,755 identities are counted, not
  // listed. Saying "everything" would be the same class of untrue statement as
  // a probe verdict printed as a fact about an agent.
  { id: "all", label: "All", hint: "every agent we hold evidence for" },
] as const;

const SORTS = [
  { id: "record", label: "Track record" },
  { id: "score", label: "Best" },
  // Tier order. "Best" ranks on verified_class, which is identical for every
  // agent in the live catalog, so this is the only ordering that surfaces the
  // one thing that differs: whether anyone has actually rated the agent.
  { id: "established", label: "Established" },
  { id: "newest", label: "New" },
  { id: "responseTime", label: "Fastest" },
] as const;

/**
 * One agent, as a row.
 *
 * Rows, not cards. Twenty-five floating cards imply twenty-five separate
 * objects; a ruled list implies one set of records, which is what a catalog is.
 * The whole row is the target and it clears the 44px floor without needing to
 * be tall.
 *
 * What it leads with, and why: the row used to lead with `score.value` in 20px
 * semibold. On the live catalog that number is 75 for essentially every row -
 * the score is a direct function of `verified_class`, and every listed agent
 * has the same one - so the loudest element on screen was a constant, and the
 * "Fastest" sort reordered by a latency the row never showed. It now leads with
 * the things that actually differ between two listings (how fast it answered,
 * who has rated it, what kind of interface it is) and carries the score as its
 * tier word, which is the field §8.1 says to lead with anyway.
 */
function AgentItem({ a, i = 0 }: { a: AgentCard; i?: number }) {
  const conc = a.signals.concentration;
  const verified = a.verifiedClass === "task-interface";
  const rt = a.live.responseTimeMs;

  /**
   * The second line, built from whatever is actually known about THIS agent.
   * It used to be the constant string "Answered when we called it", repeated
   * down all 177 rows, which is a sentence about the filter rather than about
   * the agent.
   */
  const facts: string[] = [];
  // The record comes FIRST when it exists. An agent that has been paid has told
  // us something no probe can: a stranger valued the work enough to fund it.
  if (a.record) {
    facts.push(`${fmt(a.record.completed)} of ${fmt(a.record.jobs)} jobs completed`);
    facts.push(`${fmt(a.record.clients)} ${a.record.clients === 1 ? "client" : "clients"}`);
  }
  if (verified && rt !== null) facts.push(`answered in ${ms(rt)}`);
  else if (verified) facts.push("answered when we called it");
  /**
   * A FAILED PROBE IS NOT A FACT WORTH PRINTING ABOUT AN AGENT THAT HAS BEEN PAID.
   *
   * This pushed the probe verdict unconditionally, so the top of the catalog
   * read:
   *
   *   AgentCensus Health Factor Monitor
   *   9 of 11 jobs completed · 2 clients · Its published endpoint returns an error
   *
   * Both halves are true and they are not equally important. Jobs settle
   * through the ERC-8183 commerce kernel; the HTTP endpoint is how you would
   * talk to an agent directly. The two are independent, and this agent proves
   * it - nine strangers' jobs completed and settled while its endpoint 404s.
   *
   * Printing the weakest fact beside the strongest invites the reader to
   * discount one with the other, and it made a working marketplace look
   * half-finished on the first screen. The detail page already says this
   * properly: "Its HTTP endpoint did not answer, which is normal for an agent
   * hired through escrow."
   *
   * So the verdict appears only when there is no settlement record to lead
   * with, where it is genuinely the best thing we know. Nothing is hidden - a
   * positive probe still shows above, and the full verdict is one click away.
   */
  else if (!(a.record?.completed)) facts.push(VERIFIED[a.verifiedClass]?.label ?? "not verified");
  /**
   * Ratings, qualified by whether they came from anyone selective.
   *
   * 33 addresses wrote 96.7% of every rating on this registry and one of them
   * has rated 924 agents, so a raw count is close to meaningless. The credible
   * figure is inverse-breadth weighted: below 0.5 the ratings came from raters
   * who rate everything, and the row says so rather than quoting the count.
   */
  if (conc.distinctRaters > 0) {
    facts.push(a.score.credibleRatings < 0.5
      ? `${fmt(conc.ratingCount)} ratings, but from bulk raters`
      : `${fmt(conc.ratingCount)} ratings, ${fmt(conc.distinctRaters)} raters`);
  }
  // The service name is only worth a slot when it says something the row does
  // not already say. "AgentCensus Health Factor Monitor · AgentCensus Health
  // Factor Monitor" was the first line of the catalog.
  if (a.serviceName && a.serviceName.trim().toLowerCase() !== (a.name ?? "").trim().toLowerCase()) {
    facts.push(a.serviceName);
  }

  return (
    <Link
      to={`/agent/${a.agentId}`}
      className="row-in row-hover group flex items-center gap-4 px-4 py-3.5"
      // Capped so a full page settles in ~0.3s rather than crawling down.
      style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}
    >
      <span className={`avatar size-9 shrink-0 text-[0.82rem] ${verified ? "avatar-accent" : ""}`}>
        {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[0.95rem] font-medium text-ink">
            {a.name?.trim() || `Agent ${a.agentId}`}
          </p>
          {/* A dot, not a filled check badge. At this size the badge was a
              second focal point on every row; the dot says the same thing and
              lets the name stay the loudest thing in the list. */}
          {verified && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-accent"
              title="Answered when we called it"
              aria-label="Verified"
            />
          )}
          {a.firstParty && <span className="pill pill-claim shrink-0">ours</span>}
        </div>
        <p className="meta mt-1 truncate">{facts.join("  ·  ")}</p>
      </div>

      <span className="hidden shrink-0 text-[0.76rem] text-faint sm:block">{a.score.tier}</span>
      <ChevronRight className="size-4 shrink-0 text-faint transition-colors group-hover:text-dim" />
    </Link>
  );
}

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  /** "paid" | "live" | "all". Defaults to paid: it is the stronger claim. */
  const show = params.get("show") ?? (params.get("live") === "false" ? "all" : "paid");
  const sort = params.get("sort") ?? "record";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";
  /** Set when arriving from the operators page. */
  const operator = params.get("operator") ?? "";
  /** Multi-select, comma separated in the URL, OR-matched by the server. */
  const cats = (params.get("category") ?? "").split(",").filter(Boolean);

  /**
   * How many choices are narrowing the list right now.
   *
   * Counts only what changes WHICH agents come back - the categories and the
   * show toggle. Sort sits in the drawer too but is deliberately not counted:
   * it reorders the same set, and a badge that ticks up when you reorder is
   * saying something untrue about what you are looking at.
   */
  const activeFilters = cats.length + (show !== "paid" ? 1 : 0);

  /**
   * The drawer starts open when something is already filtering.
   *
   * Landing on /catalog?category=yield with it collapsed shows a narrowed list
   * and no visible reason for it, which reads as a bug rather than a filter.
   */
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);

  const [draft, setDraft] = useState(q);
  useEffect(() => { setDraft(q); }, [q]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ perPage: "25", page: String(page), sort });
    // `live` and `paid` are independent server filters; the UI presents them as
    // one choice because in practice they never both apply to the same agent.
    if (show === "paid") { sp.set("live", "false"); sp.set("paid", "true"); }
    else if (show === "live") { /* server default is live-only */ }
    else sp.set("live", "false");
    if (q) sp.set("q", q);
    if (operator) sp.set("operator", operator);
    if (cats.length) sp.set("category", cats.join(","));
    return `/api/agents?${sp}`;
  }, [show, sort, page, q, operator, cats.join(",")]);

  /**
   * Counts are scoped to the CURRENT view, so a chip never promises rows the
   * filter cannot show: "Yield 88" under "Hired before" and "Yield 591" under
   * "All" are both true, and quoting the global number in the first case would
   * send the reader to an empty list.
   */
  const catUrl = show === "paid" ? "/api/categories?paid=true"
    : show === "live" ? "/api/categories?live=true"
      : "/api/categories";
  const catState = useApi<CategoriesPayload>(catUrl);
  const categories = catState.status === "ready" ? catState.data.categories : [];

  const toggleCat = (id: string) => {
    const next = cats.includes(id) ? cats.filter((c) => c !== id) : [...cats, id];
    set({ category: next.length ? next.join(",") : null });
  };

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
  // Suppressed when an operator filter is already active: the reader asked for
  // one operator, so telling them the results are one operator is noise.
  const oneOperator = !operator && data && data.results.length > 0
    && data.composition.distinctOperators === 1 && data.composition.topOperators[0];

  return (
    <AppShell title="Find an agent" lede={show === "paid"
        ? "Agents that have been paid to do work, and settled it on chain."
        : show === "live"
          ? "Agents whose endpoint answered when we called it."
          // Was "Every agent registered on this chain", which stopped being
          // true when the catalog moved to a static snapshot: this tab returns
          // the 1,039 agents with evidence, not the 330,794 on the registry.
          // The corpus figure is still shown, as a denominator rather than as a
          // promise about what the list contains.
          : "Every agent we hold evidence for. The rest of the registry is counted below, not listed."} wide>
      {/* Scoped to one operator, arrived at from the operators page. Stated as
          a removable filter rather than silently narrowing the catalog. */}
      {operator && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border-l border-accent-line pl-4">
          <span className="text-[0.88rem] text-dim">
            Showing only agents operated by{" "}
            <span className="font-mono text-[0.84rem] text-ink">{operator}</span>
          </span>
          <button onClick={() => set({ operator: null })} className="btn btn-ghost">
            <X className="size-3.5" /> Clear
          </button>
          <Link to="/operators" className="btn btn-ghost">All operators</Link>
        </div>
      )}

      {/* Toolbar. Search and filters are controls of one height, so the row
          aligns; on a phone they stack without changing size. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form
          className="field flex flex-1 items-center gap-2.5 px-3"
          onSubmit={(e) => { e.preventDefault(); set({ q: draft || null }); }}
        >
          <Search className="size-4 shrink-0 text-faint" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            /* Was "What do you need done?", which promised a capability search
               the query could not perform: it matched name and description
               only. The field now also searches the declared interface type and
               the OASF categories, and says so, because a search box that
               invites a sentence and matches substrings will fail on the first
               honest attempt to use it. */
            placeholder="Name, capability, interface or agent number"
            aria-label="Search agents"
            className="min-h-[40px] w-full bg-transparent text-[0.9rem] outline-none placeholder:text-faint"
          />
          {draft && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setDraft(""); set({ q: null }); }}
              className="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-surface hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>

        {/* One button for the whole filter area.

            The toolbar carried two segmented controls and a wrapping row of up
            to seventeen category chips, all above a list nobody has started
            reading yet. Nothing is removed and nothing is renamed - it is one
            click away, and the badge says when it is doing something. */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="catalog-filters"
          className={`btn min-h-[42px] shrink-0 gap-2 px-3.5 ${
            filtersOpen || activeFilters > 0 ? "btn-secondary" : "btn-ghost border border-line"
          }`}
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {activeFilters > 0 && (
            <span className="grid min-w-[1.25rem] place-items-center rounded-full bg-accent px-1 font-mono text-[0.7rem] font-semibold text-[#04150C]">
              {activeFilters}
            </span>
          )}
          <ChevronDown
            className={`size-3.5 text-faint transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* Every control that was in the toolbar, unchanged, one level down. */}
      <div id="catalog-filters" className={`filter-drawer ${filtersOpen ? "is-open" : ""}`}>
        <div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Show"
            className="flex items-center rounded-lg border border-line p-0.5"
          >
            {SHOW.map((o) => (
              <button
                key={o.id}
                onClick={() => set({ show: o.id, live: null })}
                aria-pressed={show === o.id}
                title={o.hint}
                className={`min-h-[32px] rounded-md px-3 text-[0.82rem] transition-colors ${
                  show === o.id ? "bg-surface font-medium text-ink" : "text-faint hover:text-dim"
                }`}
              >
                {show === o.id && o.id === "paid" && (
                  <Check className="mr-1 inline size-3 text-accent" strokeWidth={3} />
                )}
                {o.label}
              </button>
            ))}
          </div>

          {/* Sort as one segmented control rather than three loose chips: it is
              one choice, so it should read as one control. */}
          <div
            role="group"
            aria-label="Sort"
            className="flex items-center rounded-lg border border-line p-0.5"
          >
            {SORTS.map((o) => (
              <button
                key={o.id}
                onClick={() => set({ sort: o.id })}
                aria-pressed={sort === o.id}
                className={`min-h-[32px] rounded-md px-3 text-[0.82rem] transition-colors ${
                  sort === o.id ? "bg-surface font-medium text-ink" : "text-faint hover:text-dim"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

      {/* Categories. Self-described, multi-select, OR-matched — an agent can
          genuinely be monitoring AND risk AND lending, and a single-choice
          control would hide it from two of the three people looking for it.
          Empty categories are dropped rather than shown as dead chips. */}
      {categories.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {categories.filter((c) => c.agents > 0).map((c) => {
            const on = cats.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCat(c.id)}
                aria-pressed={on}
                title={`${fmt(c.agents)} here · ${fmt(c.proven)} have been paid`}
                className={`inline-flex min-h-[30px] items-center gap-1.5 rounded-md border px-2.5 text-[0.8rem] transition-colors ${
                  on
                    ? "border-accent-line bg-accent-soft text-accent"
                    : "border-line text-dim hover:border-line-2 hover:text-ink"
                }`}
              >
                {c.label}
                <span className={`font-mono text-[0.7rem] ${on ? "text-accent" : "text-faint"}`}>
                  {fmt(c.agents)}
                </span>
              </button>
            );
          })}
          {cats.length > 0 && (
            <button onClick={() => set({ category: null })} className="btn btn-ghost min-h-[30px] px-2">
              <X className="size-3.5" /> Clear
            </button>
          )}
        </div>
      )}

      {cats.length > 0 && (
        <p className="mt-3 text-[0.8rem] leading-relaxed text-faint">
          Categories come from what each agent says about itself in its own registration — a
          claim, not something we verified. Matching any one of your selections is enough.
        </p>
      )}
        </div>
      </div>

      {/* State of the query, as a meta line. */}
      <div className="mt-5 flex flex-wrap items-baseline gap-x-2">
        <span className="meta">{data ? `${fmt(data.total)} agents` : "—"}</span>
        {data && data.composition.distinctOperators > 0 && (
          <>
            <span className="meta text-line-2">/</span>
            <span className="meta">
              {fmt(data.composition.distinctOperators)}{" "}
              {data.composition.distinctOperators === 1 ? "operator" : "operators"}
            </span>
          </>
        )}
      </div>

      {/* Our own provenance signal, pointed at our own front page.
          §12: it would be indefensible to run this on other people's agents and
          stay quiet about the composition of our catalog. A reader can page
          through 177 listings without noticing they are one operator; this says
          it once, before they pick one. A rule in the margin rather than a
          filled callout — it is context, not an alert. */}
      {oneOperator && (
        <p className="mt-4 max-w-2xl border-l border-accent-line pl-4 text-[0.86rem] leading-relaxed text-dim">
          <span className="text-ink">
            Every agent below is operated by{" "}
            <span className="font-mono text-[0.82rem]">
              {data!.composition.topOperators[0]!.host}
            </span>
            .
          </span>{" "}
          {fmt(data!.total)} separate on-chain identities, one operator answering all of them. We
          show this because we run the same check on everyone else, and a directory that hides its
          own composition is the thing this catalog exists to argue against.
        </p>
      )}

      {/* One bordered surface with ruled rows. */}
      <div className="panel mt-6 overflow-hidden">
        {state.status === "failed" ? (
          <div className="p-4"><Failed message={state.message} /></div>
        ) : state.status === "loading" ? (
          <div className="divide-rule">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : data!.results.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <Sparkles className="mx-auto size-5 text-faint" />
            <p className="mt-4 text-[0.95rem] font-medium">No agents found</p>
            <p className="mx-auto mt-2 max-w-sm text-[0.88rem] leading-relaxed text-dim">
              {q ? `Nothing matched "${q}".` : "Nothing matched these filters."}
            </p>
            {q && (
              <p className="mx-auto mt-3 max-w-md text-[0.82rem] leading-relaxed text-faint">
                Search covers the name, description, declared interface and categories an agent
                publishes in its registration. Individual skills live in the agent's own card,
                which we call but do not index, so they are not searchable here yet.
              </p>
            )}
            {show !== "all" && (
              <button onClick={() => set({ show: "all", live: null })} className="btn btn-secondary mt-6">
                Search all agents
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-rule">
            {data!.results.map((a, i) => (
              <li key={a.agentId}><AgentItem a={a} i={i} /></li>
            ))}
          </ul>
        )}
      </div>

      {/* The honest half of the default filter. A quiet line under the list
          rather than a panel competing with the results above it. */}
      {show === "live" && data?.filter.liveOnly && data.results.length > 0 && (
        <button
          onClick={() => set({ live: "false" })}
          className="group mt-4 flex w-full flex-wrap items-baseline gap-x-2 text-left"
        >
          <span className="meta">{fmt(data.filter.hiddenByLiveFilter)} hidden</span>
          <span className="text-[0.84rem] leading-relaxed text-faint">
            registered on chain but did not answer when we called them.{" "}
            <span className="text-dim underline decoration-line-2 underline-offset-2 group-hover:text-ink">
              Show them
            </span>
          </span>
        </button>
      )}

      {data && data.results.length > 0 && pages > 1 && (
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
          <button disabled={page <= 1} onClick={() => goPage(page - 1)} className="btn btn-secondary">
            Previous
          </button>
          <span className="meta">{fmt(page)} / {fmt(pages)}</span>
          <button disabled={page >= pages} onClick={() => goPage(page + 1)} className="btn btn-secondary">
            Next
          </button>
        </div>
      )}

      <p className="mt-12 max-w-2xl text-[0.8rem] leading-relaxed text-faint">
        Categories are what agents say about themselves. A score reflects what we found when we
        called the endpoint, never a rating we were handed.
      </p>
    </AppShell>
  );
}

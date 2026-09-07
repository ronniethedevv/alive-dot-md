import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Loader2, Search } from "lucide-react";
import { fmt } from "./lib/api.ts";
import { AppShell } from "./components/AppShell.tsx";
import { Failed } from "./components/ui.tsx";

/**
 * The hiring concierge.
 *
 * TermiX scores "find, compare, hire, without instructions". This is the
 * without-instructions path: describe the job in a sentence, get a shortlist
 * ranked by money that has actually moved, and land on the hire screen with the
 * form already filled in.
 *
 * It does two things a search box cannot. It names the categories it recognised
 * in your words, so a wrong match is visible rather than mysterious. And it
 * drafts the acceptance criteria - §6 makes "what does done look like" the gate
 * for escrow readiness, and a blank box does not teach anyone how to clear it.
 *
 * What it deliberately does not do: pick a price, or sign anything. See
 * packages/api/src/match.ts for why there is no model in this path at all.
 */

interface Candidate {
  agentId: string;
  name: string | null;
  description: string | null;
  tier: string;
  score: number;
  completed: number;
  clients: number;
  categories: string[];
  hireable: boolean;
  because: string;
}

interface MatchResult {
  need: string;
  matched: { id: string; label: string; hits: string[] }[];
  candidates: Candidate[];
  draft: { task: string; conditions: string; days: number };
  note: string | null;
}

const EXAMPLES = [
  "Watch my Venus loan and warn me before I get liquidated",
  "Find the best stablecoin yield on BNB Chain right now",
  "Audit this contract for reentrancy",
  "Rebalance my portfolio to equal weights",
];

export default function Start() {
  const nav = useNavigate();
  const [need, setNeed] = useState("");
  /** Which candidate has its bio expanded. One at a time. */
  const [open, setOpen] = useState<string | null>(null);
  const [state, setState] = useState<
    { s: "idle" } | { s: "working" } | { s: "done"; r: MatchResult } | { s: "failed"; m: string }
  >({ s: "idle" });

  const ask = async (text: string) => {
    const t = text.trim();
    if (t.length < 4) return;
    setState({ s: "working" });
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ need: t }),
      });
      const r = await res.json();
      if (!res.ok || r.error) throw new Error(r.message ?? `HTTP ${res.status}`);
      setState({ s: "done", r });
    } catch (e) {
      setState({ s: "failed", m: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Hand the draft to the hire screen through router state rather than the URL.
   * A task description can be long and can contain anything; putting it in a
   * query string would truncate it and make it look like a tracking parameter.
   */
  const hire = (c: Candidate, r: MatchResult) =>
    nav(`/hire/${c.agentId}`, { state: { draft: r.draft } });

  const r = state.s === "done" ? state.r : null;

  return (
    <AppShell
      title="What do you need done?"
      lede="Describe it in a sentence. We will match it to agents that have actually been paid to do that kind of work, and draft the job for you."
    >
      <form
        className="field flex items-start gap-2.5 px-3 py-2"
        onSubmit={(e) => { e.preventDefault(); ask(need); }}
      >
        <Search className="mt-2.5 size-4 shrink-0 text-faint" />
        <textarea
          value={need}
          onChange={(e) => setNeed(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(need); }
          }}
          rows={2}
          placeholder="Watch my Venus loan and warn me before I get liquidated"
          aria-label="Describe what you need done"
          className="min-h-[52px] w-full resize-y bg-transparent py-2 text-[0.95rem] outline-none placeholder:text-faint"
        />
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => ask(need)}
          disabled={need.trim().length < 4 || state.s === "working"}
          className="btn btn-primary"
        >
          {state.s === "working"
            ? <><Loader2 className="size-4 animate-spin" /> Matching…</>
            : <>Find agents <ArrowRight className="size-4" /></>}
        </button>
        {state.s === "idle" && (
          <span className="text-[0.8rem] text-faint">or try one of these:</span>
        )}
      </div>

      {state.s === "idle" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((x) => (
            <button
              key={x}
              onClick={() => { setNeed(x); ask(x); }}
              className="rounded-md border border-line px-3 py-1.5 text-left text-[0.82rem] text-dim transition-colors hover:border-line-2 hover:text-ink"
            >
              {x}
            </button>
          ))}
        </div>
      )}

      {state.s === "failed" && <div className="mt-6"><Failed message={state.m} /></div>}

      {r && (
        <div className="mt-10">
          {/* What we understood, shown before what we recommend. A wrong match
              should be obvious from the top of the page, not inferred from a
              puzzling shortlist. */}
          <h2 className="label">What we understood</h2>
          {r.matched.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {r.matched.map((m, i) => (
                <span
                  key={m.id}
                  className="row-in pill pill-soft"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  {m.label}
                  <span className="ml-1 text-faint">· {m.hits.join(", ")}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 max-w-2xl text-[0.88rem] leading-relaxed text-dim">{r.note}</p>
          )}

          <h2 className="label mt-10">Agents that could do this</h2>
          <div className="panel mt-3 overflow-hidden">
            <ul className="divide-rule">
              {/* The whole result set can be unhireable, and saying so beats
                  letting someone click six agents to find out. For a security
                  audit today that is the true answer: the registry has agents
                  claiming it, and not one has been paid or answers a call. */}
              {r.candidates.length > 0 && !r.candidates.some((c) => c.hireable) && (
                <li className="border-b border-line px-4 py-4">
                  <p className="text-[0.9rem] font-medium text-ink">
                    None of these can be hired yet
                  </p>
                  <p className="mt-1.5 max-w-2xl text-[0.85rem] leading-relaxed text-dim">
                    They publish a matching interface, but none has answered when we called it and
                    none has ever been paid. You can look at what each one claims; we will not put
                    your money into a job with no evidence it would be picked up.
                  </p>
                </li>
              )}
              {r.candidates.map((c, i) => (
                <li
                  key={c.agentId}
                  className="row-in"
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <div className="row-hover flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[0.95rem] font-medium text-ink">
                          {c.name?.trim() || `Agent ${c.agentId}`}
                        </p>
                        <span
                          className={`pill shrink-0 ${
                            c.tier === "proven" ? "pill-verified"
                              : c.tier === "live" ? "pill-soft" : "pill-claim"}`}
                        >
                          {c.tier !== "proven" && <i className="pill-dot" />}
                          {c.tier}
                        </span>
                      </div>
                      {/* The reason is assembled from our own records, never from
                          the agent's marketing copy. */}
                      <p className="meta mt-1 truncate">{c.because}</p>
                    </div>

                    {/* Read before you commit.
                        Hire used to be the only control on the row, so the only
                        way to learn what an agent actually claimed to do was to
                        land on its funding screen. What it says about itself is
                        exactly the thing a person needs before choosing, and it
                        belongs here rather than one navigation away. */}
                    <button
                      onClick={() => setOpen(open === c.agentId ? null : c.agentId)}
                      aria-expanded={open === c.agentId}
                      aria-controls={`bio-${c.agentId}`}
                      className="btn btn-ghost shrink-0"
                    >
                      About
                      <ChevronDown
                        className={`size-3.5 transition-transform ${
                          open === c.agentId ? "rotate-180" : ""}`}
                      />
                    </button>
                    {/* Hire only where hiring will work. Everything else gets
                        a way to look, which is the honest offer for an agent we
                        have no evidence about. */}
                    {c.hireable ? (
                      <button onClick={() => hire(c, r)} className="btn btn-secondary shrink-0">
                        Hire <ArrowRight className="size-3.5" />
                      </button>
                    ) : (
                      <Link to={`/agent/${c.agentId}`} className="btn btn-ghost shrink-0">
                        View <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                  </div>

                  {open === c.agentId && (
                    <div id={`bio-${c.agentId}`} className="border-t border-line px-4 py-4">
                      <p className="label">What it says about itself</p>
                      <p className="mt-2 max-w-2xl text-[0.88rem] leading-relaxed text-dim">
                        {c.description?.trim() || "This agent publishes no description."}
                      </p>

                      {c.categories.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {c.categories.map((cat) => (
                            <span key={cat} className="pill pill-claim">{cat}</span>
                          ))}
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-4">
                        <Link
                          to={`/agent/${c.agentId}`}
                          className="text-[0.84rem] text-accent hover:underline"
                        >
                          See everything we checked →
                        </Link>
                        <span className="meta">#{c.agentId}</span>
                      </div>

                      {/* Said once, next to the copy it applies to. Categories
                          are matched against self-description, so they are the
                          agent's claim and not our verdict. */}
                      <p className="mt-3 text-[0.78rem] leading-relaxed text-faint">
                        Written by the operator, not by us. We verify whether it answers and
                        whether it has been paid — never whether the description is true.
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {r.candidates.length === 0 && (
            <p className="mt-3 text-[0.88rem] text-dim">
              Nothing in the catalog matches that yet.
            </p>
          )}

          {/* The draft, shown before the user commits to an agent, because it is
              the part they will be judged against and the part they should
              argue with. */}
          <h2 className="label mt-10">The job we drafted</h2>
          <div className="panel mt-3 divide-rule">
            <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[9rem_1fr]">
              <span className="label pt-0.5">Task</span>
              <span className="text-[0.9rem] text-ink">{r.draft.task}</span>
            </div>
            <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[9rem_1fr]">
              <span className="label pt-0.5">Done means</span>
              <span className="text-[0.9rem] leading-relaxed text-ink">{r.draft.conditions}</span>
            </div>
            <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[9rem_1fr]">
              <span className="label pt-0.5">Deadline</span>
              <span className="text-[0.9rem] text-ink">{fmt(r.draft.days)} days</span>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-[0.8rem] leading-relaxed text-faint">
            You can edit all of this on the next screen. We do not set the price —
            the agent quotes it when you ask, and nothing is funded until you sign.
          </p>
        </div>
      )}
    </AppShell>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { CATEGORY_LABEL } from "../../shared/src/categories.ts";
import { useApi, fmt, pct } from "./lib/api.ts";
import { AppShell } from "./components/AppShell.tsx";
import { Failed, Skeleton } from "./components/ui.tsx";

/**
 * Operators.
 *
 * The registry's real unit is not the agent, it is the host. Every identity
 * resolve to about a thousand hosts and five of them hold most of it, so an
 * agent-level catalog cannot show what the registry is actually made of - and
 * the §5 provenance signal is meaningless without the population it is drawn
 * from. This is that population.
 *
 * It is also the page that answers "why is the catalog one operator". The
 * answer is on the table rather than in a sentence: nearly every large operator
 * is `unprobed`, not dead, and one of them is unprobed BY DESIGN because
 * probing 24,315 URLs on a single host is a denial-of-service against them.
 *
 * §12 rule 0 governs the columns. A pending check gets its own state and is
 * never folded into a failure, because the difference between "we called it and
 * nothing was there" and "we have not called it yet" is the whole product.
 */

interface Operator {
  host: string;
  agents: number;
  live: number;
  /** Paid jobs this host's agents have completed for third parties. */
  completed: number;
  clients: number;
  paidAgents: number;
  provenAgents: number;
  infrastructure: number;
  html: number;
  testnet: number;
  dead: number;
  unreachable: number;
  noInterface: number;
  unprobed: number;
  declaresMachine: number;
  firstParty: number;
  /**
   * What this operator charges and what it works on.
   *
   * The page could say whether an operator was THERE and nothing about whether
   * you would want to hire from it - two hosts reading "4 identities · 12 paid
   * jobs" are indistinguishable until you know one does rebalancing at 0.10 U
   * and the other screens tokens at 0.05.
   */
  typicalPriceRaw: string | null;
  pricedAgents: number;
  categories: { id: string; agents: number }[];
}

/** Raw 18-decimal units to a short price. Null in, null out - never a guess. */
function priceOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v = BigInt(raw);
    const whole = v / 10n ** 18n;
    const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "").padEnd(2, "0");
    return `${whole}.${frac}`;
  } catch { return null; }
}

interface OperatorsPage {
  chainId: number;
  readAt: string;
  corpus: number;
  unattributed: number;
  provenOperators: number;
  paidOperators: number;
  operators: Operator[];
}

/**
 * What we found when we called this operator's agents, as one phrase.
 *
 * Deliberately a sentence about the dominant outcome rather than a bar chart of
 * eight states: the reader wants to know whether there is anything hireable
 * here, and every other state is detail they can get by opening the operator.
 */
function verdict(o: Operator): { label: string; tone: string } {
  const checked = o.agents - o.unprobed;

  /**
   * Paid work outranks everything, including a live endpoint.
   *
   * This function previously started at `o.live`, so a host whose agents had
   * completed twelve paid jobs read "not yet checked" - identical to a host
   * nobody has ever looked at. Money moving is the strongest evidence in the
   * product and it was invisible on the page whose entire job is to compare
   * operators.
   */
  if (o.completed > 0) {
    return {
      label: `${fmt(o.completed)} paid ${o.completed === 1 ? "job" : "jobs"} completed`,
      tone: "pill-verified",
    };
  }
  if (o.paidAgents > 0) {
    return { label: `hired, nothing settled yet`, tone: "pill-soft" };
  }
  // A live agent is a fact too, just a weaker one: it answered a call.
  if (o.live > 0) {
    return { label: `${fmt(o.live)} answered as a task interface`, tone: "pill-soft" };
  }
  if (checked === 0) return { label: "not yet checked", tone: "pill-mute" };

  /**
   * A verdict drawn from a tiny slice of a large host is not a verdict about
   * the host, and printing one would be exactly the §12 rule 0 failure this
   * table exists to avoid. TermiX has 5 probes across 24,315 agents; reading
   * that as "could not be reached" would condemn a platform on 0.02% of it.
   */
  if (checked / o.agents < 0.5) {
    return { label: `only ${fmt(checked)} of ${fmt(o.agents)} checked`, tone: "pill-mute" };
  }

  // Past half checked, report the dominant outcome among the checked ones.
  const states: [number, string, string][] = [
    [o.infrastructure, "a payment rail, nothing to commission", "pill-soft"],
    [o.html, "serves web pages", "pill-claim"],
    [o.dead, "published endpoints return errors", "pill-claim"],
    [o.unreachable, "could not be reached", "pill-mute"],
    [o.noInterface, "names no task URL", "pill-claim"],
    [o.testnet, "points at a test network", "pill-claim"],
  ];
  const top = states.reduce((a, b) => (b[0] > a[0] ? b : a));
  return top[0] > 0
    ? { label: top[1], tone: top[2] }
    : { label: "not yet checked", tone: "pill-mute" };
}

function Row({ o }: { o: Operator }) {
  const v = verdict(o);
  const checked = o.agents - o.unprobed;
  const price = priceOf(o.typicalPriceRaw);

  return (
    <Link
      to={`/catalog?operator=${encodeURIComponent(o.host)}&live=false`}
      className="row-hover group flex items-center gap-4 px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-mono text-[0.86rem] text-ink">{o.host}</p>
          {o.firstParty > 0 && <span className="pill pill-claim shrink-0">ours</span>}
        </div>
        <p className="meta mt-1 truncate">
          {fmt(o.agents)} {o.agents === 1 ? "identity" : "identities"}
          {o.clients > 0 && `  ·  ${fmt(o.clients)} paying ${o.clients === 1 ? "client" : "clients"}`}
          {/* Typical price leads the second line when there is one, because it
              is the fact a buyer is actually shopping on. Absent when too
              little has settled to have one - the same floor the agent panel
              uses, and for the same reason: a made-up price is worse than a
              blank. */}
          {price && `  ·  ~${price} U`}
          {"  ·  "}
          {checked === 0
            ? "none checked yet"
            : `${fmt(checked)} checked (${pct(checked, o.agents, 0)})`}
        </p>

        {/* What they work on. Self-described, like everywhere else these
            labels appear, and capped at three so a generalist operator does
            not push the row into a second line. */}
        {o.categories?.length > 0 && (
          <p className="mt-1.5 flex flex-wrap gap-1">
            {o.categories.slice(0, 3).map((c) => (
              <span key={c.id} className="pill pill-mute text-[0.68rem]">
                {CATEGORY_LABEL[c.id] ?? c.id}
              </span>
            ))}
          </p>
        )}
      </div>

      <span className={`pill hidden shrink-0 sm:inline-flex ${v.tone}`}>
        {v.tone !== "pill-verified" && <i className="pill-dot" />}
        {v.label}
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-dim" />
    </Link>
  );
}

const PAGE = 40;

export default function Operators() {
  const state = useApi<OperatorsPage>("/api/operators");
  const [shown, setShown] = useState(PAGE);
  /** Most hosts carry a single identity, which is noise on a page about scale. */
  const [multiOnly, setMultiOnly] = useState(true);

  const data = state.status === "ready" ? state.data : null;
  const all = data?.operators ?? [];
  const list = multiOnly ? all.filter((o) => o.agents > 1) : all;
  const attributed = all.reduce((n, o) => n + o.agents, 0);

  return (
    <AppShell
      title="Operators"
      lede="Who is actually behind the registry. One host can hold thousands of separate on-chain identities, and most of them do."
      wide
    >
      {state.status === "failed" ? (
        <Failed message={state.message} />
      ) : !data ? (
        <div className="panel divide-rule">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-56" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-40 rounded-md" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* The three numbers that frame the table. Attributed plus
              unattributed must reconcile with the corpus, or the page is
              hiding something. */}
          <div className="flex divide-x divide-line border-y border-line">
            <div className="flex-1 px-5 py-4 first:pl-0">
              <p className="figure text-[1.5rem] text-ink">{fmt(all.length)}</p>
              <p className="mt-1.5 text-[0.78rem] text-faint">hosts tracked</p>
            </div>
            {/* Was `live > 0`, which counted ONE host and understated the
                registry eighteenfold: 18 hosts have agents that completed paid
                work and 57 have some paid record, none of which this page could
                see. */}
            <div className="flex-1 px-5 py-4">
              <p className="figure text-[1.5rem] text-accent">{fmt(data.provenOperators)}</p>
              <p className="mt-1.5 text-[0.78rem] leading-snug text-faint">
                have completed paid work
              </p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="figure text-[1.5rem] text-ink">{fmt(data.paidOperators)}</p>
              <p className="mt-1.5 text-[0.78rem] leading-snug text-faint">
                have been hired at all
              </p>
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="figure text-[1.5rem] text-ink">{fmt(data.unattributed)}</p>
              <p className="mt-1.5 text-[0.78rem] leading-snug text-faint">
                identities name no host at all
              </p>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-[0.88rem] leading-relaxed text-dim">
            {fmt(attributed)} of {fmt(data.corpus)} identities resolve to a host we can name. The
            rest publish their registration inline with no service entry, so there is nothing to
            attribute and nothing to call.
          </p>

          <div className="mt-6 flex items-center justify-between gap-3">
            <span className="meta">
              {fmt(list.length)} {multiOnly ? "hosts with more than one identity" : "hosts"}
            </span>
            <button
              onClick={() => { setMultiOnly((v) => !v); setShown(PAGE); }}
              aria-pressed={!multiOnly}
              className="btn btn-secondary"
            >
              {multiOnly ? "Include single-agent hosts" : "Hide single-agent hosts"}
            </button>
          </div>

          <div className="panel mt-3 overflow-hidden">
            <ul className="divide-rule">
              {list.slice(0, shown).map((o) => (
                <li key={o.host}><Row o={o} /></li>
              ))}
            </ul>
          </div>

          {shown < list.length && (
            <button
              onClick={() => setShown((n) => n + PAGE * 2)}
              className="btn btn-secondary mt-4 w-full"
            >
              Show more — {fmt(list.length - shown)} remaining
            </button>
          )}

          <div className="mt-12 max-w-2xl border-t border-line pt-6">
            <p className="label">Why so many are unchecked</p>
            <p className="mt-3 text-[0.88rem] leading-relaxed text-dim">
              A host that publishes one endpoint per agent means one request per agent to verify,
              and the largest of them publishes over twenty thousand. Probing those in a sweep
              would be a denial-of-service against a live platform, so the verifier works a tiered
              per-host cadence and the biggest operators are still in the queue.
            </p>
            <p className="mt-3 text-[0.88rem] leading-relaxed text-dim">
              Nothing on this page reads an unchecked host as a dead one. The hireable count is a
              floor, and the operators most likely to raise it are the ones sitting at the top of
              this table with nothing checked yet.
            </p>
          </div>
        </>
      )}
    </AppShell>
  );
}

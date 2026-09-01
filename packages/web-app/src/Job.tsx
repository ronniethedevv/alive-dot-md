import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Lock, FileCheck, Send, Scale, ExternalLink, Ban, Check, Clock,
} from "lucide-react";
import { fmt, short } from "./lib/api.ts";
import { CHAIN } from "./lib/chain.ts";
import { Failed, Skeleton } from "./components/ui.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { WalletButton } from "./components/Wallet.tsx";
import { Rise } from "./components/motion.tsx";

interface Job {
  jobId: string;
  chainId: number;
  state: string;
  rawState: number;
  client: string;
  provider: string;
  evaluator: string;
  conditions: string;
  budget: { amount: string; token: string; decimals: number };
  deadline: string | null;
  reasonHash: string | null;
  reasonText: string | null;
  parentJobId: string | null;
  depth: number;
}

/**
 * Lifecycle as the contract exposes it.
 *
 * `declined` is deliberately NOT derived from `rejected` here. Both are the
 * same contract call, and the distinction between a provider refusing work it
 * should not take and a delivery being turned down lives in our own records,
 * not on chain. Showing a guess would undo the whole point of separating them,
 * so an on chain rejection is labelled exactly that and no further.
 */
const STAGES = [
  { key: "open", label: "Created", icon: FileCheck, note: "Conditions fixed" },
  { key: "funded", label: "Funded", icon: Lock, note: "Escrow held by the contract" },
  { key: "delivered", label: "Delivered", icon: Send, note: "Committed by hash" },
  { key: "settled", label: "Settled", icon: Scale, note: "Reason published" },
];

function stageIndex(state: string) {
  if (state === "open") return 0;
  if (state === "funded") return 1;
  if (state === "completed" || state === "rejected") return 3;
  return 0;
}

const amount = (a: string, d: number) => {
  const v = BigInt(a);
  const whole = v / 10n ** BigInt(d);
  const frac = (v % 10n ** BigInt(d)).toString().padStart(d, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 6)}` : whole.toString();
};

export default function Job() {
  const { jobId } = useParams();
  const [state, setState] = useState<
    { s: "loading" } | { s: "ready"; job: Job } | { s: "failed"; m: string }
  >({ s: "loading" });

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const body = await res.json();
        if (!res.ok || body?.error) throw new Error(body?.message ?? `HTTP ${res.status}`);
        if (live) setState({ s: "ready", job: body });
      } catch (e) {
        if (live) setState({ s: "failed", m: e instanceof Error ? e.message : String(e) });
      }
    };
    load();
    // A live job changes on chain, so keep it current without a refresh.
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [jobId]);

  const job = state.s === "ready" ? state.job : null;
  const at = job ? stageIndex(job.state) : 0;
  const terminal = job?.state === "completed" || job?.state === "rejected";

  let parsed: Record<string, string> | null = null;
  if (job) { try { parsed = JSON.parse(job.conditions); } catch { parsed = null; } }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-ground/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-6 px-6">
          <Link to="/" className="font-mono text-sm font-semibold uppercase tracking-widest">
            bnb<span className="text-accent">·</span>mrkt
          </Link>
          <Link to="/catalog" className="ml-auto inline-flex items-center gap-2 text-sm text-dim hover:text-ink">
            <ArrowLeft className="size-4" /> Catalog
          </Link>
          <WalletButton />
        </div>
      </header>

      <div id="main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12">
        {state.s === "failed" ? (
          <Failed message={state.m} />
        ) : !job ? (
          <div className="space-y-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-64" /></div>
        ) : (
          <>
            <Rise>
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <p className="label">Job</p>
                  <h1 className="display text-3xl text-ink md:text-4xl">#{job.jobId}</h1>
                </div>
                <span
                  className={`ml-auto inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-xs ${
                    job.state === "completed"
                      ? "bg-accent text-[#04150C]"
                      : job.state === "rejected"
                        ? "border border-danger/40 bg-danger-soft text-danger"
                        : "border border-line-2 text-dim"
                  }`}
                >
                  {job.state === "completed" ? <Check className="size-3.5" />
                    : job.state === "rejected" ? <Ban className="size-3.5" />
                    : <Clock className="size-3.5" />}
                  {job.state}
                </span>
              </div>
            </Rise>

            {/* lifecycle */}
            <Rise delay={70}>
              <ol className="mt-8 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4">
                {STAGES.map((st, i) => {
                  const reached = i <= at;
                  const Icon = st.icon;
                  return (
                    <li key={st.key} className="bg-ground p-4">
                      <span
                        className={`grid size-8 place-items-center rounded-full ${
                          reached ? "bg-accent text-[#04150C]" : "bg-surface text-faint"
                        }`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <p className={`mt-3 text-sm ${reached ? "text-ink" : "text-faint"}`}>{st.label}</p>
                      <p className="mt-0.5 text-[0.75rem] text-faint">{st.note}</p>
                    </li>
                  );
                })}
              </ol>
              {job.rawState !== undefined && !terminal && (
                <p className="mt-2 font-mono text-[0.68rem] text-faint">
                  contract state {job.rawState}. Delivery is not separately observable on chain, so
                  a funded job that has delivered still reads as funded.
                </p>
              )}
            </Rise>

            {/* terms */}
            <Rise delay={110}>
              <div className="card mt-4 overflow-hidden">
                <div className="border-b border-line px-6 py-3.5">
                  <span className="label">Agreed at creation, unchangeable since</span>
                </div>
                <dl className="divide-y divide-line">
                  {parsed?.task && (
                    <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr]">
                      <dt className="label pt-0.5">Task</dt>
                      <dd className="text-sm text-ink">{parsed.task}</dd>
                    </div>
                  )}
                  {parsed?.conditions && (
                    <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr]">
                      <dt className="label pt-0.5">Done means</dt>
                      <dd className="text-sm text-ink">{parsed.conditions}</dd>
                    </div>
                  )}
                  {!parsed && (
                    <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr]">
                      <dt className="label pt-0.5">Terms</dt>
                      <dd className="break-words font-mono text-xs text-dim">{job.conditions}</dd>
                    </div>
                  )}
                  <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr]">
                    <dt className="label pt-0.5">Budget</dt>
                    <dd className="font-mono text-sm text-ink tnum">
                      {amount(job.budget.amount, job.budget.decimals)} {job.budget.token}
                    </dd>
                  </div>
                  <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr]">
                    <dt className="label pt-0.5">Deadline</dt>
                    <dd className="text-sm text-dim">
                      {job.deadline ? new Date(job.deadline).toUTCString() : "none"}
                    </dd>
                  </div>
                  {(["client", "provider", "evaluator"] as const).map((k) => (
                    <div key={k} className="grid gap-1 px-6 py-3.5 sm:grid-cols-[9rem_1fr]">
                      <dt className="label pt-0.5">{k}</dt>
                      <dd>
                        <a
                          href={`${CHAIN.explorer}/address/${job[k]}`}
                          target="_blank" rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-accent hover:underline"
                        >
                          {short(job[k])} <ExternalLink className="size-3" />
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Rise>

            {/* the verdict */}
            <Rise delay={150}>
              <div className="card mt-4 p-6">
                <div className="flex items-center gap-2">
                  <Scale className="size-4 text-faint" />
                  <span className="label">Evaluator verdict</span>
                </div>
                {job.reasonHash ? (
                  <>
                    <p className="mt-3 text-sm text-dim">
                      The evaluator committed a document to this job when it settled. Anyone can
                      hash the published document and check it matches.
                    </p>
                    <p className="mt-3 break-all rounded-xl border border-line bg-surface p-3 font-mono text-xs text-ink">
                      {job.reasonHash}
                    </p>
                    {job.reasonText ? (
                      <p className="mt-3 text-sm text-dim">{job.reasonText}</p>
                    ) : (
                      <p className="mt-3 text-xs text-faint">
                        We hold the document only for jobs we judged ourselves, so the text is not
                        shown here.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-dim">
                    Not settled yet. A reason hash is written at settlement, whether the job is paid
                    or refunded.
                  </p>
                )}
              </div>
            </Rise>

            {job.parentJobId && (
              <p className="mt-4 text-sm text-dim">
                Subcontracted from{" "}
                <Link to={`/job/${job.parentJobId}`} className="text-accent hover:underline">
                  job #{job.parentJobId}
                </Link>{" "}
                at depth {fmt(job.depth)}.
              </p>
            )}

            <p className="mt-8 text-xs text-faint">
              Read live from the commerce contract on chain {job.chainId}, refreshed every 15
              seconds.{" "}
              <Link to="/docs#hiring" className="text-accent hover:underline">
                How escrow works
              </Link>
            </p>
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

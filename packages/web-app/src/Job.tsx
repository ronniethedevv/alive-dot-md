import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Lock, FileCheck, Send, Scale, ExternalLink, Ban, Check, Clock,
  AlertTriangle, Loader2, Copy, Undo2,
} from "lucide-react";
import { fmt, short } from "./lib/api.ts";
import { CHAIN } from "./lib/chain.ts";
import { encodeCall, SELECTORS } from "./lib/escrow.ts";
import { keccak256 } from "./lib/keccak.ts";
import { canonicalReason, loadReason, saveReason, type ReasonDoc } from "./lib/jobs.ts";
import { actionsFor, type Action } from "./lib/settle.ts";
import { Failed, Skeleton } from "./components/ui.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { WalletButton, useWallet } from "./components/Wallet.tsx";
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

/**
 * Settle a job.
 *
 * Every terminal state publishes a reason hash (§6). That is not decoration: we
 * are the evaluator on our own jobs, and an unaccountable evaluator holding the
 * escrow is the obvious criticism of this design. The answer is not "trust us",
 * it is that the verdict commits to a document anyone can hash and check. So
 * the reason box is required, the document is shown before signing, and the
 * digest under it is the exact bytes32 the transaction carries.
 */
function Settle({ job, me, onSettled }: {
  job: Job; me: string | null; onSettled: () => void;
}) {
  const actions = actionsFor(job, me);
  const [chosen, setChosen] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doc = useMemo<ReasonDoc | null>(() => {
    if (!chosen || chosen.kind === "claimRefund" || !me) return null;
    return {
      jobId: job.jobId,
      verdict: chosen.kind === "complete" ? "complete" : "reject",
      reason: reason.trim(),
      // Fixed at render, not at signing: the user must be able to see the exact
      // bytes that will be hashed. A timestamp that moved between the preview
      // and the signature would make the published hash uncheckable.
      decidedAt: new Date().toISOString().slice(0, 19) + "Z",
      decidedBy: me,
    };
  }, [chosen, reason, me, job.jobId]);

  const canonical = doc ? canonicalReason(doc) : null;
  const hash = canonical ? keccak256(canonical) : null;
  const ready = chosen?.kind === "claimRefund" || reason.trim().length > 8;

  if (actions.length === 0) return null;

  async function send() {
    if (!chosen || !window.ethereum || !me) return;
    setBusy(true);
    setError(null);
    try {
      const data = chosen.kind === "claimRefund"
        ? encodeCall(SELECTORS.claimRefund, [{ t: "uint256", v: BigInt(job.jobId) }])
        : encodeCall(SELECTORS[chosen.kind], [
          { t: "uint256", v: BigInt(job.jobId) },
          { t: "bytes32", v: hash! },
          { t: "bytes", v: "0x" },
        ]);

      await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: me, to: CHAIN.commerce, data }],
      });

      // Kept BEFORE the state refresh, so the document survives even if the
      // reload fails. Only the hash goes on chain; a hash nobody can resolve to
      // a document is a commitment to nothing.
      if (doc) saveReason(job.jobId, doc);
      setChosen(null);
      setReason("");
      onSettled();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/user rejected|denied/i.test(m)
        ? "You declined the transaction in your wallet."
        : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel mt-4 overflow-hidden">
      <div className="border-b border-line px-6 py-4">
        <p className="flex items-center gap-2 text-sm font-medium text-accent">
          <Scale className="size-4" /> This job is yours to settle
        </p>
        <p className="mt-1.5 text-sm text-dim">
          {job.state === "funded"
            ? `${amount(job.budget.amount, job.budget.decimals)} ${job.budget.token} is held by the contract until you decide.`
            : "Nothing is funded yet, so cancelling costs only gas."}
        </p>
      </div>

      <div className="space-y-3 p-6">
        {!chosen ? (
          actions.map((act) => (
            <button
              key={act.kind + act.label}
              onClick={() => { setChosen(act); setError(null); }}
              className={`w-full rounded-lg border px-4 py-3.5 text-left transition-colors ${
                act.tone === "go"
                  ? "border-accent-line hover:border-accent"
                  : "border-line hover:border-line-2"
              }`}
            >
              <p className={`text-sm font-semibold ${act.tone === "go" ? "text-accent" : "text-ink"}`}>
                {act.label}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-dim">{act.blurb}</p>
            </button>
          ))
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-ink">{chosen.label}</p>
              <button
                onClick={() => { setChosen(null); setError(null); }}
                className="ml-auto inline-flex items-center gap-1.5 text-xs text-faint hover:text-ink"
              >
                <Undo2 className="size-3.5" /> Choose something else
              </button>
            </div>
            <p className="text-sm leading-relaxed text-dim">{chosen.blurb}</p>

            {chosen.kind !== "claimRefund" && (
              <>
                <label className="block">
                  <span className="label">Why</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="What you checked, and what you found."
                    className="field mt-2 w-full resize-y p-3 text-[0.9rem] outline-none placeholder:text-faint"
                  />
                  <span className="mt-1.5 block text-xs leading-relaxed text-faint">
                    Only the hash of this goes on chain. It is kept on this device so the job
                    screen can show what the hash commits to — copy it somewhere durable if the
                    verdict needs to outlive this browser.
                  </span>
                </label>

                {hash && (
                  <div className="rounded-lg border border-line p-3">
                    <p className="label">The document, and the hash it produces</p>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[0.7rem] leading-relaxed text-dim">
                      {canonical}
                    </pre>
                    <p className="mt-2 break-all border-t border-line pt-2 font-mono text-[0.68rem] text-accent">
                      {hash}
                    </p>
                  </div>
                )}
              </>
            )}

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-danger/25 p-3 text-[0.86rem] text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
              </p>
            )}

            <button
              onClick={send}
              disabled={busy || !ready}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3.5 text-sm font-semibold text-[#04150C] transition-colors hover:bg-accent-hi disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? <><Loader2 className="size-4 animate-spin" /> Confirm in your wallet</>
                : !ready
                  ? "Say why first"
                  : chosen.label}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The document behind the hash, with the means to check it.
 *
 * Rendered only after its digest has been matched against the chain, so the
 * claim "this is what was committed" is one the reader can verify rather than
 * one they have to take from us. The copy button matters: this lives in one
 * browser's storage, and a verdict that disappears with a cache clear is not
 * much of an accountability mechanism.
 */
function ReasonDocument({ doc }: { doc: ReasonDoc }) {
  const [copied, setCopied] = useState(false);
  const text = canonicalReason(doc);

  return (
    <div className="mt-3">
      <p className="text-sm leading-relaxed text-dim">{doc.reason}</p>
      <div className="mt-3 rounded-lg border border-accent-line p-3">
        <p className="flex items-center gap-1.5 text-[0.72rem] font-medium text-accent">
          <Check className="size-3.5" strokeWidth={3} />
          This device holds the document, and it hashes to what the contract published
        </p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[0.7rem] leading-relaxed text-dim">
          {text}
        </pre>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch { /* clipboard blocked */ }
          }}
          className="mt-2 inline-flex items-center gap-1.5 text-[0.72rem] text-faint hover:text-ink"
        >
          {copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy the document"}
        </button>
      </div>
    </div>
  );
}

export default function Job() {
  const { jobId } = useParams();
  const w = useWallet();
  const [state, setState] = useState<
    { s: "loading" } | { s: "ready"; job: Job } | { s: "failed"; m: string }
  >({ s: "loading" });
  /** Bumped after a settlement so the screen re-reads chain rather than waiting
   *  out the 15 second poll while the user stares at a stale state. */
  const [nonce, setNonce] = useState(0);

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
  }, [jobId, nonce]);

  const job = state.s === "ready" ? state.job : null;
  const at = job ? stageIndex(job.state) : 0;
  const terminal = job?.state === "completed" || job?.state === "rejected";

  /**
   * The reason document this device kept, shown ONLY when it hashes to what the
   * contract actually holds.
   *
   * A stored document that does not match the chain is worse than none: it
   * would read as the published verdict while committing to nothing. So the
   * check is the same one any third party would run, and a mismatch falls back
   * to saying we do not have it.
   */
  const localDoc = useMemo(() => {
    if (!job?.reasonHash) return null;
    const doc = loadReason(job.jobId);
    if (!doc) return null;
    return keccak256(canonicalReason(doc)).toLowerCase() === job.reasonHash.toLowerCase()
      ? doc
      : null;
  }, [job?.jobId, job?.reasonHash]);

  let parsed: Record<string, string> | null = null;
  if (job) { try { parsed = JSON.parse(job.conditions); } catch { parsed = null; } }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-ground/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-4 px-5">
          <Link to="/" className="font-mono text-[0.92rem] font-semibold tracking-tight text-ink">
            ALIVE<span className="text-accent">.</span>MD
          </Link>
          <Link to="/catalog" className="ml-auto inline-flex items-center gap-1.5 text-[0.86rem] text-dim hover:text-ink">
            <ArrowLeft className="size-4" /> Catalog
          </Link>
          <WalletButton />
        </div>
      </header>

      <div id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-5 py-12">
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
                  <h1 className="text-[1.75rem] font-semibold text-ink">#{job.jobId}</h1>
                </div>
                <span
                  className={`pill ml-auto ${
                    job.state === "completed"
                      ? "pill-verified"
                      : job.state === "rejected"
                        ? "pill-danger"
                        : "pill-claim"
                  }`}
                >
                  {job.state === "completed" ? <Check className="size-3" />
                    : job.state === "rejected" ? <Ban className="size-3" />
                    : <Clock className="size-3" />}
                  {job.state}
                </span>
              </div>
            </Rise>

            {/* lifecycle */}
            <Rise delay={70}>
              <ol className="mt-8 grid gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4">
                {STAGES.map((st, i) => {
                  const reached = i <= at;
                  const Icon = st.icon;
                  return (
                    <li key={st.key} className="bg-ground p-4">
                      <span
                        className={`grid size-7 place-items-center rounded-md ${
                          reached ? "bg-accent text-[#04150C]" : "border border-line text-faint"
                        }`}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <p className={`mt-3 text-[0.88rem] font-medium ${reached ? "text-ink" : "text-faint"}`}>{st.label}</p>
                      <p className="mt-1 text-[0.76rem] leading-snug text-faint">{st.note}</p>
                    </li>
                  );
                })}
              </ol>
              {job.rawState !== undefined && !terminal && (
                <p className="meta mt-2.5 max-w-2xl text-[0.72rem] leading-relaxed">
                  contract state {job.rawState}. Delivery is not separately observable on chain, so
                  a funded job that has delivered still reads as funded.
                </p>
              )}
            </Rise>

            {/* terms */}
            <Rise delay={110}>
              <div className="panel mt-4 overflow-hidden">
                <div className="border-b border-line px-6 py-3">
                  <span className="label">Agreed at creation, unchangeable since</span>
                </div>
                <dl className="divide-y divide-line">
                  {parsed?.task && (
                    <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                      <dt className="label pt-0.5">Task</dt>
                      <dd className="text-sm text-ink">{parsed.task}</dd>
                    </div>
                  )}
                  {parsed?.conditions && (
                    <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                      <dt className="label pt-0.5">Done means</dt>
                      <dd className="text-sm text-ink">{parsed.conditions}</dd>
                    </div>
                  )}
                  {!parsed && (
                    <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                      <dt className="label pt-0.5">Terms</dt>
                      <dd className="break-words font-mono text-xs text-dim">{job.conditions}</dd>
                    </div>
                  )}
                  <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                    <dt className="label pt-0.5">Budget</dt>
                    <dd className="figure text-[0.95rem] text-ink">
                      {amount(job.budget.amount, job.budget.decimals)} {job.budget.token}
                    </dd>
                  </div>
                  <div className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                    <dt className="label pt-0.5">Deadline</dt>
                    <dd className="text-sm text-dim">
                      {job.deadline ? new Date(job.deadline).toUTCString() : "none"}
                    </dd>
                  </div>
                  {(["client", "provider", "evaluator"] as const).map((k) => (
                    <div key={k} className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                      <dt className="label pt-0.5">{k}</dt>
                      <dd>
                        <a
                          href={`${CHAIN.explorer}/address/${job[k]}`}
                          target="_blank" rel="noreferrer noopener"
                          className="inline-flex items-center gap-1.5 font-mono text-[0.78rem] text-dim underline decoration-line-2 underline-offset-2 transition-colors hover:text-accent hover:decoration-accent-line"
                        >
                          {short(job[k])} <ExternalLink className="size-3" />
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Rise>

            {/* what this wallet may do about it */}
            <Rise delay={140}>
              <Settle job={job} me={w.address} onSettled={() => setNonce((n) => n + 1)} />
            </Rise>

            {/* the verdict */}
            <Rise delay={150}>
              <div className="panel mt-4 p-6">
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
                    <p className="mt-3 break-all rounded-lg border border-line p-3 font-mono text-[0.76rem] text-ink">
                      {job.reasonHash}
                    </p>
                    {job.reasonText ? (
                      <p className="mt-3 text-sm text-dim">{job.reasonText}</p>
                    ) : localDoc ? (
                      <ReasonDocument doc={localDoc} />
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

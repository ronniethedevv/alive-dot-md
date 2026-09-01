import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Lock, FileCheck, AlertTriangle, Check, Loader2, ShieldCheck, ExternalLink,
} from "lucide-react";
import { useApi, short, type AgentCard } from "./lib/api.ts";
import { CHAIN } from "./lib/chain.ts";
import { encodeCall, SELECTORS } from "./lib/escrow.ts";
import { Failed, Skeleton } from "./components/ui.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { WalletButton, useWallet } from "./components/Wallet.tsx";
import { Rise } from "./components/motion.tsx";

type Step = "compose" | "review" | "signing" | "done";

/**
 * In flight hire state, kept so a closed tab does not strand the user.
 *
 * createJob and approve can both succeed and fund can then fail, or the tab can
 * simply be shut between them. Without this the job exists on chain, the
 * allowance is set, and the UI offers only "start again", which would create a
 * SECOND job and approve a second time. Persisting the job id lets the flow
 * resume at exactly the step that did not finish.
 *
 * Per viewer, per agent, and cleared on completion. It holds no secrets: a job
 * id and transaction hashes are public on chain the moment they are mined.
 */
const RESUME_KEY = (agentId: string) => `bnb-mrkt:hire:${agentId}`;

interface Resume {
  jobId: string | null;
  budget: string;
  txs: { label: string; hash: string }[];
  at: number;
}

function loadResume(agentId: string): Resume | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY(agentId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Resume;
    // Anything older than a day is stale enough that the deadline it was built
    // against is probably wrong. Better to start clean than resume blind.
    if (!v || Date.now() - v.at > 86_400_000) return null;
    return v;
  } catch { return null; }
}
function saveResume(agentId: string, v: Resume) {
  try { localStorage.setItem(RESUME_KEY(agentId), JSON.stringify(v)); } catch { /* private mode */ }
}
function clearResume(agentId: string) {
  try { localStorage.removeItem(RESUME_KEY(agentId)); } catch { /* ignore */ }
}

/** topic0 of JobCreated(uint256 indexed,address indexed,address indexed,address,uint256,address) */
const JOB_CREATED = "0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9";

/**
 * Wait for the createJob receipt and read the job id out of it.
 *
 * Polls rather than assuming: a transaction that has been broadcast has not
 * necessarily been mined, and every later step depends on this id being ours.
 * Throws rather than guessing if the receipt never arrives or the log is
 * missing, because the alternative is funding an escrow we do not own.
 */
async function waitForJobId(hash: string, timeoutMs = 120_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = (await window.ethereum!.request({
      method: "eth_getTransactionReceipt", params: [hash],
    })) as { status?: string; logs?: { address: string; topics: string[] }[] } | null;

    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The create transaction reverted on chain.");
      const log = (receipt.logs ?? []).find(
        (l) => l.topics?.[0]?.toLowerCase() === JOB_CREATED
          && l.address.toLowerCase() === CHAIN.commerce.toLowerCase(),
      );
      if (!log?.topics?.[1]) {
        throw new Error("Job was created but no JobCreated event was found, so the id is unknown.");
      }
      return BigInt(log.topics[1]).toString();
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for the create transaction to be mined. Nothing was funded.");
}

/** Whole U to raw units. 18 decimals, no floating point in the amount. */
function toUnits(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.trim().split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18) || "0");
}

export default function Hire() {
  const { agentId } = useParams();
  const nav = useNavigate();
  const w = useWallet();
  const state = useApi<AgentCard>(`/api/agents/${agentId}`);
  const a = state.status === "ready" ? state.data : null;

  const [step, setStep] = useState<Step>("compose");
  const [task, setTask] = useState("");
  const [conditions, setConditions] = useState("");
  const [budget, setBudget] = useState("1");
  const [days, setDays] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);

  // Offer to finish an interrupted hire rather than silently starting a new one.
  useEffect(() => {
    if (agentId) setResume(loadResume(agentId));
  }, [agentId]);

  const hireable = a?.verifiedClass === "task-interface";
  const budgetUnits = useMemo(() => {
    try { return toUnits(budget); } catch { return 0n; }
  }, [budget]);
  /**
   * The deadline is computed WHEN THE TRANSACTION IS SIGNED, never earlier.
   *
   * This was memoised on [days], so Date.now() was captured the moment the
   * field last changed. A user who picked one day and then sat on the review
   * screen for twenty hours would write a deadline four hours out, and a long
   * enough pause could write one already in the past. The review screen shows
   * the duration rather than a fixed timestamp for the same reason: the exact
   * moment is not knowable until the wallet is asked to sign.
   */
  const deadlineAt = () => BigInt(Math.floor(Date.now() / 1000) + days * 86400);

  const terms = useMemo(() => JSON.stringify({
    task: task.trim(),
    conditions: conditions.trim(),
    agentId,
    via: "bnb-mrkt",
  }), [task, conditions, agentId]);

  const canReview = task.trim().length > 8 && conditions.trim().length > 8 && budgetUnits > 0n;

  /**
   * Send the three transactions in order. Each is signed in the user's wallet;
   * this app builds calldata and never holds a key.
   *
   * createJob, then approve, then fund. approve MUST precede fund because fund
   * pulls the tokens with transferFrom, and the evaluator is set to the
   * connected account so settlement is immediate rather than waiting out the
   * seven day dispute window the router path imposes.
   */
  async function run() {
    if (!window.ethereum || !w.address) return;
    setStep("signing");
    setError(null);
    const sent: { label: string; hash: string }[] = [];
    try {
      const send = async (label: string, to: string, data: string) => {
        const hash = (await window.ethereum!.request({
          method: "eth_sendTransaction",
          params: [{ from: w.address, to, data }],
        })) as string;
        sent.push({ label, hash });
        setTxs([...sent]);
        // Persist after EVERY send. If the tab dies on the next line, the next
        // visit can pick up from here instead of creating a second job.
        saveResume(agentId!, { jobId, budget, txs: sent, at: Date.now() });
        return hash;
      };

      // Resuming: the job already exists and the allowance is already set, so
      // the only thing left is to fund the job we already created.
      if (resume?.jobId) {
        setJobId(resume.jobId);
        await send("Fund escrow", CHAIN.commerce, encodeCall(SELECTORS.fund, [
          { t: "uint256", v: BigInt(resume.jobId) },
          { t: "uint256", v: toUnits(resume.budget) },
          { t: "bytes", v: "0x" },
        ]));
        clearResume(agentId!);
        setStep("done");
        return;
      }

      await send("Create job", CHAIN.commerce, encodeCall(SELECTORS.createJob, [
        { t: "address", v: a!.owner ?? w.address! },   // provider
        { t: "address", v: w.address! },               // evaluator: us, so we can settle now
        { t: "uint256", v: deadlineAt() },
        { t: "string", v: terms },
        { t: "address", v: "0x0000000000000000000000000000000000000000" },
      ]));

      await send("Approve U", CHAIN.paymentToken, encodeCall(SELECTORS.approve, [
        { t: "address", v: CHAIN.commerce },
        { t: "uint256", v: budgetUnits },
      ]));

      // The job id comes from the createJob RECEIPT, never from jobCounter.
      //
      // eth_sendTransaction returns as soon as the transaction is broadcast, so
      // reading jobCounter here would return the value from before our job was
      // mined. Funding that id would put real U into somebody else's escrow.
      // JobCreated declares jobId as an indexed parameter, so it is topics[1]
      // of our own receipt and cannot be confused with a racing job.
      const id = await waitForJobId(sent[0]!.hash);
      setJobId(id);
      saveResume(agentId!, { jobId: id, budget, txs: sent, at: Date.now() });

      await send("Fund escrow", CHAIN.commerce, encodeCall(SELECTORS.fund, [
        { t: "uint256", v: BigInt(id) },
        { t: "uint256", v: budgetUnits },
        { t: "bytes", v: "0x" },
      ]));

      clearResume(agentId!);
      setStep("done");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/user rejected|denied/i.test(m) ? "You declined the transaction in your wallet." : m);
      setStep("review");
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-ground/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-6 px-6">
          <Link to="/" className="font-mono text-sm font-semibold uppercase tracking-widest">
            bnb<span className="text-blue-deep">·</span>mrkt
          </Link>
          <Link to={`/agent/${agentId}`} className="ml-auto inline-flex items-center gap-2 text-sm text-dim hover:text-ink">
            <ArrowLeft className="size-4" /> Agent
          </Link>
          <WalletButton />
        </div>
      </header>

      <div id="main" tabIndex={-1} className="mx-auto max-w-3xl px-6 py-12">
        {state.status === "failed" ? (
          <Failed message={state.message} />
        ) : !a ? (
          <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>
        ) : !hireable ? (
          <div className="card p-8 text-center">
            <AlertTriangle className="mx-auto size-7 text-faint" />
            <h1 className="display mt-4 text-2xl">This agent cannot be hired</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-dim">
              Only agents that answered as a task interface can take a job. This one is recorded as{" "}
              <span className="font-mono text-ink">{a.verifiedClass}</span>.
            </p>
            <Link to="/catalog" className="mt-6 inline-block text-sm text-blue-deep hover:underline">
              Back to the catalog
            </Link>
          </div>
        ) : step === "done" ? (
          <Rise>
            <div className="card p-8 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-blue-deep text-white">
                <Check className="size-6" />
              </span>
              <h1 className="display mt-5 text-3xl">Job funded</h1>
              <p className="mt-3 text-dim">
                Escrow is held by the contract. The agent can now deliver.
              </p>
              <div className="mt-6 space-y-2 text-left">
                {txs.map((t) => (
                  <a
                    key={t.hash}
                    href={`${CHAIN.explorer}/tx/${t.hash}`}
                    target="_blank" rel="noreferrer noopener"
                    className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 font-mono text-xs text-dim hover:border-blue-line"
                  >
                    <Check className="size-3.5 text-blue-deep" />
                    {t.label}
                    <span className="ml-auto truncate text-faint">{short(t.hash)}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ))}
              </div>
              {jobId && (
                <button
                  onClick={() => nav(`/job/${jobId}`)}
                  className="mt-6 rounded-full bg-blue-deep px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue"
                >
                  View job {jobId}
                </button>
              )}
            </div>
          </Rise>
        ) : (
          <>
            {resume?.jobId && step !== "signing" && (
              <Rise>
                <div className="card mb-8 border-blue-line bg-blue-soft p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-blue-deep">
                    <AlertTriangle className="size-4" /> You have an unfinished hire
                  </p>
                  <p className="mt-2 text-sm text-dim">
                    Job #{resume.jobId} was created and the escrow was approved, but it was never
                    funded. Finish it rather than starting again, which would create a second job.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => { setBudget(resume.budget); setStep("review"); }}
                      className="rounded-full bg-blue-deep px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue"
                    >
                      Fund job #{resume.jobId}
                    </button>
                    <Link
                      to={`/job/${resume.jobId}`}
                      className="rounded-full border border-line-2 px-5 py-2.5 text-sm text-dim hover:border-blue-line hover:text-ink"
                    >
                      Inspect it first
                    </Link>
                    <button
                      onClick={() => { clearResume(agentId!); setResume(null); }}
                      className="rounded-full px-5 py-2.5 text-sm text-faint hover:text-ink"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </Rise>
            )}

            <Rise>
              <h1 className="display text-3xl text-ink md:text-4xl">
                Hire {a.name?.trim() || `Agent ${a.agentId}`}
              </h1>
              <p className="mt-3 text-dim">
                Conditions are fixed when the job is created and cannot be edited afterwards.
              </p>
            </Rise>

            {step === "compose" ? (
              <Rise delay={70}>
                <div className="card mt-8 space-y-6 p-6">
                  <label className="block">
                    <span className="label">The task</span>
                    <textarea
                      value={task} onChange={(e) => setTask(e.target.value)} rows={3}
                      placeholder="What do you want this agent to do?"
                      className="mt-2 w-full resize-y rounded-xl border border-line bg-surface p-3.5 text-sm outline-none placeholder:text-faint focus:border-blue-line"
                    />
                  </label>

                  <label className="block">
                    <span className="label">What done looks like</span>
                    <textarea
                      value={conditions} onChange={(e) => setConditions(e.target.value)} rows={3}
                      placeholder="The specific, checkable shape of an acceptable answer."
                      className="mt-2 w-full resize-y rounded-xl border border-line bg-surface p-3.5 text-sm outline-none placeholder:text-faint focus:border-blue-line"
                    />
                    <span className="mt-1.5 block text-xs text-faint">
                      If you cannot state this, the job is not ready for escrow.
                    </span>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">Budget</span>
                      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-3">
                        <input
                          value={budget} onChange={(e) => setBudget(e.target.value)}
                          inputMode="decimal"
                          className="w-full bg-transparent text-sm outline-none"
                        />
                        <span className="font-mono text-xs text-faint">U</span>
                      </div>
                    </label>
                    <label className="block">
                      <span className="label">Deadline</span>
                      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-3">
                        <input
                          type="number" min={1} max={30} value={days}
                          onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full bg-transparent text-sm outline-none"
                        />
                        <span className="font-mono text-xs text-faint">days</span>
                      </div>
                    </label>
                  </div>

                  <button
                    disabled={!canReview}
                    onClick={() => setStep("review")}
                    className="w-full rounded-full bg-blue-deep py-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Review before funding
                  </button>
                </div>
              </Rise>
            ) : (
              <Rise delay={70}>
                <div className="card mt-8 overflow-hidden">
                  <div className="border-b border-line bg-blue-soft/60 px-6 py-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-blue-deep">
                      <Lock className="size-4" /> This is the irreversible step
                    </p>
                    <p className="mt-1.5 text-sm text-dim">
                      Funding moves {budget} U into escrow held by the contract. The conditions
                      below are written on chain and cannot be changed afterwards.
                    </p>
                  </div>

                  <dl className="divide-y divide-line">
                    {[
                      ["Agent", `${a.name?.trim() || a.agentId} (#${a.agentId})`],
                      ["Task", task],
                      ["What done looks like", conditions],
                      ["Budget", `${budget} U`],
                      ["Deadline", `${days} day${days === 1 ? "" : "s"} from signing`],
                      ["Evaluator", `${short(w.address ?? "")} (you)`],
                    ].map(([k, v]) => (
                      <div key={k} className="grid gap-1 px-6 py-3.5 sm:grid-cols-[10rem_1fr]">
                        <dt className="label pt-0.5">{k}</dt>
                        <dd className="break-words text-sm text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="space-y-3 border-t border-line p-6">
                    {error && (
                      <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
                      </p>
                    )}

                    <p className="text-xs leading-relaxed text-faint">
                      Three transactions, in order: create the job, approve the escrow to move
                      exactly {budget} U, then fund it. Your wallet will ask you to sign each one.
                    </p>

                    {!w.address ? (
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4">
                        <span className="text-sm text-dim">Connect a wallet to continue.</span>
                        <WalletButton />
                      </div>
                    ) : w.wrongChain ? (
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-danger/30 bg-danger-soft p-4">
                        <span className="text-sm text-danger">Wrong network.</span>
                        <button onClick={w.switchChain} className="rounded-full bg-danger px-4 py-2 text-sm text-white">
                          Switch to {CHAIN.name}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={run}
                          disabled={step === "signing"}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-blue-deep py-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue disabled:opacity-60"
                        >
                          {step === "signing"
                            ? <><Loader2 className="size-4 animate-spin" /> Confirm in your wallet</>
                            : <><ShieldCheck className="size-4" /> Fund {budget} U into escrow</>}
                        </button>
                        <button
                          onClick={() => setStep("compose")}
                          disabled={step === "signing"}
                          className="rounded-full border border-line-2 px-6 py-3.5 text-sm text-dim hover:border-blue-line hover:text-ink disabled:opacity-40"
                        >
                          Edit
                        </button>
                      </div>
                    )}

                    {txs.length > 0 && (
                      <ul className="space-y-1.5 pt-2">
                        {txs.map((t) => (
                          <li key={t.hash} className="flex items-center gap-2 font-mono text-xs text-faint">
                            <FileCheck className="size-3.5 text-blue-deep" /> {t.label} sent
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Rise>
            )}
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

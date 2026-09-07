import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Lock, FileCheck, AlertTriangle, Check, Loader2, ShieldCheck, ExternalLink,
  Wallet2,
} from "lucide-react";
import { useApi, short, type AgentCard } from "./lib/api.ts";
import { CHAIN, formatU, readUint, toUnits, U_POOL } from "./lib/chain.ts";
import { encodeCall, SELECTORS } from "./lib/escrow.ts";
import { rememberJob } from "./lib/jobs.ts";
import { CONDITIONS, CONDITION_FALLBACK } from "../../shared/src/conditions.ts";
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
const RESUME_KEY = (agentId: string) => `alive.md:hire:${agentId}`;

interface Resume {
  jobId: string | null;
  /**
   * RAW UNITS, not a display amount.
   *
   * This held the `budget` text field, so a resumed hire funded
   * `toUnits(displayString)`. When an agent quotes a `priceWei` whose matching
   * `price` string we never saw, that field is still at its default and the
   * resumed transaction would fund a different amount than the interrupted one
   * approved. The unit value is the thing both halves must agree on.
   */
  units: string;
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
    // An entry written before `units` existed cannot be resumed safely: we
    // would be guessing the amount. The job is still on chain and still in the
    // jobs list, so nothing is lost by making the user look at it.
    if (typeof v.units !== "string" || !/^\d+$/.test(v.units)) return null;
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

/**
 * What the wallet holds and what it has already allowed, read before anything
 * is signed.
 *
 * `null` means we could not read it, which is NOT zero. A failed read must
 * never block a hire that would have worked, so an unknown balance warns and
 * lets the user through; only a balance we actually read and found short stops
 * them.
 */
interface Preflight {
  balance: bigint | null;
  allowance: bigint | null;
  checkedFor: string | null;
}

export default function Hire() {
  const { agentId } = useParams();
  const nav = useNavigate();
  const w = useWallet();
  const state = useApi<AgentCard>(`/api/agents/${agentId}`);
  const a = state.status === "ready" ? state.data : null;

  /**
   * A draft handed over by the concierge (/start), through router state.
   *
   * Router state rather than the URL: a task can be long and arbitrary, and a
   * query string would truncate it and make it look like tracking. The user
   * edits everything here before anything is signed - the draft is a starting
   * point, never a commitment.
   */
  const handoff = (useLocation().state as { draft?: { task: string; conditions: string; days: number } } | null)?.draft;

  const [step, setStep] = useState<Step>("compose");
  const [task, setTask] = useState(handoff?.task ?? "");
  const [conditions, setConditions] = useState(handoff?.conditions ?? "");
  /**
   * THE DEFAULT WAS THE BUG THIS SCREEN EXISTS TO PREVENT.
   *
   * It was "1" - one whole U - while every proven agent on the kernel settles
   * at 0.05 to 0.10. A client who accepted it overpaid by 10x to 20x, and
   * escrow releases the whole budget, so none of it comes back.
   *
   * §15 removed the quote button because asking never worked, and left the
   * invented figure standing in its place. The figure was the more dangerous
   * half: a button that fails is visible, a plausible wrong number is not.
   *
   * It now starts EMPTY and is seeded from what this agent has actually been
   * paid, once the record arrives. Empty until then, because a placeholder a
   * user might approve is precisely what is being removed.
   */
  const [budget, setBudget] = useState("");
  /** Set on first edit, so a late record can never overwrite a typed figure. */
  const [budgetTouched, setBudgetTouched] = useState(false);

  /**
   * The agent's price, not the client's guess.
   *
   * ERC-8183 has a negotiation round: the client sends requirements, the agent
   * returns a price or refuses with a coded reason. Asking a user to invent a
   * budget meant funding a job and then discovering the provider's floor by
   * having it rejected, having paid gas to learn a number the agent was willing
   * to publish. So we ask first.
   */
  const [quote, setQuote] = useState<
    | { state: "idle" }
    | { state: "asking" }
    | { state: "quoted"; priceWei: string; price: string; currency: string; expiresAt?: number }
    | { state: "refused"; reason: string; reasonCode?: string; price?: string }
    | { state: "unpriced"; reason: string }
  >({ state: "idle" });

  const askForQuote = async () => {
    setQuote({ state: "asking" });
    try {
      const res = await fetch(`/api/agents/${agentId}/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, conditions }),
      });
      const q = await res.json();
      if (q.quoted && q.priceWei) {
        setBudget(q.price || budget);
        setQuote({ state: "quoted", priceWei: q.priceWei, price: q.price ?? "",
          currency: q.currency ?? "U", expiresAt: q.quoteExpiresAt });
      } else if (q.unsupported) {
        setQuote({ state: "unpriced", reason: q.reason ?? "This agent publishes no price." });
      } else {
        setQuote({ state: "refused", reason: q.reason ?? "The agent declined.",
          reasonCode: q.reasonCode, price: q.price });
      }
    } catch {
      setQuote({ state: "unpriced", reason: "Could not reach the agent to ask for a price." });
    }
  };
  const [days, setDays] = useState(handoff?.days ?? 3);

  /**
   * HOW THIS JOB GETS JUDGED. Two modes, because there are two kinds of client.
   *
   * §6 requires conditions fixed before funding, and gives the reason: an
   * evaluator has to decide pay-or-refund, and a criterion nobody can check is
   * a criterion nobody can settle. That is right for a job a contract or a
   * schema will judge.
   *
   * It is also a wall. Asking someone who wants their loan watched to write
   * "the specific, checkable shape of an acceptable answer" is asking them to
   * do the evaluator's job before they have seen any work. §6 already named the
   * escape hatch - "the timer fallback is what covers the long tail: deliver,
   * 24h silence, funds release, objection escalates" - and it had never been
   * built, so every client was forced down the precise-criteria path.
   *
   * `review`   the client judges on delivery, inside an objection window
   * `criteria` a written test the work is measured against
   */
  const [judging, setJudging] = useState<"review" | "criteria">("review");

  /**
   * The objection window, in hours. This IS the client's protection in review
   * mode, so it goes into the on-chain terms rather than living as a promise
   * in our interface.
   */
  const OBJECTION_HOURS = 24;

  /** Presets drawn from the agent's own categories: pick and edit, never write
   *  from nothing. */
  const presets = useMemo(() => {
    const out = (a?.categories ?? [])
      .map((c) => CONDITIONS[c])
      .filter(Boolean) as string[];
    return out.length ? [...new Set(out)] : [CONDITION_FALLBACK];
  }, [a?.categories]);
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  /** Which signature we are on, so "confirm in your wallet" is never vague. */
  const [progress, setProgress] = useState<
    { at: number; of: number; label: string; kind: "sign" | "wait" } | null
  >(null);

  // Offer to finish an interrupted hire rather than silently starting a new one.
  useEffect(() => {
    if (agentId) setResume(loadResume(agentId));
  }, [agentId]);

  // Same rule as the detail screen: a settlement record is stronger evidence
  // than a probe. Gating on the probe alone refused hires for agents that have
  // demonstrably completed paid work.
  const hireable = a?.verifiedClass === "task-interface" || (a?.record?.completed ?? 0) > 0;

  /**
   * What this agent has actually charged, and what we suggest authorising.
   *
   * The two are deliberately different numbers. The typical cost is a
   * measurement and is stated as one; the suggestion is that cost plus a
   * buffer, so a job is not refused for being fractionally short. The
   * suggestion is a STARTING POINT the client edits - §6 keeps the
   * irreversible step with the human, and that includes choosing the amount.
   */
  const pricing = a?.record?.pricing ?? null;
  useEffect(() => {
    if (budgetTouched || !pricing?.established) return;
    setBudget(pricing.suggested);
  }, [pricing, budgetTouched]);
  // A quoted price is authoritative and is used exactly as given, so rounding
  // in the display can never change what is funded.
  const budgetUnits = useMemo(() => {
    if (quote.state === "quoted") { try { return BigInt(quote.priceWei); } catch { /* fall through */ } }
    try { return toUnits(budget); } catch { return 0n; }
  }, [budget, quote]);

  /**
   * The one amount the screen is allowed to print.
   *
   * Every figure shown to the user is now formatted from `budgetUnits`, which
   * is the exact value that goes into `approve` and `fund`. The review panel
   * used to print the `budget` text field while funding `quote.priceWei`: an
   * agent that returned `priceWei` without a matching `price` string left the
   * field at its default of 1, so the screen said "Fund 1 U" and funded
   * something else entirely. A confirmation screen that can disagree with the
   * transaction it is confirming is worse than no confirmation screen.
   */
  const displayAmount = formatU(budgetUnits);
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
    /**
     * In review mode the "condition" IS the process, stated plainly so the
     * provider agreed to it and a reader of the chain can see what was agreed.
     */
    conditions: judging === "review"
      ? `The client reviews the delivered work and has ${OBJECTION_HOURS} hours from delivery to `
        + `refuse it. No objection within that window settles the job in the provider's favour.`
      : conditions.trim(),
    judging,
    objectionHours: judging === "review" ? OBJECTION_HOURS : undefined,
    agentId,
    // Written into the job's on-chain terms, so it is how we recognise our own
    // jobs later. Historical jobs carry the old tag; nothing we query filters
    // on it exclusively, and no job has ever been created under either.
    via: "alive.md",
  }), [task, conditions, agentId]);

  /**
   * Two different gates, because they answer two different questions.
   *
   * Asking a price needs only the TASK: the agent is being asked "what would
   * you charge for this", and it cannot answer from an acceptance criterion.
   * Requiring both fields meant the quote button sat greyed out while a user
   * who had described their task perfectly well waited for something to happen,
   * with nothing on screen saying what.
   *
   * FUNDING needs both. §6 is explicit: "if a client cannot state what done
   * looks like, the job is not ready for escrow." That gate stays.
   */
  const canAskPrice = task.trim().length > 8;

  /**
   * Ask once, in the background, and stay quiet unless there is an answer.
   *
   * Debounced so it fires when the user stops typing rather than on every
   * keystroke, and guarded by `askedFor` so editing the task afterwards does
   * not re-ask the same agent repeatedly - one enquiry per agent per visit.
   * A failure is silent by design: the price field is already on screen and
   * needs no permission from the agent to be used.
   */
  const [askedFor, setAskedFor] = useState<string | null>(null);
  useEffect(() => {
    if (step !== "compose" || !canAskPrice || !agentId) return;
    if (askedFor === agentId) return;
    const t = setTimeout(() => { setAskedFor(agentId); void askForQuote(); }, 900);
    return () => clearTimeout(t);
  }, [step, canAskPrice, agentId, askedFor]);
  /**
   * Review mode needs no written criteria - that is the entire point of it.
   * Criteria mode still does, and §6's rule stands there unchanged.
   */
  const described = canAskPrice
    && (judging === "review" || conditions.trim().length > 8);
  // Either the agent quoted, or it publishes no price and the client has
  // proposed one knowing it may be refused.
  /**
   * A price is set once EITHER the agent quoted one or the client proposed one.
   *
   * Proposing used to be reachable only from the `unpriced` state, i.e. only
   * after asking and being told no. Measured across 20 catalog agents spanning
   * both tiers, asking returns "does not publish a price or a way to ask for
   * one" 20 times out of 20 - so the fallback was the real path for everyone,
   * reached through a dead end.
   */
  const priced = quote.state === "quoted" || budgetUnits > 0n;
  const canReview = described && priced;

  /**
   * Preflight, read on the review screen before the first signature.
   *
   * Without this the flow signed createJob, signed approve, waited for a
   * receipt, and only then discovered at `fund` that the wallet holds no U -
   * because escrow settles in U and a fresh wallet has none. The user had by
   * then paid gas twice and owned a real, unfunded job on chain. The failure
   * was entirely predictable one call earlier.
   */
  const [pre, setPre] = useState<Preflight>({ balance: null, allowance: null, checkedFor: null });

  useEffect(() => {
    if (step !== "review" || !w.address || w.wrongChain) return;
    let live = true;
    (async () => {
      const owner = w.address!.slice(2).padStart(64, "0");
      const [balance, allowance] = await Promise.all([
        readUint(CHAIN.paymentToken, SELECTORS.balanceOf + owner),
        readUint(CHAIN.paymentToken, SELECTORS.allowance + owner + CHAIN.commerce.slice(2).padStart(64, "0")),
      ]);
      if (live) setPre({ balance, allowance, checkedFor: w.address! });
    })();
    return () => { live = false; };
  }, [step, w.address, w.wrongChain, txs.length]);

  /**
   * An allowance that already covers this budget makes `approve` a signature
   * that changes nothing. Skipping it is not a shortcut: re-approving costs gas
   * and asks the user to authorise a spend they have already authorised, which
   * trains them to click through exactly the dialog that should never be
   * routine.
   */
  const needsApprove = pre.allowance === null || pre.allowance < budgetUnits;
  // Only a balance we actually READ and found short is a blocker. A null is an
  // unknown, and an unknown never silently stops a hire that would have worked.
  const shortOfFunds = pre.balance !== null && pre.balance < budgetUnits;

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

    // The amount is frozen here, before the first signature, so that nothing
    // the user or a refreshed quote does mid-flow can change what gets funded
    // after they approved it.
    const units = resume?.jobId ? BigInt(resume.units) : budgetUnits;

    /**
     * The plan, decided up front so the UI can count honestly.
     *
     * "Confirm in your wallet" with no idea how many confirmations remain is
     * the worst moment in the flow to be vague: the user is being asked to
     * authorise real money and cannot tell whether they are a third of the way
     * through or nearly done. Deciding the plan before the first signature also
     * means the count never changes underneath them.
     */
    const plan: string[] = resume?.jobId
      ? ["Fund escrow"]
      : needsApprove
        ? ["Create job", "Approve U", "Fund escrow"]
        : ["Create job", "Fund escrow"];

    try {
      const send = async (label: string, to: string, data: string) => {
        setProgress({ at: plan.indexOf(label) + 1, of: plan.length, label, kind: "sign" });
        const hash = (await window.ethereum!.request({
          method: "eth_sendTransaction",
          params: [{ from: w.address, to, data }],
        })) as string;
        sent.push({ label, hash });
        setTxs([...sent]);
        // Persist after EVERY send. If the tab dies on the next line, the next
        // visit can pick up from here instead of creating a second job.
        saveResume(agentId!, { jobId, units: units.toString(), txs: sent, at: Date.now() });
        return hash;
      };

      // Resuming: the job already exists and the allowance is already set, so
      // the only thing left is to fund the job we already created.
      if (resume?.jobId) {
        setJobId(resume.jobId);
        await send("Fund escrow", CHAIN.commerce, encodeCall(SELECTORS.fund, [
          { t: "uint256", v: BigInt(resume.jobId) },
          { t: "uint256", v: units },
          { t: "bytes", v: "0x" },
        ]));
        clearResume(agentId!);
        setStep("done");
        return;
      }

      /**
       * The provider must be the AGENT'S owner, and there is no safe default.
       *
       * This read `a.owner ?? w.address`, and `owner` was NULL for every agent
       * in the live catalog because the lazy backfill §9 promised was never
       * written. So hiring named the client as their own provider: client,
       * provider and evaluator all one address, escrow paid back to the payer,
       * and the UI reporting a funded job. Falling back to a wrong address is
       * strictly worse than refusing, because it succeeds.
       */
      if (!a!.owner) {
        throw new Error(
          "We do not know who owns this agent, so there is no provider to pay. "
          + "Nothing was signed. This is our gap, not yours.",
        );
      }

      await send("Create job", CHAIN.commerce, encodeCall(SELECTORS.createJob, [
        { t: "address", v: a!.owner },                 // provider
        { t: "address", v: w.address! },               // evaluator: us, so we can settle now
        { t: "uint256", v: deadlineAt() },
        { t: "string", v: terms },
        { t: "address", v: "0x0000000000000000000000000000000000000000" },
      ]));

      // Skipped when the standing allowance already covers this budget. See
      // `needsApprove`: re-approving costs gas and normalises the one dialog
      // that should never be routine.
      if (needsApprove) {
        await send("Approve U", CHAIN.paymentToken, encodeCall(SELECTORS.approve, [
          { t: "address", v: CHAIN.commerce },
          { t: "uint256", v: units },
        ]));
      }

      // The job id comes from the createJob RECEIPT, never from jobCounter.
      //
      // eth_sendTransaction returns as soon as the transaction is broadcast, so
      // reading jobCounter here would return the value from before our job was
      // mined. Funding that id would put real U into somebody else's escrow.
      // JobCreated declares jobId as an indexed parameter, so it is topics[1]
      // of our own receipt and cannot be confused with a racing job.
      setProgress({ at: plan.indexOf("Fund escrow"), of: plan.length, kind: "wait",
        label: "Waiting for the job to be mined" });
      const id = await waitForJobId(sent[0]!.hash);
      setJobId(id);
      saveResume(agentId!, { jobId: id, units: units.toString(), txs: sent, at: Date.now() });

      // Recorded the moment the job provably EXISTS, not when the flow finishes.
      // A job whose funding then fails is precisely the one the user most needs
      // to find again, so it has to already be in the list by this point.
      rememberJob(id);

      await send("Fund escrow", CHAIN.commerce, encodeCall(SELECTORS.fund, [
        { t: "uint256", v: BigInt(id) },
        { t: "uint256", v: units },
        { t: "bytes", v: "0x" },
      ]));

      clearResume(agentId!);
      setStep("done");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/user rejected|denied/i.test(m) ? "You declined the transaction in your wallet." : m);
      setStep("review");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-ground/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-4 px-5">
          <Link to="/" className="font-mono text-[0.92rem] font-semibold tracking-tight text-ink">
            ALIVE<span className="text-accent">.</span>MD
          </Link>
          <Link to={`/agent/${agentId}`} className="ml-auto inline-flex items-center gap-1.5 text-[0.86rem] text-dim hover:text-ink">
            <ArrowLeft className="size-4" /> Agent
          </Link>
          <WalletButton />
        </div>
      </header>

      <div id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-5 py-12">
        {state.status === "failed" ? (
          <Failed message={state.message} />
        ) : !a ? (
          <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>
        ) : !hireable ? (
          <div className="panel px-6 py-16 text-center">
            <AlertTriangle className="mx-auto size-7 text-faint" />
            <h1 className="mt-4 text-[1.3rem] font-semibold">This agent cannot be hired</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-dim">
              This agent has never taken paid work, and its endpoint is recorded as{" "}
              <span className="font-mono text-ink">{a.verifiedClass}</span>. We have no evidence a
              job would be picked up, so we will not take your money for one.
            </p>
            <Link to="/catalog" className="mt-6 inline-block text-[0.88rem] text-dim underline decoration-line-2 underline-offset-2 hover:text-ink">
              Back to the catalog
            </Link>
          </div>
        ) : step === "done" ? (
          <Rise>
            <div className="panel px-6 py-16 text-center">
              <span className="avatar mx-auto size-10 border-transparent bg-accent text-[#04150C]">
                <Check className="size-6" />
              </span>
              <h1 className="mt-5 text-[1.6rem] font-semibold">Job funded</h1>
              <p className="mt-3 text-[0.92rem] text-dim">
                Escrow is held by the contract. The agent can now deliver.
              </p>
              <div className="mt-8 space-y-1.5 text-left">
                {txs.map((t) => (
                  <a
                    key={t.hash}
                    href={`${CHAIN.explorer}/tx/${t.hash}`}
                    target="_blank" rel="noreferrer noopener"
                    className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 font-mono text-[0.76rem] text-dim hover:border-line-2"
                  >
                    <Check className="size-3.5 text-accent" />
                    {t.label}
                    <span className="ml-auto truncate text-faint">{short(t.hash)}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ))}
              </div>
              {jobId && (
                <button
                  onClick={() => nav(`/job/${jobId}`)}
                  className="btn btn-primary mt-6"
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
                <div className="mb-8 border-l border-accent-line py-1 pl-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-accent">
                    <AlertTriangle className="size-4" /> You have an unfinished hire
                  </p>
                  <p className="mt-2 text-sm text-dim">
                    Job #{resume.jobId} was created for {formatU(BigInt(resume.units))} U, but it
                    was never funded. Finish it rather than starting again, which would create a
                    second job.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => { setBudget(formatU(BigInt(resume.units))); setStep("review"); }}
                      className="btn btn-primary"
                    >
                      Fund job #{resume.jobId}
                    </button>
                    <Link
                      to={`/job/${resume.jobId}`}
                      className="btn btn-secondary"
                    >
                      Inspect it first
                    </Link>
                    <button
                      onClick={() => { clearResume(agentId!); setResume(null); }}
                      className="btn btn-ghost"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </Rise>
            )}

            <Rise>
              <h1 className="text-[1.75rem] font-semibold text-ink">
                Hire {a.name?.trim() || `Agent ${a.agentId}`}
              </h1>
              <p className="mt-3 text-[0.92rem] text-dim">
                Conditions are fixed when the job is created and cannot be edited afterwards.
              </p>
            </Rise>

            {step === "compose" ? (
              <Rise delay={70}>
                <div className="panel mt-8 space-y-7 p-6">
                  <label className="block">
                    <span className="label">The task</span>
                    <textarea
                      value={task} onChange={(e) => setTask(e.target.value)} rows={3}
                      placeholder="What do you want this agent to do?"
                      className="field mt-2 w-full resize-y p-3 text-[0.9rem] outline-none placeholder:text-faint"
                    />
                  </label>

                  <label className="block">
                    <span className="label">How should this be judged?</span>

                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setJudging("review")}
                        aria-pressed={judging === "review"}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          judging === "review"
                            ? "border-accent-line bg-accent-soft"
                            : "border-line hover:border-line-2"}`}
                      >
                        <span className="block text-[0.9rem] font-medium text-ink">
                          I&apos;ll look at it myself
                        </span>
                        <span className="mt-1 block text-[0.8rem] leading-relaxed text-dim">
                          You get {OBJECTION_HOURS} hours to check the work and refuse. Nothing to
                          write now.
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setJudging("criteria")}
                        aria-pressed={judging === "criteria"}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          judging === "criteria"
                            ? "border-accent-line bg-accent-soft"
                            : "border-line hover:border-line-2"}`}
                      >
                        <span className="block text-[0.9rem] font-medium text-ink">
                          Against a written test
                        </span>
                        <span className="mt-1 block text-[0.8rem] leading-relaxed text-dim">
                          Say what a good answer contains. Harder to write, harder to argue with
                          afterwards.
                        </span>
                      </button>
                    </div>

                    {judging === "review" ? (
                      <span className="mt-2 block text-xs leading-relaxed text-faint">
                        The job records that you are the judge and that you have{" "}
                        {OBJECTION_HOURS} hours from delivery. If you do nothing, it settles in the
                        agent&apos;s favour; if you refuse, the escrow returns to you.
                      </span>
                    ) : (
                      <>
                        {/* Pick, then edit. A blank box is the wall; a sentence
                            that is nearly right is a starting point. */}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {presets.map((pre, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => setConditions(pre)}
                              className="pill pill-claim text-left"
                            >
                              use suggestion {presets.length > 1 ? i + 1 : ""}
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={conditions} onChange={(e) => setConditions(e.target.value)} rows={3}
                          placeholder={presets[0]}
                          className="field mt-2 w-full resize-y p-3 text-[0.9rem] outline-none placeholder:text-faint"
                        />
                        <span className="mt-1.5 block text-xs leading-relaxed text-faint">
                          Name a thing that can be pointed at: a number, a verdict, a list of three.
                          Anything a stranger could check without asking either of you what you
                          meant.
                        </span>
                      </>
                    )}
                  </label>

                  {/* Deadline is the client's to set. Price is not. */}
                  <label className="block">
                    <span className="label">Deadline</span>
                    <div className="field mt-2 flex items-center gap-2 px-3 py-2.5">
                      <input
                        type="number" min={1} max={30} value={days}
                        onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                      <span className="font-mono text-xs text-faint">days</span>
                    </div>
                  </label>

                  {/* ── price, asked rather than guessed ─────────────── */}
                  {/* THE PRICE, PROPOSED BY DEFAULT.
                      §6 has us ask the agent rather than let the client invent
                      a number, and that remains the better mechanism - it is
                      just not one this registry implements. `pricing.negotiate`
                      and `pricing.priceWei` are conventions we defined and
                      nothing publishes them: 20 of 20 sampled agents, proven and
                      live alike, answer "no price and no way to ask".

                      Negotiation itself is real - 172 jobs on chain carry a
                      signed quote with `provider_sig` and `negotiation_hash`,
                      and the providers doing it are the proven agents in this
                      very catalog. It simply happens through a channel that is
                      not discoverable from the registration, so we cannot reach
                      it on the client's behalf.

                      So the field leads and asking is offered underneath it. */}
                  {quote.state !== "quoted" && (
                    <label className="block">
                      <span className="label">What you will pay</span>

                      {/* WHAT IT HAS COST OTHER PEOPLE, above the field they
                          are about to fill in. Two numbers, kept apart on
                          purpose: the typical cost is a measurement, the
                          authorisation is a decision. Conflating them is how a
                          suggestion becomes a default nobody chose. */}
                      {pricing?.established && (
                        <div className="mt-2 rounded-lg border border-line px-3.5 py-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-xs text-faint">Typical cost</span>
                            <span className="figure text-sm text-ink">
                              {pricing.typical} U
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-baseline justify-between gap-3">
                            <span className="text-xs text-faint">Recommended authorisation</span>
                            <span className="figure text-sm text-accent">
                              {pricing.suggested} U
                            </span>
                          </div>
                          <p className="mt-2 text-[0.72rem] leading-relaxed text-faint">
                            Based on {pricing.jobs} settled{" "}
                            {pricing.jobs === 1 ? "job" : "jobs"} on chain
                            {pricing.minRaw !== pricing.maxRaw && (
                              <> ({pricing.min}–{pricing.max} U)</>
                            )}. The extra is headroom for execution, not a fee —
                            change it to anything you like.
                          </p>
                        </div>
                      )}

                      <div className="field mt-2 flex items-center gap-2 px-3 py-2.5">
                        <input
                          value={budget}
                          onChange={(e) => { setBudgetTouched(true); setBudget(e.target.value); }}
                          inputMode="decimal"
                          placeholder={pricing?.established ? pricing.suggested : "0.00"}
                          aria-label="Amount to authorise in U"
                          className="w-full bg-transparent text-sm outline-none"
                        />
                        <span className="font-mono text-xs text-faint">U</span>
                      </div>

                      {/* The caption changes with what we actually know. It used
                          to assert "no agent publishes a price, so you name the
                          figure" unconditionally - true about published prices,
                          and misleading the moment we could show a settled
                          one. */}
                      <span className="mt-1.5 block text-xs leading-relaxed text-faint">
                        {pricing?.established
                          ? <>This agent does not publish a price, so this figure comes from
                              what it has actually been paid. It can still refuse the job — if
                              it does, your funds come back and you have spent only gas.</>
                          : <>This agent has not settled enough paid work to show a typical
                              cost, so you name the figure. It can refuse the job — if it does,
                              your funds come back and you have spent only gas.</>}
                      </span>
                    </label>
                  )}

                  {/* ASKING NOW HAPPENS BY ITSELF, AND SILENTLY.
                      There used to be an "ask this agent what it charges"
                      button captioned "worth a try, though almost none answer",
                      which is an apology for shipping a control that fails.
                      Measured across 20 catalog agents spanning proven and live,
                      asking returns "no price and no way to ask" 20 times out of
                      20 — `pricing.negotiate` and `pricing.priceWei` are
                      conventions we defined and nothing implements.

                      So the enquiry moved into the background: once a task is
                      described we ask once, quietly, and the user only ever sees
                      it if an agent actually answers. No button that fails, no
                      caption explaining why it failed, and the capability is
                      still there for the day someone publishes a price. */}

                  {/* Deliberately understated. The user did not ask for this,
                      so it must not look like something they are waiting on. */}
                  {quote.state === "asking" && (
                    <p className="meta">checking whether this agent publishes a price…</p>
                  )}

                  {quote.state === "quoted" && (
                    <div className="quote-in rounded-lg border border-accent-line px-4 py-4">
                      <p className="text-sm text-dim">This agent charges</p>
                      <p className="figure mt-1.5 text-[2rem] text-accent">
                        {quote.price} <span className="text-[1rem] text-dim">{quote.currency}</span>
                      </p>
                      {quote.expiresAt && (
                        <p className="mt-2 text-xs text-faint">
                          This quote holds until{" "}
                          {new Date(quote.expiresAt * 1000).toLocaleTimeString()}.
                        </p>
                      )}
                      <button
                        onClick={() => setQuote({ state: "idle" })}
                        className="mt-3 text-[0.76rem] text-faint underline decoration-line-2 underline-offset-2 hover:text-dim"
                      >
                        Ask again
                      </button>
                    </div>
                  )}

                  {quote.state === "refused" && (
                    <div className="rounded-lg border border-line px-4 py-4">
                      <p className="text-sm font-medium text-ink">The agent declined to quote</p>
                      <p className="mt-1.5 text-sm text-dim">{quote.reason}</p>
                      {quote.price && (
                        <p className="mt-2 text-sm text-accent">
                          It charges {quote.price} U for this work.
                        </p>
                      )}
                      <button
                        onClick={() => setQuote({ state: "idle" })}
                        className="mt-3 text-[0.76rem] text-faint underline decoration-line-2 underline-offset-2 hover:text-dim"
                      >
                        Change the task and ask again
                      </button>
                    </div>
                  )}

                  {/* `unpriced` renders NOTHING. It is the normal case for every
                      agent on this registry, and a panel announcing the normal
                      case is noise. The price field above already carries the
                      one sentence a user needs. */}

                  <div>
                    <button
                      disabled={!canReview}
                      onClick={() => setStep("review")}
                      className="btn btn-primary btn-lg w-full"
                    >
                      Review before funding
                    </button>
                    {!canReview && (
                      <p className="mt-2 text-center text-[0.8rem] text-faint">
                        {!canAskPrice
                          ? "Describe the task first."
                          : !described
                            ? "Say what a finished answer looks like. That is what the job is judged against, and it cannot be changed once funded."
                            : "Enter what you are willing to pay."}
                      </p>
                    )}
                  </div>
                </div>
              </Rise>
            ) : (
              <Rise delay={70}>
                <div className="panel mt-8 overflow-hidden">
                  <div className="border-b border-line px-6 py-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-accent">
                      <Lock className="size-4" /> This is the irreversible step
                    </p>
                    <p className="mt-1.5 text-sm text-dim">
                      Funding moves {displayAmount} U into escrow held by the contract. The conditions
                      below are written on chain and cannot be changed afterwards.
                    </p>
                  </div>

                  <dl className="divide-y divide-line">
                    {[
                      ["Agent", `${a.name?.trim() || a.agentId} (#${a.agentId})`],
                      ["Task", task],
                      [judging === "review" ? "Judged by" : "What done looks like",
                        judging === "review"
                          ? `You, within ${OBJECTION_HOURS} hours of delivery`
                          : conditions],
                      [quote.state === "quoted" ? "Agent's price" : "Your offer", `${displayAmount} U`],
                      ["Deadline", `${days} day${days === 1 ? "" : "s"} from signing`],
                      ["Evaluator", `${short(w.address ?? "")} (you)`],
                    ].map(([k, v]) => (
                      <div key={k} className="grid gap-1 px-6 py-3.5 sm:grid-cols-[11rem_1fr]">
                        <dt className="label pt-0.5">{k}</dt>
                        <dd className="break-words text-sm text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="space-y-3 border-t border-line p-6">
                    {error && (
                      <p className="flex items-start gap-2 rounded-lg border border-danger/25 p-3 text-[0.86rem] text-danger">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
                      </p>
                    )}

                    {/* What the wallet actually holds, read before anything is
                        signed. A zero balance used to surface two signatures
                        and a mined job later, as a revert. */}
                    {w.address && !w.wrongChain && (
                      <div className="rounded-lg border border-line px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <Wallet2 className="size-4 shrink-0 text-faint" />
                          <span className="text-sm text-dim">Your balance</span>
                          <span className="ml-auto text-sm tabular-nums text-ink">
                            {pre.checkedFor !== w.address
                              ? "checking…"
                              : pre.balance === null
                                ? "could not read"
                                : `${formatU(pre.balance, 2)} U`}
                          </span>
                        </div>

                        {shortOfFunds && (
                          <div className="mt-3 border-t border-line pt-3">
                            <p className="text-sm text-danger">
                              Not enough U to fund this job. You need {displayAmount} and hold{" "}
                              {formatU(pre.balance!, 2)}.
                            </p>
                            <p className="mt-1.5 text-xs leading-relaxed text-faint">
                              Escrow settles in U and nothing else — that is fixed by the contract,
                              not by us. The liquid venue is the V3 pool; the V2 pair holds about a
                              cent and looks like proof U is untradeable.
                            </p>
                            <a
                              href={U_POOL.url}
                              target="_blank" rel="noreferrer noopener"
                              className="btn btn-secondary mt-3 border-accent-line text-accent hover:border-accent"
                            >
                              Get U on {U_POOL.label} <ExternalLink className="size-3" />
                            </a>
                          </div>
                        )}

                        {pre.balance === null && pre.checkedFor === w.address && (
                          <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-faint">
                            We could not read your balance, so this is not a claim that you are
                            short. You can continue; the transaction will tell you the truth.
                          </p>
                        )}
                      </div>
                    )}

                    <p className="text-xs leading-relaxed text-faint">
                      {resume?.jobId
                        ? `One transaction: fund the job you already created with ${displayAmount} U.`
                        : needsApprove
                          ? `Three transactions, in order: create the job, approve the escrow to move exactly ${displayAmount} U, then fund it.`
                          : `Two transactions: create the job, then fund it with ${displayAmount} U. Your existing allowance already covers this, so there is nothing to approve.`}{" "}
                      Your wallet will ask you to sign each one.
                    </p>

                    {!w.address ? (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-line p-4">
                        <span className="text-sm text-dim">Connect a wallet to continue.</span>
                        <WalletButton />
                      </div>
                    ) : w.wrongChain ? (
                      <div className="flex items-center justify-between gap-4 rounded-lg border border-danger/25 p-4">
                        <span className="text-sm text-danger">Wrong network.</span>
                        <button onClick={w.switchChain} className="rounded-full bg-danger px-4 py-2 text-sm text-white">
                          Switch to {CHAIN.name}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={run}
                          disabled={step === "signing" || shortOfFunds}
                          className="btn btn-primary btn-lg flex-1"
                        >
                          {step === "signing"
                            ? (
                              <>
                                <Loader2 className="size-4 animate-spin" />
                                {progress
                                  ? progress.kind === "wait"
                                    ? progress.label
                                    : `${progress.label} — ${progress.at} of ${progress.of}`
                                  : "Confirm in your wallet"}
                              </>
                            )
                            : shortOfFunds
                              ? <>Not enough U</>
                              : <><ShieldCheck className="size-4" /> Fund {displayAmount} U into escrow</>}
                        </button>
                        <button
                          onClick={() => setStep("compose")}
                          disabled={step === "signing"}
                          className="btn btn-secondary btn-lg"
                        >
                          Edit
                        </button>
                      </div>
                    )}

                    {(txs.length > 0 || progress?.kind === "wait") && (
                      <ul className="space-y-1.5 pt-2">
                        {txs.map((t) => (
                          <li key={t.hash} className="flex items-center gap-2 text-xs">
                            <FileCheck className="size-3.5 shrink-0 text-accent" />
                            <span className="font-mono text-faint">{t.label} sent</span>
                            {/* Clickable while the receipt is still pending: the
                                wait below can run to two minutes, and watching
                                it confirm on the explorer is the difference
                                between waiting and wondering. */}
                            <a
                              href={`${CHAIN.explorer}/tx/${t.hash}`}
                              target="_blank" rel="noreferrer noopener"
                              className="ml-auto inline-flex items-center gap-1 font-mono text-dim transition-colors hover:text-accent"
                            >
                              {short(t.hash)} <ExternalLink className="size-3" />
                            </a>
                          </li>
                        ))}
                        {progress?.kind === "wait" && (
                          <li className="flex items-center gap-2 text-xs">
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-dim" />
                            <span className="font-mono text-dim">
                              waiting for the job number, up to two minutes
                            </span>
                          </li>
                        )}
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

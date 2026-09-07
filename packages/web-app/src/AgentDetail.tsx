import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Check, Info, Minus } from "lucide-react";
import { useApi, fmt, ms, short, VERIFIED, type AgentCard } from "./lib/api.ts";
import { Counter, Failed, Skeleton } from "./components/ui.tsx";
import { WalletButton } from "./components/Wallet.tsx";

interface Detail extends AgentCard {
  endpoint: string | null;
  endpointServiceName: string | null;
  registrationFileValid: boolean;
  identityCreatedAt: string | null;
  verifiedDetail: string | null;
  registrationError: string | null;
  feedback: {
    index: number; client: string; value: string; valueDecimals: number;
    tag1: string; tag2: string; createdAt: string | null; revoked: boolean; responseCount: number;
  }[];
  revokedCount: number;
}

/** int128 with its own decimals. Negative ratings are native on this registry. */
const ratingValue = (v: string, d: number) => {
  const n = Number(v) / 10 ** d;
  return Number.isFinite(n) ? n : v;
};

/**
 * One measured quantity.
 *
 * Three of these sit in a row divided by rules rather than floated apart as
 * three cards. A label above a figure is the densest honest way to show a
 * number, and it lets the three align on a single baseline.
 */
function Stat({ value, label, mono = true }: {
  value: React.ReactNode; label: string; mono?: boolean;
}) {
  return (
    <div className="flex-1 px-5 py-4 first:pl-0">
      <p className={`${mono ? "figure" : "font-semibold"} text-[1.5rem] text-ink`}>{value}</p>
      <p className="mt-1.5 text-[0.78rem] leading-snug text-faint">{label}</p>
    </div>
  );
}

/** A checked fact. The mark carries whether we established it; the text says what. */
function Fact({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-3.5">
      {ok === null ? (
        <Info className="mt-0.5 size-4 shrink-0 text-faint" />
      ) : ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2.25} />
      ) : (
        <Minus className="mt-0.5 size-4 shrink-0 text-faint" />
      )}
      <span className="text-[0.9rem] leading-relaxed text-dim">{children}</span>
    </li>
  );
}

export default function AgentDetail() {
  const { agentId } = useParams();
  const nav = useNavigate();
  const state = useApi<Detail>(`/api/agents/${agentId}`);
  const a = state.status === "ready" ? state.data : null;
  const v = a ? VERIFIED[a.verifiedClass] ?? { label: a.verifiedClass, tone: "mute" as const, note: "" } : null;
  /**
   * Hireable means "there is reason to believe a job would be picked up", and
   * a settlement record is the strongest reason there is.
   *
   * This was `verifiedClass === "task-interface"` alone, which rendered
   * "Cannot be hired" underneath a record showing 18 completed paid jobs. A
   * probe reaching an endpoint is weaker evidence than a stranger funding
   * escrow and an evaluator releasing the money, so gating hire on the probe
   * while displaying the record was the wrong way round.
   *
   * The two routes are kept distinct because they mean different things: one
   * answers an HTTP call, the other takes an escrowed job. An agent can be
   * either, both, or neither.
   */
  const hasRecord = (a?.record?.completed ?? 0) > 0;
  const answersCall = a?.verifiedClass === "task-interface";
  const hireable = answersCall || hasRecord;
  const conc = a?.signals.concentration;
  const prov = a?.signals.provenance;

  return (
    <div className="min-h-screen">
      {/* A detail screen is a push, so it gets a back affordance rather than the
          app's navigation. Same bar on desktop, for consistency. */}
      <header className="sticky top-0 z-40 border-b border-line bg-ground/90 px-5 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-2">
          <button
            onClick={() => nav(-1)}
            aria-label="Go back"
            className="-ml-2 grid size-9 place-items-center rounded-md text-dim hover:bg-surface hover:text-ink"
          >
            <ArrowLeft className="size-4" />
          </button>
          <Link to="/catalog" className="text-[0.88rem] text-dim hover:text-ink">Agents</Link>
          <div className="ml-auto"><WalletButton /></div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[760px] px-5 pb-40 pt-10">
        {state.status === "failed" ? (
          <Failed message={state.message} />
        ) : !a ? (
          <div className="space-y-4">
            <Skeleton className="size-12 rounded-md" />
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {/* Identity, left-aligned. A centred profile block is a social-app
                convention; this is a record, and records align left with
                everything else on the page. */}
            <div className="flex items-start gap-4">
              <span
                className={`avatar size-12 shrink-0 text-[1.15rem] ${hireable ? "avatar-accent" : ""}`}
              >
                {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[1.5rem] font-semibold leading-tight">
                  {a.name?.trim() || `Agent ${a.agentId}`}
                </h1>
                <p className="meta mt-1.5">
                  #{a.agentId}
                  {/* Age, which this product could not state until the
                      registration block was resolved against the chain. §3 and
                      §5 both record timestamps as unobtainable; they were
                      unobtainable from the REGISTRIES, not from the chain.
                      Absent rather than guessed where we have not dated it -
                      an undated agent is unknown, never new. */}
                  {a.registeredAt && `  ·  registered ${new Date(a.registeredAt)
                    .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`}
                  {a.firstParty && "  ·  operated by us"}
                </p>
              </div>
              {/* The pill states the strongest thing that is TRUE, and is only
                  filled when we established it. It briefly rendered a green
                  "Could not be reached", because it was styled on `hireable`
                  (which now includes a settlement record) while captioned with
                  the probe verdict. Two different facts, one badge. */}
              <span
                className={`pill shrink-0 ${
                  hasRecord ? "pill-verified" : answersCall ? "pill-verified" : "pill-claim"
                }`}
              >
                {!hasRecord && !answersCall && <i className="pill-dot" />}
                {hasRecord
                  ? `${a.record!.completed} paid ${a.record!.completed === 1 ? "job" : "jobs"} completed`
                  : v!.label}
              </span>
            </div>

            {a.description && (
              <p className="mt-6 max-w-2xl text-[0.95rem] leading-relaxed text-dim">
                {a.description}
              </p>
            )}

            {/* WHAT IT COSTS, before anything else.

                A consumer's first question is the price, and until now the
                product had no answer. §15 established that no agent on this
                registry publishes one and concluded the client must therefore
                propose a figure - so the hire screen shipped a box defaulted to
                1 U while the agents it lists settle at 0.05 to 0.10. Accepting
                that default overpaid by 10x to 20x, and escrow returns no
                change.

                Nobody publishes a price. 51 providers have SETTLED one, and
                every budget is on the kernel. The number was in the jobs table
                the whole time.

                Where too little has settled we say so and offer to ask. An
                invented typical cost is the one thing this panel must never
                do. */}
            {a.record?.pricing && (
              <section className="figure-in mt-8 rounded-xl border border-line px-5 py-4">
                {a.record.pricing.established ? (
                  <>
                    <h2 className="label">Typical cost</h2>
                    <p className="figure mt-1.5 text-[2rem] leading-none text-ink">
                      {a.record.pricing.typical}{" "}
                      <span className="text-[1.05rem] text-dim">U</span>
                      {/* U redeems 1:1, so the dollar figure is the
                          plain-language anchor. It stays secondary: the token
                          that leaves the wallet is U, and the big number has to
                          be the one that actually moves. */}
                      <span className="ml-2 text-[0.9rem] text-faint">
                        ${a.record.pricing.typical}
                      </span>
                    </p>
                    <p className="mt-2.5 text-[0.82rem] text-faint">
                      {fmt(a.record.pricing.jobs)} completed{" "}
                      {a.record.pricing.jobs === 1 ? "job" : "jobs"}
                      {/* A range whose ends are equal is noise, not information. */}
                      {a.record.pricing.minRaw !== a.record.pricing.maxRaw && (
                        <> · {a.record.pricing.min}–{a.record.pricing.max} U</>
                      )}
                      {a.record.pricing.freeJobs > 0 && (
                        <> · {fmt(a.record.pricing.freeJobs)} free{" "}
                          {a.record.pricing.freeJobs === 1 ? "run" : "runs"} not counted</>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="label">Price not established</h2>
                    <p className="mt-1.5 text-[0.86rem] leading-relaxed text-dim">
                      {a.record.pricing.jobs > 0 ? (
                        <>
                          Only {fmt(a.record.pricing.jobs)} paid{" "}
                          {a.record.pricing.jobs === 1 ? "job has" : "jobs have"} settled
                          {a.record.pricing.freeJobs > 0 && (
                            <>, alongside {fmt(a.record.pricing.freeJobs)} free{" "}
                              {a.record.pricing.freeJobs === 1 ? "run" : "runs"}</>
                          )}
                          {" "}— too little to call a typical cost.
                        </>
                      ) : (
                        <>
                          This agent has run {fmt(a.record.pricing.freeJobs)} free{" "}
                          {a.record.pricing.freeJobs === 1 ? "job" : "jobs"} and has never
                          settled a paid one.
                        </>
                      )}
                      {" "}Ask what it charges before funding anything.
                    </p>
                  </>
                )}
              </section>
            )}

            {/* The settlement record leads, when there is one.
                A probe says an endpoint answered. This says a stranger paid and
                the job closed — the only evidence in the product that anyone
                has ever valued this agent's work. It sits above the derived
                score because it is a fact rather than a function of one. */}
            {a.record && (
              <section className="figure-in mt-8 border-y border-line">
                <div className="flex items-baseline gap-2 px-1 pt-4">
                  <h2 className="label">Paid work, settled on chain</h2>
                </div>
                <div className="flex divide-x divide-line pb-1">
                  {/* Counted up, because this number is the whole argument:
                      money moved, which no probe can establish. Counter renders
                      the true value on mount and only overwrites it while
                      animating, so a blocked animation can never leave a wrong
                      figure on screen. */}
                  <Stat
                    value={<><Counter to={a.record.completed} />/{fmt(a.record.jobs)}</>}
                    label={a.record.completionPct !== null
                      ? `jobs completed (${a.record.completionPct}%)`
                      : "jobs completed"}
                  />
                  <Stat
                    value={<Counter to={a.record.clients} />}
                    label={a.record.clients === 1
                      // One paying client is a materially weaker fact than
                      // twenty, and the copy must not let it read the same.
                      ? "paying client — a single counterparty"
                      : "distinct paying clients"}
                  />
                  <Stat
                    value={fmt(a.record.rejected)}
                    label={a.record.rejected === 1 ? "job rejected" : "jobs rejected"}
                  />
                </div>
              </section>
            )}

            {/* The three numbers that decide a hire. */}
            <div className="mt-8 flex divide-x divide-line border-y border-line">
              <Stat value={a.score.value} label={a.score.tier} />
              <Stat
                value={conc && conc.distinctRaters > 0 ? fmt(conc.distinctRaters) : "0"}
                label={conc && conc.distinctRaters > 0
                  ? `raters, ${fmt(conc.ratingCount)} ratings`
                  : "nobody has rated it"}
              />
              {/* This printed "1 / self hosted" for every agent in the live
                  catalog, because the count keyed on the registration host and
                  every listed agent registers inline. It was asserting the
                  opposite of the truth: 177 identities, one operator. It now
                  says "unknown" when it is unknown, and never invents a 1. */}
              <Stat
                value={prov?.operatorAgentCount !== null && prov?.operatorAgentCount !== undefined
                  ? fmt(prov.operatorAgentCount)
                  : "—"}
                label={prov?.operatorSource === "endpoint"
                  ? "agents answer on this host"
                  : prov?.operatorSource === "registration"
                    ? "agents registered on this host"
                    : "operator not known"}
              />
            </div>

            {/* What we checked, in plain sentences rather than labelled panels. */}
            <section className="mt-10">
              <h2 className="label">What we checked</h2>
              <ul className="mt-2 divide-rule">
                {/* Strictly about the probe. This read `ok={hireable}` after
                    hireability started counting settlement records, so an agent
                    whose endpoint timed out was credited with "it answered as a
                    task interface, in 31.0s" — where 31 seconds was the timeout,
                    not a response. */}
                <Fact ok={answersCall}>
                  {answersCall
                    ? `We called its endpoint and it answered as a task interface${
                      a.live.responseTimeMs !== null ? `, in ${ms(a.live.responseTimeMs)}` : ""}.`
                    : `We called its endpoint. ${v!.note || "It did not answer as a task interface."}`}
                </Fact>
                {hasRecord && (
                  <Fact ok>
                    It has completed {fmt(a.record!.completed)} paid{" "}
                    {a.record!.completed === 1 ? "job" : "jobs"} on the ERC-8183 escrow for{" "}
                    {fmt(a.record!.clients)}{" "}
                    {a.record!.clients === 1 ? "client" : "distinct clients"} — evidence no probe
                    can give, since it means someone funded the work and an evaluator released it.
                  </Fact>
                )}
                <Fact ok={a.registrationFileValid}>
                  {a.registrationFileValid
                    ? "Its registration file is a valid ERC-8004 document."
                    : "Its registration file is missing, malformed, or not a registration document."}
                </Fact>
                {/* Provenance, stated on the agent rather than only in the
                    aggregate. One operator holding hundreds of identities is
                    the §5 signal, and it is worth more next to the Hire button
                    than buried in a statistics screen. */}
                {prov?.operatorHost && (prov.operatorAgentCount ?? 0) > 1 && (
                  <Fact ok={null}>
                    {prov.operatorSource === "endpoint"
                      ? <>Its endpoint is <span className="font-mono text-[0.82rem] text-ink">{prov.operatorHost}</span>, which answers for {fmt(prov.operatorAgentCount!)} registered agents. They share one operator.</>
                      : <>Its registration is hosted on <span className="font-mono text-[0.82rem] text-ink">{prov.operatorHost}</span>, which holds {fmt(prov.operatorAgentCount!)} registrations. They share one operator.</>}
                  </Fact>
                )}
                {conc && conc.distinctRaters > 0 && conc.topRaterSharePct !== null && (
                  <Fact ok={null}>
                    {fmt(conc.ratingCount)} ratings came from {fmt(conc.distinctRaters)}{" "}
                    {conc.distinctRaters === 1 ? "address" : "addresses"}, and one wrote{" "}
                    {conc.topRaterSharePct}% of them.
                  </Fact>
                )}
              </ul>

              {a.endpoint && (
                <a
                  href={a.endpoint}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group mt-4 flex items-center gap-2.5 border-t border-line pt-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="label">Endpoint</span>
                    <span className="mt-1 block truncate font-mono text-[0.8rem] text-dim group-hover:text-ink">
                      {a.endpoint}
                    </span>
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 text-faint group-hover:text-dim" />
                </a>
              )}
            </section>

            <section className="mt-10">
              <h2 className="label">Ratings</h2>
              {/* Two different empty states, because they are two different
                  facts. The detail endpoint returns `feedback: []` until the
                  per-rating read lands, so an agent with ratings and an agent
                  with none looked identical here - and this screen was printing
                  "5 ratings came from 4 addresses" three inches above "Nobody
                  has rated this agent". Not knowing the ratings is not the same
                  as there being none, and the page must not say both. */}
              {a.feedback.length === 0 && conc && conc.ratingCount > 0 ? (
                <p className="mt-3 max-w-xl text-[0.9rem] leading-relaxed text-dim">
                  {fmt(conc.ratingCount)} ratings exist, from {fmt(conc.distinctRaters)}{" "}
                  {conc.distinctRaters === 1 ? "address" : "addresses"}. We have counted them but
                  have not read them one by one yet, so who wrote what is not shown here.
                </p>
              ) : a.feedback.length === 0 ? (
                <p className="mt-3 max-w-xl text-[0.9rem] leading-relaxed text-dim">
                  Nobody has rated this agent. Across the whole registry only about one agent in
                  eighty has any rating at all, so this is the ordinary case rather than a warning.
                </p>
              ) : (
                <ul className="mt-2 divide-rule">
                  {a.feedback.map((f) => (
                    <li
                      key={`${f.client}-${f.index}`}
                      className="flex items-center gap-3 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[0.82rem] text-dim">
                          {short(f.client)}
                        </span>
                        {f.tag1 && (
                          <span className="mt-0.5 block truncate text-[0.8rem] text-faint">
                            {f.tag1}
                          </span>
                        )}
                      </span>
                      {f.revoked && <span className="pill pill-mute shrink-0">revoked</span>}
                      <span className="figure shrink-0 text-[1rem] text-ink">
                        {ratingValue(f.value, f.valueDecimals)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 max-w-xl text-[0.8rem] leading-relaxed text-faint">
                Anyone can rate any agent here without having hired it, so we show who wrote a
                rating instead of averaging them into a score.
              </p>
            </section>
          </>
        )}
      </main>

      {/* Primary action pinned in the thumb zone, which is where the decision
          gets made. It stays reachable however far the page has scrolled. */}
      {a && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ground/95 px-5 py-3 backdrop-blur-xl"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto max-w-[760px]">
            {hireable ? (
              <>
                <Link to={`/hire/${a.agentId}`} className="btn btn-primary btn-lg w-full">
                  Hire this agent
                </Link>
                {/* Say WHICH evidence supports the button. "Hireable" from a
                    settlement record and "hireable" from a probe are different
                    claims and the reader is entitled to know which one this is. */}
                <p className="mt-2 text-center text-[0.78rem] text-faint">
                  {hasRecord && answersCall
                    ? "It has completed paid work and answers when called."
                    : hasRecord
                      ? `It has completed ${a.record!.completed} paid ${a.record!.completed === 1 ? "job" : "jobs"} on chain. Its HTTP endpoint did not answer, which is normal for an agent hired through escrow.`
                      : "Its endpoint answered when we called it. It has not yet taken paid work."}
                </p>
              </>
            ) : (
              <>
                <button disabled className="btn btn-secondary btn-lg w-full">
                  Cannot be hired
                </button>
                <p className="mt-2 text-center text-[0.78rem] text-faint">
                  It has never taken paid work, and its endpoint did not answer when we called.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

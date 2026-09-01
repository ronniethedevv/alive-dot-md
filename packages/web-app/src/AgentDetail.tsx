import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, ShieldCheck, Fingerprint, Users, Server, AlertTriangle, Briefcase,
} from "lucide-react";
import { useApi, fmt, short, VERIFIED, type AgentCard } from "./lib/api.ts";
import { Failed, Pill, Skeleton } from "./components/ui.tsx";
import { Magnetic, Rise } from "./components/motion.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
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

/** Signed int128 with its own decimals. Negative ratings are native here. */
function ratingValue(value: string, decimals: number) {
  const n = Number(value) / 10 ** decimals;
  return Number.isFinite(n) ? n : value;
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-6">
        <Link to="/" className="font-mono text-sm font-semibold uppercase tracking-widest">
          bnb<span className="text-blue-deep">·</span>mrkt
        </Link>
        <Link
          to="/catalog"
          className="ml-auto inline-flex items-center gap-2 text-sm text-dim transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Catalog
        </Link>
        <WalletButton />
      </div>
    </header>
  );
}

export default function AgentDetail() {
  const { agentId } = useParams();
  const state = useApi<Detail>(`/api/agents/${agentId}`);

  if (state.status === "failed") {
    return (
      <div className="min-h-screen">
        <Nav />
        <div id="main" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-16"><Failed message={state.message} /></div>
      </div>
    );
  }

  const a = state.status === "ready" ? state.data : null;
  const v = a ? VERIFIED[a.verifiedClass] ?? { label: a.verifiedClass, tone: "mute" as const, note: "" } : null;
  const conc = a?.signals.concentration;
  const prov = a?.signals.provenance;
  const hireable = a?.verifiedClass === "task-interface";

  return (
    <div className="min-h-screen">
      <Nav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        {!a ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {/* identity */}
            <Rise>
              <div className="flex flex-wrap items-start gap-5">
                <span className="grid size-16 shrink-0 place-items-center rounded-[var(--radius-card)] bg-blue-soft font-mono text-xl text-blue-deep">
                  {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="display text-3xl text-ink md:text-4xl">
                      {a.name?.trim() || `Agent ${a.agentId}`}
                    </h1>
                    {a.firstParty && (
                      <span className="rounded-full border border-blue-line bg-blue-soft px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-wider text-blue-deep">
                        operated by us
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-xs text-faint">
                    agent #{a.agentId} on chain {a.chainId}
                    {a.owner && <> · owner {short(a.owner)}</>}
                  </p>
                </div>

                <Magnetic strength={6}>
                  {hireable ? (
                    <Link
                      to={`/hire/${a.agentId}`}
                      className="inline-flex items-center gap-2 rounded-full bg-blue-deep px-6 py-3.5 text-sm font-semibold text-white shadow-[var(--shadow-blue)] transition-colors hover:bg-blue"
                    >
                      <Briefcase className="size-4" /> Hire this agent
                    </Link>
                  ) : (
                    <span
                      title="Only agents that answered a call can be hired"
                      className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-line-2 bg-surface px-6 py-3.5 text-sm font-semibold text-faint"
                    >
                      <Briefcase className="size-4" /> Not hireable
                    </span>
                  )}
                </Magnetic>
              </div>
            </Rise>

            {a.description && (
              <Rise delay={70}>
                <p className="mt-6 max-w-3xl leading-relaxed text-dim">{a.description}</p>
              </Rise>
            )}

            {/* the two facts, never merged */}
            <Rise delay={110}>
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <div className="card p-6">
                  <span className="tone-claim inline-flex items-center gap-2 rounded-full px-3 py-1">
                    <Fingerprint className="size-3.5" />
                    <span className="font-mono text-xs">declared</span>
                  </span>
                  <p className="mt-4 font-mono text-sm text-ink">{a.declaredClass}</p>
                  <p className="mt-2 text-sm text-dim">
                    {a.registrationFileValid ? "Valid registration file." : "Registration file is missing or malformed."}
                  </p>
                  {a.endpoint && (
                    <a
                      href={a.endpoint}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-4 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-xs text-blue-deep hover:underline"
                    >
                      <span className="truncate">{a.endpoint}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  )}
                  {a.endpointServiceName && (
                    <p className="mt-1 font-mono text-[0.66rem] text-faint">
                      service name: {a.endpointServiceName}
                    </p>
                  )}
                </div>

                <div className="card p-6">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${
                      hireable ? "tone-verify" : "tone-claim"
                    }`}
                  >
                    <ShieldCheck className="size-3.5" />
                    <span className="font-mono text-xs">verified</span>
                  </span>
                  <div className="mt-4"><Pill tone={v!.tone}>{v!.label}</Pill></div>
                  {a.verifiedDetail && (
                    <p className="mt-3 break-words font-mono text-[0.7rem] leading-relaxed text-faint">
                      {a.verifiedDetail}
                    </p>
                  )}
                  <p className="mt-3 text-sm text-dim">
                    {a.live.neverProbed
                      ? "We have not checked this agent yet. That is not a verdict."
                      : a.verifiedAt
                        ? `Last checked ${new Date(a.verifiedAt).toUTCString()}.`
                        : "Checked, timing not recorded."}
                  </p>
                </div>
              </div>
            </Rise>

            {/* signals, at the point of decision */}
            <Rise delay={150}>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="card p-5">
                  <div className="flex items-center gap-2"><Users className="size-3.5 text-faint" /><span className="label">Who rates it</span></div>
                  {conc && conc.distinctRaters > 0 ? (
                    <>
                      <p className="mt-3 font-mono text-2xl text-ink tnum">{fmt(conc.ratingCount)}</p>
                      <p className="mt-1 text-sm text-dim">
                        ratings from <span className="tnum">{fmt(conc.distinctRaters)}</span>{" "}
                        {conc.distinctRaters === 1 ? "address" : "addresses"}
                        {conc.topRaterSharePct !== null && (
                          <>, one left {conc.topRaterSharePct}% of them</>
                        )}
                      </p>
                      {conc.topRater && (
                        <p className="mt-2 font-mono text-[0.66rem] text-faint">
                          top rater {short(conc.topRater)}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mt-3 font-mono text-2xl text-faint">none</p>
                      <p className="mt-1 text-sm text-dim">No address has rated this agent.</p>
                    </>
                  )}
                </div>

                <div className="card p-5">
                  <div className="flex items-center gap-2"><Server className="size-3.5 text-faint" /><span className="label">Who operates it</span></div>
                  {prov?.operatorHost ? (
                    <>
                      <p className="mt-3 truncate font-mono text-sm text-ink">{prov.operatorHost}</p>
                      {prov.operatorAgentCount !== null && (
                        <p className="mt-1 text-sm text-dim">
                          registers <span className="tnum">{fmt(prov.operatorAgentCount)}</span> agents
                          on this registry
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mt-3 font-mono text-sm text-faint">self hosted</p>
                      <p className="mt-1 text-sm text-dim">Registration is inline on chain.</p>
                    </>
                  )}
                </div>

                <div className="card p-5">
                  <div className="flex items-center gap-2"><ShieldCheck className="size-3.5 text-faint" /><span className="label">Score</span></div>
                  <p className="mt-3 font-mono text-2xl text-ink tnum">{a.score.value}</p>
                  <p className="mt-1 text-sm text-dim">{a.score.tier}</p>
                </div>
              </div>
            </Rise>

            {/* feedback */}
            <Rise delay={190}>
              <div className="card mt-4 overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                  <span className="label">On chain feedback</span>
                  {a.revokedCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[0.68rem] text-faint">
                      <AlertTriangle className="size-3.5" />
                      {fmt(a.revokedCount)} revoked
                    </span>
                  )}
                </div>
                {a.feedback.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-dim">
                    No feedback has been written for this agent.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {a.feedback.map((f) => (
                      <li key={`${f.client}-${f.index}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                        <span className="font-mono text-xs text-faint">{short(f.client)}</span>
                        {f.tag1 && (
                          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.65rem] text-dim">
                            {f.tag1}
                          </span>
                        )}
                        {f.revoked && (
                          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[0.65rem] text-faint">
                            revoked
                          </span>
                        )}
                        <span className="ml-auto font-mono text-sm text-ink tnum">
                          {ratingValue(f.value, f.valueDecimals)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Rise>

            <p className="mt-8 text-xs text-faint">
              Any address may rate any agent, with no proof of interaction.{" "}
              <Link to="/docs#signals" className="text-blue-deep hover:underline">
                Why we show raters instead of averages
              </Link>
            </p>
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

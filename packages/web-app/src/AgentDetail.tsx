import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Check, ExternalLink, Users, Server, ShieldCheck, Info, Briefcase,
} from "lucide-react";
import { useApi, fmt, short, VERIFIED, type AgentCard } from "./lib/api.ts";
import { Failed, Skeleton } from "./components/ui.tsx";
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

/** A stat, stated as a number over a plain phrase rather than a labelled cell. */
function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: React.ReactNode; label: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-surface px-3 py-4 text-center">
      <Icon className="mx-auto size-4 text-faint" />
      <p className="mt-2 text-[1.35rem] font-bold leading-none tabular-nums">{value}</p>
      <p className="mt-1.5 text-[0.76rem] leading-snug text-faint">{label}</p>
    </div>
  );
}

export default function AgentDetail() {
  const { agentId } = useParams();
  const nav = useNavigate();
  const state = useApi<Detail>(`/api/agents/${agentId}`);
  const a = state.status === "ready" ? state.data : null;
  const v = a ? VERIFIED[a.verifiedClass] ?? { label: a.verifiedClass, tone: "mute" as const, note: "" } : null;
  const hireable = a?.verifiedClass === "task-interface";
  const conc = a?.signals.concentration;
  const prov = a?.signals.provenance;

  return (
    <div className="min-h-screen">
      {/* A detail screen is a push, so it gets a back affordance rather than the
          app's navigation. Same bar on desktop, for consistency. */}
      <header className="sticky top-0 z-40 border-b border-line bg-ground/90 px-4 backdrop-blur-xl lg:px-8">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3">
          <button
            onClick={() => nav(-1)}
            aria-label="Go back"
            className="-ml-2 grid size-11 place-items-center rounded-full text-dim hover:bg-surface hover:text-ink"
          >
            <ArrowLeft className="size-5" />
          </button>
          <Link to="/catalog" className="text-[0.95rem] font-semibold">Agent</Link>
          <div className="ml-auto"><WalletButton /></div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 pb-44 pt-6 lg:px-8">
        {state.status === "failed" ? (
          <Failed message={state.message} />
        ) : !a ? (
          <div className="space-y-4">
            <Skeleton className="mx-auto size-20 rounded-3xl" />
            <Skeleton className="mx-auto h-8 w-56" />
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            {/* identity, centred and large the way a profile opens */}
            <div className="text-center">
              <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-accent-soft text-3xl font-bold text-accent">
                {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
              </span>
              <div className="mt-4 flex items-center justify-center gap-2">
                <h1 className="text-[1.6rem] font-bold tracking-tight">
                  {a.name?.trim() || `Agent ${a.agentId}`}
                </h1>
                {hireable && (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent">
                    <Check className="size-3.5 text-[#04150C]" strokeWidth={3.5} />
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[0.9rem] text-faint">
                #{a.agentId}
                {a.firstParty && " · operated by us"}
              </p>

              <p
                className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.9rem] font-medium ${
                  hireable ? "bg-accent text-[#04150C]" : "bg-surface text-dim"
                }`}
              >
                {hireable ? <Check className="size-4" strokeWidth={3} /> : <Info className="size-4" />}
                {v!.label}
              </p>
            </div>

            {a.description && (
              <p className="mx-auto mt-6 max-w-xl text-center text-[0.98rem] leading-relaxed text-dim">
                {a.description}
              </p>
            )}

            {/* the three numbers that decide a hire */}
            <div className="mt-8 flex gap-2">
              <Stat icon={ShieldCheck} value={a.score.value} label={a.score.tier} />
              <Stat
                icon={Users}
                value={conc && conc.distinctRaters > 0 ? fmt(conc.distinctRaters) : "0"}
                label={conc && conc.distinctRaters > 0
                  ? `raters, ${fmt(conc.ratingCount)} ratings`
                  : "nobody has rated it"}
              />
              <Stat
                icon={Server}
                value={prov?.operatorAgentCount ? fmt(prov.operatorAgentCount) : "1"}
                label={prov?.operatorHost ? "agents from this operator" : "self hosted"}
              />
            </div>

            {/* what we checked, in plain sentences rather than labelled panels */}
            <section className="mt-8">
              <h2 className="text-[1.05rem] font-semibold">What we checked</h2>
              <ul className="mt-3 space-y-1">
                <li className="flex gap-3 rounded-2xl bg-surface px-4 py-3.5">
                  <Check className={`mt-0.5 size-4 shrink-0 ${hireable ? "text-accent" : "text-faint"}`} />
                  <span className="text-[0.92rem] leading-relaxed text-dim">
                    {hireable
                      ? "We called its endpoint and it answered as a task interface."
                      : `We called its endpoint. ${v!.note || "It did not answer as a task interface."}`}
                  </span>
                </li>
                <li className="flex gap-3 rounded-2xl bg-surface px-4 py-3.5">
                  <Check className={`mt-0.5 size-4 shrink-0 ${a.registrationFileValid ? "text-accent" : "text-faint"}`} />
                  <span className="text-[0.92rem] leading-relaxed text-dim">
                    {a.registrationFileValid
                      ? "Its registration file is a valid ERC-8004 document."
                      : "Its registration file is missing, malformed, or not a registration document."}
                  </span>
                </li>
                {conc && conc.distinctRaters > 0 && conc.topRaterSharePct !== null && (
                  <li className="flex gap-3 rounded-2xl bg-surface px-4 py-3.5">
                    <Info className="mt-0.5 size-4 shrink-0 text-faint" />
                    <span className="text-[0.92rem] leading-relaxed text-dim">
                      {fmt(conc.ratingCount)} ratings came from {fmt(conc.distinctRaters)}{" "}
                      {conc.distinctRaters === 1 ? "address" : "addresses"}, and one wrote{" "}
                      {conc.topRaterSharePct}% of them.
                    </span>
                  </li>
                )}
              </ul>

              {a.endpoint && (
                <a
                  href={a.endpoint}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="row-hover mt-1 flex min-h-[56px] items-center gap-3 rounded-2xl px-4"
                >
                  <ExternalLink className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9rem] font-medium">See its endpoint</span>
                    <span className="block truncate text-[0.78rem] text-faint">{a.endpoint}</span>
                  </span>
                </a>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-[1.05rem] font-semibold">Ratings</h2>
              {a.feedback.length === 0 ? (
                <p className="mt-3 rounded-2xl bg-surface px-4 py-5 text-[0.92rem] leading-relaxed text-dim">
                  Nobody has rated this agent. Across the whole registry only about one agent in
                  eighty has any rating at all, so this is the ordinary case rather than a warning.
                </p>
              ) : (
                <ul className="mt-3 space-y-1">
                  {a.feedback.map((f) => (
                    <li
                      key={`${f.client}-${f.index}`}
                      className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-[0.7rem] text-faint">
                        {f.client.slice(2, 4).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.88rem] text-dim">{short(f.client)}</span>
                        {f.tag1 && (
                          <span className="block truncate text-[0.78rem] text-faint">{f.tag1}</span>
                        )}
                      </span>
                      {f.revoked && (
                        <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[0.68rem] text-faint">
                          revoked
                        </span>
                      )}
                      <span className="shrink-0 text-[1.05rem] font-semibold tabular-nums">
                        {ratingValue(f.value, f.valueDecimals)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 px-1 text-[0.8rem] leading-relaxed text-faint">
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
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ground/95 px-4 py-3 backdrop-blur-xl lg:px-8"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="mx-auto max-w-3xl">
            {hireable ? (
              <Link
                to={`/hire/${a.agentId}`}
                className="flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-accent text-[1rem] font-semibold text-[#04150C] transition-transform active:scale-[.99]"
              >
                <Briefcase className="size-5" /> Hire this agent
              </Link>
            ) : (
              <>
                <button
                  disabled
                  className="flex min-h-[56px] w-full cursor-not-allowed items-center justify-center rounded-full bg-surface text-[1rem] font-semibold text-faint"
                >
                  Cannot be hired
                </button>
                <p className="mt-2 text-center text-[0.78rem] text-faint">
                  Only agents that answered when we called them can be hired.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

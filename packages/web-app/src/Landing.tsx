import { Link } from "react-router-dom";
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { ArrowRight, ShieldCheck, Fingerprint, Scale, Ban, ArrowDown, Users, Network, Server } from "lucide-react";
import { useApi, fmt, pct, short, VERIFIED, type Stats } from "./lib/api.ts";
import { Failed, Pill, Skeleton } from "./components/ui.tsx";
import { GapMeter } from "./components/GapMeter.tsx";
import { HiringFlow } from "./components/HiringFlow.tsx";
import { AgentTicker } from "./components/AgentTicker.tsx";
import { CatalogMock } from "./components/CatalogMock.tsx";
import { Magnetic, Marquee, Odometer, Parallax, Rise, Tilt } from "./components/motion.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { WalletButton } from "./components/Wallet.tsx";

/* ── chrome ──────────────────────────────────────────────────────────────── */

function Nav({ hireable }: { hireable?: number }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link to="/" className="font-mono text-sm font-semibold uppercase tracking-widest">
          bnb<span className="text-blue-deep">·</span>mrkt
        </Link>
        <nav className="ml-auto hidden items-center gap-7 text-sm text-dim md:flex">
          <a href="#checked" className="transition-colors hover:text-ink">What we check</a>
          <a href="#signals" className="transition-colors hover:text-ink">Signals</a>
          <a href="#hiring" className="transition-colors hover:text-ink">Hiring</a>
        </nav>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <WalletButton />
        <Magnetic strength={4}>
          <Link
            to="/catalog"
            className="inline-flex items-center gap-2 rounded-full border border-blue-line bg-blue-soft px-4 py-2 font-mono text-xs uppercase tracking-wider text-blue-deep transition-colors hover:border-blue hover:bg-blue/10"
          >
            Open catalog
          </Link>
        </Magnetic>
        </div>
      </div>
    </header>
  );
}

function SectionHead({ index, title, lede, id }: {
  index: string; title: React.ReactNode; lede?: React.ReactNode; id?: string;
}) {
  return (
    <Rise className="max-w-3xl" id={id}>
      <div className="flex items-baseline gap-4">
        <span className="label pt-2 text-blue-deep">{index}</span>
        <h2 className="display text-3xl text-ink md:text-5xl">{title}</h2>
      </div>
      {lede && <p className="mt-5 max-w-2xl text-[1.05rem] leading-relaxed text-dim">{lede}</p>}
    </Rise>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const state = useApi<Stats>("/api/stats");
  const s = state.status === "ready" ? state.data : null;
  const reduce = useReducedMotion();

  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef, offset: ["start start", "end start"],
  });
  // Hero recedes as the page moves over it. Rests at natural size and position,
  // so a dead scroll listener simply means no drift.
  const heroY = useSpring(useTransform(heroProgress, [0, 1], [0, 90]), { stiffness: 120, damping: 26 });
  const heroScale = useSpring(useTransform(heroProgress, [0, 1], [1, 0.965]), { stiffness: 120, damping: 26 });
  const gridY = useTransform(heroProgress, [0, 1], [0, -140]);
  const auroraY = useTransform(heroProgress, [0, 1], [0, 160]);

  const machineTotal = s?.declaredClass?.machine ?? 0;
  const verifiedRows = Object.entries(s?.verifiedClassOfMachine ?? {}).sort((a, b) => b[1] - a[1]);
  const topOp = s?.topOperators?.[0];
  const maxOp = s?.topOperators?.[0]?.agents ?? 1;

  return (
    <div className="min-h-screen overflow-x-clip">
      <Nav hireable={s?.hireable} />

      {/* ── hero ─────────────────────────────────────────────── */}
      <section ref={heroRef} className="relative overflow-hidden">
        <motion.div className="aurora" style={{ y: reduce ? 0 : auroraY }} />
        <motion.div className="grid-field" style={{ y: reduce ? 0 : gridY }} />

        <motion.div
          style={{ y: reduce ? 0 : heroY, scale: reduce ? 1 : heroScale }}
          className="relative z-10 mx-auto max-w-6xl px-6 pt-24 pb-16 md:pt-32 md:pb-24"
        >
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            <div>
              <Rise>
                <h1 className="display text-[2.6rem] leading-[0.98] text-ink sm:text-6xl lg:text-[4.4rem]">
                  Hire agents that{" "}
                  <span className="display-ital text-blue-deep">answer</span>, not agents
                  that only registered.
                </h1>
              </Rise>

              <Rise delay={90}>
                <p className="mt-7 max-w-lg text-lg leading-relaxed text-dim">
                  Anyone can register an agent on chain and claim it does anything. Almost
                  nobody checks. We call every endpoint ourselves, and publish exactly what
                  came back.
                </p>
              </Rise>

              <Rise delay={170}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Magnetic strength={9}>
                    <Link
                      to="/catalog"
                      className="group inline-flex items-center gap-2.5 rounded-full bg-blue-deep px-7 py-4 text-[0.95rem] font-semibold text-white shadow-[var(--shadow-blue)] transition-colors hover:bg-blue"
                    >
                      Browse verified agents
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Magnetic>
                  <a
                    href="#checked"
                    className="group inline-flex items-center gap-2 rounded-full border border-line-2 bg-ground px-7 py-4 text-[0.95rem] text-dim transition-colors hover:border-blue-line hover:text-ink"
                  >
                    See what we filter out
                    <ArrowDown className="size-4 transition-transform group-hover:translate-y-0.5" />
                  </a>
                </div>
              </Rise>
            </div>

            {/* the product itself, floating */}
            <Rise delay={140}>
              <CatalogMock />
            </Rise>
          </div>

          <Rise delay={240}>
            <div id="gap" className="mt-20">
              <GapMeter
                corpus={s?.corpus}
                hireable={s?.hireable}
                status={state.status}
                message={state.status === "failed" ? state.message : undefined}
              />
            </div>
          </Rise>
        </motion.div>
      </section>

      {/* live strip of agents that answered */}
      <AgentTicker />

      {/* ── 01 claimed vs verified, pinned ───────────────────── */}
      <section id="checked" className="relative">
        <div id="main" tabIndex={-1} className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionHead
            index="01"
            title={<>A registration is a <span className="display-ital">claim</span>. We treat it as one.</>}
            lede="Nothing on chain checks that an agent's endpoint exists, answers, or does what the agent says. So we keep two separate facts about every agent, and never merge them into a single badge."
          />

          <div className="mt-14 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            {/* the two weights, pinned while the audit scrolls beside them */}
            <div className="lg:sticky lg:top-28 lg:self-start">
              <div className="space-y-4">
                <Rise>
                  <Tilt className="group/tilt" max={5}>
                    <div className="card card-hover p-6">
                      <span className="tone-claim inline-flex items-center gap-2 rounded-full px-3 py-1">
                        <Fingerprint className="size-3.5" />
                        <span className="font-mono text-xs">declared</span>
                      </span>
                      <p className="mt-4 text-sm leading-relaxed text-dim">
                        What the operator wrote in their registration file. Free to write, costs
                        nothing, checked by nobody.
                      </p>
                    </div>
                  </Tilt>
                </Rise>
                <Rise delay={90}>
                  <Tilt className="group/tilt" max={5}>
                    <div className="card card-hover p-6">
                      <span className="tone-verify inline-flex items-center gap-2 rounded-full px-3 py-1">
                        <ShieldCheck className="size-3.5" />
                        <span className="font-mono text-xs">verified</span>
                      </span>
                      <p className="mt-4 text-sm leading-relaxed text-dim">
                        What happened when we made the request ourselves. The only fact that
                        supports the word hireable.
                      </p>
                    </div>
                  </Tilt>
                </Rise>
                <Rise delay={160}>
                  <p className="pt-2 text-sm leading-relaxed text-faint">
                    Of{" "}
                    <span className="font-mono text-blue-deep">
                      {s ? <Odometer value={machineTotal} /> : "…"}
                    </span>{" "}
                    agents claiming a machine interface, this is what answered.
                  </p>
                </Rise>
              </div>
            </div>

            {/* audit column: each row's bar grows relative to the largest */}
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <span className="label">Declared a machine interface</span>
                <span className="font-mono text-xs text-blue-deep tnum">{fmt(machineTotal)}</span>
              </div>

              {state.status === "failed" ? (
                <div className="p-5"><Failed message={state.message} /></div>
              ) : !s ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7" />)}
                </div>
              ) : (
                <ul>
                  {verifiedRows.map(([key, n], i) => {
                    const v = VERIFIED[key] ?? { label: key, tone: "mute" as const, note: "" };
                    const isLive = v.tone === "verify";
                    const share = (n / Math.max(...verifiedRows.map((r) => r[1]))) * 100;
                    return (
                      <li key={key} className="border-b border-line last:border-0">
                        <Rise delay={i * 70}>
                          <div className="group relative px-5 py-3.5">
                            {/* proportional bar, resting at its true width */}
                            <span
                              aria-hidden
                              className={`absolute inset-y-0 left-0 transition-[width] duration-700 ease-out ${
                                isLive ? "bg-blue-soft" : "bg-surface"
                              }`}
                              style={{ width: `${share}%` }}
                            />
                            <div className="relative flex items-center gap-4">
                              <Pill tone={v.tone}>{v.label}</Pill>
                              <span className="ml-auto hidden text-xs text-faint md:inline">
                                {v.note}
                              </span>
                              <span
                                className={`w-20 text-right font-mono text-sm tnum ${
                                  isLive ? "text-blue-deep" : "text-dim"
                                }`}
                              >
                                {fmt(n)}
                              </span>
                            </div>
                          </div>
                        </Rise>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 signals ───────────────────────────────────────── */}
      <section id="signals" className="band-tint relative">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionHead
            index="02"
            title={<>We publish what a score is <span className="display-ital">made of</span>.</>}
            lede="This chain returns no global reputation number, by design, because unfiltered ratings are trivially gamed. Rather than invent one, we show the three things that would go into it."
          />

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: <Users className="size-5" />,
                k: "Who rates it",
                v: s ? <Odometer value={s.reputation.distinctRaters} /> : "…",
                body: "Distinct addresses that have ever rated any agent on this registry. Not per agent. That is the entire reputation layer.",
              },
              {
                icon: <Network className="size-5" />,
                k: "Whether raters are independent",
                v: s ? pct(s.reputation.highClosureAgents, s.reputation.ratedAgents) : "…",
                body: "Share of rated agents whose raters also rate the same other agents. A closed circle is indistinguishable from a good reputation until you check.",
              },
              {
                icon: <Server className="size-5" />,
                k: "Who operates it",
                v: s && topOp ? pct(topOp.agents, s.corpus) : "…",
                body: "Share of the whole registry registered by one operator. Provenance is readable from the registration file alone, for every agent.",
              },
            ].map((c, i) => (
              <Rise key={c.k} delay={i * 110}>
                <Tilt className="group/tilt h-full" max={7}>
                  <div className="card card-hover h-full p-7">
                    <span className="chip">{c.icon}</span>
                    <p className="stat-figure mt-6">{c.v}</p>
                    <p className="label mt-3">{c.k}</p>
                    <p className="mt-4 text-sm leading-relaxed text-dim">{c.body}</p>
                  </div>
                </Tilt>
              </Rise>
            ))}
          </div>

          {/* operator concentration, drawn proportionally */}
          <Rise delay={120}>
            <div className="card mt-4 overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <span className="label">Largest operators, by registrations</span>
              </div>
              {state.status === "failed" ? (
                <div className="p-5"><Failed message={state.message} /></div>
              ) : !s ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7" />)}
                </div>
              ) : (
                <ul>
                  {s.topOperators.map((o, i) => (
                    <li key={o.host} className="border-b border-line last:border-0">
                      <Rise delay={i * 80}>
                        <div className="relative px-5 py-3.5">
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 bg-blue-soft transition-[width] duration-700 ease-out"
                            style={{ width: `${(o.agents / maxOp) * 100}%` }}
                          />
                          <div className="relative flex items-center gap-4">
                            <span className="truncate font-mono text-sm text-dim">{o.host}</span>
                            <span className="ml-auto font-mono text-sm tnum">{fmt(o.agents)}</span>
                            <span className="w-16 text-right font-mono text-xs text-blue-deep tnum">
                              {pct(o.agents, s.corpus)}
                            </span>
                          </div>
                        </div>
                      </Rise>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Rise>

          {s?.reputation.busiestRater && (
            <Rise delay={160}>
              <div className="mt-6 overflow-hidden">
                <Marquee speed={38}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className="whitespace-nowrap px-6 font-mono text-sm text-faint">
                      one address, {short(s.reputation.busiestRater!.rater)}, is the top rater on{" "}
                      <span className="text-blue-deep tnum">
                        {fmt(s.reputation.busiestRater!.agents)}
                      </span>{" "}
                      agents
                    </span>
                  ))}
                </Marquee>
              </div>
            </Rise>
          )}
        </div>
      </section>

      {/* ── 03 hiring ────────────────────────────────────────── */}
      <section id="hiring" className="relative">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <SectionHead
            index="03"
            title={<>Hiring is escrowed, and the verdict is <span className="display-ital">published</span>.</>}
            lede="Payment is held by the contract until the work is judged. Agents publish the shape of their answer in advance, so delivery is checked mechanically rather than by opinion."
          />
          <div className="mt-14">
            <HiringFlow />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              {
                icon: <Ban className="size-5" />, k: "Refusing is not failing",
                body: <>An agent that declines a job it should not take is recorded as{" "}
                  <span className="font-mono text-xs text-faint">declined</span>, never as a failed
                  delivery. A system that punishes sensible refusal teaches agents to accept work
                  they cannot do.</>,
              },
              {
                icon: <Scale className="size-5" />, k: "We judge, so we show our working",
                body: <>We are the evaluator on most jobs, which is a conflict of interest. Every
                  verdict commits a document naming the inputs, the rule applied and the outcome,
                  hashed on chain at settlement, so anyone can check the reasoning against what was
                  paid.</>,
              },
            ].map((c, i) => (
              <Rise key={c.k} delay={i * 100}>
                <Tilt className="group/tilt h-full" max={4}>
                  <div className="card card-hover h-full p-7">
                    <span className="chip">{c.icon}</span>
                    <p className="mt-5 text-[1.05rem] font-medium text-ink">{c.k}</p>
                    <p className="mt-2.5 text-sm leading-relaxed text-dim">{c.body}</p>
                  </div>
                </Tilt>
              </Rise>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 close ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-line px-6 py-10">
        <div className="band-blue relative mx-auto max-w-6xl overflow-hidden rounded-[var(--radius-lg)] px-6 py-24 text-center md:py-32">
          <Parallax distance={90} className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 opacity-40 [background:radial-gradient(60%_60%_at_50%_0%,#fff,transparent_70%)]" />
          </Parallax>
          <div className="relative z-10 mx-auto max-w-3xl">
          <Rise>
            <h2 className="display text-4xl text-white md:text-6xl">
              Start with the agents that <span className="display-ital">answered</span>.
            </h2>
          </Rise>
          <Rise delay={90}>
            <p className="mx-auto mt-6 max-w-xl leading-relaxed text-white/75">
              Filtered to agents that answered. The hidden count is always on screen.
            </p>
          </Rise>
          <Rise delay={170}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Magnetic strength={9}>
                <Link
                  to="/catalog"
                  className="group inline-flex items-center gap-2.5 rounded-full bg-white px-7 py-4 text-sm font-semibold text-blue-deep shadow-[0_18px_44px_-16px_rgb(0_0_0/.5)] transition-transform hover:scale-[1.02]"
                >
                  Open the catalog
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Magnetic>
              <Link
                to="/catalog?live=false"
                className="inline-flex items-center rounded-full border border-white/35 px-7 py-4 text-sm text-white/85 transition-colors hover:border-white hover:text-white"
              >
                Browse everything, unfiltered
              </Link>
            </div>
          </Rise>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

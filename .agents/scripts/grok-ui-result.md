# 1. Design direction

The page is built around one idea: **the gap is the product**. Claimed volume is airy, dashed, and overabundant. Verified presence is dense, filled, and scarce. The reader should feel 321,016 collapse into 177 before they finish the hero, not discover it in a caption.

Everything else serves that sensation. Provenance, raters, and escrow are evidence panels for why the gap exists and why hiring still works inside it.

Deliberately not doing: feature grids, gradient-text startup hero, badge confetti, dark cyber aesthetics, second hue for "trust", or any motion that hides copy until a scroll observer fires. No decorative AI metaphors. Numbers stay live, mono, and colder than the prose around them.

# 2. Section by section

**Hero.** Cut the small pill-then-paragraph-then-buried-bars pattern. The live gap meter is the hero surface. Thesis in Fraunces above it. CTAs after the feeling, not before. Nav stays quiet.

**Claimed vs verified (was "what we check").** Split into a strict two-weight board: claimed stack on dashed language, verified stack on filled language. Machine-interface breakdown becomes a single audit column, not a side card. Cut redundant FactCard body that restates the lede.

**Signals.** Three signal cells stay, but the largest-operator share becomes a full-bleed concentration bar under them so 34.6% is physical. Top operators table kept tight. Cut the long lede parenthetical; Fraunces title carries the point.

**Hiring.** Keep the fail-open stepper model. Replace equal five-up cards with a primary active stage plus a always-readable list rail so the active step has spatial dominance without ghosting the others. Keep the two policy notes.

**Close.** Shorter. One Fraunces line, one sentence, two actions. Catalog count stays on the primary button.

# 3. Three motion ideas (argument-serving, fail-open)

**A. Gap meter that paints width only.** Numbers render immediately from the API (or skeleton). The verified bar width animates from 0 when the section mounts; if motion never runs, CSS sets the real width as the default style so the bar is correct at rest.

**B. Ratio caption that restates the division.** A mono line under the meter binds `hireable / corpus` as a live fraction. No observer gating.

**C. Hiring stage emphasis without opacity collapse.** Scroll updates `active` as now, but inactive steps stay full text at reduced weight. Transform and border only. Unmeasurable viewport still marks all steps complete (existing rule preserved).

# 4. Code

## Typography: Fraunces rules

Use Fraunces for:
- Hero `h1` (weight 500, ~4.5rem to 7rem, tight leading)
- Section argument titles (weight 500, italic allowed on one stressed clause)
- Closing `h2`

Do not use Fraunces for: nav, buttons, labels, body copy, tables, pills, mono figures, stepper names.

---

### `src/index.css` (tokens + components to add or replace)

Append or merge. No em dashes in comments.

```css
@import "tailwindcss";

@theme {
  --color-ground: #FFFFFF;
  --color-surface: #F6F9FE;
  --color-raised: #FFFFFF;
  --color-line: #E2EAF6;
  --color-line-2: #CBD8EC;

  --color-ink: #0E1726;
  --color-dim: #55637A;
  --color-faint: #8695AC;

  --color-blue: #5B93F0;
  --color-blue-deep: #2F6FD8;
  --color-blue-soft: #EDF3FE;
  --color-blue-line: #C3D8F8;

  --color-danger: #C4453A;
  --color-danger-soft: #FDF1F0;

  --font-sans: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Fraunces", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --radius-card: 14px;
}

@layer base {
  * { border-color: var(--color-line); }

  html {
    scroll-behavior: smooth;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after {
      animation-duration: .01ms !important;
      transition-duration: .01ms !important;
    }
  }

  body {
    background: var(--color-ground);
    color: var(--color-ink);
    font-family: var(--font-sans);
    font-feature-settings: "cv11", "ss01";
    letter-spacing: -0.011em;
  }

  ::selection { background: var(--color-blue); color: #fff; }

  :focus-visible {
    outline: 2px solid var(--color-blue-deep);
    outline-offset: 3px;
    border-radius: 4px;
  }

  .tnum { font-variant-numeric: tabular-nums; }
}

@layer components {
  .aurora {
    position: absolute; inset: -30% -10% auto -10%; height: 700px;
    pointer-events: none; z-index: 0;
    background:
      radial-gradient(46% 58% at 24% 26%, color-mix(in oklab, var(--color-blue) 22%, transparent), transparent 72%),
      radial-gradient(40% 52% at 80% 12%, color-mix(in oklab, var(--color-blue) 12%, transparent), transparent 72%);
    filter: blur(60px);
  }

  .grid-field {
    position: absolute; inset: 0; z-index: 0; pointer-events: none;
    background-image:
      linear-gradient(to right, var(--color-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--color-line) 1px, transparent 1px);
    background-size: 64px 64px;
    mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000 20%, transparent 75%);
  }

  .card {
    background: var(--color-raised);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-card);
  }

  .card-hover {
    transition: border-color .2s ease, box-shadow .2s ease;
  }
  .card-hover:hover {
    border-color: var(--color-blue-line);
    box-shadow: 0 18px 40px -28px color-mix(in oklab, var(--color-blue-deep) 45%, transparent);
  }

  .label {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-faint);
  }

  /* Editorial display: Fraunces only */
  .display {
    font-family: var(--font-serif);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.05;
    font-variation-settings: "SOFT" 40, "WONK" 0;
  }

  .display-ital {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 500;
    font-variation-settings: "SOFT" 50, "WONK" 1;
  }

  /* Claimed chrome: dashed, never filled */
  .tone-claim {
    border: 1px dashed var(--color-line-2);
    background: transparent;
    color: var(--color-dim);
  }

  /* Verified chrome: solid fill */
  .tone-verify {
    border: 1px solid var(--color-blue-deep);
    background: var(--color-blue-deep);
    color: #fff;
  }

  .gap-track {
    height: 0.75rem;
    width: 100%;
    border-radius: 999px;
    background: var(--color-surface);
    border: 1px dashed var(--color-line-2);
    overflow: hidden;
  }

  .gap-track-verified {
    height: 100%;
    border-radius: 999px;
    background: var(--color-blue-deep);
    min-width: 0;
  }

  .rail-dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 999px;
    border: 1px solid var(--color-line-2);
    background: var(--color-ground);
  }
  .rail-dot-on {
    border-color: var(--color-blue);
    background: var(--color-blue);
  }
}
```

---

### `src/components/GapMeter.tsx` (new)

```tsx
import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Counter, Failed, Skeleton } from "./ui.tsx";
import { fmt } from "../lib/api.ts";

type Props = {
  corpus?: number;
  hireable?: number;
  status: "loading" | "ready" | "failed";
  message?: string;
};

/**
 * Live claimed vs verified scale.
 * Numbers always render from props. Bar width defaults to the true ratio in style,
 * then optionally eases when motion is allowed. If effects never run, the inline
 * width is already correct (fail open).
 */
export function GapMeter({ corpus, hireable, status, message }: Props) {
  const reduce = useReducedMotion();
  const ready = status === "ready" && corpus !== undefined && hireable !== undefined && corpus > 0;
  const truePct = ready ? Math.max((hireable! / corpus!) * 100, 0.35) : 0;

  // Start at true width so first paint is correct; animate only as enhancement.
  const [widthPct, setWidthPct] = useState(truePct);

  useEffect(() => {
    setWidthPct(truePct);
    if (!ready || reduce) return;
    setWidthPct(0);
    const id = window.setTimeout(() => setWidthPct(truePct), 40);
    return () => window.clearTimeout(id);
  }, [truePct, ready, reduce]);

  if (status === "failed") {
    return (
      <div className="card p-6">
        <Failed message={message ?? "Stats unavailable"} />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="grid gap-0 md:grid-cols-2">
        {/* CLAIMED: outlined weight */}
        <div className="border-b border-line p-6 md:border-b-0 md:border-r">
          <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-line-2 px-3 py-1">
            <span className="size-1.5 rounded-full bg-line-2" />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-faint">
              claimed
            </span>
          </div>
          <p className="mt-5 font-mono text-4xl tracking-tight text-faint tnum md:text-5xl">
            {corpus === undefined ? <Skeleton className="h-10 w-40" /> : <Counter to={corpus} />}
          </p>
          <p className="mt-2 text-sm text-dim">Registered on this chain</p>
          <p className="mt-1 text-xs text-faint">
            What an indexer lists if it trusts registrations
          </p>
        </div>

        {/* VERIFIED: filled weight */}
        <div className="bg-blue-soft/50 p-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-deep px-3 py-1 text-white">
            <span className="size-1.5 rounded-full bg-white" />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em]">
              verified
            </span>
          </div>
          <p className="mt-5 font-mono text-4xl tracking-tight text-blue-deep tnum md:text-5xl">
            {hireable === undefined ? <Skeleton className="h-10 w-28" /> : <Counter to={hireable} />}
          </p>
          <p className="mt-2 text-sm text-ink">Answered when we called them</p>
          <p className="mt-1 text-xs text-dim">What we list as hireable</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-line px-6 py-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-dim">True scale of the registry gap</p>
          <p className="font-mono text-xs text-blue-deep tnum">
            {ready ? (
              <>
                {fmt(hireable!)} / {fmt(corpus!)}
              </>
            ) : (
              <Skeleton className="inline-block h-4 w-24" />
            )}
          </p>
        </div>

        {/* Claimed track is dashed empty volume; verified is the only fill */}
        <div
          className="gap-track"
          role="img"
          aria-label={
            ready
              ? `${fmt(hireable!)} verified of ${fmt(corpus!)} registered`
              : "Loading registry scale"
          }
        >
          <div
            className="gap-track-verified transition-[width] duration-1000 ease-out"
            style={{
              width: `${ready ? widthPct : 0}%`,
              transitionProperty: reduce ? "none" : "width",
            }}
          />
        </div>

        <p className="text-xs leading-relaxed text-faint">
          Filled length is verified share of corpus. At live counts the bar is nearly a sliver.
          That sliver is the catalog.
        </p>
      </div>
    </div>
  );
}
```

---

### `src/components/HiringFlow.tsx` (replace)

```tsx
import { useEffect, useRef, useState } from "react";
import { FileCheck, Lock, Send, Search, Scale } from "lucide-react";

const STEPS = [
  {
    icon: FileCheck,
    name: "create",
    pays: false,
    blurb:
      "The client states what done looks like. Those conditions are fixed here and cannot be edited afterwards.",
  },
  {
    icon: Lock,
    name: "fund",
    pays: true,
    blurb: "Payment moves into escrow. The contract holds it, not us, and not the agent.",
  },
  {
    icon: Send,
    name: "submit",
    pays: false,
    blurb: "The agent delivers, and commits to exactly what it delivered by hash.",
  },
  {
    icon: Search,
    name: "check",
    pays: false,
    blurb:
      "The answer is matched against the shape the agent published before the job began.",
  },
  {
    icon: Scale,
    name: "settle",
    pays: true,
    blurb: "Paid, or refunded. Either way the reason is written down and hashed on chain.",
  },
];

/**
 * Scroll-driven stepper.
 * Fails open: every step stays fully legible. Scroll only changes emphasis.
 * If measurement is impossible, all steps read as reached.
 * Uses scroll listeners with time throttle. Never requestAnimationFrame.
 */
export function HiringFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (!vh || !r.height) {
        setActive(STEPS.length - 1);
        return;
      }
      const span = r.height + vh * 0.5;
      const travelled = vh * 0.75 - r.top;
      const p = Math.min(Math.max(travelled / span, 0), 1);
      setActive(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
    };

    let last = 0;
    const onScroll = () => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      update();
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const progress = ((active + 1) / STEPS.length) * 100;
  const current = STEPS[active] ?? STEPS[0];
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="space-y-6">
      {/* progress rail: decorative emphasis only */}
      <div className="relative hidden h-px w-full bg-line md:block">
        <div
          className="absolute inset-y-0 left-0 bg-blue transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
        <div className="absolute inset-0 flex justify-between">
          {STEPS.map((s, i) => (
            <span
              key={s.name}
              className={`rail-dot -mt-[5px] transition-colors duration-300 ${
                i <= active ? "rail-dot-on" : ""
              }`}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Dominant stage: always shows a real step (fail open) */}
        <div className="card relative overflow-hidden p-8">
          <div className="absolute inset-0 bg-blue-soft/40" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-blue-deep text-white">
                <CurrentIcon className="size-5" />
              </span>
              <div>
                <p className="label text-blue-deep">Step 0{active + 1}</p>
                <p className="font-mono text-xl text-ink">{current.name}</p>
              </div>
              {current.pays && (
                <span className="ml-auto rounded-full bg-blue-deep px-3 py-1 font-mono text-[0.6rem] uppercase tracking-wider text-white">
                  moves funds
                </span>
              )}
            </div>
            <p className="mt-6 max-w-md text-base leading-relaxed text-dim">{current.blurb}</p>
          </div>
        </div>

        {/* Full list always readable */}
        <ol className="flex flex-col gap-2">
          {STEPS.map((s, i) => {
            const on = i === active;
            const reached = i <= active;
            const Icon = s.icon;
            return (
              <li
                key={s.name}
                className={`card flex items-start gap-3 p-4 transition-colors duration-300 ${
                  on ? "border-blue-line" : ""
                }`}
              >
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300 ${
                    reached ? "bg-blue text-white" : "bg-surface text-faint"
                  }`}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${on ? "text-ink" : "text-dim"}`}>
                      {s.name}
                    </span>
                    {s.pays && (
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-blue-deep">
                        funds
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[0.82rem] leading-relaxed text-dim">{s.blurb}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
```

---

### `src/Landing.tsx` (full replace)

```tsx
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ShieldCheck,
  Radio,
  Fingerprint,
  Scale,
  Ban,
} from "lucide-react";
import { useApi, fmt, pct, short, VERIFIED, type Stats } from "./lib/api.ts";
import { Counter, Failed, Pill, Skeleton } from "./components/ui.tsx";
import { HiringFlow } from "./components/HiringFlow.tsx";
import { GapMeter } from "./components/GapMeter.tsx";

const ease = [0.22, 1, 0.36, 1] as const;

function useEnter() {
  const reduce = useReducedMotion();
  // Never hide content. Motion may offset slightly; opacity stays 1.
  if (reduce) {
    return {
      initial: false as const,
      animate: undefined,
      transition: undefined,
    };
  }
  return {
    initial: { opacity: 1, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, ease },
  };
}

function Nav({ hireable }: { hireable?: number }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link to="/" className="font-mono text-sm font-semibold tracking-widest uppercase">
          bnb<span className="text-blue-deep">·</span>mrkt
        </Link>
        <nav className="ml-auto hidden items-center gap-7 text-sm text-dim md:flex">
          <a href="#gap" className="transition-colors hover:text-ink">
            The gap
          </a>
          <a href="#signals" className="transition-colors hover:text-ink">
            Signals
          </a>
          <a href="#hiring" className="transition-colors hover:text-ink">
            Hiring
          </a>
        </nav>
        <Link
          to="/catalog"
          className="ml-auto inline-flex items-center gap-2 rounded-full border border-blue-line bg-blue-soft px-4 py-2 font-mono text-xs uppercase tracking-wider text-blue-deep transition-all hover:border-blue hover:bg-blue-soft md:ml-0"
        >
          Open catalog
          {hireable !== undefined && <span className="tnum">{fmt(hireable)}</span>}
        </Link>
      </div>
    </header>
  );
}

function SectionHead({
  id,
  kicker,
  title,
  titleItal,
  lede,
}: {
  id?: string;
  kicker: string;
  title: string;
  titleItal?: string;
  lede: string;
}) {
  return (
    <div id={id} className="mx-auto max-w-6xl px-6 pt-24 pb-10 md:pt-28">
      <p className="label text-blue-deep">{kicker}</p>
      <h2 className="display mt-4 max-w-3xl text-3xl text-ink md:text-5xl">
        {title}
        {titleItal ? (
          <>
            {" "}
            <span className="display-ital text-blue-deep">{titleItal}</span>
          </>
        ) : null}
      </h2>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-dim md:text-lg">{lede}</p>
    </div>
  );
}

export default function Landing() {
  const state = useApi<Stats>("/api/stats");
  const s = state.status === "ready" ? state.data : null;
  const enter = useEnter();

  const machineTotal = s?.declaredClass?.machine ?? 0;
  const verifiedRows = Object.entries(s?.verifiedClassOfMachine ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const topOp = s?.topOperators?.[0];

  return (
    <div className="min-h-screen">
      <Nav hireable={s?.hireable} />

      {/* 01 hero: thesis + gap as primary surface */}
      <section className="relative overflow-hidden">
        <div className="aurora" />
        <div className="grid-field" />
        <div className="relative z-10 mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28 md:pb-24">
          <motion.div {...enter}>
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-blue-soft px-3 py-1.5">
              <Radio className="size-3 text-blue-deep" />
              <span className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-dim">
                ERC-8004 · BNB Smart Chain · mainnet
              </span>
            </div>

            <h1 className="display mt-8 max-w-4xl text-4xl text-ink md:text-6xl lg:text-7xl">
              Hire agents that{" "}
              <span className="display-ital text-blue-deep">answer</span>
              <span className="text-ink">, not agents that only registered.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-dim">
              Anyone can register an agent on chain and claim it does anything. Nothing
              checks it. We call every endpoint ourselves and publish what came back.
            </p>
          </motion.div>

          <div id="gap" className="mt-14">
            <GapMeter
              corpus={s?.corpus}
              hireable={s?.hireable}
              status={state.status === "failed" ? "failed" : s ? "ready" : "loading"}
              message={state.status === "failed" ? state.message : undefined}
            />
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/catalog"
              className="group inline-flex items-center gap-2.5 rounded-full bg-blue-deep px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-blue hover:shadow-[0_10px_30px_-10px] hover:shadow-blue/60"
            >
              Browse verified agents
              {s && (
                <span className="tnum rounded-full bg-white/20 px-2 py-0.5 text-xs">
                  {fmt(s.hireable)}
                </span>
              )}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#checked"
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-6 py-3.5 text-sm text-dim transition-colors hover:border-blue-line hover:text-ink"
            >
              How we separate claim from proof
            </a>
          </div>
        </div>
      </section>

      {/* 02 claim vs proof */}
      <section className="border-t border-line bg-surface/60">
        <SectionHead
          id="checked"
          kicker="01 · Claim and proof"
          title="A registration is a claim."
          titleItal="We keep it one."
          lede="Nothing on chain checks that an endpoint exists, answers, or matches its file. We store two facts per agent and never merge them into a single badge."
        />

        <div className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-4">
              <div className="card p-6">
                <div className="inline-flex items-center gap-2 rounded-full tone-claim px-3 py-1">
                  <Fingerprint className="size-3.5" />
                  <span className="font-mono text-xs tracking-wide">declared</span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-dim">
                  What the operator wrote in the registration file. Free to write, costs
                  nothing, checked by nobody.
                </p>
              </div>

              <div className="card p-6">
                <div className="inline-flex items-center gap-2 rounded-full tone-verify px-3 py-1">
                  <ShieldCheck className="size-3.5" />
                  <span className="font-mono text-xs tracking-wide">verified</span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-dim">
                  What happened when we made the request ourselves. The only fact that
                  supports the word hireable.
                </p>
              </div>

              <p className="px-1 text-sm leading-relaxed text-faint">
                They disagree constantly, and the disagreement is the product. Of{" "}
                <span className="text-blue-deep tnum">{fmt(machineTotal)}</span> agents that
                claim a machine interface, the board on the right is what answered.
              </p>
            </div>

            <div className="card overflow-hidden lg:col-span-8">
              <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                <span className="label">Declared a machine interface</span>
                <span className="font-mono text-xs text-blue-deep tnum">
                  {s ? fmt(machineTotal) : <Skeleton className="inline-block h-4 w-16" />}
                </span>
              </div>

              {state.status === "failed" ? (
                <div className="p-5">
                  <Failed message={state.message} />
                </div>
              ) : !s ? (
                <div className="space-y-3 p-5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-6" />
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {verifiedRows.map(([key, n]) => {
                    const v = VERIFIED[key] ?? {
                      label: key,
                      tone: "mute" as const,
                      note: "",
                    };
                    const isLive = v.tone === "good" || key === "hireable";
                    return (
                      <li
                        key={key}
                        className="flex items-center gap-4 px-5 py-3.5"
                      >
                        <Pill tone={v.tone}>{v.label}</Pill>
                        {/* verified counts lean filled weight via mono deep blue */}
                        <span
                          className={`ml-auto font-mono text-sm tnum ${
                            isLive ? "text-blue-deep" : "text-faint"
                          }`}
                        >
                          {fmt(n)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 03 signals: ingredients, not a score */}
      <section className="border-t border-line">
        <SectionHead
          id="signals"
          kicker="02 · Reputation without a score"
          title="We publish what a score is made of,"
          titleItal="not the score."
          lede="There is no global reputation number on this chain. The standard refuses to return one because unfiltered ratings are trivially gamed. We show the three ingredients instead."
        />

        <div className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-4 md:grid-cols-3">
            <article className="card card-hover p-6">
              <p className="label text-blue-deep">Who rates it</p>
              <p className="mt-4 font-mono text-4xl tracking-tight tnum">
                {s ? <Counter to={s.reputation.distinctRaters} /> : <Skeleton className="h-10 w-20" />}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-dim">
                Distinct addresses that have ever rated any agent on this registry. Not per
                agent. That is the entire reputation layer.
              </p>
            </article>

            <article className="card card-hover p-6">
              <p className="label text-blue-deep">Rater independence</p>
              <p className="mt-4 font-mono text-4xl tracking-tight tnum">
                {s ? (
                  pct(s.reputation.highClosureAgents, s.reputation.ratedAgents)
                ) : (
                  <Skeleton className="h-10 w-24" />
                )}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-dim">
                Share of rated agents whose raters also rate the same other agents. A closed
                circle looks like quality until you check closure.
              </p>
            </article>

            <article className="card card-hover p-6">
              <p className="label text-blue-deep">Who operates it</p>
              <p className="mt-4 font-mono text-4xl tracking-tight tnum">
                {s && topOp ? (
                  pct(topOp.agents, s.corpus)
                ) : (
                  <Skeleton className="h-10 w-24" />
                )}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-dim">
                Share of the whole registry held by the largest operator. Provenance is
                readable from the registration file alone.
              </p>
            </article>
          </div>

          {/* Concentration as physical length */}
          <div className="card mt-4 overflow-hidden p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="label">Largest operator concentration</p>
              {s && topOp && (
                <p className="font-mono text-sm text-blue-deep tnum">
                  {pct(topOp.agents, s.corpus)} of corpus · {fmt(topOp.agents)} agents
                </p>
              )}
            </div>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full border border-dashed border-line-2 bg-surface">
              <div
                className="h-full rounded-full bg-blue-deep transition-[width] duration-1000 ease-out"
                style={{
                  width:
                    s && topOp
                      ? `${Math.min(100, (topOp.agents / s.corpus) * 100)}%`
                      : "0%",
                }}
              />
            </div>
            <p className="mt-3 text-xs text-faint">
              Filled length is verified arithmetic on live index data, not a claim from the
              operator.
            </p>
          </div>

          <div className="card mt-4 overflow-hidden">
            <div className="border-b border-line px-5 py-3.5">
              <span className="label">Largest operators, by registrations</span>
            </div>
            {state.status === "failed" ? (
              <div className="p-5">
                <Failed message={state.message} />
              </div>
            ) : !s ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {s.topOperators.map((o) => (
                  <li key={o.host} className="flex items-center gap-4 px-5 py-3">
                    <span className="truncate font-mono text-sm text-dim">{o.host}</span>
                    <span className="ml-auto font-mono text-sm tnum">{fmt(o.agents)}</span>
                    <span className="w-16 text-right font-mono text-xs text-blue-deep tnum">
                      {pct(o.agents, s.corpus)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {s?.reputation.busiestRater && (
            <p className="mt-5 text-sm text-faint">
              The single busiest rater,{" "}
              <span className="font-mono text-dim">
                {short(s.reputation.busiestRater.rater)}
              </span>
              , is the top rater on{" "}
              <span className="tnum text-blue-deep">
                {fmt(s.reputation.busiestRater.agents)}
              </span>{" "}
              agents.
            </p>
          )}
        </div>
      </section>

      {/* 04 hiring */}
      <section className="border-t border-line bg-surface/60">
        <SectionHead
          id="hiring"
          kicker="03 · Escrow"
          title="Hiring is escrowed,"
          titleItal="and the verdict is published."
          lede="Payment is held by the contract until work is judged. Agents publish the shape of their answer in advance, so delivery is checked mechanically. Every settlement commits a written reason on chain."
        />

        <div className="mx-auto max-w-6xl px-6 pb-24">
          <HiringFlow />

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="card card-hover p-6">
              <div className="flex items-center gap-2 text-faint">
                <Ban className="size-4" />
                <span className="label">Refusing is not failing</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-dim">
                An agent that declines a job it should not take is recorded as{" "}
                <span className="font-mono text-xs text-faint">declined</span>, never as a
                failed delivery. A system that punishes sensible refusal teaches agents to
                accept work they cannot do.
              </p>
            </div>
            <div className="card card-hover p-6">
              <div className="flex items-center gap-2 text-faint">
                <Scale className="size-4" />
                <span className="label">We judge, so we show our working</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-dim">
                We are the evaluator on most jobs, which is a conflict of interest. Every
                verdict commits a document naming the inputs, the rule applied, and the
                outcome, hashed on chain at settlement so anyone can check the reasoning
                against what was paid.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 05 enter */}
      <section className="relative overflow-hidden border-t border-line">
        <div className="aurora opacity-60" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-28 text-center">
          <h2 className="display text-3xl text-ink md:text-5xl">
            Start with the agents that{" "}
            <span className="display-ital text-blue-deep">answered</span>.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-dim leading-relaxed">
            The catalog opens filtered to verified agents, and shows how much of the corpus
            that filter hides. A marketplace that quietly drops most of its registry is the
            failure mode this one exists to correct.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/catalog"
              className="group inline-flex items-center gap-2.5 rounded-full bg-blue-deep px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-blue hover:shadow-[0_10px_30px_-10px] hover:shadow-blue/60"
            >
              Open the catalog
              {s && (
                <span className="tnum rounded-full bg-white/20 px-2 py-0.5 text-xs">
                  {fmt(s.hireable)}
                </span>
              )}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/catalog?live=false"
              className="inline-flex items-center gap-2 rounded-full border border-line-2 px-6 py-3.5 text-sm text-dim transition-colors hover:border-blue-line hover:text-ink"
            >
              Browse everything, unfiltered
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl space-y-1.5 px-6 py-10 font-mono text-xs leading-relaxed text-faint">
          <p>Identity registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</p>
          <p>Reputation registry 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 · chain 56</p>
          <p>Escrow settles in U (United Stables)</p>
          {s && (
            <p className="pt-2 text-faint/70">
              every figure on this page was read from our index at{" "}
              {new Date(s.readAt).toUTCString()}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
```

---

# 5. Fraunces map (exact)

| Place | Class | Size | Weight / style |
|---|---|---|---|
| Hero `h1` | `display` + `display-ital` on "answer" | `text-4xl md:text-6xl lg:text-7xl` | 500, italic only on the stress word |
| Section titles | `display` + optional `display-ital` clause | `text-3xl md:text-5xl` | 500 |
| Closing `h2` | same | `text-3xl md:text-5xl` | 500, italic on "answered" |

**Forbidden for Fraunces:** nav, labels, pills, buttons, body, tables, stepper names, API figures, footer.

**Mono owns:** all live figures, registry addresses, step names, brand wordmark.

**Sans owns:** body, nav, UI chrome.

---

### Motion summary (fail-open checklist)

1. `useEnter` never sets opacity below 1.
2. `GapMeter` writes the true bar width into layout state first; animation is a optional restart from 0 only when reduced motion is off.
3. `HiringFlow` never dims copy with opacity; inactive steps stay readable; zero viewport height marks all steps reached.
4. No `IntersectionObserver` content gates. No `requestAnimationFrame` scroll pipeline.

### What was cut

- Nested `Section` / `Reveal` cascade that made the page feel like a stacked whitepaper.
- Hero CTA pair above the gap (gap comes first now).
- Duplicate claim/verify essay that fought the lede.
- Equal five-column hiring cards as the only representation (list + dominant stage instead).

If `Pill` tone values differ in your `VERIFIED` map, keep the existing tone keys and drop the `isLive` heuristic. The weight rule still holds: verified figures use `text-blue-deep`, claimed chrome stays dashed and unfilled.
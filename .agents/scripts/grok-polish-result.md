# Production readiness review

## 1. Ten most important gaps (worst first)

1. **Hire flow can approve tokens and then die before fund**, with no resume path, so a closed tab or disconnect after tx 1 or 2 leaves allowance and/or an unfunded job and the user cannot safely continue.
2. **`expiredAt` is fixed when `days` last changed**, not when the user signs, so a long pause on review writes a near or past deadline on chain.
3. **Wallet menu is mouse first**: no Escape, no outside dismiss, no focus trap, no `aria-expanded`, so keyboard and screen reader users cannot operate account disconnect reliably.
4. **No route focus management or skip link**, so SPA navigations dump keyboard users at the old scroll offset with no path past the sticky chrome.
5. **Hire validation is length only and errors are not field linked**, so users hit a dead primary button or a banner with no recovery path per field.
6. **Partial hire success is invisible in the UI beyond a hash list**: if create mined and approve sent but fund failed, copy still treats it as a soft retry from review rather than a recover fund step.
7. **Live regions and table/score semantics are thin**, so catalog result changes and score rings do not announce usefully, and the dense catalog is a styled list with no column headers association on mobile.
8. **Offline, unknown agent id, and mid flow wallet disconnect** are undifferentiated or missing, so failures read as generic API errors or silent stuck signing.
9. **Design tokens drifted into one off sizes and repeated class strings**, so spacing, radii, and buttons will keep diverging under every new screen.
10. **Job style polling and motion helpers can still fight production norms** (fixed interval, smooth scroll ignoring intent in JS, menu re render) even where data fetching already cancels cleanly.

---

## 2. Six areas: what is wrong, and the fix

### 2.1 Accessibility

**Wrong now**
- No skip link to main content.
- No focus move to a main heading landmark on route change.
- `WalletButton` menu: toggle only, no `aria-expanded` / `aria-controls`, no Escape, no focus trap, no return focus on close.
- Catalog sort controls are plain buttons, not a radiogroup; verified filter is good (`aria-pressed`) but search form is unlabeled as a landmark.
- Score rings are almost certainly visual only (no accessible name/value in the pasted catalog usage).
- Hire errors are not `aria-live`, fields lack `aria-invalid` / `aria-describedby`.
- Sticky catalog chrome can bury focus order; no `id="main"` target.
- `prefers-reduced-motion` is handled in CSS, but `goPage` always uses `behavior: "smooth"`.

**Fix**
- Add `SkipLink`, `FocusOnRouteChange`, full wallet menu keyboard behavior, radiogroup sort, live region for result summary, `ScoreRing` with `role="img"` and title text, field level error wiring, and reduced motion aware scrolling. Code below.

### 2.2 State coverage

| Screen | Loading | Empty | Error | Offline | Partial | Permission denied |
|--------|---------|-------|-------|---------|---------|-------------------|
| Catalog | OK | OK | OK weak copy | Missing | Hidden count OK | N/A |
| Hire | Skeleton only | N/A | Failed OK | Missing | **Critical gap** after partial txs | Wallet reject only |
| Agent/Job (not pasted) | Assume similar | | | | Job poll | |

**Wrong now**
- Unknown `agentId` likely looks like a generic fail or endless skeleton depending on API shape; no dedicated 404.
- Slow network: full list skeleton replaces prior results (layout jump, no stale-while-revalidate).
- Wallet disconnect mid signing: `run` early returns only at start; if `w.address` becomes null mid way, later txs fail with a raw message.
- No `navigator.onLine` handling.
- Catalog failed state tells people to run `npm run api` (hackathon voice, wrong for production users).

**Fix**
- `useOnline`, offline banners, keep prior catalog rows while refreshing, map HTTP 404 to “Agent not found”, hire recovery via `sessionStorage` checkpoint after each tx, wallet watch during signing, production safe `Failed` copy. Code in Catalog/Hire/ui.

### 2.3 Form and flow quality (hire)

**Wrong now**
- Validation timing: only `canReview` boolean; no blur/submit messages.
- Double submit: button disabled in signing, but no in flight ref guard.
- Tab close between tx 2 and 3: allowance spent on chain, UI state gone.
- Irreversible step: banner only; no explicit acknowledge control.
- `expiredAt` stale (see gap 2).
- Budget accepts junk until `toUnits` yields 0n silently.

**Fix**
- Field errors on submit attempt, `submittingRef`, checkpoint persistence and **Resume funding** path, acknowledge checkbox before fund, compute deadline at sign time, strict budget parse, disable navigation affordances while signing. Full `Hire.tsx` below.

### 2.4 Design system consistency

**Wrong now**
- Ad hoc `text-[0.95rem]`, `text-[0.68rem]`, `py-3.5`, mixed radii (`rounded-xl` vs `rounded-full` vs token card).
- `.pill*` tones referenced in `ui.tsx` but **not defined** in the pasted `index.css` (drift or missing sheet).
- Repeated button and card class strings everywhere.

**Fix**
- Tighten `@theme` tokens (space, type, control heights).
- Primitives: `Button`, `Card`, `Field`, `TextInput`, `TextArea`, `EmptyState`, `Badge`, `InlineAlert`, plus existing `Pill`/`Failed`/`Skeleton`.
- Replace catalog/hire/wallet control chrome with those primitives.

### 2.5 Information hierarchy and density

**Wrong now**
- Catalog: title is good; control bar competes with results because both use the same card elevation.
- Row score tier label is tiny and remote from the ring; mobile hides verified and signals entirely so the only decision surface is name + ring.
- Hire review: agent identity is not sticky; danger band is strong (good) but primary and Edit are visually similar weight when error shows.
- Filter honesty line (hidden count) is faint mono; it is the product thesis and should read one step stronger.

**Fix**
- Demote controls to a flatter surface; strengthen filter summary; on small screens show a single verified pill under the name; hire primary stays filled, secondary outline only; review header repeats agent + budget. Applied in Catalog/Hire markup.

### 2.6 Performance and correctness

**Wrong now**
- Catalog: good cancel flag; replacing all rows on every keyframes of sort is fine; skeleton on every URL change is heavy but acceptable.
- `AgentRow` inline in parent file is fine; keys on `agentId` are stable (good).
- Hire `terms` / `expiredAt` memos: deadline bug is correctness, not just perf.
- Wallet menu: no subscription cleanup beyond provider (OK); `open` state lacks outside click listener cleanup pattern.
- Any job poll at 15s fixed should back off on error (pattern provided; apply in `Job.tsx`).
- `Counter` / motion: fail open is already the right idea; keep it.

**Fix**
- Deadline at submit; checkpoint; outside pointerdown + keydown with cleanup; `usePolling` with exponential back off helper; catalog retains last good data while `refreshing`.

---

## 3. Code

### 3.1 `src/index.css` (tokens + primitives + missing pills)

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

  --color-blue: #467BE7;
  --color-blue-deep: #1256E0;
  --color-blue-soft: #F1F5FD;
  --color-blue-line: #C6D6F8;

  --color-danger: #C4453A;
  --color-danger-soft: #FDF1F0;

  --font-sans: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "Fraunces", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-card: 22px;
  --radius-lg: 28px;
  --radius-pill: 999px;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;

  --text-2xs: 0.625rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-md: 1.05rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;

  --h-control: 2.75rem;
  --h-control-sm: 2.25rem;

  --shadow-soft: 0 2px 4px rgb(14 23 38 / .04), 0 12px 28px -16px rgb(14 23 38 / .10);
  --shadow-lift: 0 4px 10px rgb(14 23 38 / .05), 0 28px 60px -28px rgb(47 111 216 / .30);
  --shadow-blue: 0 18px 44px -18px rgb(47 111 216 / .55);
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
    border: 1px solid color-mix(in oklab, var(--color-line) 70%, transparent);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-soft);
  }

  .card-flat {
    background: var(--color-raised);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-card);
  }

  .card-hover { transition: box-shadow .25s ease, transform .25s ease; }
  .card-hover:hover {
    box-shadow: var(--shadow-lift);
    transform: translateY(-3px);
  }
  @media (prefers-reduced-motion: reduce) {
    .card-hover:hover { transform: none; }
  }

  .band-blue {
    background:
      radial-gradient(80% 120% at 12% 0%, color-mix(in oklab, #fff 16%, transparent), transparent 60%),
      linear-gradient(160deg, var(--color-blue-deep), color-mix(in oklab, var(--color-blue-deep) 82%, #123a7a));
    color: #fff;
  }
  .band-blue .label { color: color-mix(in oklab, #fff 70%, transparent); }

  .band-soft { background: var(--color-blue-soft); }
  .band-tint {
    background: linear-gradient(180deg, var(--color-ground) 0%, var(--color-blue-soft) 18%,
                var(--color-blue-soft) 82%, var(--color-ground) 100%);
  }

  .stat-figure {
    font-family: var(--font-mono);
    font-size: clamp(2.25rem, 4vw, 3.25rem);
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    color: var(--color-ink);
  }

  .chip {
    display: grid; place-items: center;
    width: 2.75rem; height: 2.75rem; border-radius: 999px;
    background: var(--color-blue-soft); color: var(--color-blue-deep);
  }

  .row-hover { transition: background-color .16s ease; }
  .row-hover:hover { background: var(--color-blue-soft); }

  .mock {
    border-radius: var(--radius-lg);
    background: var(--color-raised);
    border: 1px solid var(--color-line);
    box-shadow:
      0 2px 6px rgb(14 23 38 / .05),
      0 40px 90px -40px rgb(14 23 38 / .32),
      0 10px 30px -18px rgb(47 111 216 / .28);
  }

  .label {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-faint);
  }

  .display {
    font-family: var(--font-serif);
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 1.0;
    font-variation-settings: "SOFT" 30, "WONK" 0;
  }

  .display-ital {
    font-family: var(--font-serif);
    font-style: italic;
    font-weight: 500;
    font-variation-settings: "SOFT" 50, "WONK" 1;
  }

  .tone-claim {
    border: 1px dashed var(--color-line-2);
    background: transparent;
    color: var(--color-dim);
  }

  .tone-verify {
    border: 1px solid var(--color-blue-deep);
    background: var(--color-blue-deep);
    color: #fff;
  }

  .gap-track {
    height: 1.1rem;
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

  /* Pills: verified = filled; claim = dashed outline; never inverted hues */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    border-radius: var(--radius-pill);
    padding: 0.28rem 0.7rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1.2;
    white-space: nowrap;
  }
  .pill-dot {
    width: 0.35rem;
    height: 0.35rem;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.7;
    flex-shrink: 0;
  }
  .pill-verified {
    border: 1px solid var(--color-blue-deep);
    background: var(--color-blue-deep);
    color: #fff;
  }
  .pill-soft {
    border: 1px solid var(--color-blue-line);
    background: var(--color-blue-soft);
    color: var(--color-blue-deep);
  }
  .pill-claim {
    border: 1px dashed var(--color-line-2);
    background: transparent;
    color: var(--color-dim);
  }
  .pill-mute {
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    color: var(--color-faint);
  }
  .pill-danger {
    border: 1px solid color-mix(in oklab, var(--color-danger) 35%, transparent);
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: var(--h-control);
    padding: 0 1.25rem;
    border-radius: var(--radius-pill);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1;
    transition: background-color .16s ease, border-color .16s ease, color .16s ease, opacity .16s ease;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--color-blue-deep);
    color: #fff;
    border: 1px solid var(--color-blue-deep);
  }
  .btn-primary:hover:not(:disabled) { background: var(--color-blue); border-color: var(--color-blue); }
  .btn-secondary {
    background: var(--color-ground);
    color: var(--color-dim);
    border: 1px solid var(--color-line-2);
  }
  .btn-secondary:hover:not(:disabled) {
    border-color: var(--color-blue-line);
    color: var(--color-ink);
  }
  .btn-danger {
    background: var(--color-danger);
    color: #fff;
    border: 1px solid var(--color-danger);
  }
  .btn-ghost {
    background: transparent;
    color: var(--color-dim);
    border: 1px solid transparent;
    min-height: var(--h-control-sm);
  }
  .btn-ghost:hover:not(:disabled) { color: var(--color-ink); }
  .btn-sm {
    min-height: var(--h-control-sm);
    padding: 0 0.9rem;
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .field-wrap { display: block; width: 100%; }
  .field-control {
    width: 100%;
    border: 1px solid var(--color-line);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    padding: 0.85rem 1rem;
    font-size: var(--text-sm);
    color: var(--color-ink);
    outline: none;
  }
  .field-control::placeholder { color: var(--color-faint); }
  .field-control:focus {
    border-color: var(--color-blue-line);
  }
  .field-control[aria-invalid="true"] {
    border-color: color-mix(in oklab, var(--color-danger) 50%, var(--color-line));
  }
  textarea.field-control { resize: vertical; }

  .skip-link {
    position: absolute;
    left: 1rem;
    top: -100px;
    z-index: 100;
    border-radius: var(--radius-pill);
    background: var(--color-blue-deep);
    color: #fff;
    padding: 0.6rem 1rem;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .skip-link:focus {
    top: 1rem;
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
}
```

### 3.2 `src/components/ui.tsx` (primitives + production Failed)

```tsx
import { useMotionValue, useSpring } from "framer-motion";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Reveal } from "./Reveal.tsx";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import clsx from "clsx";

const TONE = {
  verify: "pill-verified",
  soft: "pill-soft",
  claim: "pill-claim",
  mute: "pill-mute",
  danger: "pill-danger",
} as const;

export type Tone = keyof typeof TONE;

export function Pill({ tone = "mute", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx("pill", TONE[tone])}>
      {tone !== "verify" && <i className="pill-dot" aria-hidden />}
      {children}
    </span>
  );
}

export function Badge({
  children,
  tone = "soft",
}: {
  children: ReactNode;
  tone?: "soft" | "claim" | "verify" | "mute";
}) {
  return <Pill tone={tone}>{children}</Pill>;
}

export function Card({
  children,
  className,
  flat = false,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  flat?: boolean;
  as?: "div" | "section" | "article";
}) {
  return <Tag className={clsx(flat ? "card-flat" : "card", className)}>{children}</Tag>;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "md" | "sm";
    loading?: boolean;
  }
>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "secondary" && "btn-secondary",
        variant === "danger" && "btn-danger",
        variant === "ghost" && "btn-ghost",
        size === "sm" && "btn-sm",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field-wrap">
      <label className="block" htmlFor={id}>
        <span className="label">{label}</span>
        <div className="mt-2">
          {/* Child clones are avoided: pass id via render props pattern below */}
          {typeof children === "function"
            ? (children as (p: { id: string; describedBy?: string; invalid: boolean }) => ReactNode)({
                id,
                describedBy,
                invalid: !!error,
              })
            : children}
        </div>
      </label>
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={clsx("field-control", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function TextArea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={clsx("field-control", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

/** Compatible Field that wires id and describedby without render props complexity at call sites. */
export function LabeledField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="field-wrap">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-16 text-center">
      {Icon && <Icon className="mx-auto size-8 text-line-2" aria-hidden />}
      <p className="mt-4 text-ink">{title}</p>
      {body && <div className="mx-auto mt-2 max-w-md text-sm text-dim">{body}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function InlineAlert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "info";
  children: ReactNode;
}) {
  return (
    <p
      role="alert"
      className={clsx(
        "flex items-start gap-2 rounded-[var(--radius-md)] border p-3 text-sm",
        tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
        tone === "info" && "border-blue-line bg-blue-soft text-blue-deep",
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to content
    </a>
  );
}

export function Counter({
  to,
  format = (n: number) => n.toLocaleString("en-US"),
}: {
  to: number;
  format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1.1, bounce: 0 });
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => {
      if (!started) {
        setStarted(true);
        mv.set(to);
      }
    };
    if (typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) {
          start();
          io.disconnect();
        }
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    const failOpen = window.setTimeout(start, 1000);
    return () => {
      io.disconnect();
      window.clearTimeout(failOpen);
    };
  }, [to, mv, started]);

  useEffect(
    () =>
      spring.on("change", (v) => {
        if (ref.current) ref.current.textContent = format(Math.round(v));
      }),
    [spring, format],
  );

  return (
    <span ref={ref} className="tnum">
      {format(to)}
    </span>
  );
}

export function Section({
  id,
  index,
  title,
  lede,
  children,
}: {
  id?: string;
  index: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal>
          <div className="flex items-baseline gap-4">
            <span className="label pt-2 text-blue-deep">{index}</span>
            <h2 className="max-w-3xl text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink md:text-[2.6rem]">
              {title}
            </h2>
          </div>
          {lede && <p className="mt-5 max-w-2xl text-[1.05rem] leading-relaxed text-dim">{lede}</p>}
        </Reveal>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

export function Failed({ message, title }: { message: string; title?: string }) {
  return (
    <div className="card flex gap-4 border-danger/30 bg-danger-soft p-6" role="alert">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div>
        <p className="label text-danger">{title ?? "We could not load this"}</p>
        <p className="mt-2 text-sm text-dim">
          Nothing here is filled from cache or placeholder values, so this panel stays empty rather than
          wrong. Check your connection and try again.
        </p>
        <p className="mt-2 font-mono text-xs text-faint">{message}</p>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded bg-surface", className)} aria-hidden />;
}

export function OfflineBanner({ offline }: { offline: boolean }) {
  if (!offline) return null;
  return (
    <div
      className="border-b border-danger/20 bg-danger-soft px-6 py-2 text-center text-sm text-danger"
      role="status"
      aria-live="polite"
    >
      You are offline. Figures will not refresh until the connection returns.
    </div>
  );
}
```

### 3.3 `src/hooks/useOnline.ts`

```tsx
import { useEffect, useState } from "react";

/** Browser online signal. Defaults to true so SSR and first paint fail open. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}
```

### 3.4 `src/hooks/usePolling.ts`

```tsx
import { useEffect, useRef } from "react";

/**
 * Interval poll with exponential back off on failure.
 * Honour tab visibility: pause when hidden so we do not spin timers uselessly;
 * fire once when visible again. Caller owns the fetch and abort.
 */
export function usePolling(
  tick: () => Promise<"ok" | "fail">,
  {
    intervalMs = 15_000,
    maxIntervalMs = 120_000,
    enabled = true,
  }: { intervalMs?: number; maxIntervalMs?: number; enabled?: boolean },
) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer = 0;
    let delay = intervalMs;

    const clear = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    };

    const schedule = () => {
      clear();
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      try {
        const result = await tickRef.current();
        delay = result === "ok" ? intervalMs : Math.min(maxIntervalMs, Math.round(delay * 1.8));
      } catch {
        delay = Math.min(maxIntervalMs, Math.round(delay * 1.8));
      }
      if (!cancelled) schedule();
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        delay = intervalMs;
        void run();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    void run();

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, intervalMs, maxIntervalMs]);
}
```

### 3.5 `src/components/FocusOnRouteChange.tsx`

```tsx
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * After a client route change, move focus to the main landmark (or h1 inside it)
 * so keyboard and SR users are not left mid page on the previous screen.
 * Does not steal focus if the user is already inside main (e.g. query only).
 */
export function FocusOnRouteChange() {
  const location = useLocation();

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const active = document.activeElement;
    if (active && main.contains(active) && active !== document.body) return;

    const target =
      (main.querySelector("h1") as HTMLElement | null) ??
      main;

    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [location.pathname, location.search]);

  return null;
}
```

Mount once next to the router outlet:

```tsx
import { SkipLink } from "./components/ui.tsx";
import { FocusOnRouteChange } from "./components/FocusOnRouteChange.tsx";

// inside the app shell:
<>
  <SkipLink />
  <FocusOnRouteChange />
  {/* routes */}
</>
```

### 3.6 `src/components/ScoreRing.tsx` (accessible)

```tsx
import clsx from "clsx";

/**
 * Verified score ring. Visual weight only: filled arc, no second hue.
 * Resting DOM always shows the true value; SVG is decorative next to the text.
 */
export function ScoreRing({
  value,
  size = 40,
  className,
}: {
  value: number | null | undefined;
  size?: number;
  className?: string;
}) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = n === null ? c : c - (n / 100) * c;
  const label = n === null ? "No score" : `Verified score ${Math.round(n)} out of 100`;

  return (
    <span
      className={clsx("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className=" -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="3"
        />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="var(--color-blue-deep)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="pointer-events-none absolute font-mono text-[0.62rem] text-ink tnum" aria-hidden>
        {n === null ? "—" : Math.round(n)}
      </span>
    </span>
  );
}
```

Wait: the ScoreRing has an em/en dash character "—" in the null display. I must fix that to something else like ".." or "n/a".Fixing a dash in `ScoreRing` and continuing with the remaining full files.

### 3.6 `src/components/ScoreRing.tsx` (accessible, no unicode dashes)

```tsx
import clsx from "clsx";

/**
 * Verified score ring. Visual weight only: filled arc, no second hue.
 * Resting DOM always exposes the true value via aria-label; the SVG is decorative.
 */
export function ScoreRing({
  value,
  size = 40,
  className,
}: {
  value: number | null | undefined;
  size?: number;
  className?: string;
}) {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : null;
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = n === null ? c : c - (n / 100) * c;
  const label = n === null ? "No score" : `Verified score ${Math.round(n)} out of 100`;

  return (
    <span
      className={clsx("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        aria-hidden
        className="-rotate-90"
      >
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--color-line)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="var(--color-blue-deep)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span
        className="pointer-events-none absolute font-mono text-[0.62rem] text-ink tnum"
        aria-hidden
      >
        {n === null ? "na" : Math.round(n)}
      </span>
    </span>
  );
}
```

### 3.7 `src/components/Wallet.tsx`

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Wallet as WalletIcon, LogOut, AlertTriangle, Check } from "lucide-react";
import { CHAIN } from "../lib/chain.ts";
import { short } from "../lib/api.ts";
import { Button } from "./ui.tsx";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...a: never[]) => void): void;
  removeListener?(event: string, cb: (...a: never[]) => void): void;
}
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

interface WalletState {
  available: boolean;
  address: string | null;
  chainId: number | null;
  wrongChain: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);
export const useWallet = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside WalletProvider");
  return v;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eth) return;
    let live = true;
    (async () => {
      try {
        const accs = (await eth.request({ method: "eth_accounts" })) as string[];
        const cid = (await eth.request({ method: "eth_chainId" })) as string;
        if (!live) return;
        if (accs?.[0]) setAddress(accs[0]);
        setChainId(Number.parseInt(cid, 16));
      } catch {
        /* provider refused; stay disconnected */
      }
    })();

    const onAccounts = (...a: never[]) =>
      setAddress(((a[0] as unknown as string[]) ?? [])[0] ?? null);
    const onChain = (...a: never[]) =>
      setChainId(Number.parseInt(a[0] as unknown as string, 16));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [eth]);

  const connect = useCallback(async () => {
    if (!eth) return;
    setConnecting(true);
    setError(null);
    try {
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accs?.[0] ?? null);
      const cid = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(cid, 16));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/user rejected|denied/i.test(msg) ? "Connection was declined in your wallet." : msg);
    } finally {
      setConnecting(false);
    }
  }, [eth]);

  const switchChain = useCallback(async () => {
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN.hexId }],
      });
    } catch (e) {
      if ((e as { code?: number })?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN.hexId,
              chainName: CHAIN.name,
              nativeCurrency: CHAIN.currency,
              rpcUrls: [CHAIN.rpc],
              blockExplorerUrls: [CHAIN.explorer],
            },
          ],
        });
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [eth]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      available: !!eth,
      address,
      chainId,
      wrongChain: address !== null && chainId !== null && chainId !== CHAIN.id,
      connecting,
      error,
      connect,
      disconnect,
      switchChain,
    }),
    [eth, address, chainId, connecting, error, connect, disconnect, switchChain],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return Array.from(nodes).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
}

export function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    const t = window.setTimeout(() => {
      const focusable = panelRef.current ? getFocusable(panelRef.current) : [];
      focusable[0]?.focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
      window.clearTimeout(t);
    };
  }, [open]);

  if (!w.available) {
    return (
      <a
        href="https://ethereum.org/en/wallets/find-wallet/"
        target="_blank"
        rel="noreferrer noopener"
        className="btn btn-secondary btn-sm"
      >
        <WalletIcon className="size-4" aria-hidden /> Get a wallet
      </a>
    );
  }

  if (!w.address) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={w.connect}
        loading={w.connecting}
        aria-label={w.connecting ? "Waiting for wallet" : "Connect wallet"}
      >
        <WalletIcon className="size-4" aria-hidden />
        {w.connecting ? "Check your wallet" : "Connect wallet"}
      </Button>
    );
  }

  if (w.wrongChain) {
    return (
      <Button type="button" size="sm" variant="danger" onClick={w.switchChain}>
        <AlertTriangle className="size-4" aria-hidden /> Switch to {CHAIN.name}
      </Button>
    );
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-blue-line bg-blue-soft px-4 py-2 font-mono text-xs text-blue-deep"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Check className="size-3.5" aria-hidden /> {short(w.address)}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          aria-label="Account"
          className="card absolute right-0 z-50 mt-2 w-64 p-2"
        >
          <p className="break-all px-3 py-2 font-mono text-[0.68rem] text-faint">{w.address}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              w.disconnect();
              setOpen(false);
              buttonRef.current?.focus();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dim transition-colors hover:bg-surface hover:text-ink"
          >
            <LogOut className="size-4" aria-hidden /> Forget this account
          </button>
          <p className="px-3 pb-1 pt-2 text-[0.68rem] leading-relaxed text-faint">
            This clears the account from this site only. Your wallet decides what it shares, so revoke
            access there if you want it gone entirely.
          </p>
        </div>
      )}
    </div>
  );
}
```

### 3.8 `src/Catalog.tsx`

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Search,
  ShieldCheck,
  Users,
  Server,
  Eye,
  EyeOff,
} from "lucide-react";
import { fmt, VERIFIED, type AgentCard, type AgentsPage } from "./lib/api.ts";
import {
  Badge,
  Button,
  EmptyState,
  Failed,
  OfflineBanner,
  Skeleton,
  SkipLink,
} from "./components/ui.tsx";
import { Rise } from "./components/motion.tsx";
import { ScoreRing } from "./components/ScoreRing.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { WalletButton } from "./components/Wallet.tsx";
import { useOnline } from "./hooks/useOnline.ts";

const SORTS = [
  { id: "score", label: "Best verified" },
  { id: "newest", label: "Newest" },
  { id: "responseTime", label: "Fastest" },
] as const;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ground/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <Link to="/" className="font-mono text-sm font-semibold uppercase tracking-widest">
          bnb<span className="text-blue-deep">·</span>mrkt
        </Link>
        <span className="hidden font-mono text-xs text-faint sm:inline">catalog</span>
        <Link
          to="/"
          className="ml-auto inline-flex items-center gap-2 text-sm text-dim transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Link>
        <WalletButton />
      </div>
    </header>
  );
}

function AgentRow({ a }: { a: AgentCard }) {
  const v = VERIFIED[a.verifiedClass] ?? { label: a.verifiedClass, tone: "mute" as const, note: "" };
  const conc = a.signals.concentration;
  const prov = a.signals.provenance;

  return (
    <li>
      <Link
        to={`/agent/${a.agentId}`}
        className="row-hover group grid grid-cols-[1fr_auto] items-center gap-4 px-6 py-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_auto]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-full bg-blue-soft font-mono text-sm text-blue-deep"
            aria-hidden
          >
            {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-ink">
                {a.name?.trim() || `Agent ${a.agentId}`}
              </p>
              {a.firstParty && <Badge tone="soft">ours</Badge>}
              <span className="md:hidden">
                <Badge tone={v.tone}>{v.label}</Badge>
              </span>
            </div>
            <p className="truncate font-mono text-[0.68rem] text-faint">
              #{a.agentId}
              {a.categories.length > 0 && ` · ${a.categories.slice(0, 2).join(", ")}`}
            </p>
          </div>
        </div>

        <div className="hidden md:block">
          <Badge tone={v.tone}>{v.label}</Badge>
          <p className="mt-1.5 truncate font-mono text-[0.66rem] text-faint">
            declared {a.declaredClass}
          </p>
        </div>

        <div className="hidden min-w-0 md:block">
          {conc.distinctRaters > 0 ? (
            <p className="truncate text-xs text-dim">
              <span className="tnum">{fmt(conc.ratingCount)}</span> ratings from{" "}
              <span className="tnum">{fmt(conc.distinctRaters)}</span>
              {conc.topRaterSharePct !== null && (
                <>, top {conc.topRaterSharePct}%</>
              )}
            </p>
          ) : (
            <p className="text-xs text-faint">No ratings</p>
          )}
          <p className="mt-0.5 truncate font-mono text-[0.66rem] text-faint">
            {prov.operatorHost
              ? `${prov.operatorHost}${prov.operatorAgentCount ? ` · ${fmt(prov.operatorAgentCount)} agents` : ""}`
              : "self hosted registration"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-faint">{a.score.tier}</p>
          </div>
          <ScoreRing value={a.score.value} />
          <ArrowRight
            className="size-4 shrink-0 text-line-2 transition-all group-hover:translate-x-0.5 group-hover:text-blue-deep"
            aria-hidden
          />
        </div>
      </Link>
    </li>
  );
}

export default function Catalog() {
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const liveOnly = params.get("live") !== "false";
  const sort = params.get("sort") ?? "score";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";

  const [draft, setDraft] = useState(q);
  useEffect(() => {
    setDraft(q);
  }, [q]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({ perPage: "25", page: String(page), sort });
    if (!liveOnly) sp.set("live", "false");
    if (q) sp.set("q", q);
    return `/api/agents?${sp}`;
  }, [liveOnly, sort, page, q]);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; data: AgentsPage }
    | { status: "refreshing"; data: AgentsPage }
    | { status: "failed"; message: string; data?: AgentsPage }
  >({ status: "loading" });

  const lastGood = useRef<AgentsPage | null>(null);

  useEffect(() => {
    let live = true;
    const ac = new AbortController();
    setState((prev) =>
      prev.status === "ready" || prev.status === "refreshing"
        ? { status: "refreshing", data: prev.data }
        : prev.status === "failed" && prev.data
          ? { status: "refreshing", data: prev.data }
          : { status: "loading" },
    );

    (async () => {
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json" },
          signal: ac.signal,
        });
        const body = await res.json();
        if (!res.ok || body?.error) throw new Error(body?.message ?? `HTTP ${res.status}`);
        if (!live) return;
        lastGood.current = body;
        setState({ status: "ready", data: body });
      } catch (e) {
        if (!live || (e instanceof DOMException && e.name === "AbortError")) return;
        setState({
          status: "failed",
          message: e instanceof Error ? e.message : String(e),
          data: lastGood.current ?? undefined,
        });
      }
    })();

    return () => {
      live = false;
      ac.abort();
    };
  }, [url]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const goPage = (n: number) => {
    set({ page: String(n) });
    const top = document.getElementById("results");
    if (top) {
      const y = top.getBoundingClientRect().top + window.scrollY - 150;
      window.scrollTo({
        top: y,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  };

  const data =
    state.status === "ready" || state.status === "refreshing"
      ? state.data
      : state.status === "failed"
        ? state.data ?? null
        : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const busy = state.status === "loading" || state.status === "refreshing";

  const summaryText = data
    ? `${fmt(data.total)} agents shown${
        data.filter.liveOnly
          ? `, ${fmt(data.filter.hiddenByLiveFilter)} hidden by verified filter`
          : ""
      }`
    : busy
      ? "Loading agents"
      : "No agent data";

  return (
    <div className="min-h-screen">
      <SkipLink />
      <Nav />
      <OfflineBanner offline={!online} />

      <main id="main" className="mx-auto max-w-7xl px-6 py-10">
        <Rise>
          <h1 className="display text-3xl text-ink md:text-4xl" tabIndex={-1}>
            Agents that <span className="display-ital text-blue-deep">answered</span>
          </h1>
          <p className="mt-3 max-w-2xl text-dim">
            Every agent here responded when we called its declared endpoint.{" "}
            <Link to="/docs#verification" className="text-blue-deep hover:underline">
              What we check
            </Link>
          </p>
        </Rise>

        <div className="card-flat sticky top-20 z-30 mt-8 flex flex-wrap items-center gap-3 bg-ground/95 p-3 backdrop-blur-xl">
          <form
            role="search"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: draft || null });
            }}
          >
            <Search className="size-4 shrink-0 text-faint" aria-hidden />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search by name, description or agent id"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
              aria-label="Search agents"
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  set({ q: null });
                }}
                className="shrink-0 font-mono text-[0.65rem] uppercase tracking-wider text-faint hover:text-ink"
              >
                clear
              </button>
            )}
          </form>

          <button
            type="button"
            onClick={() => set({ live: liveOnly ? "false" : null })}
            aria-pressed={liveOnly}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition-colors ${
              liveOnly
                ? "border-blue-deep bg-blue-deep text-white"
                : "border-line-2 bg-ground text-dim hover:border-blue-line"
            }`}
          >
            {liveOnly ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
            Verified only
          </button>

          <div
            className="flex items-center gap-1.5 rounded-full border border-line bg-surface p-1"
            role="radiogroup"
            aria-label="Sort agents"
          >
            {SORTS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={sort === o.id}
                onClick={() => set({ sort: o.id })}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                  sort === o.id
                    ? "bg-ground text-ink shadow-[var(--shadow-soft)]"
                    : "text-faint hover:text-dim"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-sm text-dim" aria-live="polite">
          <span className="sr-only">{summaryText}</span>
          {data && (
            <>
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <ShieldCheck className="size-3.5 text-blue-deep" aria-hidden />
                <span className="tnum text-blue-deep">{fmt(data.total)}</span> shown
                {busy && <span className="font-mono text-xs font-normal text-faint"> updating</span>}
              </span>
              {data.filter.liveOnly && (
                <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                  <EyeOff className="size-3.5" aria-hidden />
                  <span className="tnum">{fmt(data.filter.hiddenByLiveFilter)}</span> hidden by this filter
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-faint">
                <Server className="size-3.5" aria-hidden />
                <span className="tnum">{fmt(data.filter.corpusResolved)}</span> of{" "}
                <span className="tnum">{fmt(data.filter.corpusTotal)}</span> registrations resolved
              </span>
            </>
          )}
        </div>

        <div id="results" className="card mt-4 scroll-mt-40 overflow-hidden">
          <div
            className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_auto] gap-4 border-b border-line bg-surface/70 px-6 py-3 md:grid"
            role="row"
          >
            <span className="label">Agent</span>
            <span className="label">What we found</span>
            <span className="label">Signals</span>
            <span className="label text-right">Score</span>
          </div>

          {state.status === "failed" && !data ? (
            <div className="p-5">
              <Failed message={state.message} />
            </div>
          ) : state.status === "loading" && !data ? (
            <ul className="divide-y divide-line" aria-label="Loading agents">
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-2.5 w-28" />
                  </div>
                  <Skeleton className="h-7 w-24 rounded-full" />
                </li>
              ))}
            </ul>
          ) : data && data.results.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nothing matches that."
              body={
                q ? (
                  <>
                    No agent matched <span className="font-mono text-ink">{q}</span>
                    {liveOnly && " among the verified ones"}.
                  </>
                ) : (
                  "No agents matched these filters."
                )
              }
              action={
                liveOnly ? (
                  <Button type="button" variant="secondary" onClick={() => set({ live: "false" })}>
                    Search everything, unfiltered
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-line" aria-label="Agent results
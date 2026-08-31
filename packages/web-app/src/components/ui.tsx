import { useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reveal } from "./Reveal.tsx";
import { AlertTriangle } from "lucide-react";
import clsx from "clsx";

/**
 * With one accent colour, CLAIMED versus VERIFIED is carried by weight:
 * verified facts are filled, claims are outlined and never filled. Losing that
 * distinction would cost the product its whole argument, so it is encoded here
 * once and nowhere else.
 */
const TONE = {
  verify: "pill-verified",  // established by us calling it
  soft:   "pill-soft",      // established, but a lesser fact
  claim:  "pill-claim",     // asserted by the operator, unchecked
  mute:   "pill-mute",      // absence of a fact
  danger: "pill-danger",    // system failure only
} as const;

export type Tone = keyof typeof TONE;

export function Pill({ tone = "mute", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx("pill", TONE[tone])}>
      {tone !== "verify" && <i className="pill-dot" />}
      {children}
    </span>
  );
}

/**
 * Counts up to a real value. Like Reveal, this fails OPEN: the span is
 * populated with the true number on mount, and the animation only overwrites it
 * while running. A broken animation can never leave a wrong or empty figure on
 * screen, which matters more here than anywhere else on the page.
 */
export function Counter({ to, format = (n: number) => n.toLocaleString("en-US") }: {
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
    const start = () => { if (!started) { setStarted(true); mv.set(to); } };
    if (typeof IntersectionObserver === "undefined") { start(); return; }
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) { start(); io.disconnect(); }
    }, { threshold: 0.01 });
    io.observe(el);
    const failOpen = window.setTimeout(start, 1000);
    return () => { io.disconnect(); window.clearTimeout(failOpen); };
  }, [to, mv, started]);

  useEffect(() =>
    spring.on("change", (v) => {
      if (ref.current) ref.current.textContent = format(Math.round(v));
    }), [spring, format]);

  // Rendered with the TRUE value, not zero.
  return <span ref={ref} className="tnum">{format(to)}</span>;
}

export function Section({ id, index, title, lede, children }: {
  id?: string; index: string; title: string; lede?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={id} className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <Reveal>
          <div className="flex items-baseline gap-4">
            <span className="label pt-2 text-blue-deep">{index}</span>
            <h2 className="text-3xl md:text-[2.6rem] font-semibold tracking-[-0.03em] leading-[1.08] text-balance max-w-3xl">
              {title}
            </h2>
          </div>
          {lede && <p className="mt-5 max-w-2xl text-dim text-[1.05rem] leading-relaxed">{lede}</p>}
        </Reveal>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

export function Failed({ message }: { message: string }) {
  return (
    <div className="card flex gap-4 border-danger/30 bg-danger-soft p-6">
      <AlertTriangle className="size-5 shrink-0 text-danger mt-0.5" />
      <div>
        <p className="label text-danger">The index is not responding</p>
        <p className="mt-2 text-sm text-dim">
          Nothing here is shown from cache or placeholder values, so it is blank rather than wrong.
          Start the index with <code className="font-mono text-blue-deep">npm run api</code>.
        </p>
        <p className="mt-2 font-mono text-xs text-faint">{message}</p>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("animate-pulse rounded bg-surface", className)} />
  );
}

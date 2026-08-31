import { useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reveal } from "./Reveal.tsx";
import { AlertTriangle } from "lucide-react";
import clsx from "clsx";

const TONE = {
  verify: "text-verify",
  claim: "text-claim",
  danger: "text-danger",
  mute: "text-faint",
} as const;

export type Tone = keyof typeof TONE;

export function Pill({ tone = "mute", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx("pill", TONE[tone])}>
      <i className="pill-dot" />
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
            <span className="label text-claim pt-2">{index}</span>
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
    <div className="card border-danger/40 bg-danger-soft/40 p-6 flex gap-4">
      <AlertTriangle className="size-5 shrink-0 text-danger mt-0.5" />
      <div>
        <p className="label text-danger">The index is not responding</p>
        <p className="mt-2 text-sm text-dim">
          Nothing on this page is shown from cache or placeholder values, so it is blank rather
          than wrong. Start the index with <code className="font-mono text-claim">npm run api</code>.
        </p>
        <p className="mt-2 font-mono text-xs text-faint">{message}</p>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("animate-pulse rounded bg-line/70", className)} />
  );
}

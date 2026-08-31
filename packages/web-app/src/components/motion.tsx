import {
  motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform,
  type MotionValue,
} from "framer-motion";
import {
  useEffect, useRef, useState, type CSSProperties, type ReactNode,
} from "react";

/**
 * Motion primitives.
 *
 * Every effect here FAILS OPEN. The rule, learned from two bugs on this page:
 * if a trigger never fires, the reader must still see correct, legible content.
 * So each primitive animates a property whose RESTING value is already the true
 * one. Parallax rests at zero offset. Tilt rests flat. Odometers render the real
 * digits. Nothing is hidden behind a scroll listener.
 */

const SPRING = { stiffness: 120, damping: 24, mass: 0.6 };

/** Scroll progress through an element, 0 as it enters, 1 as it leaves. */
export function useSectionProgress(ref: React.RefObject<HTMLElement | null>) {
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  return scrollYProgress;
}

/**
 * Parallax drift. `distance` is total travel in px across the scroll range.
 * Resting position is the element's natural place, so a dead scroll listener
 * simply means no drift.
 */
export function Parallax({
  children, distance = 60, className, style,
}: { children: ReactNode; distance?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const progress = useSectionProgress(ref);
  const raw = useTransform(progress, [0, 1], [distance / 2, -distance / 2]);
  const y = useSpring(raw, SPRING);

  return (
    <div ref={ref} className={className} style={style}>
      <motion.div style={{ y: reduce ? 0 : y }}>{children}</motion.div>
    </div>
  );
}

/** Pointer-reactive 3D tilt with a soft spotlight. Rests perfectly flat. */
export function Tilt({
  children, className, max = 6, glow = true,
}: { children: ReactNode; className?: string; max?: number; glow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), SPRING);
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), SPRING);
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || reduce) return;
    const r = el.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const reset = () => { px.set(0.5); py.set(0.5); };

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{
        rotateX: reduce ? 0 : rx,
        rotateY: reduce ? 0 : ry,
        transformPerspective: 900,
      }}
      className={`relative ${className ?? ""}`}
    >
      {children}
      {glow && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 [.group\\/tilt:hover_&]:opacity-100"
          style={{
            background: useTransform(
              [gx, gy] as unknown as MotionValue<string>[],
              ([x, y]: string[]) =>
                `radial-gradient(280px circle at ${x} ${y}, color-mix(in oklab, var(--color-blue) 16%, transparent), transparent 70%)`,
            ),
          }}
        />
      )}
    </motion.div>
  );
}

/** Button that leans toward the pointer. Rests centred. */
export function Magnetic({
  children, className, strength = 8, as: As = "div",
}: { children: ReactNode; className?: string; strength?: number; as?: "div" | "span" }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(useMotionValue(0), SPRING);
  const y = useSpring(useMotionValue(0), SPRING);

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || reduce) return;
    const r = el.getBoundingClientRect();
    x.set(((e.clientX - r.left) / r.width - 0.5) * strength * 2);
    y.set(((e.clientY - r.top) / r.height - 0.5) * strength * 2);
  };

  const Cmp = As === "span" ? motion.span : motion.div;
  return (
    <Cmp
      ref={ref as never}
      onPointerMove={onMove}
      onPointerLeave={() => { x.set(0); y.set(0); }}
      style={{ x, y, display: "inline-flex" }}
      className={className}
    >
      {children}
    </Cmp>
  );
}

/**
 * Odometer. Each digit is a column that slides to its value.
 *
 * Fails open twice over: the true string is rendered as real text for screen
 * readers and as the column content, so a stalled transition leaves the correct
 * digits on screen rather than a blank or a zero.
 */
export function Odometer({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const text = value.toLocaleString("en-US");
  const chars = text.split("");

  return (
    <span className={`inline-flex tnum ${className ?? ""}`} role="text" aria-label={text}>
      {chars.map((c, i) => {
        if (!/\d/.test(c)) {
          return <span key={`s${i}`} aria-hidden className="px-[0.02em]">{c}</span>;
        }
        const d = Number(c);
        return (
          <span key={`d${i}`} aria-hidden className="relative inline-block overflow-hidden"
                style={{ height: "1em", width: "0.62em", lineHeight: 1 }}>
            <motion.span
              className="absolute left-0 top-0 flex flex-col items-center"
              initial={false}
              animate={{ y: reduce ? `-${d}em` : `-${d}em` }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 20, delay: i * 0.04 }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <span key={n} style={{ height: "1em", lineHeight: 1 }}>{n}</span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Infinite marquee. Duplicates its children once and translates by exactly half,
 * so the loop is seamless. Pauses on hover and for reduced motion, where it
 * becomes an ordinary horizontally scrollable strip.
 */
export function Marquee({
  children, speed = 46, className,
}: { children: ReactNode; speed?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [paused, setPaused] = useState(false);

  if (reduce) {
    return <div className={`flex gap-3 overflow-x-auto ${className ?? ""}`}>{children}</div>;
  }
  return (
    <div
      className={`group relative overflow-hidden ${className ?? ""}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <motion.div
        className="flex w-max gap-3"
        animate={{ x: paused ? undefined : ["0%", "-50%"] }}
        transition={{ duration: speed, ease: "linear", repeat: Infinity }}
        style={{ animationPlayState: paused ? "paused" : "running" }}
      >
        {children}
        <span aria-hidden className="flex gap-3">{children}</span>
      </motion.div>
    </div>
  );
}

/**
 * Reveal with choreography. Visible by default if anything goes wrong: the
 * observer is an enhancement, and a timer guarantees the reveal regardless.
 */
export function Rise({
  children, delay = 0, y = 18, className, id,
}: { children: ReactNode; delay?: number; y?: number; className?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.01, rootMargin: "0px 0px -30px 0px" });
    io.observe(el);
    if (el.getBoundingClientRect().top < window.innerHeight) setShown(true);
    const t = window.setTimeout(() => setShown(true), 1000);
    return () => { io.disconnect(); window.clearTimeout(t); };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className={className}
      style={{
        opacity: shown || reduce ? 1 : 0,
        transform: shown || reduce ? "none" : `translateY(${y}px)`,
        transition: reduce ? "none"
          : `opacity .6s cubic-bezier(.22,1,.36,1) ${delay}ms, transform .7s cubic-bezier(.22,1,.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row of cards that travels left as the page scrolls down.
 *
 * TRAVEL IS MEASURED, NOT ASSUMED. The first version computed it as a
 * percentage of the row's own width on the assumption that one card filled the
 * viewport. Cards are 360px and a desktop viewport fits four, so it translated
 * the row roughly twice as far as it should and scrolled the whole thing off
 * the left edge - the section rendered as a tall band of nothing. The distance
 * a rail must move is `rowWidth - viewportWidth` and there is no way to know
 * either without asking the DOM.
 *
 * FAILS OPEN, like everything in motion.tsx:
 *
 *   - `prefers-reduced-motion`, or no scroll listener: an ordinary
 *     horizontally-scrollable row. Nothing pinned, nothing hidden.
 *   - Measurement not yet run, or a row narrower than the viewport: travel is
 *     zero, so the cards simply sit still and readable.
 */
export function ScrollRail({
  children, count, className = "",
}: { children: ReactNode; count: number; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  /** How far the row overflows its viewport, in px. Zero until measured. */
  const [travel, setTravel] = useState(0);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      // scrollWidth is the full row; clientWidth of the viewport is what shows.
      const overflow = el.scrollWidth - (el.parentElement?.clientWidth ?? 0);
      setTravel(Math.max(0, overflow));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [count, children]);

  // Progress through the tall outer section: 0 when its top reaches the
  // viewport top, 1 when its bottom does.
  const { scrollYProgress } = useScroll({ target: outer, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], [0, -travel]);

  if (reduce) {
    return (
      <div className={`overflow-x-auto pb-4 ${className}`}>
        <div className="flex gap-4 px-5 lg:px-8">{children}</div>
      </div>
    );
  }

  return (
    /* Section height sets how much scrolling the rail consumes. Scaled to the
       distance actually travelled rather than to the card count, so a rail that
       barely overflows does not eat three screens of scrolling. */
    <div
      ref={outer}
      style={{ height: `calc(100vh + ${travel}px)` }}
      className={className}
    >
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <motion.div
          ref={row}
          style={{ x }}
          /* No `will-change: transform` here. It promotes the row to its own
             compositor layer for the whole life of the page, which on this
             layout produced blank paints below the fold - the DOM reported
             every element visible at opacity 1 while the rendered frame was
             empty. Framer already promotes during the animation; asking for it
             permanently bought nothing and cost correctness. */
          className="flex gap-4 px-5 lg:px-8"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}

/** One finding. Fixed width so the measured travel stays stable. */
export function RailCard({
  figure, unit, title, body, tone = "ink",
}: {
  figure: ReactNode;
  unit?: string;
  title: string;
  body: string;
  tone?: "ink" | "accent";
}) {
  return (
    <article className="panel flex w-[78vw] shrink-0 flex-col justify-between p-6 sm:w-[340px] lg:h-[280px]">
      <div>
        <p className={`figure text-[2.4rem] ${tone === "accent" ? "text-accent" : "text-ink"}`}>
          {figure}
          {unit && <span className="ml-1.5 font-sans text-[1rem] font-medium text-faint">{unit}</span>}
        </p>
        <h3 className="mt-4 text-[1.02rem] font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-[0.88rem] leading-relaxed text-dim">{body}</p>
    </article>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll reveal that fails OPEN.
 *
 * The first version used framer-motion's `whileInView` with an initial opacity
 * of 0. The observer never fired for programmatically scrolled sections and
 * every section below the hero stayed at opacity 0 — the page looked empty.
 *
 * Content being permanently invisible because an animation did not run is not
 * an acceptable failure mode, so this component guarantees it cannot happen:
 *
 *  - if IntersectionObserver is missing, content is visible immediately;
 *  - if the observer never fires, a timer reveals it anyway;
 *  - if the element is already on screen at mount, it reveals on the next frame;
 *  - reduced-motion users skip the transform entirely.
 *
 * The animation is decoration. The text is the product.
 */
export function Reveal({
  children, delay = 0, className,
}: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }

    const reveal = () => setShown(true);
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) { reveal(); io.disconnect(); } },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.01 },
    );
    io.observe(el);

    // Already in view at mount, or the observer is asleep: reveal regardless.
    if (el.getBoundingClientRect().top < window.innerHeight) {
      requestAnimationFrame(reveal);
    }
    const failOpen = window.setTimeout(reveal, 1200);

    return () => { io.disconnect(); window.clearTimeout(failOpen); };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(14px)",
        transition: `opacity .55s cubic-bezier(.22,1,.36,1) ${delay}ms, transform .55s cubic-bezier(.22,1,.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

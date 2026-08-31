import { useEffect, useRef, useState } from "react";
import { FileCheck, Lock, Send, Search, Scale } from "lucide-react";

const STEPS = [
  { icon: FileCheck, name: "create", pays: false,
    blurb: "The client states what done looks like. Those conditions are fixed here and cannot be edited afterwards." },
  { icon: Lock, name: "fund", pays: true,
    blurb: "Payment moves into escrow. The contract holds it, not us, and not the agent." },
  { icon: Send, name: "submit", pays: false,
    blurb: "The agent delivers, and commits to exactly what it delivered by hash." },
  { icon: Search, name: "check", pays: false,
    blurb: "The answer is matched against the shape the agent published before the job began." },
  { icon: Scale, name: "settle", pays: true,
    blurb: "Paid, or refunded. Either way the reason is written down and hashed on chain." },
];

/**
 * Scroll-driven stepper.
 *
 * The active step advances as the section moves through the viewport. Like
 * Reveal, this FAILS OPEN: every step is fully legible at all times and scroll
 * position only changes emphasis. If the listener never runs, the reader sees
 * five readable steps rather than one and four ghosts.
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
      // An unmeasurable viewport (hidden pane, zero-height embed) makes the
      // arithmetic below meaningless. Show every step as active rather than
      // leaving four of five dimmed on evidence we do not have.
      if (!vh || !r.height) { setActive(STEPS.length - 1); return; }
      // 0 when the block's top reaches 75% down the viewport,
      // 1 when its bottom passes 25% up it.
      const span = r.height + vh * 0.5;
      const travelled = vh * 0.75 - r.top;
      const p = Math.min(Math.max(travelled / span, 0), 1);
      setActive(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
    };

    // Measure SYNCHRONOUSLY, throttled by timestamp. Not requestAnimationFrame.
    //
    // The first version coalesced through rAF and guarded with `if (!frame)`.
    // rAF does not fire at all in a hidden or backgrounded tab, so `update`
    // never ran, `frame` never reset to zero, and every later scroll was
    // discarded — the stepper froze permanently and only a reload recovered it.
    //
    // Rescheduling instead of refusing fixes the deadlock but keeps the effect
    // hostage to frame scheduling, and it cannot be verified in a hidden tab.
    // One getBoundingClientRect per 50ms is cheap enough to just do inline, and
    // it behaves identically whether or not frames are being served.
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

  return (
    <div ref={ref}>
      {/* rail */}
      <div className="relative mb-8 hidden h-px w-full bg-line md:block">
        <div
          className="absolute inset-y-0 left-0 bg-blue transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
        <div className="absolute inset-0 flex justify-between">
          {STEPS.map((s, i) => (
            <span
              key={s.name}
              className={`-mt-[5px] size-2.5 rounded-full border transition-colors duration-300 ${
                i <= active
                  ? "border-blue bg-blue"
                  : "border-line-2 bg-ground"
              }`}
            />
          ))}
        </div>
      </div>

      <ol className="grid gap-3 md:grid-cols-5">
        {STEPS.map((s, i) => {
          const on = i <= active;
          const Icon = s.icon;
          return (
            <li
              key={s.name}
              className={`card p-5 transition-all duration-500 ${
                on ? "border-blue-line shadow-[0_10px_30px_-22px_rgb(47_111_216/.5)]" : ""
              }`}
              style={{ transform: on ? "translateY(0)" : "translateY(4px)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`grid size-7 place-items-center rounded-full transition-colors duration-300 ${
                    on ? "bg-blue text-white" : "bg-surface text-faint"
                  }`}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="label">0{i + 1}</span>
                {s.pays && (
                  <span className="ml-auto font-mono text-[0.6rem] uppercase tracking-wider text-blue-deep">
                    moves funds
                  </span>
                )}
              </div>
              <p className={`mt-3 font-mono text-sm transition-colors duration-300 ${on ? "text-ink" : "text-faint"}`}>
                {s.name}
              </p>
              <p className="mt-1.5 text-[0.82rem] leading-relaxed text-dim">{s.blurb}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

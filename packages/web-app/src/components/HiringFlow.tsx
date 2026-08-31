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

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import { Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useApi, fmt } from "../lib/api.ts";
import { Skeleton } from "./ui.tsx";

interface AgentCard {
  agentId: string;
  name: string | null;
  categories: string[];
  verifiedClass: string;
  score: { value: number; tier: string };
  signals: { provenance: { operatorHost: string | null } };
}
interface AgentsPage { results: AgentCard[]; total: number; filter: { hiddenByLiveFilter: number } }

/**
 * A floating preview of the real catalog, populated from the real index.
 *
 * The reference pages this is modelled on all show the product itself rather
 * than describing it. Rows here are live: if the index is unreachable the panel
 * shows its own empty state, because a marketplace whose entire claim is "we
 * only list what we checked" cannot put invented agents in its shop window.
 */
export function CatalogMock() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const state = useApi<AgentsPage>("/api/agents?perPage=5");

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // Rests flat and level. Scroll only eases the tilt out as it comes to centre.
  const rotate = useSpring(useTransform(scrollYProgress, [0, 0.5, 1], [7, 0.5, -4]), {
    stiffness: 90, damping: 22,
  });
  const lift = useSpring(useTransform(scrollYProgress, [0, 0.5], [40, 0]), {
    stiffness: 90, damping: 22,
  });

  const rows = state.status === "ready" ? state.data.results : [];

  return (
    <div ref={ref} style={{ perspective: 1400 }}>
      <motion.div
        className="mock overflow-hidden"
        style={{
          rotateX: reduce ? 0 : rotate,
          y: reduce ? 0 : lift,
          transformOrigin: "50% 100%",
        }}
      >
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-line bg-surface/70 px-5 py-3.5">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-line-2" />
            <span className="size-2.5 rounded-full bg-line-2" />
            <span className="size-2.5 rounded-full bg-line-2" />
          </div>
          <div className="ml-2 flex flex-1 items-center gap-2 rounded-full border border-line bg-ground px-3 py-1.5">
            <Search className="size-3.5 text-faint" />
            <span className="text-xs text-faint">Search agents by task</span>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-blue-line bg-blue-soft px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-wider text-blue-deep sm:inline-flex">
            <ShieldCheck className="size-3" /> verified only
          </span>
          <SlidersHorizontal className="size-4 shrink-0 text-faint" />
        </div>

        {/* rows */}
        <ul className="divide-y divide-line">
          {state.status === "failed" ? (
            <li className="px-5 py-10 text-center text-sm text-faint">
              The index is not responding, so there is nothing to show.
            </li>
          ) : rows.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </li>
            ))
          ) : (
            rows.map((a, i) => (
              <li
                key={a.agentId}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-blue-soft/50"
                style={{
                  // staggered only as a static offset, no gated animation
                  animationDelay: `${i * 60}ms`,
                }}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-soft font-mono text-[0.7rem] text-blue-deep">
                  {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {a.name?.trim() || `Agent ${a.agentId}`}
                  </p>
                  <p className="truncate font-mono text-[0.68rem] text-faint">
                    #{a.agentId}
                    {a.signals.provenance.operatorHost
                      ? ` · ${a.signals.provenance.operatorHost}`
                      : ""}
                  </p>
                </div>
                <span className="hidden items-center gap-1.5 rounded-full bg-blue-deep px-2.5 py-1 font-mono text-[0.62rem] text-white sm:inline-flex">
                  <ShieldCheck className="size-3" /> answered
                </span>
                <span className="w-9 text-right font-mono text-sm text-ink tnum">
                  {a.score.value}
                </span>
              </li>
            ))
          )}
        </ul>

        {/* honest footer: the hidden count is always visible */}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface/70 px-5 py-3">
          <span className="font-mono text-[0.68rem] text-faint">
            {state.status === "ready"
              ? `${fmt(state.data.total)} verified`
              : "loading"}
          </span>
          <span className="font-mono text-[0.68rem] text-faint">
            {state.status === "ready"
              ? `${fmt(state.data.filter.hiddenByLiveFilter)} hidden by this filter`
              : ""}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

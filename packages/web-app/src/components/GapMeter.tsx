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
        <div className="bg-accent-soft/50 p-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-[#04150C]">
            <span className="size-1.5 rounded-full bg-white" />
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em]">
              verified
            </span>
          </div>
          <p className="mt-5 font-mono text-4xl tracking-tight text-accent tnum md:text-5xl">
            {hireable === undefined ? <Skeleton className="h-10 w-28" /> : <Counter to={hireable} />}
          </p>
          <p className="mt-2 text-sm text-ink">Answered when we called them</p>
          <p className="mt-1 text-xs text-dim">What we list as hireable</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-line px-6 py-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-dim">True scale of the registry gap</p>
          <p className="font-mono text-xs text-accent tnum">
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

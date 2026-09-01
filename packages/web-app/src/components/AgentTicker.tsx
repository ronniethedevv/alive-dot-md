import { CheckCircle2 } from "lucide-react";
import { useApi, fmt } from "../lib/api.ts";
import { Marquee } from "./motion.tsx";

interface AgentCard {
  agentId: string;
  name: string | null;
  verifiedClass: string;
  score: { value: number; tier: string };
  signals: { provenance: { operatorHost: string | null; operatorAgentCount: number | null } };
}
interface AgentsPage { results: AgentCard[]; total: number }

/**
 * A live strip of agents that actually answered.
 *
 * Bound to GET /api/agents (verified-only by default), never to a fixture. If
 * the index is unreachable the strip renders nothing at all rather than
 * inventing plausible rows, which on this page would be the one unforgivable
 * lie: the whole argument is that we only list what we checked.
 */
export function AgentTicker() {
  const state = useApi<AgentsPage>("/api/agents?perPage=24");
  if (state.status !== "ready" || state.data.results.length === 0) return null;

  const rows = state.data.results;

  return (
    <div className="relative border-y border-line bg-surface/60 py-3">
      {/* edges fade so the loop has no visible seam */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ground to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ground to-transparent" />

      <Marquee speed={64}>
        {rows.map((a) => (
          <span
            key={a.agentId}
            className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-ground px-3.5 py-1.5"
          >
            <CheckCircle2 className="size-3.5 shrink-0 text-accent" />
            <span className="max-w-[16ch] truncate text-[0.82rem] text-ink">
              {a.name?.trim() || `Agent ${a.agentId}`}
            </span>
            <span className="font-mono text-[0.68rem] text-faint tnum">#{a.agentId}</span>
            <span className="font-mono text-[0.68rem] text-accent tnum">
              {a.score.value}
            </span>
          </span>
        ))}
      </Marquee>

      <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.16em] text-faint">
        {fmt(state.data.total)} agents answered when we called them
      </p>
    </div>
  );
}

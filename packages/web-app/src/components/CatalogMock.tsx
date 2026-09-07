import { Search } from "lucide-react";
import { useApi, fmt } from "../lib/api.ts";
import { Skeleton } from "./ui.tsx";

interface AgentCard {
  agentId: string;
  name: string | null;
  categories: string[];
  verifiedClass: string;
  score: { value: number; tier: string };
  live: { responseTimeMs: number | null };
  signals: { provenance: { operatorHost: string | null } };
}
interface AgentsPage { results: AgentCard[]; total: number; filter: { hiddenByLiveFilter: number } }

/**
 * A preview of the real catalog, populated from the real index.
 *
 * Rows here are live: if the index is unreachable the panel shows its own empty
 * state, because a marketplace whose entire claim is "we only list what we
 * checked" cannot put invented agents in its shop window.
 *
 * It used to float on a scroll-driven 3D tilt with a fake browser chrome and
 * traffic-light dots. That is a marketing device, and it made the product look
 * unlike itself: the rows in the picture had circular avatars and green pills
 * the actual catalog does not have. A preview of a tool should be indis-
 * tinguishable from the tool, so this is flat, still, and built from the same
 * row treatment as the real list.
 */
export function CatalogMock() {
  const state = useApi<AgentsPage>("/api/agents?perPage=5");
  const rows = state.status === "ready" ? state.data.results : [];

  return (
    <div className="mock">
      {/* Search affordance only, matching the real toolbar. No window chrome:
          the reader knows what a browser looks like. */}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Search className="size-3.5 shrink-0 text-faint" />
        <span className="text-[0.82rem] text-faint">
          Name, capability, interface or agent number
        </span>
      </div>

      <ul className="divide-rule">
        {state.status === "failed" ? (
          <li className="px-5 py-12 text-center text-[0.86rem] text-faint">
            The index is not responding, so there is nothing to show.
          </li>
        ) : rows.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3.5 px-4 py-3">
              <Skeleton className="size-8 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-2.5 w-48" />
              </div>
            </li>
          ))
        ) : (
          rows.map((a) => (
            <li key={a.agentId} className="flex items-center gap-3.5 px-4 py-3">
              <span className="avatar avatar-accent size-8 shrink-0 text-[0.72rem]">
                {(a.name?.trim()?.[0] ?? "A").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[0.88rem] font-medium text-ink">
                    {a.name?.trim() || `Agent ${a.agentId}`}
                  </p>
                  <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                </div>
                <p className="meta mt-0.5 truncate text-[0.72rem]">
                  {a.live.responseTimeMs !== null
                    ? `answered in ${a.live.responseTimeMs}ms`
                    : "answered when we called it"}
                  {a.signals.provenance.operatorHost
                    ? `  ·  ${a.signals.provenance.operatorHost}`
                    : ""}
                </p>
              </div>
              <span className="hidden shrink-0 text-[0.72rem] text-faint sm:block">
                {a.score.tier}
              </span>
            </li>
          ))
        )}
      </ul>

      {/* The hidden count is always visible, even in the shop window. */}
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <span className="meta text-[0.7rem]">
          {state.status === "ready" ? `${fmt(state.data.total)} verified` : "loading"}
        </span>
        <span className="meta text-[0.7rem]">
          {state.status === "ready"
            ? `${fmt(state.data.filter.hiddenByLiveFilter)} hidden by this filter`
            : ""}
        </span>
      </div>
    </div>
  );
}

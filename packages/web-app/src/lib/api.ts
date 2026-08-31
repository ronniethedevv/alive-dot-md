import { useEffect, useState } from "react";

export interface Stats {
  chainId: number;
  readAt: string;
  corpus: number;
  registrationsResolved: number;
  declaredClass: Record<string, number>;
  verifiedClass: Record<string, number>;
  verifiedClassOfMachine: Record<string, number>;
  hireable: number;
  firstParty: number;
  reputation: {
    agentsWithFeedback: number;
    distinctRaters: number;
    singleRaterAgents: number;
    highClosureAgents: number;
    ratedAgents: number;
    busiestRater: { rater: string; agents: number } | null;
  };
  topOperators: { host: string; agents: number }[];
}

type State<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  /** Rule 0 at the presentation layer: a failure is its own state. The UI must
   *  never fall back to placeholder numbers when the index is unreachable. */
  | { status: "failed"; message: string };

export function useApi<T>(path: string): State<T> {
  const [state, setState] = useState<State<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(path, { headers: { accept: "application/json" } });
        const body = await res.json();
        if (!res.ok || body?.error) throw new Error(body?.message ?? `HTTP ${res.status}`);
        if (live) setState({ status: "ready", data: body as T });
      } catch (e) {
        if (live) setState({ status: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { live = false; };
  }, [path]);
  return state;
}

export const fmt = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("en-US") : ", ";

export const pct = (a: number, b: number, dp = 1) =>
  b ? `${((a / b) * 100).toFixed(dp)}%` : ", ";

export const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/** The product's vocabulary. Raw enum values never reach the screen. */
/** Filled = we established it. Outlined = claimed or unknown. */
export const VERIFIED: Record<string, { label: string; tone: "verify" | "soft" | "claim" | "mute"; note: string }> = {
  "task-interface": { label: "Answered as a task interface", tone: "verify", note: "hireable" },
  infrastructure:   { label: "A payment rail, not a service", tone: "soft", note: "answers, nothing to commission" },
  "no-interface":   { label: "Answered, names no task URL", tone: "soft", note: "well formed, not hireable" },
  html:             { label: "Served a web page", tone: "claim", note: "a page for humans" },
  testnet:          { label: "Points at a test network", tone: "claim", note: "fixable deployment mistake" },
  dead:             { label: "Host answered with an error", tone: "claim", note: "declared but not there" },
  unreachable:      { label: "Could not be reached", tone: "mute", note: "DNS, TLS or timeout" },
  unprobed:         { label: "Not yet checked by us", tone: "mute", note: "never a verdict" },
};

export const DECLARED: Record<string, string> = {
  machine: "Declares a machine interface",
  "web-only": "Declares only a web page",
  template: "Declares a placeholder we cannot fill",
  none: "Declares no endpoint",
};

/** Section 8.1 AgentCard, exactly as the API serves it. */
export interface AgentCard {
  agentId: string;
  chainId: number;
  name: string | null;
  description: string | null;
  categories: string[];
  owner: string | null;
  declaredClass: string;
  verifiedClass: string;
  verifiedAt: string | null;
  x402Claimed: boolean;
  firstParty: boolean;
  live: {
    reachable: boolean;
    lastProbedAt: string | null;
    responseTimeMs: number | null;
    neverProbed: boolean;
  };
  score: { value: number; tier: string; ratingCount: number };
  signals: {
    provenance: {
      operatorHost: string | null;
      operatorAgentCount: number | null;
      sequentialIds: boolean | null;
    };
    concentration: {
      distinctRaters: number;
      ratingCount: number;
      topRaterSharePct: number | null;
      topRater: string | null;
    };
  };
}

export interface AgentsPage {
  results: AgentCard[];
  total: number;
  page: number;
  perPage: number;
  filter: {
    liveOnly: boolean;
    hiddenByLiveFilter: number;
    corpusResolved: number;
    corpusTotal: number;
  };
}

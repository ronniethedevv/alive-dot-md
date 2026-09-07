import { useEffect, useState } from "react";

export interface Stats {
  chainId: number;
  readAt: string;
  freshness: {
    lastProbeAt: string | null;
    highestAgentId: number | null;
    highestJobId: number | null;
  };
  paidAgents: number;
  provenAgents: number;
  kernel: {
    jobs: number; completed: number; submitted: number; rejected: number;
    expired: number; clients: number; providers: number;
    operators: number; operatorsPaid: number;
  };
  corpus: number;
  registrationsResolved: number;
  verifiedClass: Record<string, number>;
  tiers: Record<string, number>;
  hireable: number;
  firstParty: number;
  reputation: {
    agentsWithFeedback: number;
    distinctRaters: number;
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
  /**
   * The SUBJECT of this verdict is the URL, not the agent.
   *
   * It read "declared but not there", which is a claim about the agent and one
   * we cannot support. Ten TermiX agents were recorded `dead` because the
   * hostname in their registration has no backend routed to it - and every one
   * of them is served, right now, on that operator's main host. The endpoint
   * they published is broken; the agent is not. Saying the second when we
   * measured the first is the same error as the withdrawn 31 Aug disclosure,
   * one level down, and it is the third time this project has made it about
   * this operator.
   */
  dead:             { label: "Its published endpoint returns an error", tone: "claim", note: "the URL is broken; the agent may not be" },
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
  endpointHost: string | null;
  /** ISO date of on-chain registration. Null means undated, never "new". */
  registeredAt: string | null;
  serviceName: string | null;
  /**
   * Settlement record from the ERC-8183 commerce kernel, or null if this agent
   * has never taken paid work from anyone but itself.
   *
   * This is the only evidence in the product that money changed hands. A
   * `verifiedClass` of task-interface says an endpoint answered a call; this
   * says a stranger paid and the job settled.
   */
  record: {
    jobs: number;
    completed: number;
    rejected: number;
    clients: number;
    settledRaw: string;
    completionPct: number | null;
    /**
     * What this agent has actually been paid, from settled jobs on the kernel.
     *
     * `established` false means DO NOT PRINT A FIGURE - too little has settled
     * to claim a typical cost, and a made-up number in a payment screen is
     * worse than an honest blank.
     */
    pricing: {
      typicalRaw: string; typical: string;
      minRaw: string; maxRaw: string; min: string; max: string;
      jobs: number; freeJobs: number;
      established: boolean;
      suggestedRaw: string; suggested: string;
    } | null;
  } | null;
  score: {
    value: number;
    /** proven > live > declared > unproven. The claim; score orders within it. */
    tier: string;
    ratingCount: number;
    /** Ratings after inverse-breadth weighting. Near zero means they all came
     *  from raters who rate everything, which on this registry is most of them. */
    credibleRatings: number;
    topRaterBreadth: number | null;
  };
  signals: {
    provenance: {
      operatorHost: string | null;
      operatorAgentCount: number | null;
      /** Whether the count groups on the registration host or the answering
       *  one. They are different claims and the copy must not blur them. */
      operatorSource: "registration" | "endpoint" | null;
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
  /** Who operates the agents in THIS result set. §12 requires the provenance
   *  signal to be applied to our own front page, not only to other people's
   *  agents one detail screen at a time. */
  composition: {
    distinctOperators: number;
    topOperators: { host: string; n: number }[];
  };
}

export interface CategoriesPayload {
  readAt: string;
  /** Categories are matched against self-description. Carried in the payload so
   *  any consumer inherits the caveat, not just our own UI. */
  basis: string;
  categories: { id: string; label: string; agents: number; proven: number }[];
}

/** Latency, at the precision the number deserves. */
export const ms = (n: number) => (n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);

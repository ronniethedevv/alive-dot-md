// The §8.1 data contract. This file is the interface between the backend and
// the UI. Changing a shape here means changing ROADMAP.md §8.1, the §8.2 brief
// and the §8.3 handback checklist in the same commit — never just here.

export type JobState =
  | "open"
  | "funded"
  | "submitted"
  | "completed"
  | "rejected"
  /** Provider refused before submission. Neutral. NEVER counted as a failure. */
  | "declined"
  | "expired";

export type EvaluatorType = "onchain" | "schema" | "duplicate" | "timer";
export type Tier = "unproven" | "emerging" | "established";

/**
 * What the registration file CLAIMS (§4). A statement by the operator.
 *
 * - machine   — a non-"web" service with a concrete, structurally valid URL.
 *               Named `machine`, not `callable`: it claims an interface, it
 *               does not establish one.
 * - web-only  — declares only a human web page. No machine interface.
 * - template  — a URL that cannot resolve by construction: an unsubstituted
 *               "{agentId}", or an RFC 2606 reserved name. Intent, plus a bug.
 * - none      — no endpoint, non-conformant registration, or empty URI.
 *
 * `none` and `template` must never collapse into one state in the UI.
 */
export type DeclaredClass = "machine" | "web-only" | "template" | "none";

/**
 * What an independent probe FOUND (§4). The only axis that supports telling a
 * user they can hire someone. Of 212 declared-`machine` endpoints, 150 served
 * HTML and 7 were real task interfaces — so these two axes disagree by design,
 * and showing the disagreement is the product.
 *
 * - unprobed       — not yet checked. NOT a negative verdict; most of the
 *                    catalog is unprobed by design. Never render it as one.
 * - task-interface — live, mainnet, declares a task URL. Hireable.
 * - html           — answered with a web page. Declared machine, is not.
 * - testnet        — mainnet identity pointing at a testnet service. A fixable
 *                    deployment mistake, NOT an abandoned agent. Must read
 *                    differently from `dead`.
 * - dead           — host answered 4xx/5xx. Declared but not there.
 * - unreachable    — DNS/TLS/timeout. "We could not reach it" is our failure to
 *                    ask, and stays distinct from the host answering.
 */
export type VerifiedClass =
  | "unprobed" | "task-interface" | "html" | "testnet" | "dead" | "unreachable";

export interface AgentCard {
  agentId: string;
  chainId: number;
  name: string;
  description: string | null;
  /** Self-asserted. From OASF domains/skills when declared, else free text. */
  categories: string[];
  owner: string;
  declaredClass: DeclaredClass;
  verifiedClass: VerifiedClass;
  /** Null iff verifiedClass is "unprobed". */
  verifiedAt: string | null;
  /**
   * Claims x402 payment support but declares no endpoint to pay. Audited on the
   * sample: all 13 such agents published no URL of any kind, so this is a
   * capability claim with nowhere to send a request. NEVER treat as reachable.
   */
  x402Claimed: boolean;
  /**
   * Agents we registered and operate ourselves. MUST be visibly disclosed in
   * every place the agent appears — catalog row, detail page, job view.
   * A disclosure, not a quality badge. See ROADMAP §8.2 / §9 Days 3-4.
   */
  firstParty: boolean;
  live: {
    reachable: boolean;
    /** Null until probed. Most agents are never probed by design (§4). */
    lastProbedAt: string | null;
    responseTimeMs: number | null;
    neverProbed: boolean;
  };
  score: {
    /** 0-100 graded. No transfer discount in v1 — parked until backfill (§5). */
    value: number;
    tier: Tier;
    ratingCount: number;
  };
  signals: {
    /** 100% coverage, no indexer needed. The v1 headline signal. */
    provenance: {
      /** Null when self-hosted or registered inline rather than by an operator. */
      operatorHost: string | null;
      /** True count from the resolver pass. Never a sample extrapolation (§12). */
      operatorAgentCount: number | null;
      sequentialIds: boolean;
    };
    /** From getClients(). ~1.3% of agents have any data here. */
    concentration: {
      distinctRaters: number;
      /** Null when distinctRaters is 0. */
      topRaterSharePct: number | null;
    };
    // signals.transfers is deliberately absent in v1. It needs Transfer log
    // history, which needs the blocked backfill. Do not add a transfer badge.
  };
}

export interface FeedbackEntry {
  index: number;
  client: string;
  /** int128 on chain. Always a string, never a number. Signed. */
  value: string;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  /** Null in v1 — the reputation registry stores no timestamps (§3.10). */
  createdAt: string | null;
  revoked: boolean;
  responseCount: number;
}

export interface AgentDetail extends AgentCard {
  /** Null when declaredClass is "none". */
  endpoint: string | null;
  /** services[].name — "web" is not callable. */
  endpointServiceName: string | null;
  registrationFileValid: boolean;
  /** Null in v1 — needs the Registered log, which needs backfill. */
  identityCreatedAt: string | null;
  feedback: FeedbackEntry[];
  revokedCount: number;
}

export interface Job {
  jobId: string;
  state: JobState;
  agentId: string;
  /** token is always "U" — the ERC-8183 kernel's payment token is immutable. */
  budget: { amount: string; token: "U" };
  conditions: string;
  deadline: string;
  evaluatorType: EvaluatorType;
  reasonHash: string | null;
  reasonText: string | null;
  parentJobId: string | null;
  depth: number;
}

export interface AgentListResponse {
  results: AgentCard[];
  total: number;
  page: number;
}

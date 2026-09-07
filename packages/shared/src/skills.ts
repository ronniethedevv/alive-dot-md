// The words people actually use, mapped to the vocabulary the index speaks.
//
// THE PROBLEM THIS SOLVES, measured before it was written.
//
// `matchNeed` matches the user's sentence against RULES, which is a vocabulary
// built from what AGENTS wrote about themselves. Clients do not write like
// registrations. Five natural phrasings put through /api/match:
//
//   "Watch my Venus loan and warn me before I get liquidated"  -> risk, yield, monitoring
//   "stop me getting rekt on my loan"                          -> NOTHING
//   "I want to earn more on my BNB"                            -> NOTHING
//   "keep my pancakeswap position in range"                    -> NOTHING
//   "is this token a scam"                                     -> security
//
// Three of five opened onto an empty result. The third is the one that should
// sting: it is exactly Range Keeper and BNB LP Range Rebalancer - proven
// agents, in the catalog, with settled prices - and it is also the PancakeSwap
// partner challenge said the way a person would say it.
//
// The gap is RETRIEVAL, not ranking. `agent_trust` orders candidates well; the
// front door only opens for people who already speak the index's dialect.
//
// WHY THIS LAYER IS A TABLE AND NOT A MODEL.
//
// A model is the obvious reach and the wrong first move. Every mapping here is
// one a person can read, argue with, and test, and it costs nothing per query.
// The table fixes all three dead phrasings above. A model belongs AFTER this,
// for the long tail the table misses - and when it comes, its entire job is to
// emit ids that already exist in this file. See match.ts for why nothing that
// reads agent text is ever allowed near the ranking.

/** A protocol a client might name, and the terms that name it. */
export interface Protocol {
  id: string;
  label: string;
  any: string[];
  /** Categories this protocol implies, when the client names nothing else. */
  categories: string[];
}

/**
 * Named venues, because people say "Venus" and "Pancake" rather than "lending"
 * and "liquidity pool". Naming a protocol is a strong signal about the work,
 * and until now it carried none: "venus" reached Yield only by accident, via
 * the RULES term list, and "pancakeswap" reached nothing at all.
 */
export const PROTOCOLS: Protocol[] = [
  // Naming a venue is not a request for everything the venue does. PancakeSwap
  // implied `trading`, which is 132,718 agents and swamps any LP query with
  // generic swap bots. The narrower two are what someone naming Pancake
  // actually tends to want; if they say "swap" the SKILLS table adds trading on
  // its own evidence.
  { id: "pancakeswap", label: "PancakeSwap", categories: ["rebalancing", "yield-optimisation"],
    any: ["pancakeswap", "pancake swap", "pancake", "cake"] },
  { id: "venus", label: "Venus", categories: ["yield", "risk", "health-factor"],
    any: ["venus", "vtoken", "xvs"] },
  { id: "aave", label: "Aave", categories: ["yield", "risk", "health-factor"],
    any: ["aave"] },
  { id: "lista", label: "Lista", categories: ["yield"],
    any: ["lista", "slisbnb", "liquid staking"] },
  { id: "fourmeme", label: "Four.meme", categories: ["trading"],
    any: ["four.meme", "fourmeme", "four meme"] },
];

/**
 * Altana's ten production skills.
 *
 * These are the best capability vocabulary available to this project, and the
 * reason is that they name things an agent can EXECUTE rather than things it
 * can claim. §4 bars self-assertions from scoring precisely because a
 * description is free to say anything; a skill that resolves to a real call
 * against a real protocol is a different kind of statement.
 *
 * Deliberately NOT the OASF taxonomy. Its slugs
 * (`analytical_skills/market_insights`, `information_skills/news_synthesis`)
 * describe a field of activity, are identical across every agent one operator
 * publishes, and contain nothing about DeFi at all - which is why
 * build-categories.ts already excludes them from classification. Checked again
 * on 2026-09-06 against 8004scan's live skill stats: the top 60 skills by usage
 * contain no protocol, no venue, and no lending or liquidity term.
 */
export interface Skill {
  id: string;
  label: string;
  any: string[];
  categories: string[];
  protocol?: string;
}

export const SKILLS: Skill[] = [
  { id: "pancakeswap-liquidity", label: "PancakeSwap Liquidity", protocol: "pancakeswap",
    categories: ["rebalancing", "yield"],
    any: ["liquidity position", "lp position", "in range", "out of range", "range order",
      "concentrated liquidity", "provide liquidity", "lp range", "reposition"] },
  { id: "pancakeswap-trading", label: "PancakeSwap Trading", protocol: "pancakeswap",
    categories: ["trading"], any: ["swap", "swapping", "buy token", "sell token"] },
  { id: "venus-lending", label: "Venus Lending", protocol: "venus",
    categories: ["health-factor", "risk", "yield"],
    any: ["borrow", "borrowing", "collateral", "loan", "supply rate", "repay"] },
  { id: "aave-lending", label: "Aave V3 Lending", protocol: "aave",
    categories: ["health-factor", "risk", "yield"], any: ["aave", "v3 lending"] },
  { id: "lista-staking", label: "Lista Liquid Staking", protocol: "lista",
    categories: ["yield", "yield-optimisation"],
    any: ["stake", "staking", "liquid staking", "restake"] },
  { id: "copy-trade", label: "Copy Trade", categories: ["trading"],
    any: ["copy trade", "copy trading", "mirror", "follow a trader", "copy a wallet"] },
  { id: "token-radar", label: "Token Radar", categories: ["security", "prediction"],
    any: ["token radar", "new token", "rug", "rugpull", "honeypot", "is it safe",
      "scam", "screen a token", "due diligence"] },
  { id: "wallet-tracker", label: "Wallet Tracker", categories: ["monitoring", "analytics"],
    any: ["track a wallet", "watch a wallet", "whale", "wallet activity", "follow an address"] },
  { id: "fourmeme-trading", label: "Four.meme Trading", protocol: "fourmeme",
    categories: ["trading"], any: ["four.meme", "meme coin", "memecoin"] },
  // Grid is one of the four categories the brief names, and no Altana skill
  // covers it - so it is listed here as a capability the market has (four
  // proven agents) rather than one the SDK ships. The vocabulary is about what
  // clients ask for, not about who supplies it.
  { id: "grid-trading", label: "Grid Trading", categories: ["grid-trading", "trading"],
    any: ["grid", "grid bot", "grid order", "grid strategy", "ladder", "buy the dip automatically",
      "range trading", "dca", "dollar cost"] },
  { id: "x402-payments", label: "x402 API Payments", categories: ["payments"],
    any: ["x402", "pay per call", "api payment", "micropayment", "metered api"] },
];

/**
 * Colloquial to canonical.
 *
 * Every entry earns its place by being something a client would plausibly type
 * that the registration vocabulary has no word for. The left side is what
 * people say; the right side is terms RULES already knows, appended to the text
 * before matching so the existing matcher does the work unchanged.
 *
 * "rekt" is not slang worth being precious about - it is how a large share of
 * this market describes the exact event a health-factor agent exists to
 * prevent, and it matched nothing.
 */
export const SYNONYMS: { any: string[]; add: string[] }[] = [
  { any: ["rekt", "wiped out", "blown up", "get liquidated", "getting liquidated",
    "lose my collateral", "margin call"], add: ["liquidation", "health factor", "risk"] },
  { any: ["earn more", "make more", "better return", "better returns", "best return",
    "put my money to work", "idle funds", "grow my", "highest apr", "best apy",
    "where should i put"], add: ["yield", "apy", "yield optimisation"] },
  { any: ["in range", "out of range", "drifted", "out of band", "off balance",
    "back to target", "reset my position"], add: ["rebalance", "liquidity pool"] },
  { any: ["is it safe", "is this safe", "safe to buy", "legit", "trustworthy",
    "should i trust"], add: ["security", "audit", "scam"] },
  { any: ["keep an eye", "keep an eye on", "let me know if", "warn me", "tell me when",
    "ping me", "heads up"], add: ["monitor", "alert"] },
  { any: ["what should i buy", "when to buy", "when to sell", "entry point",
    "good entry"], add: ["signal", "prediction", "trading"] },
  { any: ["spread my", "too concentrated", "all in one", "diversify"],
    add: ["portfolio", "allocation", "diversif"] },
];

export interface Expansion {
  /** The original text plus canonical terms, for the existing matcher to read. */
  text: string;
  /** Protocols the client named, as ids. */
  protocols: { id: string; label: string }[];
  /** Skills the phrasing implies, as ids. */
  skills: { id: string; label: string }[];
  /** Categories implied by protocol or skill alone, when wording missed them. */
  impliedCategories: string[];
  /** Exactly what was added and why, so the UI can show its working. */
  added: { term: string; from: string }[];
}

/**
 * Case-insensitive term test. SINGLE WORDS NEED A BOUNDARY; PHRASES DO NOT.
 *
 * This was a plain `includes` and it produced exactly the failure this file
 * exists to fix, one layer down. "keep my pancakeswap position in range"
 * contains the substring "swap", so PancakeSwap TRADING fired on a liquidity
 * request, added the `trading` category, and widened the candidate set from a
 * handful of LP agents to all 132,718 agents claiming trading. Range Keeper and
 * BNB LP Range Rebalancer - the two proven agents the query is literally about
 * - were buried under generic swap bots.
 *
 * It is the same mistake build-categories.ts records against its own matcher,
 * where `_` counting as a word character let `governance_and_compliance` make
 * 177 trading agents claim Security & audit. A term list is only as good as
 * its boundaries.
 *
 * Multi-word terms keep substring semantics: "in range" should match inside
 * "position in range" and has no boundary problem to solve.
 */
const hit = (haystack: string, needle: string): boolean => {
  const t = needle.toLowerCase();
  if (/\s/.test(t)) return haystack.includes(t);
  // Escape regex metacharacters - real terms include "four.meme".
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9_])${esc}(?![a-z0-9_])`, "i").test(haystack);
};

/**
 * Widen a client's sentence into the index's vocabulary.
 *
 * Deterministic, table-driven and side-effect free: the same sentence always
 * expands the same way, which is what makes it testable and what keeps it out
 * of the class of things that can quietly change their mind about a ranking.
 */
export function expandNeed(need: string): Expansion {
  const lower = (need ?? "").toLowerCase();
  const added: { term: string; from: string }[] = [];
  const impliedCategories = new Set<string>();

  const protocols = PROTOCOLS
    .filter((p) => p.any.some((t) => hit(lower, t)))
    .map((p) => {
      p.categories.forEach((c) => impliedCategories.add(c));
      return { id: p.id, label: p.label };
    });

  const skills = SKILLS
    .filter((s) =>
      s.any.some((t) => hit(lower, t))
      // A named protocol alone does not claim a skill: "pancakeswap" is not
      // "manage my pancakeswap liquidity". The skill needs its own phrasing,
      // or it needs the protocol AND a category the protocol implies.
      || (s.protocol != null && protocols.some((p) => p.id === s.protocol)
        && s.any.some((t) => hit(lower, t))))
    .map((s) => {
      s.categories.forEach((c) => impliedCategories.add(c));
      return { id: s.id, label: s.label };
    });

  for (const syn of SYNONYMS) {
    const found = syn.any.find((t) => hit(lower, t));
    if (found) for (const term of syn.add) added.push({ term, from: found });
  }

  // Protocol and skill labels join the text too, so an agent describing itself
  // as "PancakeSwap LP manager" is reachable from "keep my pancake position in
  // range" through the ordinary matcher rather than a special case.
  for (const p of protocols) added.push({ term: p.label, from: p.label });
  for (const s of skills) added.push({ term: s.label, from: s.label });

  const text = added.length ? `${need} ${added.map((a) => a.term).join(" ")}` : need;
  return { text, protocols, skills, impliedCategories: [...impliedCategories], added };
}

// The category vocabulary. ONE definition, imported by the indexer that assigns
// them, the API that filters on them, and the UI that names them - so a label
// cannot drift from the rule that produced it.
//
// These are CLAIMS matched against what an agent says about itself. §4 bars
// self-assertions from SCORING; navigation is a different job, and the UI
// labels these as self-described.
//
// The vocabulary was measured rather than imagined. Raw term frequency over the
// corpus is useless - one operator's 102,886 identical registrations put
// "trading" and "multi-chain" at the top of any naive count - so these were
// built from frequencies over DISTINCT description texts among agents in the
// proven/live/declared tiers, which is what people actually wrote.
//
// The four the hackathon names as reference (monitoring, grid trading, health
// factor, yield) all map onto rules here, and deliberately are not the only
// ones: a marketplace that can only describe DeFi is a DeFi directory. Half of
// these are domain-neutral.

export interface Rule {
  id: string;
  label: string;
  /** Terms that claim the category. One hit is enough. */
  any: string[];
}

export const RULES: Rule[] = [
  // ── the four the brief names, first-class and first in the list ────────
  //
  // These are ADDITIVE, not a replacement for the general vocabulary below,
  // and the argument for that vocabulary still stands: a marketplace that can
  // only describe DeFi is a DeFi directory.
  //
  // But the four reference categories were only reachable through general
  // labels - grid trading sat inside "Trading" alongside 132,718 agents,
  // rebalancing inside "Portfolio", health factor split across "Risk &
  // liquidation" and "Monitoring" - so a visitor looking for exactly these
  // four could not click to any of them. The catalog held Grid Trader, Range
  // Keeper, Health Factor Monitor and BNB LP Range Rebalancer, all with
  // completed paid work, and no filter named what they do.
  //
  // Categories are multi-label by design, so these overlap the general ones
  // deliberately. An agent is both "Yield" and "Yield Optimisation"; naming
  // the second costs nothing and is the difference between a visitor finding
  // it and not.
  {
    id: "rebalancing", label: "Rebalancing",
    // Inflections listed explicitly - the matcher is exact-term with word
    // boundaries, so "rebalance" does not imply "rebalancing".
    any: ["rebalance", "rebalances", "rebalancing", "rebalancer", "re-balance",
      "lp range", "range keeper", "range manager", "range order", "reposition",
      "repositioning", "re-range", "reranging", "position range", "liquidity range",
      "tick range", "concentrated liquidity", "out of range", "in-range", "lp position",
      "reset position", "reset ranges", "drift"],
  },
  {
    id: "grid-trading", label: "Grid Trading",
    any: ["grid", "grid trading", "grid bot", "grid order", "grid orders",
      "grid strategy", "grid trader", "grid planner", "grid levels", "grid spacing",
      "ladder order", "laddering"],
  },
  {
    id: "yield-optimisation", label: "Yield Optimisation",
    any: ["yield", "yields", "yield optimisation", "yield optimization",
      "yield optimiser", "yield optimizer", "yield scout", "yield ranking",
      "yield aggregat", "yield allocator", "best yield", "highest yield",
      "highest apr", "highest apy", "best apr", "best apy", "apr", "apy",
      "yield farming", "auto-compound", "autocompound", "route liquidity",
      "supply rate", "optimal allocation"],
  },
  {
    id: "health-factor", label: "Health Factor Monitoring",
    any: ["health factor", "healthfactor", "health report", "position health",
      "liquidation risk", "liquidation threshold", "liquidatable", "at_risk",
      "collateral ratio", "collateralisation", "collateralization", "ltv",
      "loan to value", "margin call", "shortfall", "venus position",
      "aave position", "lending position", "position monitor", "undercollateralised",
      "undercollateralized"],
  },

  // ── markets and capital ────────────────────────────────────────────────
  {
    id: "trading", label: "Trading",
    any: ["trading", "trade", "trader", "dca", "grid", "swap", "swaps", "market maker",
      "market-making", "momentum", "arbitrage", "limit order", "orderbook", "order book",
      "spot", "perp", "perpetual", "position sizing", "entry", "exit"],
  },
  {
    id: "yield", label: "Yield",
    any: ["yield", "apy", "apr", "vault", "vaults", "staking", "stake", "farming",
      "farm", "lending", "lend", "borrow", "supply rate", "venus", "aave", "beefy",
      "compound", "pendle", "liquidity pool", "lp "],
  },
  {
    id: "risk", label: "Risk & liquidation",
    // Inflections are listed explicitly rather than stemmed. A stemmer would
    // fire "liquid" on liquidity pools, which is a different category entirely.
    any: ["health factor", "healthfactor", "liquidation", "liquidate", "liquidated",
      "at risk", "undercollateralised", "undercollateralized", "collateral",
      "margin", "solvency", "drawdown", "risk profile", "risk score", "exposure",
      "stress test", "var ", "hedge"],
  },
  {
    id: "portfolio", label: "Portfolio",
    any: ["portfolio", "rebalance", "rebalancing", "allocation", "allocator",
      "diversif", "index", "basket", "weighting", "hrp", "asset mix"],
  },
  {
    id: "payments", label: "Payments",
    any: ["payment", "payments", "x402", "stablecoin", "invoice", "billing",
      "gasless", "escrow", "settle", "settlement", "remittance", "checkout",
      "subscription", "micropayment"],
  },
  {
    id: "bridging", label: "Bridging",
    any: ["bridge", "bridging", "cross-chain", "crosschain", "cross chain",
      "interoperab", "router", "relayer", "omnichain"],
  },

  // ── watching things ────────────────────────────────────────────────────
  {
    id: "monitoring", label: "Monitoring",
    any: ["monitor", "monitoring", "alert", "alerts", "alerting", "watch", "watcher",
      "uptime", "liveness", "heartbeat", "notify", "notification", "track", "tracking",
      "surveillance", "observability", "ping"],
  },
  {
    id: "analytics", label: "Data & analytics",
    any: ["analytics", "analysis", "analyse", "analyze", "metrics", "dashboard",
      "oracle", "insight", "insights", "statistics", "aggregat", "census", "benchmark",
      "report", "reporting", "dataset", "etl", "query"],
  },
  {
    id: "prediction", label: "Prediction & signals",
    any: ["predict", "prediction", "forecast", "forecasting", "signal", "signals",
      "sentiment", "probability", "odds", "trend", "backtest", "model score"],
  },

  // ── building and defending software ────────────────────────────────────
  {
    id: "security", label: "Security & audit",
    any: ["security", "audit", "auditing", "auditor", "vulnerability", "exploit",
      "threat", "malicious", "scam", "phishing", "rug", "honeypot", "penetration",
      "static analysis", "shield", "firewall", "compliance", "kyc", "aml"],
  },
  {
    id: "development", label: "Code & development",
    any: ["code", "coding", "developer", "development", "programming", "refactor",
      "debug", "github", "repository", "pull request", "unit test", "compile",
      "deploy", "devops", "sdk", "api integration", "solidity", "smart-contract",
      "smart contract"],
  },
  {
    id: "automation", label: "Automation & workflow",
    any: ["automation", "automate", "workflow", "orchestrat", "scheduler",
      "scheduling", "cron", "pipeline", "trigger", "batch job", "task runner",
      "ops", "runbook", "integration"],
  },

  // ── words and pictures. Nothing crypto about these. ─────────────────────
  {
    id: "research", label: "Research",
    any: ["research", "researcher", "literature", "summarise", "summarize",
      "summary", "due diligence", "fact check", "fact-check", "investigat",
      "intelligence", "briefing", "survey", "citation"],
  },
  {
    id: "content", label: "Content & writing",
    any: ["content", "writing", "writer", "copywrit", "blog", "article", "newsletter",
      "editorial", "ghostwrit", "caption", "seo", "translation", "translate",
      "proofread", "social post", "tweet", "thread"],
  },
  {
    id: "media", label: "Media & design",
    any: ["image", "images", "video", "audio", "voice", "speech", "design",
      "designer", "avatar", "artwork", "illustration", "render", "animation",
      "logo", "thumbnail", "music", "art "],
  },
  {
    id: "support", label: "Support & assistants",
    any: ["assistant", "support", "helpdesk", "customer service", "chatbot",
      "chat bot", "faq", "onboarding", "concierge", "companion", "tutor",
      "coaching", "advisor"],
  },
  {
    id: "gaming", label: "Gaming & social",
    any: ["game", "gaming", "player", "quest", "arena", "sports", "esports",
      "leaderboard", "tournament", "community", "vote", "voting", "governance",
      "dao ", "social graph", "meme"],
  },
];

/** id -> human label, for anything that only needs to name a category. */
export const CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(RULES.map((r) => [r.id, r.label]));

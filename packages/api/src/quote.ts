// Ask an agent what it charges.
//
// ERC-8183 defines a negotiation round: the client sends requirements, the
// provider returns a price or refuses with a coded reason. This proxies that
// round so the UI can quote before anything touches the chain.
//
// Why this exists at all: without it a client invents a budget, funds a job,
// and discovers the provider's floor by having the job rejected. They have then
// paid gas to learn a number the provider was willing to publish.

import { isFetchable } from "./verify-now.ts";

/** ERC-8183 rejection codes, and what they mean to someone who is not reading the spec. */
export const REASON_TEXT: Record<string, string> = {
  "0x01": "Your budget is below what this agent charges",
  "0x02": "The deadline is too tight for this work",
  "0x03": "This agent cannot do that task",
  "0x04": "The task needs to be clearer before it can be priced",
  "0x05": "This agent is busy",
  "0x06": "This agent does not support that request",
  "0x07": "The task description is too long",
};

export interface Quote {
  /** Did the agent give a price. */
  quoted: boolean;
  /** Set when quoted. Raw 18 decimal units. */
  priceWei?: string;
  price?: string;
  currency?: string;
  quoteExpiresAt?: number;
  terms?: unknown;
  /** Set when refused, or when the agent has no negotiation endpoint. */
  reasonCode?: string;
  reason?: string;
  /** True when the agent simply does not implement negotiation. */
  unsupported?: boolean;
}

const UA = "alive-quote/1.0 (ERC-8183 negotiation; contact via repo)";

async function post(url: string, body: unknown, ms = 12_000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const text = (await res.text()).slice(0, 100_000);
  return { res, text };
}

async function get(url: string, ms = 10_000) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
  const text = (await res.text()).slice(0, 100_000);
  return { res, text };
}

/**
 * Find the agent's negotiation endpoint and ask it for a price.
 *
 * Most agents on this registry implement no negotiation at all. That is a
 * normal answer, not a failure: we report `unsupported` so the UI can ask the
 * client to propose a figure instead, and say plainly that it might be refused.
 */
export async function getQuote(
  endpoint: string | null,
  task: string,
  conditions: string,
  budgetWei?: string,
): Promise<Quote> {
  if (!endpoint) {
    return { quoted: false, unsupported: true, reason: "This agent publishes no endpoint to ask." };
  }
  const guard = isFetchable(endpoint);
  if (!guard.ok) return { quoted: false, unsupported: true, reason: guard.why };

  // The card may advertise a negotiate URL, which is the direct route.
  let negotiateUrl: string | null = null;
  try {
    const { res, text } = await get(endpoint);
    if (res.ok) {
      const card = JSON.parse(text);
      const advertised = card?.pricing?.negotiate;
      if (typeof advertised === "string") negotiateUrl = advertised;
      // A card that states a flat price without a negotiation endpoint is still
      // a published price, and is better than nothing.
      else if (card?.pricing?.priceWei) {
        return {
          quoted: true,
          priceWei: String(card.pricing.priceWei),
          price: String(card.pricing.price ?? ""),
          currency: String(card.pricing.currency ?? "U"),
        };
      }
    }
  } catch { /* fall through to the conventional path */ }

  if (!negotiateUrl) {
    return {
      quoted: false,
      unsupported: true,
      reason: "This agent does not publish a price or a way to ask for one.",
    };
  }

  const negGuard = isFetchable(negotiateUrl);
  if (!negGuard.ok) return { quoted: false, unsupported: true, reason: negGuard.why };

  try {
    const { res, text } = await post(negotiateUrl, { task, conditions, budgetWei });
    if (!res.ok) {
      return { quoted: false, unsupported: true,
        reason: `The agent's pricing endpoint answered http ${res.status}.` };
    }
    const q = JSON.parse(text);

    if (q?.accepted === true && q?.priceWei) {
      return {
        quoted: true,
        priceWei: String(q.priceWei),
        price: String(q.price ?? ""),
        currency: String(q.currency ?? "U"),
        quoteExpiresAt: typeof q.quoteExpiresAt === "number" ? q.quoteExpiresAt : undefined,
        terms: q.terms,
      };
    }

    // A refusal is an answer. Prefer the agent's own words, fall back to ours.
    const code = typeof q?.reasonCode === "string" ? q.reasonCode : undefined;
    return {
      quoted: false,
      reasonCode: code,
      reason: String(q?.reason ?? (code && REASON_TEXT[code]) ?? "The agent declined to quote."),
      priceWei: q?.priceWei ? String(q.priceWei) : undefined,
      price: q?.price ? String(q.price) : undefined,
    };
  } catch (e: any) {
    return {
      quoted: false,
      unsupported: true,
      reason: e?.name === "TimeoutError"
        ? "The agent did not answer in time."
        : "The agent's pricing endpoint could not be reached.",
    };
  }
}

// Selling the concierge to machines, per x402.
//
// WHY METER THIS AT ALL, AND WHY NOT THE OBVIOUS THINGS.
//
// Charging a person to search would be the wrong move twice: it is the top of
// the funnel, and a marketplace nobody can browse is not discovered. Taking a
// cut of the hire is not available either - `platformFeeBP()` is 0 on the
// commerce kernel and `setPlatformFee` is owner-gated to an address that is not
// ours (§10). So the fee cannot sit on the human path or on the escrow.
//
// It sits where the value actually is: an AGENT calling this concierge
// programmatically. TermiX's premise is agents hiring agents, and an agent that
// wants a ranked, evidence-backed shortlist of who can do a job is buying
// something real. x402 is built for exactly that shape - pay per call, settle
// before the work - so it cannot run at a loss the way a subscription can.
//
// HUMANS ARE FREE. The gate only closes on callers that ask to be metered.
//
// STATUS, STATED PLAINLY: the challenge half is complete and correct against
// the x402 spec. The VERIFY half needs a facilitator, and b402's is not
// reachable from documentation right now - `facilitator.b402.ai` (recorded in
// DAY0-FINDINGS §5) no longer resolves at all, its replacement
// `facilitatorv3.b402.ai` answers only at `/`, and every documented route name
// 404s there. Guessing further was stopped deliberately: probing an operator's
// URL space is exactly how the withdrawn TermiX disclosure happened.
//
// So the facilitator is configuration, not a constant. Set X402_FACILITATOR and
// verification switches on; leave it unset and the endpoint stays free, which
// is the correct failure direction for a payment gate - it never charges for
// work it cannot confirm it was paid for, and never refuses work it could not
// bill.

/** Raw 18-decimal units of U. Kept as a string; these overflow a Number. */
export const PRICE_RAW = process.env.X402_PRICE_RAW ?? "1000000000000000";  // 0.001 U

/** Where U settles. Immutable on the kernel, so it is not a choice. */
const PAY_TO = process.env.X402_PAY_TO ?? "";
const U_TOKEN = "0xcE24439F2D9C6a2289F741120FE202248B666666";
const FACILITATOR = process.env.X402_FACILITATOR ?? "";

/** Metering is off unless someone has said where the money goes. */
export const enabled = () => PAY_TO !== "";

/**
 * Does this caller want to be billed?
 *
 * Deliberately opt-in rather than sniffed from a User-Agent. Guessing whether a
 * caller is a bot and charging it if so would bill the wrong party sooner or
 * later, and a browser that gets a surprise 402 is a broken product. An agent
 * integrating on purpose sends the header.
 */
export function wantsMetered(headers: Record<string, unknown>): boolean {
  const h = (k: string) => String(headers[k] ?? "").toLowerCase();
  return h("x-payment") !== "" || h("x-402") === "1" || h("x-metered") === "1";
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
}

/** The body of a 402, per the x402 spec: what we accept, and for what. */
export function requirements(resource: string): { x402Version: number; accepts: PaymentRequirements[] } {
  return {
    x402Version: 1,
    accepts: [{
      scheme: "exact",
      network: "bsc",
      maxAmountRequired: PRICE_RAW,
      resource,
      description: "Ranked agent shortlist with on-chain settlement evidence",
      mimeType: "application/json",
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      asset: U_TOKEN,
      extra: { name: "United Stables", version: "1" },
    }],
  };
}

export interface Settlement { ok: boolean; reason: string; txHash?: string }

/**
 * Verify a presented payment with the facilitator.
 *
 * FAIL OPEN, and that is a considered choice rather than laziness. This gate
 * guards a READ - a ranked list built from public chain data. The cost of
 * wrongly serving one free shortlist is a fraction of a cent; the cost of
 * wrongly refusing a paying agent mid-integration is the integration. A gate in
 * front of a withdrawal would fail closed, and this is not that.
 */
export async function verify(payment: string, resource: string): Promise<Settlement> {
  if (!FACILITATOR) {
    return { ok: true, reason: "no facilitator configured - served free, not billed" };
  }
  try {
    const res = await fetch(`${FACILITATOR.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: payment,
        paymentRequirements: requirements(resource).accepts[0],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, reason: `facilitator answered http ${res.status}` };
    const j: any = await res.json();
    return j?.isValid || j?.valid
      ? { ok: true, reason: "verified", txHash: j?.txHash ?? j?.transaction }
      : { ok: false, reason: String(j?.invalidReason ?? j?.reason ?? "payment not valid") };
  } catch (e: any) {
    // Our inability to reach the facilitator is our problem, not the caller's.
    // Rule 0, applied to money: a failure is never recorded as the caller's fault.
    return { ok: true, reason: `facilitator unreachable (${String(e?.name)}) - served free` };
  }
}

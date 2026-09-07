// The schema-check evaluator.
//
// §6 routes "output has a declared shape" to a contract-style shape check, and
// it is the cheapest honest evaluator available: no timer, no UMA bond, no
// human reading deliverables. Our first-party agents publish an `outputSchema`
// per skill precisely so this path is usable on them.
//
// §6 also requires the reason hash to be published on EVERY terminal state.
// That requirement exists because we are the evaluator on most jobs, and an
// unaccountable evaluator holding the escrow is the obvious criticism of this
// design. The answer is not "trust us": it is that every verdict commits to a
// document stating the inputs, the rule applied and the outcome, hashed on
// chain at settlement, so anyone can check afterwards that the reasoning
// matches what was paid.

import { keccak256 } from "./keccak.ts";

export type Verdict = "pass" | "fail";

export interface Finding {
  path: string;
  problem: string;
}

export interface Evaluation {
  verdict: Verdict;
  findings: Finding[];
  /** Canonical JSON. This is the document the hash commits to. */
  reasonDocument: string;
  /** bytes32 for complete()/reject(). */
  reasonHash: `0x${string}`;
}

type Schema = Record<string, any>;

/**
 * JSON Schema subset: the keywords our agents actually publish. Deliberately
 * small — an evaluator nobody can read is not more trustworthy than a timer.
 */
function check(value: unknown, schema: Schema, path = "$"): Finding[] {
  const out: Finding[] = [];
  if (!schema || typeof schema !== "object") return out;

  if (schema.enum) {
    if (!schema.enum.includes(value as any)) {
      out.push({ path, problem: `expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` });
    }
    return out;
  }

  const types: string[] = schema.type
    ? (Array.isArray(schema.type) ? schema.type : [schema.type])
    : [];
  if (types.length) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const ok = types.some((t) =>
      t === actual
      || (t === "integer" && typeof value === "number" && Number.isInteger(value))
      || (t === "number" && typeof value === "number"));
    if (!ok) {
      out.push({ path, problem: `expected type ${types.join("|")}, got ${actual}` });
      return out; // further checks would be noise once the type is wrong
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      out.push({ path, problem: `expected >= ${schema.minimum}, got ${value}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      out.push({ path, problem: `expected <= ${schema.maximum}, got ${value}` });
    }
  }

  if (typeof value === "string" && schema.pattern) {
    if (!new RegExp(schema.pattern).test(value)) {
      out.push({ path, problem: `does not match /${schema.pattern}/` });
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) out.push({ path: `${path}.${key}`, problem: "required field is missing" });
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) out.push(...check(obj[key], sub as Schema, `${path}.${key}`));
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => out.push(...check(v, schema.items, `${path}[${i}]`)));
  }

  return out;
}

/**
 * Canonical JSON: keys sorted at every level, no incidental whitespace.
 *
 * The hash goes on chain and the document is published beside it, so two
 * parties must be able to derive the same digest from the same facts. Ordinary
 * JSON.stringify preserves insertion order, which would make the hash depend on
 * how the object happened to be built.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export interface EvaluateInput {
  jobId: string;
  agentId: string;
  skill: string;
  /** The schema the agent published BEFORE the job — not one supplied with the result. */
  outputSchema: Schema;
  /** What the provider delivered. */
  result: unknown;
  /** Conditions locked at job creation (§6). Recorded, not re-interpreted. */
  conditions?: string;
}

/**
 * Evaluate a delivery. Pure and deterministic: the same inputs always produce
 * the same reason hash, which is what makes the published document checkable.
 */
export function evaluate(input: EvaluateInput): Evaluation {
  const findings = check(input.result, input.outputSchema);
  const verdict: Verdict = findings.length === 0 ? "pass" : "fail";

  const doc = {
    schemaVersion: "alive.md/evaluation/1",
    jobId: input.jobId,
    agentId: input.agentId,
    skill: input.skill,
    evaluator: "schema",
    conditions: input.conditions ?? null,
    // The schema is included in full: a verdict is only checkable against the
    // rule that produced it, and an agent could otherwise publish a different
    // schema later and make a past verdict unverifiable.
    outputSchema: input.outputSchema,
    result: input.result,
    verdict,
    findings,
  };
  const reasonDocument = canonical(doc);
  return { verdict, findings, reasonDocument, reasonHash: keccak256(reasonDocument) };
}

/**
 * Which contract call a verdict implies.
 *
 * `fail` maps to `reject`, which refunds the client — NOT to a "failed
 * delivery" score. §6's refusal state and a failed shape check are different
 * events that share one contract function, and the distinction lives in our
 * data model (§8.1 `declined` vs `rejected`), never in the chain.
 */
export function settlementFor(v: Verdict): "complete" | "reject" {
  return v === "pass" ? "complete" : "reject";
}

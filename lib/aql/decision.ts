// Accept or reject a sample, the default AQLs, and the labelling plan, which
// never depends on the sample: Accept 0 / Reject 1 (BUILD_SPEC 6.1 and 7).
import type { AcceptanceLimits, Aql, Decision } from "./schema";

/** Limits alone, as for labelling, or an engine plan, which also carries the sample it needs. */
export interface DecisionPlan extends AcceptanceLimits {
  /** The sample the plan needs. Without it the limits decide alone. */
  n?: number;
  /** Items inspected. Against an n, a sample that is not known never accepts. */
  sampleSize?: number | null;
  /** A lot plan's lot: a lot no larger than n is inspected in full. */
  lotSize?: number;
}

/**
 * Accept with at most Ac defects found; reject at Re (Ac + 1) or more. A
 * sample short of the plan's n (an arrow down, or below the lot's plan)
 * cannot accept, because the items not inspected may hold more defects; it
 * can still reject, because defects only add up. Otherwise it is incomplete.
 */
export function decide(defects: number, plan: DecisionPlan): Decision {
  if (!isCount(defects, 0)) {
    throw new RangeError(`Defects found must be a whole number of at least 0, got ${defects}`);
  }
  const { ac, re, n, lotSize } = plan;
  const sampleSize = plan.sampleSize ?? null;
  if (!isCount(ac, 0) || re !== ac + 1) {
    throw new RangeError(`Not a single sampling plan: Accept ${ac}, Reject ${re}`);
  }
  if (n !== undefined && !isCount(n, 1)) throw new RangeError(`Not a sample size: n ${n}`);
  if (sampleSize !== null && !isCount(sampleSize, 0)) throw new RangeError(`Not a sample size: ${sampleSize}`);
  if (lotSize !== undefined && !isCount(lotSize, 1)) throw new RangeError(`Not a lot size: ${lotSize}`);

  if (defects >= re) return "reject";
  if (n === undefined) return "accept";
  return sampleSize !== null && sampleSize >= Math.min(n, lotSize ?? n) ? "accept" : "incomplete";
}

function isCount(value: number, min: number): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

/** Labelling, at every level and whatever the number inspected: Accept 0 / Reject 1. */
export function labelingPlan(): AcceptanceLimits {
  return { ac: 0, re: 1 };
}

/** AQL defaults; a template or client can set others. Critical 0 is Accept 0 / Reject 1. */
export const DEFAULT_AQL = {
  watertight: 1.5,
  critical: 0,
  major: 2.5,
  minor: 4.0,
} as const satisfies Readonly<Record<string, Aql>>;

export type AqlCheck = keyof typeof DEFAULT_AQL;

/** The defaults with a template's or client's AQLs on top; an override left undefined keeps the default. */
export function resolveAqls(overrides: Partial<Record<AqlCheck, Aql>> = {}): Record<AqlCheck, Aql> {
  const resolved: Record<AqlCheck, Aql> = { ...DEFAULT_AQL };
  for (const check of Object.keys(DEFAULT_AQL) as AqlCheck[]) {
    const aql = overrides[check];
    if (aql !== undefined) resolved[check] = aql;
  }
  return resolved;
}

// Accept or reject a sample, the default AQLs, and the labelling plan, which
// never depends on the sample: Accept 0 / Reject 1 (BUILD_SPEC 6.1 and 7).
import type { AcceptanceLimits, Aql } from "./schema";

export type Decision = "accept" | "reject";

/** Accept with at most Ac defects found; reject at Re (Ac + 1) or more. */
export function decide(defects: number, limits: AcceptanceLimits): Decision {
  if (!Number.isSafeInteger(defects) || defects < 0) {
    throw new RangeError(`Defects found must be a whole number of at least 0, got ${defects}`);
  }
  if (!Number.isSafeInteger(limits.ac) || limits.ac < 0 || limits.re !== limits.ac + 1) {
    throw new RangeError(`Not a single sampling plan: Accept ${limits.ac}, Reject ${limits.re}`);
  }
  return defects <= limits.ac ? "accept" : "reject";
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

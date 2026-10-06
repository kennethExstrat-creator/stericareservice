// AQLs, counts and plans as the standard and the reports print them, for
// messages and labels.
import type { TablePlan } from "./lookup";
import type { Aql } from "./schema";
import { SAMPLE_SIZES, type CodeLetter } from "./tables";

/** An AQL as ISO 2859-1 prints it: 0.010, 0.10, 1.0, 4.0, 10. Critical (0) prints as 0. */
export function formatAql(aql: Aql): string {
  if (aql === 0) return "0";
  if (aql < 0.1) return aql.toFixed(3);
  if (aql < 1) return aql.toFixed(2);
  if (aql < 10) return aql.toFixed(1);
  return String(aql);
}

/** A count with thousands separators: 120000 as "120,000". */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * One line for a plan, naming the arrow when one was followed, e.g.
 * "Code letter N (n 500), AQL 4.0: arrow up to code letter M (n 315), Accept 21, Reject 22."
 */
export function describePlan(plan: TablePlan & { codeLetter: CodeLetter; aql: Aql }): string {
  const entry = `Code letter ${plan.codeLetter} (n ${formatCount(SAMPLE_SIZES[plan.codeLetter])}), AQL ${formatAql(plan.aql)}`;
  const limits = `Accept ${plan.ac}, Reject ${plan.re}.`;
  if (plan.arrow === null) return `${entry}: ${limits}`;
  return `${entry}: arrow ${plan.arrow} to code letter ${plan.usedLetter} (n ${formatCount(plan.n)}), ${limits}`;
}

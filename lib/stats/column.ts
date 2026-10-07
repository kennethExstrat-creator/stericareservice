// The computed footer of one measurement column: statistic, spec outcome.
import { checkSpec, type Spec } from "./spec";
import { roundTo, statistic, type StatisticKind } from "./statistics";

export type ColumnOutcome = "pass" | "fail" | "na" | "not_done";

export type ColumnSummary = {
  /** Values entered so far. */
  count: number;
  /** Median or average of the entered values; null until there is one. */
  statistic: number | null;
  /** Every row has a value. */
  complete: boolean;
  /**
   * Pass or fail only once the column is complete (BUILD_SPEC 6.2 rule 5:
   * missing data is "Not Done", never "Passed"); "na" without a spec.
   */
  outcome: ColumnOutcome;
};

export function summarizeColumn(
  values: readonly (number | null)[],
  rows: number,
  kind: StatisticKind,
  spec: Spec | undefined,
  decimals: number | undefined,
): ColumnSummary {
  const entered = values.slice(0, rows).filter((value): value is number => value !== null);
  const value = statistic(kind, entered);
  const complete = entered.length === rows;

  let outcome: ColumnOutcome;
  if (!spec || spec.kind === "na") outcome = "na";
  else if (!complete || value === null) outcome = "not_done";
  // Judged on the value as displayed, so the P/F always agrees with the printed figure.
  else outcome = checkSpec(decimals === undefined ? value : roundTo(value, decimals), spec);

  return { count: entered.length, statistic: value, complete, outcome };
}

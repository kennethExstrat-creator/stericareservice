// Per ordered size (BUILD_SPEC 6.1 dye_leak): one leaking pouch fails the
// size; not done until both counts are entered (6.2 rule 5). The plan flows
// forward from the sampling plan's dye leak pouches, else config n (BUILD_SPEC
// 8). Fewer pouches tested than planned is a warning the reviewer must see,
// as sampling_plan warns on a sample below its plan.
import type { PerSizeResult } from "@/lib/schemas/module-result";
import {
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import type { DyeLeakConfig } from "./config";
import { emptyDyeLeakSize, type DyeLeakData, type DyeLeakSize } from "./schema";

/** The "Passed / Failed" line of a size: the leak verdict alone, without the plan warning. */
export type DyeLeakVerdict = "pass" | "fail" | "not_done";

export type DyeLeakComputed = {
  /** Pouches the plan asks for per ordered size; null when neither the sampling plan nor config n sets it. */
  pouchesPlanned: Record<string, number | null>;
  /** Per ordered size: fail on any leaking pouch, pass on none, not done until both counts are entered. */
  result: Record<string, DyeLeakVerdict>;
  /**
   * Sums over the ordered sizes of the counts entered. Null until a size has
   * that count, so a module nobody tested never reads "0 failed".
   */
  totalTested: number | null;
  totalFailed: number | null;
};

/** Pouches to test for a size: the sampling plan's dye leak pouches, else config n. A plan of 0 plans nothing. */
export function plannedPouches(context: InspectionContext, config: DyeLeakConfig, size: string): number | null {
  const planned = samplingFor(context, size).pouchesDyeLeak;
  return planned !== null && planned > 0 ? planned : config.n;
}

type SizeOutcome = { verdict: DyeLeakVerdict; result: PerSizeResult; issues: CalcIssue[] };

export function calcDyeLeak({
  data,
  config,
  labels,
  context,
}: CalcInput<DyeLeakData, DyeLeakConfig>): CalcOutput<DyeLeakComputed> {
  const entries = Object.fromEntries(
    context.sizes.map((size) => [size, data.sizes[size] ?? emptyDyeLeakSize()]),
  ) as Record<string, DyeLeakSize>;
  const planned = Object.fromEntries(context.sizes.map((size) => [size, plannedPouches(context, config, size)]));
  const outcomes = Object.fromEntries(
    context.sizes.map((size) => [size, evaluateSize(size, entries[size], planned[size], labels)]),
  ) as Record<string, SizeOutcome>;

  const perSize = perSizeResults(context.sizes, (size) => outcomes[size].result);
  const counts = (pick: (entry: DyeLeakSize) => number | null) =>
    context.sizes.reduce<number | null>((sum, size) => {
      const count = pick(entries[size]);
      return count === null ? sum : (sum ?? 0) + count;
    }, null);

  return {
    result: resultFromSizes(perSize, summarise(context.sizes, entries, outcomes, labels)),
    computed: {
      pouchesPlanned: planned,
      result: Object.fromEntries(context.sizes.map((size) => [size, outcomes[size].verdict])),
      totalTested: counts((entry) => entry.pouchesTested),
      totalFailed: counts((entry) => entry.pouchesFailed),
    },
    issues: context.sizes.flatMap((size) => outcomes[size].issues),
  };
}

function evaluateSize(size: string, entry: DyeLeakSize, planned: number | null, labels: Labels): SizeOutcome {
  const tested = entry.pouchesTested;
  const failed = entry.pouchesFailed;
  const testedLabel = labelFor(labels, "pouchesTested");
  const failedLabel = labelFor(labels, "pouchesFailed");
  const issues: CalcIssue[] = [];

  if (tested !== null && failed !== null && failed > tested) {
    issues.push(
      errorIssue(
        "dye_leak_failed_above_tested",
        `Size ${size}: ${failedLabel} (${failed}) is more than ${testedLabel} (${tested}).`,
        { size, path: ["sizes", size, "pouchesFailed"] },
      ),
    );
  }
  const belowPlan = tested !== null && tested > 0 && planned !== null && tested < planned;
  if (belowPlan) {
    issues.push(
      warningIssue("dye_leak_below_plan", `Size ${size}: ${testedLabel} ${tested}, below the ${planned} planned.`, {
        size,
        path: ["sizes", size, "pouchesTested"],
      }),
    );
  }

  // A leak is a leak: the size fails even before the count tested is entered.
  if (failed !== null && failed > 0) {
    return { verdict: "fail", result: { status: "fail", summary: `${failedLabel}: ${ofTested(failed, tested)}.` }, issues };
  }
  if (tested === 0) {
    return { verdict: "not_done", result: { status: "not_done", summary: `${testedLabel}: 0, nothing tested yet.` }, issues };
  }
  const missing = [tested === null ? testedLabel : null, failed === null ? failedLabel : null].filter(
    (label): label is string => label !== null,
  );
  if (missing.length > 0) {
    return { verdict: "not_done", result: { status: "not_done", summary: `Missing: ${missing.join(", ")}.` }, issues };
  }
  if (belowPlan) {
    return {
      verdict: "pass",
      result: { status: "warn", summary: `${failedLabel}: 0 of ${tested}; ${planned} planned.` },
      issues,
    };
  }
  return { verdict: "pass", result: { status: "pass", summary: `${failedLabel}: 0 of ${tested}.` }, issues };
}

/**
 * "Pouches Failed: 2 of 13 in size 7.0. Not done for size 8.5." Failures
 * first, else the total of the sizes that passed; then what is open.
 */
function summarise(
  sizes: readonly string[],
  entries: Readonly<Record<string, DyeLeakSize>>,
  outcomes: Readonly<Record<string, SizeOutcome>>,
  labels: Labels,
): string {
  if (sizes.length === 0) return "No sizes ordered yet.";
  const failedLabel = labelFor(labels, "pouchesFailed");
  const parts: string[] = [];

  const failing = sizes.filter((size) => outcomes[size].verdict === "fail");
  const passing = sizes.filter((size) => outcomes[size].verdict === "pass");
  if (failing.length > 0) {
    const where = failing.map(
      (size) => `${ofTested(entries[size].pouchesFailed ?? 0, entries[size].pouchesTested)} in size ${size}`,
    );
    parts.push(`${failedLabel}: ${where.join(", ")}.`);
  } else if (passing.length > 0) {
    const tested = passing.reduce((sum, size) => sum + (entries[size].pouchesTested ?? 0), 0);
    parts.push(`${failedLabel}: 0 of ${tested}.`);
  }
  const open = sizes.filter((size) => outcomes[size].result.status === "not_done");
  if (open.length > 0) parts.push(`Not done for size ${open.join(", ")}.`);
  const below = sizes.filter((size) => outcomes[size].issues.some((issue) => issue.code === "dye_leak_below_plan"));
  if (below.length > 0) parts.push(`Fewer pouches tested than planned for size ${below.join(", ")}.`);
  return parts.join(" ");
}

function ofTested(failed: number, tested: number | null): string {
  return tested === null ? String(failed) : `${failed} of ${tested}`;
}

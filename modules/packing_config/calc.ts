// Result "info" once the gloves per inner unit and the inner units per case
// are entered; "not done" until then (BUILD_SPEC 6.2 rule 5). The gloves per
// case is worked out from them (Kenneth, 27 October 2026: "if there is
// already an auto calulate field, why another to fill?"): edit.ts writes
// their product with them, and none stored, as in data saved before, counts
// as that product, so it never keeps the step not done. It is typed only
// while one of them is missing (a document may state only the gloves per
// case). "warn" when a stored gloves per case is not the gloves per inner
// unit times the inner units per case (6.1), as in data saved before: that
// check is computed, never typed (rule 2). The counts reach order_lots and
// the sampling plan through the context. The onsite forms' Packing Mode text
// is never waited for, even where the template shows it (every seed template
// does): BUILD_SPEC 6.1 bases this result on the counts alone, and neither
// report prints the text.
import { formatCount } from "@/lib/aql";
import {
  errorIssue,
  labelFor,
  notDone,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
  type Labels,
} from "@/modules/_framework";
import { CASE_FACTORS, INNER_UNIT_NAMES, PACKING_COUNTS, type PackingConfigConfig, type PackingCount } from "./config";
import type { PackingConfigData } from "./schema";

export type PackingConfigComputed = {
  /**
   * "Gloves per Case (Inner × per Case)": gloves per inner unit x inner units
   * per case, the gloves per case worked out and what a stored one is checked
   * against. Null until both are entered.
   */
  glovesPerCaseCheck: number | null;
  /** What one inner unit is ("plastic pack"), from the template: the export carries no config. */
  innerUnit: string;
};

type Counts = Readonly<Record<PackingCount, number | null>>;
type Case = { perInner: number; perCase: number; total: number };

export function calcPackingConfig({
  data,
  config,
  labels,
}: CalcInput<PackingConfigData, PackingConfigConfig>): CalcOutput<PackingConfigComputed> {
  const issues: CalcIssue[] = PACKING_COUNTS.filter((field) => data[field] === 0).map((field) =>
    errorIssue("packing_count_not_positive", `${labelFor(labels, field)}: must be more than 0.`, { path: [field] }),
  );
  const counts = positiveCounts(data);
  const check = glovesPerCaseCheck(counts);
  const computed: PackingConfigComputed = { glovesPerCaseCheck: check, innerUnit: INNER_UNIT_NAMES[config.innerUnit] };

  const { glovesPerInner: perInner, innersPerCase: perCase, glovesPerCase: stored } = counts;
  const mismatch =
    perInner !== null && perCase !== null && stored !== null && stored !== check
      ? warningIssue("gloves_per_case_mismatch", mismatchMessage({ perInner, perCase, total: stored }, labels), {
          path: ["glovesPerCase"],
        })
      : null;
  if (mismatch) issues.push(mismatch);

  // The gloves per case follows from these two: only they are ever missing.
  if (perInner === null || perCase === null) {
    const missing = CASE_FACTORS.filter((field) => counts[field] === null);
    return {
      result: notDone(sentence(`Missing: ${missing.map((field) => labelFor(labels, field)).join(", ")}`)),
      computed,
      issues,
    };
  }
  if (mismatch) return { result: { status: "warn", summary: mismatch.message }, computed, issues };
  const total = stored ?? perInner * perCase;
  return { result: { status: "info", summary: summarise({ perInner, perCase, total }, labels) }, computed, issues };
}

/**
 * The gloves per case worked out (Kenneth, 27 October 2026): gloves per
 * inner unit x inner units per case once both are entered, which edit.ts
 * writes with them and the field shows read-only; null while either is
 * missing (or 0), when the field is typed instead.
 */
export function workedOutGlovesPerCase(data: PackingConfigData): number | null {
  return glovesPerCaseCheck(positiveCounts(data));
}

/**
 * The packing every later module reads. A gloves per case not stored is the
 * worked-out one, inner x per case: data saved before 27 October 2026 may
 * hold none beside both counts, and its order totals and lot sizes come all
 * the same. A stored one is used as stored, also when the check warns.
 */
export function contributePackingConfig({
  data,
  config,
}: ContributeInput<PackingConfigData, PackingConfigConfig>): ContextContribution {
  const counts = positiveCounts(data);
  return {
    packing: {
      innerUnit: INNER_UNIT_NAMES[config.innerUnit],
      glovesPerInner: counts.glovesPerInner,
      innersPerCase: counts.innersPerCase,
      glovesPerCase: counts.glovesPerCase ?? glovesPerCaseCheck(counts),
    },
  };
}

/** A count of 0 is no packing at all: it is reported, and counts as not entered. */
function positiveCounts(data: PackingConfigData): Counts {
  const positive = (value: number | null) => (value !== null && value > 0 ? value : null);
  return {
    glovesPerInner: positive(data.glovesPerInner),
    innersPerCase: positive(data.innersPerCase),
    glovesPerCase: positive(data.glovesPerCase),
  };
}

function glovesPerCaseCheck(counts: Counts): number | null {
  return counts.glovesPerInner === null || counts.innersPerCase === null
    ? null
    : counts.glovesPerInner * counts.innersPerCase;
}

/** "# Gloves per Case 2,500 is not # Glove per Inner Box × # Inners per Case: 200 × 10 = 2,000." */
function mismatchMessage({ perInner, perCase, total }: Case, labels: Labels): string {
  const product = `${labelFor(labels, "glovesPerInner")} × ${labelFor(labels, "innersPerCase")}`;
  return `${labelFor(labels, "glovesPerCase")} ${formatCount(total)} is not ${product}: ${formatCount(perInner)} × ${formatCount(perCase)} = ${formatCount(perInner * perCase)}.`;
}

/** "# Gloves per Case 2,000 = # Glove per Inner Box 200 × # Inners per Case 10." */
function summarise({ perInner, perCase, total }: Case, labels: Labels): string {
  return `${labelFor(labels, "glovesPerCase")} ${formatCount(total)} = ${labelFor(labels, "glovesPerInner")} ${formatCount(perInner)} × ${labelFor(labels, "innersPerCase")} ${formatCount(perCase)}.`;
}

/** One full stop at the end, also after a label that has its own ("# pcs per ctn."). */
function sentence(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

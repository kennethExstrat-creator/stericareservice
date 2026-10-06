// Result "info" once the three counts are entered; "not done" until then
// (BUILD_SPEC 6.2 rule 5). "warn" when the gloves per case, as printed, is
// not the gloves per inner unit times the inner units per case (6.1): that
// check is computed, never typed (rule 2). The counts reach order_lots and
// the sampling plan through the context.
import { formatCount } from "@/lib/format";
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
import { INNER_UNIT_NAMES, PACKING_COUNTS, type PackingConfigConfig, type PackingCount } from "./config";
import type { PackingConfigData } from "./schema";

export type PackingConfigComputed = {
  /** "Gloves per case (inner × per case)": gloves per inner unit x inner units per case. Null until both are entered. */
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

  const { glovesPerInner: perInner, innersPerCase: perCase, glovesPerCase: total } = counts;
  const mismatch =
    perInner !== null && perCase !== null && total !== null && total !== check
      ? warningIssue("gloves_per_case_mismatch", mismatchMessage({ perInner, perCase, total }, labels), {
          path: ["glovesPerCase"],
        })
      : null;
  if (mismatch) issues.push(mismatch);

  if (perInner === null || perCase === null || total === null) {
    const missing = PACKING_COUNTS.filter((field) => counts[field] === null);
    return {
      result: notDone(sentence(`Missing: ${missing.map((field) => labelFor(labels, field)).join(", ")}`)),
      computed,
      issues,
    };
  }
  if (mismatch) return { result: { status: "warn", summary: mismatch.message }, computed, issues };
  return { result: { status: "info", summary: summarise({ perInner, perCase, total }, labels) }, computed, issues };
}

/**
 * The packing every later module reads. A gloves per case not entered yet is
 * taken as inner x per case, so the order totals and the AQL plan can start;
 * an entered one is used as printed, also when the check warns.
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

/** "# gloves per case 2,500 is not # glove per inner box × # inners per case: 200 × 10 = 2,000." */
function mismatchMessage({ perInner, perCase, total }: Case, labels: Labels): string {
  const product = `${labelFor(labels, "glovesPerInner")} × ${labelFor(labels, "innersPerCase")}`;
  return `${labelFor(labels, "glovesPerCase")} ${formatCount(total)} is not ${product}: ${formatCount(perInner)} × ${formatCount(perCase)} = ${formatCount(perInner * perCase)}.`;
}

/** "# gloves per case 2,000 = # glove per inner box 200 × # inners per case 10." */
function summarise({ perInner, perCase, total }: Case, labels: Labels): string {
  return `${labelFor(labels, "glovesPerCase")} ${formatCount(total)} = ${labelFor(labels, "glovesPerInner")} ${formatCount(perInner)} × ${labelFor(labels, "innersPerCase")} ${formatCount(perCase)}.`;
}

/** One full stop at the end, also after a label that has its own ("# pcs per ctn."). */
function sentence(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

// Per ordered size (BUILD_SPEC 6.1, EN 455): the median of the readings of
// the gloves tested against the minimum, judged at the decimals it is
// printed with, as lib/stats judges every statistic. Not done until each
// ordered size has all its readings (6.2 rule 5). A reading of 0 N or less,
// or one past the gloves tested, is wrong data: an error with its path.
import type { PerSizeResult } from "@/lib/schemas/module-result";
import { checkSpec, formatDecimal, median, roundTo, type Spec } from "@/lib/stats";
import {
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import type { ForceAtBreakConfig } from "./config";
import type { ForceAtBreakData } from "./schema";

export type ForceResult = "pass" | "fail" | "not_done";

export type ForceAtBreakSizeComputed = {
  /** Gloves tested: the sampling plan's gloves for the physical test, else config n. */
  n: number;
  /** Valid readings among the n. */
  entered: number;
  /** Median of the n readings at config decimals, as printed and judged; null until all n are in. */
  median: number | null;
  /** median ≥ config specMin; not done until all n readings are in. */
  result: ForceResult;
};

export type ForceAtBreakComputed = {
  specMin: number;
  standardLabel: string | null;
  decimals: number;
  labReportAttached: boolean;
  /** Ordered sizes only (6.2 rule 4). */
  sizes: { [size: string]: ForceAtBreakSizeComputed };
};

export function calcForceAtBreak({
  data,
  config,
  labels,
  context,
}: CalcInput<ForceAtBreakData, ForceAtBreakConfig>): CalcOutput<ForceAtBreakComputed> {
  const issues: CalcIssue[] = [];
  const sizes: Record<string, ForceAtBreakSizeComputed> = {};
  const spec = forceSpec(config);

  const perSize = perSizeResults(context.sizes, (size): PerSizeResult => {
    const n = readingsFor(context, config, size);
    const values = data.sizes[size]?.values ?? [];
    issues.push(...readingIssues(values, n, size, sizeLabel(context, size), labels));

    const readings = values.slice(0, n).filter(isValidReading);
    const value = median(readings);
    if (n === 0 || readings.length < n || value === null) {
      sizes[size] = { n, entered: readings.length, median: null, result: "not_done" };
      return { status: "not_done", summary: n === 0 ? NO_GLOVES : `${readings.length} of ${n} readings` };
    }
    // Judged as printed, so the verdict always agrees with the printed median.
    const shown = roundTo(value, config.decimals);
    const result = checkSpec(shown, spec) === "pass" ? "pass" : "fail";
    sizes[size] = { n, entered: n, median: shown, result };
    return { status: result, summary: medianText(shown, result, config, labels) };
  });

  return {
    result: resultFromSizes(perSize, summarise(context, perSize, sizes, config, labels)),
    computed: {
      specMin: config.specMin,
      standardLabel: config.standardLabel,
      decimals: config.decimals,
      labReportAttached: data.labReport !== null,
      sizes,
    },
    issues,
  };
}

/** Readings a size needs: the sampling plan's gloves for the physical test when entered, else config n. */
export function readingsFor(context: InspectionContext, config: Pick<ForceAtBreakConfig, "n">, size: string): number {
  return plannedReadings(context, size) ?? config.n;
}

/** The sampling plan's gloves for the physical test of a size, or null while it gives none. */
export function plannedReadings(context: InspectionContext, size: string): number | null {
  const planned = samplingFor(context, size).physical;
  return planned !== null && Number.isInteger(planned) && planned >= 0 ? planned : null;
}

/** A reading that can count: a force at break is always more than 0 N. */
export function isValidReading(value: number | null): value is number {
  return value !== null && value > 0;
}

export function forceSpec(config: Pick<ForceAtBreakConfig, "specMin">): Spec {
  return { kind: "min", min: config.specMin };
}

const STANDARD_PLACEHOLDER = "{standardLabel}";

/**
 * The spec caption with the standard: "Spec." and EN 455 give "Spec. (EN
 * 455)". A caption that places the standard itself ("Spec. ({standardLabel})")
 * has it filled in, or dropped with its brackets when there is none.
 */
export function specCaption(caption: string, standardLabel: string | null): string {
  const standard = (standardLabel ?? "").trim();
  if (!caption.includes(STANDARD_PLACEHOLDER)) return standard === "" ? caption : `${caption} (${standard})`;
  if (standard !== "") return caption.split(STANDARD_PLACEHOLDER).join(standard);
  return caption.replace(/\s*\(\{standardLabel\}\)/g, "").split(STANDARD_PLACEHOLDER).join("").trim();
}

/** "Spec. ≥ 6 N", in the template's wording. */
export function specText(config: Pick<ForceAtBreakConfig, "specMin" | "standardLabel">, labels: Labels): string {
  return `${specCaption(labelFor(labels, "specRow"), config.standardLabel)} ≥ ${formatDecimal(config.specMin)} N`;
}

const NO_GLOVES = "No gloves to test in the sampling plan";

function readingIssues(
  values: readonly (number | null)[],
  n: number,
  size: string,
  name: string,
  labels: Labels,
): CalcIssue[] {
  const issues: CalcIssue[] = [];
  values.forEach((value, index) => {
    if (value === null || value > 0) return;
    issues.push(
      errorIssue(
        "force_reading_not_positive",
        `Size ${name}, glove ${index + 1}: ${labelFor(labels, "values")} must be more than 0, not ${formatDecimal(value)}.`,
        { size, path: ["sizes", size, "values", index] },
      ),
    );
  });
  const beyond = values.flatMap((value, index) => (index >= n && value !== null ? [index] : []));
  if (beyond.length > 0) {
    const one = beyond.length === 1;
    const entered = `${beyond.length} ${one ? "reading is" : "readings are"} entered`;
    const where = n === 0 ? `${entered}, but the sampling plan gives no gloves to test` : `${entered} beyond the ${n} gloves tested`;
    issues.push(
      errorIssue(
        "force_readings_beyond_plan",
        `Size ${name}: ${where}. Clear ${one ? "it" : "them"} or correct the sampling plan.`,
        { size, path: ["sizes", size, "values", beyond[0]] },
      ),
    );
  }
  return issues;
}

function medianText(value: number, result: ForceResult, config: ForceAtBreakConfig, labels: Labels): string {
  const text = `${labelFor(labels, "median")} ${formatDecimal(value, config.decimals)} N`;
  return result === "fail" ? `${text} (below ${formatDecimal(config.specMin)} N)` : text;
}

/** "Size M: Median 6.537 N. Spec. ≥ 6 N." The spec is left out until a size has a median. */
function summarise(
  context: InspectionContext,
  perSize: Readonly<Record<string, PerSizeResult>>,
  sizes: Readonly<Record<string, ForceAtBreakSizeComputed>>,
  config: ForceAtBreakConfig,
  labels: Labels,
): string {
  if (context.sizes.length === 0) return "No sizes ordered yet.";
  const parts = context.sizes.map((size) => `Size ${sizeLabel(context, size)}: ${perSize[size]?.summary ?? ""}`);
  const judged = context.sizes.some((size) => (sizes[size]?.median ?? null) !== null);
  return `${parts.join("; ")}.${judged ? ` ${specText(config, labels)}.` : ""}`;
}

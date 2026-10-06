// Per ordered size (BUILD_SPEC 6.1, EN 455): the median of the readings of
// the gloves tested against the minimum, judged at the decimals it is
// printed with, as lib/stats judges every statistic. Not done until each
// ordered size has all its readings (6.2 rule 5). A reading of 0 N or less,
// or one past the gloves tested, is wrong data: an error with its path. So
// is a sampling plan that asks for more readings than a size can take. The
// lab report is optional here ('where applicable'): the module keeps the id
// of the file attached through its file slot (the framework's file
// channel), and says so when the inspection no longer holds that file.
import type { PerSizeResult } from "@/lib/schemas/module-result";
import { checkSpec, formatDecimal, median, roundTo, type Spec } from "@/lib/stats";
import {
  errorIssue,
  heldFileState,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { MAX_READINGS, type ForceAtBreakConfig } from "./config";
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
    const name = sizeLabel(context, size);
    const values = data.sizes[size]?.values ?? [];
    // The plan's count has no upper limit, the screen's grid has: a typo such
    // as 600 for 13 would otherwise leave the size waiting for good.
    if (n > MAX_READINGS) {
      issues.push(
        errorIssue(
          "force_plan_too_many",
          `Size ${name}: the sampling plan gives ${n} gloves to test; at most ${MAX_READINGS} readings can be entered. Correct the sampling plan.`,
          { size, path: ["sizes", size] },
        ),
      );
    }
    issues.push(...readingIssues(values, n, size, name, labels));

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

  const report = heldFileState(context, data.labReport);
  if (report === "missing") {
    issues.push(
      warningIssue(
        "lab_report_missing",
        `${labelFor(labels, "labReport")}: the file attached here is no longer with this inspection. Attach it again.`,
        { path: ["labReport"] },
      ),
    );
  }

  return {
    result: resultFromSizes(perSize, summarise(context, perSize, sizes, config, labels)),
    computed: {
      specMin: config.specMin,
      standardLabel: config.standardLabel,
      decimals: config.decimals,
      labReportAttached: report === "attached",
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

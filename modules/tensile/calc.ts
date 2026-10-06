// Per ordered size (BUILD_SPEC 6.1, ASTM D6319): the lab report's tensile
// strength and elongation at break averages against their minimums, each
// judged at the decimals it is printed with; a size fails if either fails.
// Not done until both averages of every ordered size are in and the lab
// report is attached, which this module requires (6.2 rule 5). An average
// of 0 or less is wrong data: an error with its path.
import type { ModuleStatus, PerSizeResult } from "@/lib/schemas/module-result";
import { checkSpec, formatDecimal, roundTo, type Spec } from "@/lib/stats";
import {
  combinePerSize,
  errorIssue,
  labelFor,
  perSizeResults,
  sizeLabel,
  worstStatus,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { TENSILE_MEASURES, type TensileConfig, type TensileMeasure } from "./config";
import { emptyTensileSize, type TensileData, type TensileSize } from "./schema";

export type TensileOutcome = "pass" | "fail" | "not_done";

export type TensileSizeComputed = {
  /** tensileStrength ≥ config tensileMin, judged as printed; not done until entered. */
  tensileResult: TensileOutcome;
  /** elongationAtBreak ≥ config elongationMin, judged as printed; not done until entered. */
  elongationResult: TensileOutcome;
};

export type TensileComputed = {
  tensileMin: number;
  elongationMin: number;
  standardLabel: string;
  decimals: { tensileStrength: number; elongationAtBreak: number };
  labReportAttached: boolean;
  /** Ordered sizes only (6.2 rule 4). */
  sizes: { [size: string]: TensileSizeComputed };
};

type MeasureRule = {
  unit: "MPa" | "%";
  result: keyof TensileSizeComputed;
  minimum: (config: TensileConfig) => number;
  /** Issue code for an average of 0 or less. */
  invalidCode: string;
};

export const MEASURE_RULES: Readonly<Record<TensileMeasure, MeasureRule>> = {
  tensileStrength: {
    unit: "MPa",
    result: "tensileResult",
    minimum: (config) => config.tensileMin,
    invalidCode: "tensile_strength_not_positive",
  },
  elongationAtBreak: {
    unit: "%",
    result: "elongationResult",
    minimum: (config) => config.elongationMin,
    invalidCode: "elongation_not_positive",
  },
};

export function calcTensile({
  data,
  config,
  labels,
  context,
}: CalcInput<TensileData, TensileConfig>): CalcOutput<TensileComputed> {
  const issues: CalcIssue[] = [];
  const sizes: Record<string, TensileSizeComputed> = {};

  const perSize = perSizeResults(context.sizes, (size): PerSizeResult => {
    const entry = data.sizes[size] ?? emptyTensileSize();
    for (const measure of TENSILE_MEASURES) {
      const value = entry[measure];
      if (value === null || value > 0) continue;
      issues.push(
        errorIssue(
          MEASURE_RULES[measure].invalidCode,
          `Size ${sizeLabel(context, size)}: ${labelFor(labels, measure)} must be more than 0, not ${formatDecimal(value)}.`,
          { size, path: ["sizes", size, measure] },
        ),
      );
    }
    const outcomes: TensileSizeComputed = {
      tensileResult: judgeAverage(entry.tensileStrength, config, "tensileStrength"),
      elongationResult: judgeAverage(entry.elongationAtBreak, config, "elongationAtBreak"),
    };
    sizes[size] = outcomes;
    return { status: sizeStatus(outcomes), summary: sizeSummary(entry, outcomes, config) };
  });

  // The lab report is required: without it the module is not done, whatever its sizes say.
  const attached = data.labReport !== null;
  const status = attached ? combinePerSize(perSize) : worstStatus([combinePerSize(perSize), "not_done"]);
  return {
    result: { status, summary: summarise(context, perSize, sizes, attached, config, labels), perSize },
    computed: {
      tensileMin: config.tensileMin,
      elongationMin: config.elongationMin,
      standardLabel: config.standardLabel,
      decimals: { ...config.decimals },
      labReportAttached: attached,
      sizes,
    },
    issues,
  };
}

export function measureSpec(config: TensileConfig, measure: TensileMeasure): Spec {
  return { kind: "min", min: MEASURE_RULES[measure].minimum(config) };
}

/** An average against its minimum, at the decimals it is printed with. */
export function judgeAverage(value: number | null, config: TensileConfig, measure: TensileMeasure): TensileOutcome {
  if (value === null || value <= 0) return "not_done";
  const shown = roundTo(value, config.decimals[measure]);
  return checkSpec(shown, measureSpec(config, measure)) === "pass" ? "pass" : "fail";
}

/** "34.18 MPa", "536%": a value at the measure's decimals with its unit. */
export function formatAverage(value: number, config: TensileConfig, measure: TensileMeasure): string {
  const text = formatDecimal(value, config.decimals[measure]);
  return MEASURE_RULES[measure].unit === "%" ? `${text}%` : `${text} ${MEASURE_RULES[measure].unit}`;
}

/** "≥ 14.00 MPa", "≥ 500%": the minimum as the report prints it. */
export function formatMinimum(config: TensileConfig, measure: TensileMeasure): string {
  return `≥ ${formatAverage(MEASURE_RULES[measure].minimum(config), config, measure)}`;
}

const STANDARD_PLACEHOLDER = "{standardLabel}";

/**
 * The spec caption with the standard: "Spec. ({standardLabel})" and ASTM
 * D6319 give "Spec. (ASTM D6319)"; with no standard the placeholder goes with
 * its brackets. A caption without the placeholder gets the standard after it.
 */
export function specCaption(caption: string, standardLabel: string | null): string {
  const standard = (standardLabel ?? "").trim();
  if (!caption.includes(STANDARD_PLACEHOLDER)) return standard === "" ? caption : `${caption} (${standard})`;
  if (standard !== "") return caption.split(STANDARD_PLACEHOLDER).join(standard);
  return caption.replace(/\s*\(\{standardLabel\}\)/g, "").split(STANDARD_PLACEHOLDER).join("").trim();
}

/** "Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%", in the template's wording. */
export function specText(config: TensileConfig, labels: Labels): string {
  const minimums = TENSILE_MEASURES.map((measure) => formatMinimum(config, measure)).join(" / ");
  return `${specCaption(labelFor(labels, "specRow"), config.standardLabel)} ${minimums}`;
}

function sizeStatus(outcomes: TensileSizeComputed): ModuleStatus {
  const values = Object.values(outcomes);
  if (values.includes("fail")) return "fail";
  return values.includes("not_done") ? "not_done" : "pass";
}

/** "34.18 MPa / 536%"; "12.50 MPa (below ≥ 14.00 MPa) / 536%"; "not entered". */
function sizeSummary(entry: TensileSize, outcomes: TensileSizeComputed, config: TensileConfig): string {
  if (entry.tensileStrength === null && entry.elongationAtBreak === null) return "not entered";
  return TENSILE_MEASURES.map((measure) => {
    const value = entry[measure];
    if (value === null) return "not entered";
    const text = formatAverage(value, config, measure);
    if (value <= 0) return `${text} (not valid)`;
    return outcomes[MEASURE_RULES[measure].result] === "fail" ? `${text} (below ${formatAverage(MEASURE_RULES[measure].minimum(config), config, measure)})` : text;
  }).join(" / ");
}

/**
 * "Size XS: 34.18 MPa / 536%; Size S: 32.99 MPa / 547%. Spec. (ASTM D6319)
 * ≥ 14.00 MPa / ≥ 500%." The spec is left out until a value is judged; a
 * missing lab report is named last.
 */
function summarise(
  context: InspectionContext,
  perSize: Readonly<Record<string, PerSizeResult>>,
  sizes: Readonly<Record<string, TensileSizeComputed>>,
  attached: boolean,
  config: TensileConfig,
  labels: Labels,
): string {
  const lines: string[] = [];
  if (context.sizes.length === 0) lines.push("No sizes ordered yet.");
  else {
    const parts = context.sizes.map((size) => `Size ${sizeLabel(context, size)}: ${perSize[size]?.summary ?? ""}`);
    const judged = Object.values(sizes).some((outcomes) => Object.values(outcomes).some((outcome) => outcome !== "not_done"));
    lines.push(`${parts.join("; ")}.`);
    if (judged) lines.push(`${specText(config, labels)}.`);
  }
  if (!attached) lines.push(`${labelFor(labels, "labReport")} not attached.`);
  return lines.join(" ");
}

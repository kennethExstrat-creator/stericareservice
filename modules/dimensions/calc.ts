// Per size and measure: the median or average of the gloves' readings,
// printed at the template's decimals and judged at that precision against
// the size's spec (lib/stats summarizeColumn), so the verdict always agrees
// with the printed figure. A size fails when a measure fails, passes when
// every judged measure passes, and is not done until every glove has every
// reading (BUILD_SPEC 6.2 rule 5). A measure whose spec is NA, or missing,
// is recorded but not judged. A reading of 0 mm or less is an error that
// blocks submit; it still counts, as MeasurementGrid's footer counts it, so
// the screen never shows two verdicts for one column.
import type { ModuleStatus } from "@/lib/schemas";
import {
  formatDecimal,
  formatSpec,
  roundTo,
  summarizeColumn,
  type ColumnOutcome,
  type Spec,
  type StatisticKind,
} from "@/lib/stats";
import {
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  warningIssue,
  worstStatus,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { MAX_ROWS, type DimensionsConfig, type Measure } from "./config";
import type { DimensionGlove, DimensionsData } from "./schema";

type BySize<T> = { [size: string]: T };
type ByMeasure<T> = { [measure: string]: T };

/** pass or fail on the printed statistic, na without a spec to judge by, not_done while readings are missing. */
export type MeasureOutcome = ColumnOutcome;

export type DimensionsComputed = {
  /** "median" or "average", as the template sets it. */
  statisticKind: StatisticKind;
  /** The measures on, in column order. */
  measures: Measure[];
  /** Decimals each measure's statistic is printed and judged at. */
  decimals: ByMeasure<number>;
  /** Gloves per ordered size: the sampling plan's n for dimension, else the template's rows. */
  rows: BySize<number>;
  /** Readings counted per size and measure, gloves 1 to n. */
  count: BySize<ByMeasure<number>>;
  /** Median or average of the readings counted, unrounded; null until there is one. */
  statistic: BySize<ByMeasure<number | null>>;
  /** The statistic at the template's decimals: what the report prints and what is judged. */
  shown: BySize<ByMeasure<number | null>>;
  /** The spec each measure is judged against; null when the template has none for it. */
  spec: BySize<ByMeasure<Spec | null>>;
  measureResult: BySize<ByMeasure<MeasureOutcome>>;
};

/** Where a size's number of gloves comes from. */
export type RowsSource = "sampling" | "template";

/**
 * Gloves to measure for a size: the sampling plan's n when it holds a count
 * (BUILD_SPEC 8: numbers flow forward), else the template's rows. Capped at
 * MAX_ROWS, so a mistyped plan cannot stall the screen.
 */
export function rowsFor(
  context: InspectionContext,
  size: string,
  config: Pick<DimensionsConfig, "rows">,
): { rows: number; source: RowsSource } {
  const planned = samplingFor(context, size).dimensions;
  if (planned === null || !Number.isInteger(planned) || planned < 0) return { rows: config.rows, source: "template" };
  return { rows: Math.min(planned, MAX_ROWS), source: "sampling" };
}

/** The template's spec for one size and measure; undefined when it has none. */
export function specFor(config: Pick<DimensionsConfig, "specs">, size: string, measure: Measure): Spec | undefined {
  return config.specs.find((row) => row.size === size)?.specs[measure];
}

type MeasureSummary = {
  measure: Measure;
  count: number;
  complete: boolean;
  shown: number | null;
  spec: Spec | undefined;
  outcome: MeasureOutcome;
  status: ModuleStatus;
};

export function calcDimensions({
  data,
  config,
  labels,
  context,
}: CalcInput<DimensionsData, DimensionsConfig>): CalcOutput<DimensionsComputed> {
  const issues: CalcIssue[] = [];
  const computed: DimensionsComputed = {
    statisticKind: config.statistic,
    measures: [...config.measures],
    decimals: Object.fromEntries(config.measures.map((measure) => [measure, config.decimals[measure]])),
    rows: {},
    count: {},
    statistic: {},
    shown: {},
    spec: {},
    measureResult: {},
  };
  const failures = new Map<string, MeasureSummary[]>();

  const perSize = perSizeResults(context.sizes, (size) => {
    const { rows, source } = rowsFor(context, size, config);
    const gloves = data.sizes[size]?.gloves ?? [];
    issues.push(...readingIssues(size, gloves, rows, source, config.measures, labels, context));
    computed.rows[size] = rows;
    if (rows === 0) {
      return { status: "not_done", summary: "The sampling plan has no gloves for dimension." };
    }

    const measures = config.measures.map((measure): MeasureSummary => {
      const column = Array.from({ length: rows }, (_, index) => gloves[index]?.[measure] ?? null);
      const spec = specFor(config, size, measure);
      const decimals = config.decimals[measure];
      const summary = summarizeColumn(column, rows, config.statistic, spec, decimals);
      const shown = summary.statistic === null ? null : roundTo(summary.statistic, decimals);
      (computed.count[size] ??= {})[measure] = summary.count;
      (computed.statistic[size] ??= {})[measure] = summary.statistic;
      (computed.shown[size] ??= {})[measure] = shown;
      (computed.spec[size] ??= {})[measure] = spec ?? null;
      (computed.measureResult[size] ??= {})[measure] = summary.outcome;
      return {
        measure,
        count: summary.count,
        complete: summary.complete,
        shown,
        spec,
        outcome: summary.outcome,
        status: measureStatus(summary.complete, summary.outcome),
      };
    });

    const failed = measures.filter((entry) => entry.status === "fail");
    if (failed.length > 0) failures.set(size, failed);
    return {
      status: worstStatus(measures.map((entry) => entry.status)),
      summary: sizeSummary(measures, rows, config, labels),
    };
  });

  return {
    result: resultFromSizes(perSize, moduleSummary(perSize, failures, config, labels, context)),
    computed,
    issues,
  };
}

/** Not done while readings are missing; a measure without a spec to judge by is a record (info). */
function measureStatus(complete: boolean, outcome: MeasureOutcome): ModuleStatus {
  if (!complete || outcome === "not_done") return "not_done";
  return outcome === "na" ? "info" : outcome;
}

/** "Width 106 (95 ± 10)": the printed statistic and its spec; with `verdict`, "Width 106 Failed (95 ± 10)". */
function printed(entry: MeasureSummary, config: DimensionsConfig, labels: Labels, verdict: boolean): string {
  const value = `${labelFor(labels, entry.measure)} ${formatDecimal(entry.shown, config.decimals[entry.measure])}`;
  const spec = entry.spec ? formatSpec(entry.spec) : "no spec";
  const judged = entry.outcome === "pass" || entry.outcome === "fail";
  return verdict && judged ? `${value} ${labelFor(labels, entry.outcome)} (${spec})` : `${value} (${spec})`;
}

function readingIssues(
  size: string,
  gloves: readonly DimensionGlove[],
  rows: number,
  source: RowsSource,
  measures: readonly Measure[],
  labels: Labels,
  context: InspectionContext,
): CalcIssue[] {
  const issues: CalcIssue[] = [];
  const name = sizeLabel(context, size);
  const rowNo = labelFor(labels, "rowNo");
  const beyond: number[] = [];
  gloves.forEach((glove, index) => {
    for (const measure of measures) {
      const value = glove[measure];
      if (value === null) continue;
      if (index >= rows) {
        if (beyond.at(-1) !== index + 1) beyond.push(index + 1);
        continue;
      }
      if (value <= 0) {
        issues.push(
          errorIssue(
            "dimension_not_positive",
            `Size ${name}, ${labelFor(labels, measure)} ${rowNo} ${index + 1}: must be more than 0 mm.`,
            { size, path: ["sizes", size, "gloves", index, measure] },
          ),
        );
      }
    }
  });
  if (beyond.length > 0) {
    const which = beyond.length === 1 ? `${beyond[0]}` : `${beyond[0]} to ${beyond.at(-1)}`;
    const plan =
      source === "sampling"
        ? `the sampling plan has ${rows} gloves for dimension`
        : `the template measures ${rows} gloves per size`;
    issues.push(
      warningIssue(
        "dimension_beyond_sample",
        `Size ${name}: readings for ${rowNo} ${which} are not counted; ${plan}.`,
        { size, path: ["sizes", size, "gloves", rows] },
      ),
    );
  }
  return issues;
}

/** "Median: Length 245 Passed (≥ 240), Finger Thickness 0.09 (NA). Missing readings: Width 9 of 13." */
function sizeSummary(measures: readonly MeasureSummary[], rows: number, config: DimensionsConfig, labels: Labels): string {
  const complete = measures.filter((entry) => entry.complete);
  const missing = measures.filter((entry) => !entry.complete);
  const parts: string[] = [];
  if (complete.length > 0) {
    const items = complete.map((entry) => printed(entry, config, labels, true));
    parts.push(`${labelFor(labels, "statistic")}: ${items.join(", ")}.`);
  }
  if (missing.length > 0) {
    const items = missing.map((entry) => `${labelFor(labels, entry.measure)} ${entry.count} of ${rows}`);
    parts.push(`Missing readings: ${items.join(", ")}.`);
  }
  return parts.join(" ");
}

/** "Out of spec: size M Width 106 (95 ± 10). Not done for size S. Median within spec for size XS, L." */
function moduleSummary(
  perSize: Readonly<Record<string, { status: ModuleStatus }>>,
  failures: ReadonlyMap<string, readonly MeasureSummary[]>,
  config: DimensionsConfig,
  labels: Labels,
  context: InspectionContext,
): string {
  if (context.sizes.length === 0) return "No sizes ordered yet.";
  const sizesWith = (status: ModuleStatus) =>
    context.sizes.filter((size) => perSize[size]?.status === status).map((size) => sizeLabel(context, size));
  const parts: string[] = [];
  if (failures.size > 0) {
    const sizes = [...failures].map(([size, failed]) => {
      const items = failed.map((entry) => printed(entry, config, labels, false));
      return `size ${sizeLabel(context, size)} ${items.join(", ")}`;
    });
    parts.push(`Out of spec: ${sizes.join("; ")}.`);
  }
  const notDone = sizesWith("not_done");
  if (notDone.length > 0) parts.push(`Not done for size ${notDone.join(", ")}.`);
  const passed = sizesWith("pass");
  if (passed.length > 0) parts.push(`${labelFor(labels, "statistic")} within spec for size ${passed.join(", ")}.`);
  const unjudged = sizesWith("info");
  if (unjudged.length > 0) parts.push(`Recorded without a spec to judge by for size ${unjudged.join(", ")}.`);
  return parts.join(" ");
}

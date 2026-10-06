// Result (BUILD_SPEC 6.1 sampling_plan): "info" once every column the
// template shows is entered for every ordered size; "warn" when a size's
// watertight and visual sample is below the plan of the inspection level
// (BUILD_SPEC 7) or is not a standard sample size; "not done" until then and
// while a value is impossible (6.2 rule 5). The samples flow forward to the
// modules that test them through the context (BUILD_SPEC 8).
import {
  AqlSchema,
  codeLetterForSampleSize,
  formatAql,
  formatCount,
  isStandardSampleSize,
  planFromLotSize,
  SAMPLE_SIZES,
  type CodeLetter,
  type InspectionLevel,
  type LotSizePlan,
} from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas";
import {
  EMPTY_SAMPLING,
  errorIssue,
  labelFor,
  lotSizeGloves,
  perSizeResults,
  resultFromSizes,
  sizeLabel,
  warningIssue,
  worstStatus,
  type AqlSettings,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
  type InspectionContext,
  type Labels,
  type SamplingValues,
} from "@/modules/_framework";
import { SAMPLING_CONTEXT_KEYS, SAMPLING_COLUMNS, shownColumns, type SamplingColumn, type SamplingPlanConfig } from "./config";
import { emptySamplingSize, type SamplingPlanData, type SamplingSize } from "./schema";

/** One size's lot at the inspection level, and its watertight and visual sample against it. */
export type SizePlan = {
  /** Gloves in the lot: cases ordered x gloves per case; null until both are entered. */
  lotSizeGloves: number | null;
  /** ISO 2859-1 Table 1 code letter of the lot at the inspection level; null without a level or a lot size. */
  codeLetter: CodeLetter | null;
  /**
   * The sample the inspection level asks for: the largest n among the plans
   * of the AQLs checked on the watertight and visual sample (arrows followed).
   */
  planSampleSize: number | null;
  /** The code letter of that plan: codeLetter, or where an AQL's arrow led. */
  planCodeLetter: CodeLetter | null;
  /** The watertight and visual sample's own code letter, which watertight and visual use (BUILD_SPEC 7). */
  sampleCodeLetter: CodeLetter | null;
  /** The watertight and visual sample is smaller than the plan; null without a plan or a sample. */
  belowPlan: boolean | null;
};

export type SamplingPlanComputed = {
  /** The level the plans are computed at: the template's, else the client's; null for none. */
  inspectionLevel: InspectionLevel | null;
  /** Per ordered size. */
  sizes: Record<string, SizePlan>;
  /** Each shown column summed over the ordered sizes (the onsite forms' Total: row); null while none is entered. */
  totals: Record<string, number | null>;
};

/** Watertight and visual need at least this sample: Table 2-A starts at n 2 (code A). */
const MIN_SAMPLE = 2;

export function calcSamplingPlan({
  data,
  config,
  labels,
  context,
}: CalcInput<SamplingPlanData, SamplingPlanConfig>): CalcOutput<SamplingPlanComputed> {
  const level = config.inspectionLevel ?? context.aql.inspectionLevel;
  const issues: CalcIssue[] = [];
  const sizes: Record<string, SizePlan> = {};
  const perSize = perSizeResults(context.sizes, (size) => {
    const checked = checkSize({ size, row: data.sizes[size] ?? emptySamplingSize(), config, level, labels, context });
    sizes[size] = checked.plan;
    issues.push(...checked.issues);
    return checked.result;
  });
  return {
    result: resultFromSizes(perSize, summarise(perSize, context, level)),
    computed: { inspectionLevel: level, sizes, totals: totalsOf(data, config, context.sizes) },
    issues,
  };
}

export function contributeSamplingPlan({
  data,
  config,
}: ContributeInput<SamplingPlanData, SamplingPlanConfig>): ContextContribution {
  const sampling = Object.fromEntries(
    Object.entries(data.sizes).map(([size, row]) => [size, samplingValues(row, config)]),
  );
  // A template without a level leaves the client's level, if any, in place.
  return config.inspectionLevel === null ? { sampling } : { sampling, aql: { inspectionLevel: config.inspectionLevel } };
}

/** What one size passes forward under the context's keys; a column switched off passes nothing. */
export function samplingValues(row: SamplingSize, config: SamplingPlanConfig): SamplingValues {
  const values: SamplingValues = { ...EMPTY_SAMPLING };
  for (const column of SAMPLING_COLUMNS) {
    values[SAMPLING_CONTEXT_KEYS[column]] = config.columns[column] ? row[column] : null;
  }
  return values;
}

/**
 * The plan of the inspection level for a lot: Table 1, then Table 2-A for
 * each AQL checked on the watertight and visual sample (watertight,
 * critical, major, minor). The largest n wins: critical (AQL 0) gives Table
 * 1's n, and an AQL whose arrow points down can ask for more (docs/AQL.md).
 */
export function lotPlan(lotSize: number, level: InspectionLevel, aql: AqlSettings): LotSizePlan | null {
  let largest: LotSizePlan | null = null;
  for (const value of [aql.watertight, aql.critical, aql.major, aql.minor]) {
    const parsed = AqlSchema.safeParse(value);
    if (!parsed.success) continue;
    const plan = planFromLotSize({ lotSize, level, aql: parsed.data });
    if (plan.ok && (largest === null || plan.plan.n > largest.n)) largest = plan.plan;
  }
  return largest;
}

type Finding = {
  level: "error" | "warning";
  code: string;
  column: SamplingColumn;
  /** The problem, for the size's summary. */
  brief: string;
  /** The problem in full, for the issue list. */
  detail: string;
};

type SizeCheckInput = {
  size: string;
  row: SamplingSize;
  config: SamplingPlanConfig;
  level: InspectionLevel | null;
  labels: Labels;
  context: InspectionContext;
};

function checkSize({ size, row, config, level, labels, context }: SizeCheckInput): {
  plan: SizePlan;
  issues: CalcIssue[];
  result: PerSizeResult;
} {
  const label = (column: SamplingColumn) => labelFor(labels, column);
  const value = (column: SamplingColumn) => (config.columns[column] ? row[column] : null);
  const findings: Finding[] = [];

  const cases = value("cases");
  const ordered = context.order[size]?.qtyCases ?? null;
  if (cases === 0) {
    findings.push({
      level: "error",
      code: "cases_zero",
      column: "cases",
      brief: `${label("cases")} is 0`,
      detail: "0 cases sampled; every ordered size needs at least 1.",
    });
  } else if (cases !== null && ordered !== null && cases > ordered) {
    findings.push({
      level: "error",
      code: "cases_above_order",
      column: "cases",
      brief: `${label("cases")} ${formatCount(cases)} is more than the ${formatCount(ordered)} ordered`,
      detail: `${counted(cases, "case")} sampled, more than the ${counted(ordered, "case")} ordered.`,
    });
  }

  // The sample's issues carry lib/aql's codes, as watertight and visual pass them on for their own n.
  const sample = value("glovesWatertightVisual");
  let sampleCodeLetter: CodeLetter | null = null;
  if (sample !== null && sample < MIN_SAMPLE) {
    findings.push({
      level: "error",
      code: "invalid_sample_size",
      column: "glovesWatertightVisual",
      brief: `${label("glovesWatertightVisual")} ${sample} is below ${MIN_SAMPLE}`,
      detail: `${counted(sample, "glove")} sampled; an ISO 2859-1 sample has at least ${MIN_SAMPLE}.`,
    });
  } else if (sample !== null) {
    sampleCodeLetter = codeLetterForSampleSize(sample);
    if (!isStandardSampleSize(sample)) {
      const standard = formatCount(SAMPLE_SIZES[sampleCodeLetter]);
      findings.push({
        level: "warning",
        code: "nonstandard_sample",
        column: "glovesWatertightVisual",
        brief: `${formatCount(sample)} is not a standard sample size (read as code ${sampleCodeLetter}, n ${standard})`,
        detail: `${formatCount(sample)} is not a standard sample size, so it is read as code letter ${sampleCodeLetter} (n ${standard}), the largest standard sample size below it.`,
      });
    }
  }

  const lot = lotSizeGloves(context, size);
  const plan = level === null || lot === null ? null : lotPlan(lot, level, context.aql);
  // A plan's n at or above the lot means inspecting every glove (docs/AQL.md rule 8).
  const required = plan === null ? null : Math.min(plan.n, plan.lotSize);
  if (plan !== null && required !== null && level !== null && sample !== null && sample >= MIN_SAMPLE && sample < required) {
    const who = plan.usedLetter === plan.codeLetter ? `inspection level ${level}` : `inspection level ${level} at AQL ${formatAql(plan.aql)}`;
    const needs = required < plan.n ? `all ${formatCount(required)}` : formatCount(plan.n);
    findings.push({
      level: "warning",
      code: "sample_below_plan",
      column: "glovesWatertightVisual",
      brief: `${formatCount(sample)} sampled, ${who} needs ${needs} (code ${plan.usedLetter})`,
      detail: `${formatCount(sample)} gloves sampled; ${who} needs ${needs} (lot ${formatCount(plan.lotSize)} gloves, code ${plan.usedLetter}).`,
    });
  }

  const name = sizeLabel(context, size);
  const issues = findings.map((finding) =>
    (finding.level === "error" ? errorIssue : warningIssue)(
      finding.code,
      `Size ${name}, ${label(finding.column)}: ${finding.detail}`,
      { size, path: ["sizes", size, finding.column] },
    ),
  );
  const sizePlan: SizePlan = {
    lotSizeGloves: lot,
    codeLetter: plan?.codeLetter ?? null,
    planSampleSize: plan?.n ?? null,
    planCodeLetter: plan?.usedLetter ?? null,
    sampleCodeLetter,
    belowPlan: required === null || sample === null ? null : sample < required,
  };
  return { plan: sizePlan, issues, result: sizeResult({ row, config, level, lot, plan, findings, label }) };
}

type SizeResultInput = {
  row: SamplingSize;
  config: SamplingPlanConfig;
  level: InspectionLevel | null;
  lot: number | null;
  plan: LotSizePlan | null;
  findings: readonly Finding[];
  label: (column: SamplingColumn) => string;
};

function sizeResult({ row, config, level, lot, plan, findings, label }: SizeResultInput): PerSizeResult {
  const shown = shownColumns(config);
  const errors = findings.filter((finding) => finding.level === "error");
  if (errors.length > 0) return { status: "not_done", summary: sentence(errors.map((finding) => finding.brief)) };
  const missing = shown.filter((column) => row[column] === null);
  if (missing.length > 0) return { status: "not_done", summary: `Missing: ${missing.map(label).join(", ")}.` };
  if (level !== null && lot === null) {
    return {
      status: "not_done",
      summary: `Lot size unknown: the inspection level ${level} plan needs the order quantity and the gloves per case.`,
    };
  }
  if (level !== null && plan === null) {
    return { status: "not_done", summary: `No inspection level ${level} plan for a lot of ${formatCount(lot ?? 0)} gloves.` };
  }
  if (findings.length > 0) return { status: "warn", summary: sentence(findings.map((finding) => finding.brief)) };
  if (shown.length === 0) return { status: "info", summary: "No columns are switched on." };

  const parts = (["cases", "glovesWatertightVisual"] as const)
    .filter((column) => config.columns[column])
    .map((column) => `${label(column)}: ${formatCount(row[column] ?? 0)}`);
  if (plan !== null) parts.push(`inspection level ${level} needs ${formatCount(plan.n)} (code ${plan.usedLetter})`);
  return { status: "info", summary: sentence(parts) };
}

function summarise(
  perSize: Readonly<Record<string, PerSizeResult>>,
  context: InspectionContext,
  level: InspectionLevel | null,
): string {
  const sizes = context.sizes;
  if (sizes.length === 0) return "No sizes ordered yet.";
  const describe = (size: string) => `Size ${sizeLabel(context, size)}: ${perSize[size]?.summary ?? ""}`;
  if (sizes.length === 1) return describe(sizes[0]);
  const worst = worstStatus(sizes.map((size) => perSize[size].status));
  const names = sizes.map((size) => sizeLabel(context, size)).join(", ");
  if (worst === "info") {
    return level === null ? `Sampling plan entered for size ${names}.` : `Samples meet inspection level ${level} for size ${names}.`;
  }
  return sizes
    .filter((size) => perSize[size].status === worst)
    .map(describe)
    .join(" ");
}

function totalsOf(data: SamplingPlanData, config: SamplingPlanConfig, sizes: readonly string[]): Record<string, number | null> {
  return Object.fromEntries(
    shownColumns(config).map((column) => {
      const values = sizes.flatMap((size) => {
        const entered = data.sizes[size]?.[column] ?? null;
        return entered === null ? [] : [entered];
      });
      return [column, values.length === 0 ? null : values.reduce((sum, entered) => sum + entered, 0)];
    }),
  );
}

/** "1 case", "2,900 cases". */
function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** "Case: 50; inspection level I needs 500 (code N)." */
function sentence(parts: readonly string[]): string {
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

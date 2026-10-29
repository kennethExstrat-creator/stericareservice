// Result (BUILD_SPEC 6.1 sampling_plan): "info" once every column the
// template shows is entered for every ordered size; "warn" when a size's
// watertight and visual sample is below the plan of the inspection level
// (BUILD_SPEC 7) or is not a standard sample size, its inner units in all
// are not its cases × inner units per case, or its gloves are not its code
// letter's sample; "not done" until then and while a value is impossible
// (6.2 rule 5). The inner units per case and the code letter are never
// asked for. Each size's gloves taken per inner box and those put back are
// worked out here (Kenneth, 27 October 2026), never typed, and so is whether
// its code letter is below its lot's. The samples flow forward to the
// modules that test them through the context (BUILD_SPEC 8). Both inspection
// levels are resolved here and nowhere else (Kenneth, 27 October 2026: "for
// dimension and FAB, use Special Inspection Level S2 ... so both general
// inspection and special inspection is in use"). The general level, for #
// of Gloves Sample and its code letter (resolveInspectionLevel): the one set
// for the inspection in Sampling Settings, else the template's, else the
// client's, else I. The special level, for Dimension, FAB and Packaging &
// Dispensing (resolveSpecialInspectionLevel): the one set for the
// inspection, else the template's, else S-2.
import {
  AqlSchema,
  codeLetterForSampleSize,
  formatCount,
  isStandardSampleSize,
  planFromLotSize,
  SAMPLE_SIZES,
  type CodeLetter,
  type GeneralInspectionLevel,
  type InspectionLevel,
  type LotSizePlan,
  type SpecialInspectionLevel,
} from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas";
import {
  AQL_CHECKS,
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
import {
  SAMPLING_CONTEXT_KEYS,
  shownColumns,
  showsCodeLetter,
  showsGlovesPerInnerBox,
  showsInnerUnitsPerCase,
  type SamplingColumn,
  type SamplingPlanConfig,
} from "./config";
import { glovesPerInnerBox, glovesPutBack } from "./inner-boxes";
import { letterSample, letterSteps } from "./letter-steps";
import { emptySamplingSize, generalLevel, rowsOff, type SamplingPlanData, type SamplingSize } from "./schema";

/** One size's lot at the general inspection level, and its watertight and visual sample against it. */
export type SizePlan = {
  /** Gloves in the lot: cases ordered x gloves per case; null until both are entered. */
  lotSizeGloves: number | null;
  /**
   * ISO 2859-1 Table 1 code letter of the lot at the general inspection
   * level; null without a lot size. The letter the size's gloves are taken
   * from, which the inspector may lower, is data (SamplingSize.codeLetter).
   */
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
  /**
   * The gloves to take from each inner box: ⌈gloves ÷ inner units sampled⌉,
   * never under the sample (Kenneth, 27 October 2026); null while either is
   * missing, and where the template shows no gloves or no inner units.
   */
  glovesPerInnerBox: number | null;
  /** The gloves taken beyond the sample, to put back: glovesPerInnerBox × inner units − gloves; null with it. */
  putBack: number | null;
  /**
   * The size's code letter (data) is below its lot's (codeLetter): the
   * inspector lowered it on purpose, for a factory whose performance is
   * consistent (Kenneth, 27 October 2026). False where either is missing.
   */
  codeLetterReduced: boolean;
  /** The lot's code letter while the size's is below it; null otherwise. */
  reducedFrom: CodeLetter | null;
  /**
   * Fewer gloves sampled than the size's code letter's sample (every glove
   * of a smaller lot): reduced sampling, as a lowered letter is, which the
   * report says (Kenneth, 29 October 2026). False where either is missing.
   */
  belowLetter: boolean;
};

export type SamplingPlanComputed = {
  /** The general level the plans are computed at (resolveInspectionLevel). */
  inspectionLevel: GeneralInspectionLevel;
  /** The special level of Dimension, FAB and Packaging & Dispensing (resolveSpecialInspectionLevel). */
  specialInspectionLevel: SpecialInspectionLevel;
  /** Per ordered size. */
  sizes: Record<string, SizePlan>;
  /**
   * Each shown column summed over the ordered sizes (the onsite forms' Total:
   * row), and the gloves put back (`putBack`) where they show; null while
   * none is entered. Never the inner units per case, the gloves per inner box
   * or the code letter.
   */
  totals: Record<string, number | null>;
};

/** Watertight and visual need at least this sample: Table 2-A starts at n 2 (code A). */
const MIN_SAMPLE = 2;

/** The general level when neither the inspection, its template nor its client sets one (Kenneth, 27 October 2026). */
export const DEFAULT_INSPECTION_LEVEL: GeneralInspectionLevel = "I";

/**
 * The special level when neither the inspection nor its template sets one
 * (Kenneth, 27 October 2026: "for dimension and FAB, use Special Inspection
 * Level S2").
 */
export const DEFAULT_SPECIAL_INSPECTION_LEVEL: SpecialInspectionLevel = "S-2";

/** Where a level comes from: set for the inspection, the template's, the client's (the general level only), or the default. */
export type LevelSource = "inspection" | "template" | "client" | "default";
export type SourcedLevel<Level extends InspectionLevel = InspectionLevel> = { level: Level; source: LevelSource };

/**
 * The general level the plans and # of Gloves Sample are worked out at, and
 * where it comes from: the one set for this inspection in Sampling Settings,
 * else the template's, else the client's, else I. A special level in any of
 * them is no general level (generalLevel), so the next one stands in: data
 * saved while Sampling Settings had one level for everything may hold S-3,
 * and reads as no level of its own. The one place it is resolved: whatever
 * needs the level asks here, or reads calc's `computed.inspectionLevel`.
 */
export function resolveInspectionLevel(
  data: Pick<SamplingPlanData, "inspectionLevel">,
  config: Pick<SamplingPlanConfig, "inspectionLevel">,
  context: Pick<InspectionContext, "aql">,
): SourcedLevel<GeneralInspectionLevel> {
  const own = generalLevel(data.inspectionLevel);
  if (own !== null) return { level: own, source: "inspection" };
  return defaultInspectionLevel(data, config, context);
}

/**
 * The general level the inspection has without one of its own, which Use
 * Default goes back to: the template's, else the client's, else I. The
 * context holds the client's only while the inspection sets no level, since
 * the sampling plan puts the level it sets there (contributeSamplingPlan);
 * with one set, I stands in for the client's: no client sets a level yet
 * (BUILD_SPEC 13).
 */
export function defaultInspectionLevel(
  data: Pick<SamplingPlanData, "inspectionLevel">,
  config: Pick<SamplingPlanConfig, "inspectionLevel">,
  context: Pick<InspectionContext, "aql">,
): SourcedLevel<GeneralInspectionLevel> {
  const template = generalLevel(config.inspectionLevel);
  if (template !== null) return { level: template, source: "template" };
  const client = generalLevel(data.inspectionLevel) === null ? generalLevel(context.aql.inspectionLevel) : null;
  return client === null ? { level: DEFAULT_INSPECTION_LEVEL, source: "default" } : { level: client, source: "client" };
}

/**
 * The special level Dimension, FAB and Packaging & Dispensing are sampled at
 * (Auto Calculate Sampling, auto-special.ts), and where it comes from: the
 * one set for this inspection in Sampling Settings, else the template's,
 * else S-2. No client sets one. The one place it is resolved: whatever needs
 * it asks here, or reads calc's `computed.specialInspectionLevel`.
 */
export function resolveSpecialInspectionLevel(
  data: Pick<SamplingPlanData, "specialInspectionLevel">,
  config: Pick<SamplingPlanConfig, "specialInspectionLevel">,
): SourcedLevel<SpecialInspectionLevel> {
  if (data.specialInspectionLevel) return { level: data.specialInspectionLevel, source: "inspection" };
  return defaultSpecialInspectionLevel(config);
}

/** The special level the inspection has without one of its own, which Use Default goes back to: the template's, else S-2. */
export function defaultSpecialInspectionLevel(
  config: Pick<SamplingPlanConfig, "specialInspectionLevel">,
): SourcedLevel<SpecialInspectionLevel> {
  // A template version saved before the setting has none (the config schema's default).
  const template = config.specialInspectionLevel ?? null;
  return template === null ? { level: DEFAULT_SPECIAL_INSPECTION_LEVEL, source: "default" } : { level: template, source: "template" };
}

export function calcSamplingPlan({
  data,
  config,
  labels,
  context,
}: CalcInput<SamplingPlanData, SamplingPlanConfig>): CalcOutput<SamplingPlanComputed> {
  const { level } = resolveInspectionLevel(data, config, context);
  const issues: CalcIssue[] = [];
  const sizes: Record<string, SizePlan> = {};
  // A test row switched off on screen is neither asked for nor checked (Kenneth, 26 October 2026); what it holds
  // still goes forward as entered (contributeSamplingPlan), and the totals still sum it.
  const off = rowsOff(data);
  const asked: SamplingPlanConfig =
    off.size === 0 ? config : { ...config, columns: { ...config.columns, ...Object.fromEntries([...off].map((column) => [column, false])) } };
  const perSize = perSizeResults(context.sizes, (size) => {
    const checked = checkSize({ size, row: data.sizes[size] ?? emptySamplingSize(), config: asked, level, labels, context });
    sizes[size] = checked.plan;
    issues.push(...checked.issues);
    return checked.result;
  });
  return {
    result: resultFromSizes(perSize, summarise(perSize, context)),
    computed: {
      inspectionLevel: level,
      // Nothing is checked at it: Auto Calculate Sampling fills Dimension, FAB and Packaging & Dispensing at it, and
      // the export carries it beside the general level.
      specialInspectionLevel: resolveSpecialInspectionLevel(data, config).level,
      sizes,
      totals: totalsOf(data, config, context.sizes, sizes),
    },
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
  // The general level set for this inspection in Sampling Settings, else the template's, for every reader of
  // `context.aql`. Neither leaves the client's level, if any, in place; with none at all, a reader takes
  // the default I, as resolveInspectionLevel does. A special level in either is none (generalLevel).
  const level = generalLevel(data.inspectionLevel) ?? generalLevel(config.inspectionLevel);
  if (level === null) return { sampling };
  return { sampling, aql: { inspectionLevel: level } };
}

/**
 * What one size passes forward under the context's keys: the columns the
 * template shows (shownColumns). A column switched off passes nothing, and so
 * does the gloves for weight: weight records its own value per size.
 */
export function samplingValues(row: SamplingSize, config: SamplingPlanConfig): SamplingValues {
  const values: SamplingValues = { ...EMPTY_SAMPLING };
  for (const column of shownColumns(config)) values[SAMPLING_CONTEXT_KEYS[column]] = row[column];
  return values;
}

/**
 * The plan of the inspection level for a lot: Table 1, then Table 2-A for
 * each AQL checked on the watertight and visual sample: watertight, critical,
 * major and minor, the checks the inspection runs (a check switched off is
 * null in the context). The largest n wins: critical (AQL 0) gives Table 1's
 * n, and an AQL whose arrow points down can ask for more (docs/AQL.md). With
 * no check run on the sample, Table 1's n is the plan, as AQL 0 gives it.
 */
export function lotPlan(lotSize: number, level: InspectionLevel, aql: AqlSettings): LotSizePlan | null {
  const run = AQL_CHECKS.flatMap((check) => {
    const value = aql[check];
    return value === null ? [] : [value];
  });
  let largest: LotSizePlan | null = null;
  for (const value of run.length === 0 ? [0] : run) {
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
  column: SamplingColumn | "codeLetter";
  /** The problem, for the size's summary. */
  brief: string;
  /** The problem in full, for the issue list. */
  detail: string;
};

type SizeCheckInput = {
  size: string;
  row: SamplingSize;
  config: SamplingPlanConfig;
  level: InspectionLevel;
  labels: Labels;
  context: InspectionContext;
};

function checkSize({ size, row, config, level, labels, context }: SizeCheckInput): {
  plan: SizePlan;
  issues: CalcIssue[];
  result: PerSizeResult;
} {
  const label = (key: string) => labelFor(labels, key);
  const value = (column: SamplingColumn) => (config.columns[column] ? row[column] : null);
  const findings: Finding[] = [];
  const lot = lotSizeGloves(context, size);
  const plan = lot === null ? null : lotPlan(lot, level, context.aql);

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

  // While the inner units per case are entered, the screen writes cases × per case into the total (withCount). One
  // stored otherwise (data saved another way: a reading, two devices' edits) is flagged on the total.
  const perCase = showsInnerUnitsPerCase(config) ? row.innerUnitsPerCase : null;
  const innerUnits = value("innerUnits");
  if (cases !== null && perCase !== null && innerUnits !== null && innerUnits !== cases * perCase) {
    const product = `${formatCount(cases)} × ${formatCount(perCase)}`;
    findings.push({
      level: "warning",
      code: "inner_units_mismatch",
      column: "innerUnits",
      brief: `${label("innerUnits")} ${formatCount(innerUnits)} is not ${product}`,
      detail: `${formatCount(innerUnits)} is not ${product} = ${formatCount(cases * perCase)} (${label("cases")} × ${label("innerUnitsPerCase")}). Enter either again to work it out.`,
    });
  }

  // The gloves are the code letter's sample, every glove of a smaller lot (Kenneth, 27 October 2026). Gloves typed
  // otherwise are no warning (Kenneth, 29 October 2026: "the warning is not needed"): fewer than the letter's sample
  // is reduced sampling (belowLetter), which the report says.
  const letter = showsCodeLetter(config) ? row.codeLetter : null;
  const sampled = value("gloves");
  const letterGloves = letter === null ? null : letterSample(letter, lot);

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

  // A plan's n at or above the lot means inspecting every glove (docs/AQL.md rule 8). A sample below it is no
  // warning (Kenneth, 26 October 2026: "the warning is not needed"): belowPlan still says so in the computed values.
  const required = plan === null ? null : Math.min(plan.n, plan.lotSize);

  const name = sizeLabel(context, size);
  const issues = findings.map((finding) =>
    (finding.level === "error" ? errorIssue : warningIssue)(
      finding.code,
      `Size ${name}, ${label(finding.column)}: ${finding.detail}`,
      { size, path: ["sizes", size, finding.column] },
    ),
  );
  // The gloves taken per inner box and those put back, whether the gloves came from Auto Calculate Sampling or were
  // typed (Kenneth, 27 October 2026: "Always use this method").
  const gloves = showsGlovesPerInnerBox(config) ? value("gloves") : null;
  const { reducedFrom } = letterSteps(letter, plan?.codeLetter ?? null);
  const sizePlan: SizePlan = {
    lotSizeGloves: lot,
    codeLetter: plan?.codeLetter ?? null,
    planSampleSize: plan?.n ?? null,
    planCodeLetter: plan?.usedLetter ?? null,
    sampleCodeLetter,
    belowPlan: required === null || sample === null ? null : sample < required,
    glovesPerInnerBox: glovesPerInnerBox(gloves, innerUnits),
    putBack: glovesPutBack(gloves, innerUnits),
    codeLetterReduced: reducedFrom !== null,
    reducedFrom,
    belowLetter: letterGloves !== null && sampled !== null && sampled < letterGloves,
  };
  return { plan: sizePlan, issues, result: sizeResult({ row, config, findings, label, plan: sizePlan }) };
}

type SizeResultInput = {
  row: SamplingSize;
  config: SamplingPlanConfig;
  findings: readonly Finding[];
  label: (key: string) => string;
  /**
   * The size's computed values: the gloves per inner box and those put back
   * join a complete size's summary, and the lot's letter while the size's is
   * below it.
   */
  plan: Pick<SizePlan, "glovesPerInnerBox" | "putBack" | "reducedFrom">;
};

function sizeResult({ row, config, findings, label, plan }: SizeResultInput): PerSizeResult {
  const shown = shownColumns(config);
  const errors = findings.filter((finding) => finding.level === "error");
  if (errors.length > 0) return { status: "not_done", summary: sentence(errors.map((finding) => finding.brief)) };
  const missing = shown.filter((column) => row[column] === null);
  // Listing every column of an empty size would repeat the whole table in the summary.
  if (missing.length > 0 && missing.length === shown.length) return { status: "not_done", summary: "Not started." };
  if (missing.length > 0) return { status: "not_done", summary: `Missing: ${missing.map(label).join(", ")}.` };
  // Nothing waits on the inspection level's plan, and no summary names it (Kenneth, 26 October 2026: "remove the
  // level of inspection"): the plan is still worked out for the computed values.
  if (findings.length > 0) return { status: "warn", summary: sentence(findings.map((finding) => finding.brief)) };
  if (shown.length === 0) return { status: "info", summary: "No columns are switched on." };

  const parts = (["cases", "glovesWatertightVisual"] as const)
    .filter((column) => config.columns[column])
    .map((column) => `${label(column)}: ${formatCount(row[column] ?? 0)}`);
  // What the inspector takes from each inner box and puts back: the review and the export read it here too.
  for (const key of ["glovesPerInnerBox", "putBack"] as const) {
    const count = plan[key];
    if (count !== null) parts.push(`${label(key)}: ${formatCount(count)}`);
  }
  // The letter the gloves are taken from, and the lot's while it is lowered, so a reviewer sees it was (Kenneth, 27
  // October 2026).
  if (showsCodeLetter(config) && row.codeLetter !== null) {
    const reduced = plan.reducedFrom === null ? "" : ` (reduced from ${plan.reducedFrom})`;
    parts.push(`${label("codeLetter")}: ${row.codeLetter}${reduced}`);
  }
  return { status: "info", summary: sentence(parts) };
}

function summarise(perSize: Readonly<Record<string, PerSizeResult>>, context: InspectionContext): string {
  const sizes = context.sizes;
  if (sizes.length === 0) return "No sizes ordered yet.";
  const worst = worstStatus(sizes.map((size) => perSize[size].status));
  if (worst === "info" && sizes.length > 1) {
    const names = sizes.map((size) => sizeLabel(context, size)).join(", ");
    return `Sampling plan entered for size ${names}.`;
  }
  return bySummary(sizes.filter((size) => perSize[size].status === worst), perSize, context);
}

/** "Size XS, L: 80 sampled, ... Size S, M: 200 sampled, ...": sizes with the same summary named once, in order. */
function bySummary(
  sizes: readonly string[],
  perSize: Readonly<Record<string, PerSizeResult>>,
  context: InspectionContext,
): string {
  const groups = new Map<string, string[]>();
  for (const size of sizes) {
    const summary = perSize[size]?.summary ?? "";
    groups.set(summary, [...(groups.get(summary) ?? []), sizeLabel(context, size)]);
  }
  return Array.from(groups, ([summary, names]) => `Size ${names.join(", ")}: ${summary}`).join(" ");
}

function totalsOf(
  data: SamplingPlanData,
  config: SamplingPlanConfig,
  sizes: readonly string[],
  plans: Readonly<Record<string, SizePlan>>,
): Record<string, number | null> {
  const totals: Record<string, number | null> = Object.fromEntries(
    shownColumns(config).map((column) => [column, sumOf(sizes.map((size) => data.sizes[size]?.[column] ?? null))]),
  );
  // The gloves put back add up; the inner units per case and the gloves per inner box do not, and have no total.
  if (showsGlovesPerInnerBox(config)) totals.putBack = sumOf(sizes.map((size) => plans[size]?.putBack ?? null));
  return totals;
}

/** The values entered, summed; null while none is. */
function sumOf(values: readonly (number | null)[]): number | null {
  const entered = values.filter((value): value is number => value !== null);
  return entered.length === 0 ? null : entered.reduce((sum, value) => sum + value, 0);
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

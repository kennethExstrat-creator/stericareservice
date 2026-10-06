// Per ordered size and included level: the defects found against Accept 0 /
// Reject 1 (BUILD_SPEC 7: labelling, whatever the number inspected), so any
// defect fails. A level is not done until the boxes inspected are recorded
// (6.2 rule 5); fewer than the template plans is a warning. Box numbers are
// optional, but a box must come from the size's carton list (6.2 rule 7).
import { decide, labelingPlan } from "@/lib/aql";
import type { ModuleStatus } from "@/lib/schemas";
import {
  cartonsFor,
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  sizeLabel,
  warningIssue,
  worstStatus,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import {
  LABELING_LEVELS,
  type LabelingCheckItem,
  type LabelingConfig,
  type LabelingLevel,
  type LabelingLevelConfig,
} from "./config";
import { emptyLabelingSize, type LabelingData, type LabelingLevelData } from "./schema";

/** The disposition the report prints for a level: Passed, Failed, or nothing yet. */
export type LabelingDisposition = "pass" | "fail" | "not_done";

/** What the report computes per size and level (6.2 rule 2: never typed). */
export type LabelingLevelComputed = {
  accept: number;
  reject: number;
  /** Defects found over the level's checks. */
  total: number;
  result: LabelingDisposition;
};

/** `sizes.<size>.<level>`, ordered sizes and included levels only. */
export type LabelingComputed = {
  sizes: { [size: string]: { [level: string]: LabelingLevelComputed } };
};

type CheckCount = { check: LabelingCheckItem; label: string; count: number };

type LevelOutcome = {
  level: LabelingLevel;
  label: string;
  planned: number;
  inspected: number | null;
  total: number;
  /** Checks with defects found, in the template's order. */
  found: CheckCount[];
  disposition: LabelingDisposition;
  /** The disposition, or a warning when fewer boxes were inspected than planned. */
  status: ModuleStatus;
};

export function calcLabeling({
  data,
  config,
  labels,
  context,
}: CalcInput<LabelingData, LabelingConfig>): CalcOutput<LabelingComputed> {
  const levels = includedLevels(config);
  const issues: CalcIssue[] = [];
  const computed: LabelingComputed = { sizes: {} };
  const outcomes = new Map<string, LevelOutcome[]>();

  for (const size of context.sizes) {
    const entry = data.sizes[size] ?? emptyLabelingSize();
    const sizeOutcomes = levels.map((level) => assessLevel(level, config.levels[level], entry[level], labels));
    outcomes.set(size, sizeOutcomes);
    computed.sizes[size] = Object.fromEntries(
      sizeOutcomes.map((outcome) => [outcome.level, levelComputed(outcome)]),
    );
    for (const level of levels) {
      issues.push(...levelIssues(size, level, config.levels[level], entry[level], labels, context));
    }
  }

  if (levels.length === 0) {
    const perSize = perSizeResults(context.sizes, () => ({ status: "info", summary: "No levels are inspected." }));
    return { result: resultFromSizes(perSize, "No labelling levels are switched on."), computed, issues };
  }

  const perSize = perSizeResults(context.sizes, (size) => {
    const sizeOutcomes = outcomes.get(size) ?? [];
    return {
      status: worstStatus(sizeOutcomes.map((outcome) => outcome.status)),
      summary: `${sizeOutcomes.map(describeLevel).join("; ")}.`,
    };
  });
  return { result: resultFromSizes(perSize, summarise(outcomes, context)), computed, issues };
}

/** The levels the template inspects, in report order. */
export function includedLevels(config: LabelingConfig): LabelingLevel[] {
  return LABELING_LEVELS.filter((level) => config.levels[level].include);
}

/** "Dispenser Box", "Inner Boxes/Packs": the level heading in the template's wording. */
export function levelLabel(labels: Labels, level: LabelingLevel): string {
  return labelFor(labels, `${level}Level`);
}

/** A level's own wording of a field (`innerResult`), else the field's (`result`). */
export function levelFieldLabel(labels: Labels, level: LabelingLevel, field: string): string {
  const own = labels[`${level}${field.charAt(0).toUpperCase()}${field.slice(1)}`];
  return own !== undefined && own.trim() !== "" ? own : labelFor(labels, field);
}

/**
 * A check's wording: a label keyed `<level>.<code>` or `<code>` when the
 * template sets one, else the label the template's config gives the check.
 */
export function checkLabel(labels: Labels, level: LabelingLevel, check: LabelingCheckItem): string {
  for (const key of [`${level}.${check.code}`, check.code]) {
    const label = labels[key];
    if (label !== undefined && label.trim() !== "") return label;
  }
  return check.label;
}

/** Defects found over a level's checks; counts of checks the template does not list are ignored. */
export function levelTotal(levelConfig: LabelingLevelConfig, entry: LabelingLevelData): number {
  return levelConfig.checks.reduce((sum, check) => sum + (entry.defects[check.code] ?? 0), 0);
}

function assessLevel(
  level: LabelingLevel,
  levelConfig: LabelingLevelConfig,
  entry: LabelingLevelData,
  labels: Labels,
): LevelOutcome {
  const counts = levelConfig.checks.map((check) => ({
    check,
    label: checkLabel(labels, level, check),
    count: entry.defects[check.code] ?? 0,
  }));
  const total = levelTotal(levelConfig, entry);
  const inspected = entry.inspected;
  const recorded = inspected !== null && inspected > 0;
  // Accept 0 / Reject 1 at any n: a defect rejects even before the count is recorded.
  const disposition: LabelingDisposition =
    decide(total, labelingPlan()) === "reject" ? "fail" : recorded ? "pass" : "not_done";
  const belowPlan = recorded && inspected < levelConfig.n;
  return {
    level,
    label: levelLabel(labels, level),
    planned: levelConfig.n,
    inspected,
    total,
    found: counts.filter((item) => item.count > 0),
    disposition,
    status: disposition === "pass" && belowPlan ? "warn" : disposition,
  };
}

function levelComputed(outcome: LevelOutcome): LabelingLevelComputed {
  const { ac, re } = labelingPlan();
  return { accept: ac, reject: re, total: outcome.total, result: outcome.disposition };
}

function levelIssues(
  size: string,
  level: LabelingLevel,
  levelConfig: LabelingLevelConfig,
  entry: LabelingLevelData,
  labels: Labels,
  context: InspectionContext,
): CalcIssue[] {
  const issues: CalcIssue[] = [];
  const at = ["sizes", size, level];
  const where = `${levelLabel(labels, level)}, size ${sizeLabel(context, size)}`;
  const { inspected, boxNos } = entry;

  if (inspected !== null && inspected > 0 && inspected < levelConfig.n) {
    issues.push(
      warningIssue(
        "labeling_below_plan",
        `${where}: ${countOf(inspected, "box", "boxes")} inspected; the plan is ${levelConfig.n}.`,
        { size, path: [...at, "inspected"] },
      ),
    );
  }

  if (inspected !== null && boxNos.length > inspected) {
    issues.push(
      errorIssue(
        "boxes_exceed_inspected",
        `${where}: ${countOf(boxNos.length, "box is", "boxes are")} picked but ${inspected} inspected.`,
        { size, path: [...at, "boxNos"] },
      ),
    );
  }

  const cartons = cartonsFor(context, size);
  const seen = new Set<number>();
  boxNos.forEach((box, index) => {
    const path = [...at, "boxNos", index];
    // With no carton list yet, a box number is taken as entered (docs/MODULES.md 7).
    if (cartons.length > 0 && !cartons.includes(box)) {
      issues.push(
        errorIssue(
          "box_not_in_carton_list",
          `Box ${box} (${levelLabel(labels, level)}) is not in the size ${sizeLabel(context, size)} carton list.`,
          { size, path },
        ),
      );
    }
    // Inner boxes may come from one carton; the carton level inspects each carton once.
    if (level === "carton" && seen.has(box)) {
      issues.push(errorIssue("box_duplicate", `${where}: carton ${box} is picked twice.`, { size, path }));
    }
    seen.add(box);
  });

  if (inspected !== null) {
    for (const check of levelConfig.checks) {
      const count = entry.defects[check.code] ?? 0;
      if (count > inspected) {
        issues.push(
          warningIssue(
            "defects_exceed_inspected",
            `${where}: ${count} × ${checkLabel(labels, level, check)} found in ${countOf(inspected, "box", "boxes")} inspected.`,
            { size, path: [...at, "defects", check.code] },
          ),
        );
      }
    }
  }
  return issues;
}

/** "Dispenser Box: 0 defects in 3", "Carton Box: not recorded". */
function describeLevel(outcome: LevelOutcome): string {
  const { label, total, inspected, planned, disposition } = outcome;
  if (disposition === "not_done") return `${label}: not recorded`;
  const defects = countOf(total, "defect", "defects");
  if (inspected === null || inspected === 0) return `${label}: ${defects}, boxes inspected not recorded`;
  const plan = inspected < planned ? ` (plan ${planned})` : "";
  return `${label}: ${defects} in ${inspected}${plan}`;
}

function summarise(outcomes: ReadonlyMap<string, LevelOutcome[]>, context: InspectionContext): string {
  const sizes = [...outcomes.keys()];
  if (sizes.length === 0) return "No sizes ordered yet.";
  const sizeText = (size: string) => `size ${sizeLabel(context, size)}`;
  const withStatus = (status: ModuleStatus) =>
    sizes.flatMap((size) => {
      const matching = (outcomes.get(size) ?? []).filter((outcome) => outcome.status === status);
      return matching.length > 0 ? [{ size, matching }] : [];
    });

  const parts: string[] = [];
  const failed = withStatus("fail");
  if (failed.length > 0) {
    const lines = failed.flatMap(({ size, matching }) =>
      matching.map((outcome) => {
        const checks = outcome.found.map((found) => `${found.label} ${found.count}`).join(", ");
        return `${sizeText(size)} ${outcome.label} ${countOf(outcome.total, "defect", "defects")} (${checks})`;
      }),
    );
    parts.push(`Failed: ${lines.join("; ")}.`);
  }
  const missing = withStatus("not_done");
  if (missing.length > 0) {
    const lines = missing.map(
      ({ size, matching }) => `${sizeText(size)} (${matching.map((outcome) => outcome.label).join(", ")})`,
    );
    parts.push(`Not recorded: ${lines.join("; ")}.`);
  }
  if (parts.length > 0) return parts.join(" ");

  const sizeList = `${sizes.length === 1 ? "size" : "sizes"} ${sizes.map((size) => sizeLabel(context, size)).join(", ")}`;
  const short = withStatus("warn");
  if (short.length === 0) return `No defects in ${sizeList}.`;
  const lines = short.flatMap(({ size, matching }) =>
    matching.map((outcome) => `${sizeText(size)} ${outcome.label} ${outcome.inspected} of ${outcome.planned}`),
  );
  return `No defects in ${sizeList}. Fewer boxes inspected than planned: ${lines.join("; ")}.`;
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

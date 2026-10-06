// Per ordered size and defect class: the defects found against the class's
// AQL plan for the gloves inspected (BUILD_SPEC 6.1, 7). Code letters,
// Accept / Reject and totals are computed here (6.2 rule 2). A class is
// accepted at Ac or fewer defects and rejected at Re or more; any critical
// defect fails (AQL 0: Accept 0 / Reject 1), even before the gloves inspected
// are entered. A class is not done until its gloves inspected are entered, or
// while the sample is too small for its AQL (6.2 rule 5). A size takes its
// worst class. With handSplit the defects of both hands count together.
import { AqlSchema, CODE_LETTERS, decide, formatAql, planFromSampleSize, type Aql, type CodeLetter } from "@/lib/aql";
import type { ModuleStatus, PerSizeResult } from "@/lib/schemas";
import {
  errorIssue,
  HAND_LABEL,
  HANDS,
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
  type Hand,
  type InspectionContext,
  type IssuePath,
} from "@/modules/_framework";
import type { VisualConfig, VisualDefect } from "./config";
import {
  DEFECT_CLASSES,
  emptyVisualHand,
  emptyVisualSize,
  type DefectClass,
  type VisualCounts,
  type VisualData,
  type VisualSize,
} from "./schema";

type Labels = CalcInput<VisualData, VisualConfig>["labels"];

/** A one-off defect label the inspector added: not in the class's list, flagged for an admin. */
export type UnmappedDefect = { label: string; count: number; hand: Hand | null };

export type HandCounts = { counts: Record<string, number>; total: number };

export type VisualClassComputed = {
  /** As entered: n for the class's plan. Null until the inspector enters or confirms it. */
  inspected: number | null;
  /** The sampling plan's gloves for watertight and visual, which inspected is checked against. */
  planned: number | null;
  /** The sample's code letter; usedLetter is where an arrow led, n its sample size. */
  codeLetter: CodeLetter | null;
  usedLetter: CodeLetter | null;
  n: number | null;
  arrow: "up" | "down" | null;
  accept: number | null;
  reject: number | null;
  /** Defects per code, both hands: every listed defect in the template's order, then codes it lacks. */
  counts: Record<string, number>;
  /** Per hand, with handSplit on. */
  hands: { R: HandCounts; L: HandCounts } | null;
  unmapped: UnmappedDefect[];
  /** Every defect of the class, both hands, one-offs included: printed as total / inspected. */
  total: number;
  decision: "accept" | "reject" | "incomplete" | null;
  result: "pass" | "fail" | "not_done";
};

/** A size's classes; a class the template switches off is null. */
export type VisualSizeComputed = {
  critical: VisualClassComputed | null;
  major: VisualClassComputed | null;
  minor: VisualClassComputed | null;
};

export type VisualClassInfo = {
  include: boolean;
  /** The AQL used: critical 0; otherwise the template's, else the client's, else BUILD_SPEC 7's. */
  aql: number;
  /** The class heading with its AQL filled in: "Major Defects (AQL 2.5)". */
  heading: string;
  /** The defect list in the template's order and wording. */
  defects: VisualDefect[];
};

export type VisualComputed = {
  /** Code letters of the ordered sizes, as the heading prints them: "J & L". */
  codeLetters: string;
  /** The heading caption with its code letters filled in. */
  heading: string;
  classes: { critical: VisualClassInfo; major: VisualClassInfo; minor: VisualClassInfo };
  sizes: Record<string, VisualSizeComputed>;
};

export function calcVisual({ data, config, labels, context }: CalcInput<VisualData, VisualConfig>): CalcOutput<VisualComputed> {
  const issues: CalcIssue[] = [];
  const included = DEFECT_CLASSES.filter((cls) => config.classes[cls].include);
  const classes = effectiveClasses(config, labels, context);
  const aqls = {} as Record<DefectClass, Aql | null>;
  for (const cls of DEFECT_CLASSES) {
    const plannable = AqlSchema.safeParse(classes[cls].aql);
    aqls[cls] = plannable.success ? plannable.data : null;
    if (classes[cls].include && !plannable.success) {
      issues.push(
        errorIssue(
          "aql_invalid",
          `${classLabel(labels, cls)}: AQL ${classes[cls].aql} is not in ISO 2859-1 Table 2-A, so no limits can be set. Ask an admin to correct the template or the client's AQL.`,
        ),
      );
    }
  }

  const sizes: Record<string, VisualSizeComputed> = {};
  const lines: string[] = [];
  const perSize = perSizeResults(context.sizes, (size) => {
    const outcome = calcSize({
      size,
      entry: data.sizes[size] ?? emptyVisualSize(),
      split: config.handSplit,
      included,
      aqls,
      classes,
      labels,
      context,
    });
    sizes[size] = outcome.computed;
    issues.push(...outcome.issues);
    lines.push(`size ${sizeLabel(context, size)}: ${outcome.line}`);
    return outcome.result;
  });

  const codeLetters = listCodeLetters(
    Object.values(sizes).flatMap((entry) => DEFECT_CLASSES.map((cls) => entry[cls]?.codeLetter ?? null)),
  );
  const computed: VisualComputed = {
    codeLetters,
    heading: fillCaption(labelFor(labels, "heading"), { codeLetters }),
    classes,
    sizes,
  };
  const summary =
    included.length === 0
      ? "No defect classes are switched on."
      : lines.length === 0
        ? "No sizes ordered yet."
        : `${capitalise(lines.join("; "))}.`;
  return { result: resultFromSizes(perSize, summary), computed, issues };
}

type SizeInput = {
  size: string;
  entry: VisualSize;
  split: boolean;
  included: readonly DefectClass[];
  aqls: Readonly<Record<DefectClass, Aql | null>>;
  classes: VisualComputed["classes"];
  labels: Labels;
  context: InspectionContext;
};

type SizeOutcome = { computed: VisualSizeComputed; result: PerSizeResult; line: string; issues: CalcIssue[] };

function calcSize({ size, entry, split, included, aqls, classes, labels, context }: SizeInput): SizeOutcome {
  const where = (hand: Hand | null) =>
    `Size ${sizeLabel(context, size)}${hand === null ? "" : `, ${HAND_LABEL[hand].toLowerCase()}`}`;
  const issues = ignoredShape(size, entry, split, included, where(null));
  const computed: VisualSizeComputed = { critical: null, major: null, minor: null };
  if (included.length === 0) {
    return { computed, result: { status: "info", summary: "No defect classes are switched on." }, line: "no classes", issues };
  }

  const outcomes = included.map((cls) => {
    const outcome = calcClass({ size, cls, entry, split, aql: aqls[cls], defects: classes[cls].defects, labels, context, where });
    computed[cls] = outcome.computed;
    issues.push(...outcome.issues);
    return { cls, ...outcome };
  });

  const status = worstStatus(outcomes.map((outcome) => outcome.computed.result));
  const planned = samplingFor(context, size).watertightVisual;
  const nothingInspected = outcomes.every((outcome) => outcome.computed.inspected === null && outcome.computed.result === "not_done");
  const line = nothingInspected
    ? `not done, ${labelFor(labels, "inspected")} missing${planned === null ? "" : ` (sampling plan: ${planned})`}`
    : `${outcomes.map((outcome) => outcome.brief).join(", ")}: ${VERDICT[status]}`;
  return {
    computed,
    result: { status, summary: `${outcomes.map((outcome) => outcome.summary).join("; ")}.` },
    line,
    issues,
  };
}

const VERDICT: Readonly<Record<ModuleStatus, string>> = {
  pass: "Passed",
  fail: "Failed",
  not_done: "Not done",
  warn: "Warning",
  info: "Info",
};

type ClassInput = {
  size: string;
  cls: DefectClass;
  entry: VisualSize;
  split: boolean;
  aql: Aql | null;
  defects: readonly VisualDefect[];
  labels: Labels;
  context: InspectionContext;
  where: (hand: Hand | null) => string;
};

type ClassOutcome = {
  computed: VisualClassComputed;
  /** For the size's summary: what was found against the limit, and the verdict. */
  summary: string;
  /** For the module's summary: the class, its total and sample. */
  brief: string;
  issues: CalcIssue[];
};

function calcClass({ size, cls, entry, split, aql, defects, labels, context, where }: ClassInput): ClassOutcome {
  const name = classLabel(labels, cls);
  const inspectedLabel = labelFor(labels, "inspected");
  const inspectedPath: IssuePath = ["sizes", size, cls, "inspected"];
  const counted = countDefects({ size, cls, entry, split, defects, where, name });
  const issues = counted.issues;

  const inspected = entry[cls].inspected;
  const planned = samplingFor(context, size).watertightVisual;
  const computed: VisualClassComputed = {
    inspected,
    planned,
    codeLetter: null,
    usedLetter: null,
    n: null,
    arrow: null,
    accept: null,
    reject: null,
    counts: counted.counts,
    hands: counted.hands,
    unmapped: counted.unmapped,
    total: counted.total,
    decision: null,
    result: "not_done",
  };
  const finish = (result: VisualClassComputed["result"], summary: string): ClassOutcome => {
    computed.result = result;
    const brief =
      result === "not_done"
        ? `${name} not done`
        : inspected === null || inspected < 2
          ? `${name} ${counted.total} found`
          : `${name} ${counted.total} / ${inspected}`;
    return { computed, summary, brief, issues };
  };
  // AQL 0 rejects at one defect whatever the sample: a critical defect fails before n is known.
  const criticalFound = () =>
    finish("fail", `${name} ${counted.total} found${foundList(counted, defects)}: Failed (any critical defect fails)`);

  if (inspected === null) {
    if (cls === "critical" && counted.total > 0) return criticalFound();
    const hint = planned === null ? "" : ` (sampling plan: ${planned})`;
    return finish("not_done", `${name}: ${inspectedLabel} missing${hint}`);
  }
  if (inspected < 2) {
    issues.push(
      errorIssue("inspected_too_small", `${where(null)}, ${name}: ${inspectedLabel} must be at least 2 for an AQL plan.`, {
        size,
        path: inspectedPath,
      }),
    );
    if (cls === "critical" && counted.total > 0) return criticalFound();
    return finish("not_done", `${name}: ${inspectedLabel} must be at least 2`);
  }
  if (planned !== null && inspected !== planned) {
    issues.push(
      warningIssue(
        "inspected_not_planned",
        `${where(null)}, ${name}: ${inspectedLabel} is ${inspected}, but the sampling plan has ${planned} gloves for watertight and visual.`,
        { size, path: inspectedPath },
      ),
    );
  }
  if (counted.total > inspected) {
    issues.push(
      warningIssue(
        "defects_exceed_inspected",
        `${where(null)}, ${name}: ${plural(counted.total, "defect")} counted in ${inspected} gloves inspected. Check the counts.`,
        { size, path: inspectedPath },
      ),
    );
  }
  if (aql === null) return finish("not_done", `${name}: no limits, the AQL is not in ISO 2859-1 Table 2-A`);

  const planning = planFromSampleSize({ sampleSize: inspected, aql });
  if (!planning.ok) return finish("not_done", `${name}: ${planning.error.message}`);
  const plan = planning.plan;
  for (const warning of plan.warnings) {
    issues.push(warningIssue(warning.code, `${where(null)}, ${name}: ${warning.message}`, { size, path: inspectedPath }));
  }

  const decision = decide(counted.total, { ac: plan.ac, re: plan.re, n: plan.n, sampleSize: inspected });
  computed.codeLetter = plan.codeLetter;
  computed.usedLetter = plan.usedLetter;
  computed.n = plan.n;
  computed.arrow = plan.arrow;
  computed.accept = plan.ac;
  computed.reject = plan.re;
  computed.decision = decision;

  const found = `${counted.total} / ${inspected}${foundList(counted, defects)}`;
  if (decision === "incomplete") {
    return finish(
      "not_done",
      `${name} ${found}: ${inspected} gloves are too few for AQL ${aqlCaption(aql)}, which needs ${plan.n} (Accept ${plan.ac}, Reject ${plan.re})`,
    );
  }
  const limit = `${labelFor(labels, "defectLimit")} ${plan.ac} / ${plan.re}`;
  return decision === "accept"
    ? finish("pass", `${name} ${found}, ${limit}: Passed`)
    : finish("fail", `${name} ${found}, ${limit}: Failed`);
}

type Counted = {
  counts: Record<string, number>;
  hands: { R: HandCounts; L: HandCounts } | null;
  unmapped: UnmappedDefect[];
  total: number;
  issues: CalcIssue[];
};

/** Adds up a class's defects for the size (both hands with a split), and flags what an admin must look at. */
function countDefects({
  size,
  cls,
  entry,
  split,
  defects,
  where,
  name,
}: {
  size: string;
  cls: DefectClass;
  entry: VisualSize;
  split: boolean;
  defects: readonly VisualDefect[];
  where: (hand: Hand | null) => string;
  name: string;
}): Counted {
  const issues: CalcIssue[] = [];
  const listed = new Set(defects.map((defect) => defect.code));
  const counts = zeroCounts(defects);
  const hands = split
    ? { R: { counts: zeroCounts(defects), total: 0 }, L: { counts: zeroCounts(defects), total: 0 } }
    : null;
  const unmapped: UnmappedDefect[] = [];
  let total = 0;

  for (const hand of split ? HANDS : [null]) {
    const record: VisualCounts = hand === null ? entry[cls] : (entry[hand] ?? emptyVisualHand())[cls];
    const path: IssuePath = hand === null ? ["sizes", size, cls] : ["sizes", size, hand, cls];
    let handTotal = 0;
    for (const [code, count] of Object.entries(record.counts)) {
      counts[code] = (counts[code] ?? 0) + count;
      if (hands && hand) hands[hand].counts[code] = (hands[hand].counts[code] ?? 0) + count;
      handTotal += count;
      if (!listed.has(code) && count > 0) {
        issues.push(
          warningIssue(
            "defect_not_listed",
            `${where(hand)}, ${name}: ${plural(count, "defect")} counted under "${code}", which this class does not list. They count towards the total; an admin checks the template.`,
            { size, path: [...path, "counts", code] },
          ),
        );
      }
    }
    record.unmapped.forEach((oneOff, index) => {
      if (oneOff.count === 0) return;
      const label = oneOff.label.trim();
      handTotal += oneOff.count;
      unmapped.push({ label, count: oneOff.count, hand });
      issues.push(
        warningIssue(
          "defect_unmapped",
          `${where(hand)}, ${name}: "${label}" (${oneOff.count}) is not in the template's defect list. It counts towards the total; an admin maps it to a defect code.`,
          { size, path: [...path, "unmapped", index] },
        ),
      );
    });
    if (hands && hand) hands[hand].total = handTotal;
    total += handTotal;
  }
  return { counts, hands, unmapped, total, issues };
}

/**
 * Defects saved in the shape the template does not use (per hand without a
 * hand split, or on the size with one) are left out, and said so. A template
 * version is fixed for an inspection, so this follows only an edit by hand.
 */
function ignoredShape(
  size: string,
  entry: VisualSize,
  split: boolean,
  included: readonly DefectClass[],
  where: string,
): CalcIssue[] {
  if (split) {
    return included.some((cls) => hasDefects(entry[cls]))
      ? [
          warningIssue(
            "hand_split_mismatch",
            `${where}: defects are saved without a hand, but this template records right and left hands apart. They are left out.`,
            { size, path: ["sizes", size] },
          ),
        ]
      : [];
  }
  return HANDS.filter((hand) => {
    const record = entry[hand];
    return record !== undefined && included.some((cls) => hasDefects(record[cls]));
  }).map((hand) =>
    warningIssue(
      "hand_split_mismatch",
      `${where}: defects are saved for the ${HAND_LABEL[hand].toLowerCase()}, but this template does not record hands apart. They are left out.`,
      { size, path: ["sizes", size, hand] },
    ),
  );
}

function hasDefects(record: VisualCounts): boolean {
  return Object.values(record.counts).some((count) => count > 0) || record.unmapped.some((oneOff) => oneOff.count > 0);
}

/**
 * Each class as the template sets it: on or off, the AQL used (critical 0;
 * otherwise the template's, else the client's, else BUILD_SPEC 7's), the
 * heading with its AQL, and the defect list in the template's wording.
 */
export function effectiveClasses(
  config: VisualConfig,
  labels: Labels,
  context: Pick<InspectionContext, "aql">,
): VisualComputed["classes"] {
  const info = (cls: DefectClass): VisualClassInfo => {
    const setting = config.classes[cls];
    const aql = cls === "critical" ? 0 : (setting.aql ?? context.aql[cls]);
    return {
      include: setting.include,
      aql,
      heading: fillCaption(labelFor(labels, `${cls}Heading`), { aql: aqlCaption(aql) }),
      defects: setting.defects.map((defect) => ({ code: defect.code, label: defectLabel(labels, cls, defect) })),
    };
  };
  return { critical: info("critical"), major: info("major"), minor: info("minor") };
}

/** The class's name in the template's wording: "Major Defects". */
export function classLabel(labels: Labels, cls: DefectClass): string {
  return labelFor(labels, `${cls}Counts`);
}

/**
 * A defect in the template's wording: its label in the class's list, unless
 * the template's labels reword it for the class (`minor.bead_defective`) or
 * everywhere (`bead_defective`) without rewriting the list.
 */
export function defectLabel(labels: Labels, cls: DefectClass, defect: VisualDefect): string {
  // labelFor gives the code itself when the labels do not word it: the list's wording stands.
  const own = labelFor(labels, cls, defect.code);
  return own === defect.code ? defect.label : own;
}

function zeroCounts(defects: readonly VisualDefect[]): Record<string, number> {
  return Object.fromEntries(defects.map((defect) => [defect.code, 0]));
}

/** "(Thin spot on glove body 5)": what was found, in the template's wording. */
function foundList(counted: Pick<Counted, "counts" | "unmapped">, defects: readonly VisualDefect[]): string {
  const parts: string[] = [];
  for (const [code, count] of Object.entries(counted.counts)) {
    if (count === 0) continue;
    parts.push(`${defects.find((defect) => defect.code === code)?.label ?? code} ${count}`);
  }
  for (const defect of counted.unmapped) parts.push(`${defect.label} ${defect.count}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/** The distinct code letters, in table order, as the reports' headings print them: "K, L & M". */
export function listCodeLetters(letters: readonly (CodeLetter | null)[]): string {
  const found = CODE_LETTERS.filter((letter) => letters.includes(letter));
  if (found.length === 0) return "–";
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(", ")} & ${found[found.length - 1]}`;
}

/** An AQL as the headings print it: 0 as 0.0, a Table 2-A AQL as ISO 2859-1 does (2.5, 4.0, 0.65), anything else as given. */
export function aqlCaption(aql: number): string {
  if (aql === 0) return "0.0";
  const known = AqlSchema.safeParse(aql);
  return known.success ? formatAql(known.data) : String(aql);
}

/** Fills `{name}` placeholders in a caption; an unknown placeholder stays as written. */
export function fillCaption(caption: string, values: Readonly<Record<string, string>>): string {
  return caption.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

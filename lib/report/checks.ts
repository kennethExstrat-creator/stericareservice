// Results by Check on the report's Summary (the design's page 1), and the overall
// conclusion's one-line verdict worked out from them. One row per check the
// inspection judged: each test module with a result (pass, fail, warning or
// not done; a module that only records, "info", has none), Visual
// Inspection once per defect class and the packing check's aged sample on a
// row of its own, not done for a size with none entered (every size needs
// one: Kenneth, 27 October 2026). The order, the sampling plan and the
// box/carton numbers are records, not checks: they show only when they hold
// a problem. Each row names the check by its short name (docs/DESIGN.md,
// Step Names), its criterion from the module's config, and its result from
// the computed values, in the template's words where it has them. The app
// never changes a result here: the status is the module's own.
import { formatCount, formatNumber, formatSpec, hasLimit } from "@/lib/format";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import type { ModuleKey, ModuleStatus } from "@/lib/schemas/module-result";
import type { Spec } from "@/lib/stats";
import { shortTitleFor } from "@/lib/templates/short-titles";
import { SpecSchema } from "@/modules/_framework/config-schemas";
import { andList, aqlText, counted, rangeText } from "./format";
import { at, labelOf, list, num, orderedSizes, rec, sizeLabel, text } from "./read";

/** A check's verdict: a module's own result, never info (a check that only records has no row). */
export type CheckStatus = Exclude<ModuleStatus, "info">;

export type CheckRow = {
  /** The module's key; a part of one adds its own: "visual:critical", "dispensing_packing:aged". */
  key: string;
  moduleKey: ModuleKey;
  /** By the module's short name: "Dimension", "Visual Inspection: Major". */
  check: string;
  /** What it is judged against: "Length ≥ 240 mm; Width to spec", "AQL 2.5". Null when the config sets nothing to say. */
  criterion: string | null;
  /** What was found: "Median Length 243 to 244 mm", "9 in 840 gloves". Null until something is entered. */
  result: string | null;
  status: CheckStatus;
  /** The sizes, as the template shows them, whose own verdict failed: for a check that passed in some sizes only. */
  failedSizes: string[];
  /** "Failed for size S": under the result, when the check failed in some of the sizes on the order and not all. */
  sizesNote: string | null;
};

/** Modules that judge the gloves: a row whenever they have a result. */
const CHECK_MODULES: readonly ModuleKey[] = [
  "dimensions",
  "weight",
  "force_at_break",
  "tensile",
  "watertight",
  "visual",
  "dispensing_packing",
  "dispensing_safedon",
  "labeling",
  "dye_leak",
  "documents",
  "loading",
];

/** Modules that record the order and the sampling: a row only for a failure or a warning. */
const RECORD_MODULES: readonly ModuleKey[] = ["header", "glove_info", "order_lots", "packing_config", "sampling_plan", "carton_sampling"];

/** A check the report names its own way, not by the step's short name (Kenneth, 27 October 2026: "Freedom from Holes - Watertight Test"). */
const REPORT_CHECK_NAMES: Readonly<Partial<Record<ModuleKey, string>>> = {
  watertight: "Freedom from Holes – Watertight Test",
};

const VISUAL_CLASSES = [
  { key: "critical", word: "Critical" },
  { key: "major", word: "Major" },
  { key: "minor", word: "Minor" },
] as const;

type RowParts = Pick<CheckRow, "criterion" | "result"> & Partial<Pick<CheckRow, "key" | "check" | "status" | "failedSizes">>;

/** The Results by Check rows, in the template's order. */
export function checkRows(doc: InspectionExport): CheckRow[] {
  const sizes = orderedSizes(doc);
  return doc.modules.flatMap((module): CheckRow[] => {
    const status = module.result.status;
    const record = RECORD_MODULES.includes(module.key);
    if (status === "info" || (!CHECK_MODULES.includes(module.key) && !(record && (status === "fail" || status === "warn")))) return [];
    const short = REPORT_CHECK_NAMES[module.key] ?? shortTitleFor(module.key, module.title);
    const moduleFailed = sizesWhere(doc, module, "fail");
    return rowsOf(module, doc, sizes, short).map((parts) => {
      const rowStatus = parts.status ?? status;
      const failedSizes = parts.failedSizes ?? moduleFailed;
      const some = rowStatus === "fail" && failedSizes.length > 0 && failedSizes.length < sizes.length;
      return {
        key: parts.key ?? module.key,
        moduleKey: module.key,
        check: parts.check ?? short,
        criterion: parts.criterion,
        result: parts.result,
        status: rowStatus,
        failedSizes,
        sizesNote: some ? `Failed for ${failedSizes.length === 1 ? "size" : "sizes"} ${andList(failedSizes)}` : null,
      };
    });
  });
}

function rowsOf(module: ExportModule, doc: InspectionExport, sizes: readonly string[], short: string): RowParts[] {
  switch (module.key) {
    case "dimensions":
      return [dimensionsRow(module, sizes)];
    case "weight":
      return [weightRow(module, sizes)];
    case "force_at_break":
      return [forceAtBreakRow(module, sizes)];
    case "tensile":
      return [tensileRow(module, sizes)];
    case "watertight":
      return [watertightRow(module, sizes)];
    case "visual":
      return visualRows(module, doc, sizes, short);
    case "dispensing_packing":
      return packingRows(module, doc, sizes, short);
    case "dispensing_safedon":
      return [safedonRow(module, sizes)];
    case "labeling":
      return [labelingRow(module, sizes)];
    case "dye_leak":
      return [dyeLeakRow(module)];
    default:
      // Documents, loading, and a record holding a problem: its own summary says what.
      return [{ criterion: null, result: text(module.result.summary) }];
  }
}

/* ------------------------------------------------------------------ *
 * One builder per module
 * ------------------------------------------------------------------ */

function dimensionsRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const { computed } = module;
  const measures = list(computed.measures).filter((measure): measure is string => typeof measure === "string");
  const specOf = (size: string, measure: string) => asSpec(at(computed, "spec", size, measure));
  const limited = measures.filter((measure) => sizes.some((size) => hasLimit(specOf(size, measure))));
  const parts = limited.map((measure) => {
    const label = labelOf(module, measure, measure);
    const specs = sizes.map((size) => specOf(size, measure)).filter(hasLimit);
    return sameSpecs(specs) ? `${label} ${formatSpec(specs[0], { unit: "mm" })}` : `${label} to spec`;
  });
  // A row's line, not the spec table: past two measures, the rest are named together.
  const rest = limited.slice(2);
  const criterion = rest.length === 0 ? parts : [...parts.slice(0, 2), rest.every((measure) => /thickness/i.test(measure)) ? "Thickness to spec" : "others to spec"];
  const shown = limited[0] ?? measures[0];
  const statistic = labelOf(module, "statistic", text(computed.statisticKind) === "average" ? "Average" : "Median");
  const values = shown ? sizes.map((size) => num(at(computed, "statistic", size, shown))) : [];
  const range = rangeText(values, { decimals: shown ? (num(at(computed, "decimals", shown)) ?? undefined) : undefined, unit: "mm" });
  return {
    criterion: criterion.join("; ") || null,
    result: shown && range ? `${statistic} ${labelOf(module, shown, shown)} ${range}` : null,
  };
}

function weightRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const { computed } = module;
  const average = labelOf(module, "average", "Average");
  const decimals = num(module.config?.decimals) ?? undefined;
  const specs = sizes.map((size) => asSpec(at(computed, "spec", size))).filter(hasLimit);
  const grams = num(at(computed, "indicative", "grams"));
  const threshold = num(computed.warnThresholdPct);
  let criterion: string | null = null;
  if (specs.length > 0) criterion = sameSpecs(specs) ? `${average} ${formatSpec(specs[0], { unit: "g" })}` : `${average} to spec`;
  else if (grams !== null && threshold !== null) {
    criterion = `Within ${formatNumber(threshold)}% of the indicative ${formatNumber(grams, { unit: "g" })}`;
  }
  const range = rangeText(sizes.map((size) => num(at(computed, "average", size))), { decimals, unit: "g" });
  return { criterion, result: range ? `${average} ${range}` : null };
}

function forceAtBreakRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const { computed } = module;
  const median = labelOf(module, "median", "Median");
  const min = num(module.config?.specMin) ?? num(computed.specMin);
  const standard = text(module.config?.standardLabel) ?? text(computed.standardLabel);
  const decimals = num(module.config?.decimals) ?? num(computed.decimals) ?? undefined;
  const range = rangeText(sizes.map((size) => num(at(computed, "sizes", size, "median"))), { decimals, unit: "N" });
  return {
    criterion: min === null ? standard : `${median} ≥ ${formatNumber(min, { unit: "N" })}${standard ? `, ${standard}` : ""}`,
    result: range ? `${median} ${range}` : null,
  };
}

function tensileRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const config = rec(module.config);
  const decimals = rec(config.decimals);
  const tensileMin = num(config.tensileMin);
  const elongationMin = num(config.elongationMin);
  const standard = text(config.standardLabel);
  const limits = [
    tensileMin === null ? null : `Tensile strength ≥ ${formatNumber(tensileMin, { decimals: num(decimals.tensileStrength) ?? undefined, unit: "MPa" })}`,
    elongationMin === null ? null : `elongation ≥ ${formatNumber(elongationMin, { unit: "%" })}`,
  ].filter((part): part is string => part !== null);
  const tensile = rangeText(sizes.map((size) => num(at(module.data, "sizes", size, "tensileStrength"))), {
    decimals: num(decimals.tensileStrength) ?? undefined,
    unit: "MPa",
    dash: true,
  });
  const elongation = rangeText(sizes.map((size) => num(at(module.data, "sizes", size, "elongationAtBreak"))), {
    decimals: num(decimals.elongationAtBreak) ?? undefined,
    unit: "%",
    dash: true,
  });
  const found = [tensile && `Tensile strength ${tensile}`, elongation && `elongation ${elongation}`].filter(Boolean);
  return {
    criterion: limits.length > 0 ? `${limits.join(", ")}${standard ? `; ${standard}` : ""}` : standard,
    result: found.length > 0 ? found.join(", ") : null,
  };
}

function watertightRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const { computed } = module;
  const aql = num(computed.aql) ?? num(module.config?.aql);
  const perSize = sizes.map((size) => rec(at(computed, "sizes", size)));
  const tested = sumOf(perSize.map((entry) => num(entry.tested) ?? num(entry.n)));
  const found = sumOf(perSize.map((entry) => num(entry.totalDefects)));
  return {
    criterion: aql === null ? "Watertight test" : `Watertight test, ${aqlText(aql)}`,
    result: tested === null ? null : `${counted(found ?? 0, "pinhole")} in ${counted(tested, "glove")}`,
  };
}

function visualRows(module: ExportModule, doc: InspectionExport, sizes: readonly string[], short: string): RowParts[] {
  const { computed } = module;
  return VISUAL_CLASSES.flatMap(({ key, word }): RowParts[] => {
    const definition = rec(at(computed, "classes", key));
    if (definition.include === false || Object.keys(definition).length === 0) return [];
    const aql = num(definition.aql);
    const perSize = sizes.map((size) => rec(at(computed, "sizes", size, key)));
    const inspected = sumOf(perSize.map((entry) => num(entry.inspected) ?? num(entry.n)));
    const found = sumOf(perSize.map((entry) => num(entry.total)));
    const verdicts = perSize.map((entry) => entry.result);
    return [
      {
        key: `visual:${key}`,
        check: `${short}: ${word}`,
        criterion: aql === null ? null : aql === 0 ? `${aqlText(aql)}, accept 0` : aqlText(aql),
        result: inspected === null ? null : `${formatCount(found ?? 0)} in ${counted(inspected, "glove")}`,
        status: worstOf(verdicts, module.result.status),
        failedSizes: sizes.filter((_, index) => verdicts[index] === "fail").map((size) => sizeLabel(doc, size)),
      },
    ];
  });
}

function packingRows(module: ExportModule, doc: InspectionExport, sizes: readonly string[], short: string): RowParts[] {
  const { computed } = module;
  const minLayering = num(module.config?.minLayeringPct);
  const minDispensing = num(module.config?.minDispensingPct);
  const limits = [
    minLayering === null ? null : `Layering ≥ ${formatNumber(minLayering, { unit: "%" })}`,
    minDispensing === null ? null : `dispensing ≥ ${formatNumber(minDispensing, { unit: "%" })}`,
  ].filter((part): part is string => part !== null);
  const criterion = limits.join(", ") || null;
  const percents = (values: (number | null)[]) => rangeText(values, { maxDecimals: 1, unit: "%", dash: true });
  const figures = (layering: string | null, dispensing: string | null) =>
    [layering && `Layering ${layering}`, dispensing && `dispensing ${dispensing}`].filter(Boolean).join(", ") || null;

  const perSize = sizes.map((size) => rec(at(computed, "sizes", size)));
  const boxVerdicts = perSize.map((entry) => worstOf([entry.layeringResult, entry.dispensingResult, entry.stickinessResult], "not_done"));
  const rows: RowParts[] = [
    {
      criterion,
      result: figures(percents(perSize.map((entry) => num(entry.layeringAverage))), percents(perSize.map((entry) => num(entry.dispensingAverage)))),
      status: worstOf(boxVerdicts, module.result.status),
      failedSizes: sizes.filter((_, index) => boxVerdicts[index] === "fail").map((size) => sizeLabel(doc, size)),
    },
  ];

  // The aged sample (Kenneth, 26 October 2026): judged on its own, against the boxes' minimums. Every size
  // needs one (27 October 2026): a size with none entered (no verdict of its own) is not done.
  if (sizes.length > 0) {
    const agedVerdicts = sizes.map((size) => at(computed, "sizes", size, "agedSample", "result") ?? "not_done");
    rows.push({
      key: "dispensing_packing:aged",
      check: `${short}: ${labelOf(module, "agedSample", "Aged Sample")}`,
      criterion,
      result: figures(
        percents(sizes.map((size) => num(at(module.data, "sizes", size, "agedSample", "layeringPct")))),
        percents(sizes.map((size) => num(at(module.data, "sizes", size, "agedSample", "dispensingPct")))),
      ),
      status: worstOf(agedVerdicts, "not_done"),
      failedSizes: sizes.filter((_, index) => agedVerdicts[index] === "fail").map((size) => sizeLabel(doc, size)),
    });
  }
  return rows;
}

function safedonRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const maxRate = num(module.config?.maxRatePct);
  const perSize = sizes.map((size) => rec(at(module.computed, "sizes", size)));
  const gloves = sumOf(perSize.map((entry) => num(entry.glovesInspected)));
  const defects = sumOf(perSize.map((entry) => num(entry.totalDefects))) ?? 0;
  const rate = gloves ? formatNumber((defects / gloves) * 100, { maxDecimals: 2, unit: "%" }) : null;
  return {
    criterion: maxRate === null ? null : `Defect rate ≤ ${formatNumber(maxRate, { unit: "%" })}`,
    result: gloves === null ? null : `${formatCount(defects)} in ${counted(gloves, "glove")} (${rate})`,
  };
}

function labelingRow(module: ExportModule, sizes: readonly string[]): RowParts {
  const levels = (["inner", "carton"] as const).filter((level) => rec(at(module.config, "levels", level)).include !== false);
  const names = levels.map((level) => labelOf(module, `${level}Level`, level === "inner" ? "Inner Box" : "Carton Box"));
  const boxes = sumOf(sizes.flatMap((size) => levels.map((level) => num(at(module.data, "sizes", size, level, "inspected")))));
  const defects = sumOf(sizes.flatMap((size) => levels.map((level) => num(at(module.computed, "sizes", size, level, "total"))))) ?? 0;
  return {
    criterion: names.length > 0 ? andList(names) : null,
    result: boxes === null ? null : `${counted(defects, "defect")} in ${counted(boxes, "box", "boxes")}`,
  };
}

function dyeLeakRow(module: ExportModule): RowParts {
  const tested = num(module.computed.totalTested);
  const failed = num(module.computed.totalFailed) ?? 0;
  return {
    criterion: "No pouch leaks",
    result: tested === null ? null : `${formatCount(failed)} of ${counted(tested, "pouch", "pouches")} leaked`,
  };
}

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The overall conclusion's line, from the checks: "All 9 checks passed for
 * every size on the order: S, M, L and XL." when every one passed, else
 * which failed, which are not done and which carry a warning ("8 of 9
 * checks passed for size M; Weight has a warning."). `sizes` as the template
 * shows them.
 */
export function checksVerdict(rows: readonly CheckRow[], sizes: readonly string[]): string {
  const total = rows.length;
  if (total === 0) return "No checks are recorded yet.";
  const named = (status: CheckStatus) => rows.filter((row) => row.status === status).map((row) => row.check);
  const failed = named("fail");
  const notDone = named("not_done");
  const warned = named("warn");
  const where = sizes.length === 0 ? "" : sizes.length === 1 ? ` for size ${sizes[0]}` : ` for every size on the order: ${andList(sizes)}`;
  const checks = (count: number) => (count === 1 ? "check" : "checks");

  if (failed.length === 0 && notDone.length === 0) {
    const passed = total - warned.length;
    if (warned.length === 0) return total === 1 ? `The check passed${where}.` : `All ${total} checks passed${where}.`;
    return `${passed} of ${total} ${checks(total)} passed${where}; ${andList(warned)} ${warned.length === 1 ? "has a warning" : "have warnings"}.`;
  }
  const lines: string[] = [];
  if (failed.length > 0) lines.push(`${failed.length} of ${total} ${checks(total)} failed: ${andList(failed)}.`);
  if (notDone.length > 0) {
    const count = failed.length > 0 ? `${notDone.length} ${notDone.length === 1 ? "is" : "are"}` : `${notDone.length} of ${total} ${checks(total)} ${notDone.length === 1 ? "is" : "are"}`;
    lines.push(`${count} not done: ${andList(notDone)}.`);
  }
  if (warned.length > 0) lines.push(`${andList(warned)} ${warned.length === 1 ? "has a warning" : "have warnings"}.`);
  return lines.join(" ");
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function asSpec(value: unknown): Spec | null {
  const parsed = SpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sameSpecs(specs: readonly Spec[]): boolean {
  return specs.every((spec) => JSON.stringify(spec) === JSON.stringify(specs[0]));
}

/** The sum of the values known; null when none is. */
function sumOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

const SEVERITY: Readonly<Record<CheckStatus, number>> = { fail: 3, not_done: 2, warn: 1, pass: 0 };

/** The worst verdict among the sizes' (fail, then not done, then warning); `none` when no size has one. */
function worstOf(verdicts: readonly unknown[], none: ModuleStatus): CheckStatus {
  const known = verdicts.filter((verdict): verdict is CheckStatus => typeof verdict === "string" && verdict in SEVERITY);
  if (known.length < verdicts.length) known.push("not_done");
  if (known.length === 0) return none === "info" ? "not_done" : none;
  return known.reduce((worst, verdict) => (SEVERITY[verdict] > SEVERITY[worst] ? verdict : worst));
}

/** The sizes whose own verdict is `status`, as the template shows them. */
function sizesWhere(doc: InspectionExport, module: ExportModule, status: ModuleStatus): string[] {
  const perSize = module.result.perSize ?? {};
  return orderedSizes(doc)
    .filter((size) => perSize[size]?.status === status)
    .map((size) => sizeLabel(doc, size));
}

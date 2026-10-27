// The sampling plan for the manufacturer (Kenneth, 27 October 2026: "Do a
// button to export the sampling plan using this template design. This is to
// send to the manufacturer to prepare the sample before the inspector
// arrive."): one pure function turns the inspection export
// (lib/schemas/export.ts) into the model of that one A4 landscape page,
// which components/sampling-plan draws. It tells the factory what to have
// ready: the sample at a glance (cases to pull, inner boxes taken, gloves
// drawn and those put back, gloves sampled), the order it comes from, then
// the plan size by size and what each test takes. Rows switched off on the
// Sampling Plan, or that the template does not show, are left out. Read
// defensively, as the report reads the export (lib/report/read.ts): a value
// missing reads as nothing, never as a crash, so a plan opened before it is
// complete still prints, its blanks as dashes. Client-safe.
import { CodeLetterSchema, type CodeLetter } from "@/lib/aql";
import { formatCount } from "@/lib/format";
import { andList, longDate } from "@/lib/report/format";
import { STERICARE_LETTERHEAD, type Letterhead } from "@/lib/report/letterhead";
import { NOT_STATED, poOf } from "@/lib/report/model";
import { at, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "@/lib/report/read";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import type { ModuleStatus } from "@/lib/schemas/module-result";
import { INNER_UNIT_NAMES, INNER_UNITS } from "@/modules/packing_config/config";
import {
  columnGroups,
  SAMPLING_PLAN_DEFAULT_CONFIG,
  SamplingPlanConfigSchema,
  showsCodeLetter,
  showsGlovesPerInnerBox,
  showsInnerUnitsPerCase,
  type SamplingPlanConfig,
  type ShownColumn,
} from "@/modules/sampling_plan/config";
import { samplingPlanReady } from "./paths";

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

/** What the page shows around its content: the report's chrome as the sampling plan fills it. */
export type SamplingPlanChrome = {
  letterhead: Letterhead;
  /** "Sampling Plan", set in spaced capitals. */
  bandTitle: string;
  /** "PO-0001 · Inspection 20 October 2026"; null with neither. */
  bandAside: string | null;
  /** "Prepared for Manufacturer A · PO-0001"; null with neither. */
  footerLeft: string | null;
  footerRight: string;
};

/** One of the info card's details: the value, or "Not stated". */
export type SamplingPlanFact = {
  key: "client" | "poNo" | "manufacturer" | "inspectionDate";
  label: string;
  value: string;
  stated: boolean;
};

export type SamplingPlanSize = { value: string; label: string };

/** A count in a size's column. */
export type SamplingPlanCell = {
  value: number | null;
  /**
   * Stands apart from the row's usual count, so the factory sees it: the XL
   * cases' 2 inner boxes where the others take 1, the M boxes' 11 gloves
   * where the others give 13. Only in a row with no total (per case, per box).
   */
  odd: boolean;
};

export type SamplingPlanRowKey =
  | "cases"
  | "innerUnitsPerCase"
  | "innerUnits"
  | "glovesPerInnerBox"
  | "glovesDrawn"
  | "putBack"
  | "gloves"
  | "pouches"
  | "glovesWatertightVisual"
  | "glovesDimensions"
  | "glovesPhysical"
  | "innerUnitsDispensing"
  | "pouchesDyeLeak";

export type SamplingPlanRow = {
  key: SamplingPlanRowKey;
  /** "Cases to pull", "Watertight & visual". */
  label: string;
  /** What a test row counts, in grey after its name: "gloves", "inner boxes". */
  unit: string | null;
  /** One per size, in the sizes' order. */
  cells: SamplingPlanCell[];
  /** False where a sum means nothing (per case, per box): no total. */
  summed: boolean;
  /** The sizes' sum; null while none is known, and where not summed. */
  total: number | null;
  /** Put Back: taken away from the gloves drawn, shown as −8. */
  negative: boolean;
  /** Gloves sampled: what the plan comes to, tinted. */
  highlight: boolean;
};

export type SamplingPlanGroup = {
  key: "quantity" | "tests";
  /** "Sampling Quantity", "For Each Test": set in spaced capitals. */
  title: string;
  rows: SamplingPlanRow[];
};

/** A line of The Sample at a Glance: the big number, and the words after it. */
export type GlanceLine = {
  key: "cases" | "innerUnits" | "glovesDrawn" | "gloves";
  value: number;
  /** "cases to pull", "gloves drawn, 36 put back". */
  text: string;
  /** Gloves sampled, tinted. */
  highlight: boolean;
};

export type SamplingPlanOrderLine = {
  size: string;
  label: string;
  /** As entered, blanks left out. */
  lots: string[];
  cases: number;
  /** Cases × gloves per case; null until the packing is known. */
  gloves: number | null;
};

/** The Order card: what the samples come from. */
export type SamplingPlanOrder = {
  /** "1,000 gloves per case"; null until the packing is known. */
  glovesPerCase: number | null;
  lines: SamplingPlanOrderLine[];
  totalCases: number;
  /** Null until every size's gloves are known. */
  totalGloves: number | null;
};

/** The words for what the template counts: gloves, or pairs (STD_SG). */
export type UnitWords = { one: string; many: string };

export type SamplingPlanModel = {
  refNo: string;
  /** The Sampling Plan step's result, as the capture screen shows it. */
  status: ModuleStatus;
  /** The step is Done (samplingPlanReady): what Export Sampling Plan waits for. */
  complete: boolean;
  chrome: SamplingPlanChrome;
  /** "Nitrile Examination Gloves": the glove's material and the template's product type, over the title. */
  kicker: string;
  /** The product's name, else the template's words. */
  title: string;
  lead: string;
  facts: SamplingPlanFact[];
  /** The ordered sizes, in the template's order, as it shows them: the table's columns. */
  sizes: SamplingPlanSize[];
  /** Every size the template lists, in its order: what the size chips are coloured by (sizeTone). */
  templateSizes: string[];
  unit: UnitWords;
  glance: GlanceLine[];
  /** Null without an order. */
  order: SamplingPlanOrder | null;
  groups: SamplingPlanGroup[];
  /** A Total column: more than one size ordered. */
  showTotal: boolean;
  /** "Sample sizes follow ISO 2859-1 single sampling, code letters L, M, L and K for sizes S, M, L and XL."; null without a letter. */
  note: string | null;
  /** The PO as the band names it, the bracketed reference left out ("PO-0001"): the PDF's name. */
  po: string | null;
};

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const SAMPLING_PLAN_TITLE = "Sampling Plan";
export const SAMPLING_PLAN_LEAD = "Please have these samples ready for SteriCare's pre-shipment inspection.";
export const SAMPLING_PLAN_FOOTER = "Computer-generated document. No signature required.";
export const GLANCE_TITLE = "The Sample at a Glance";
export const ORDER_TITLE = "Order";
export const PLAN_TABLE_TITLE = "Sampling Plan by Size";

const GROUP_TITLES = { quantity: "Sampling Quantity", tests: "For Each Test" } as const;

/** The materials a Glove Type names, as the kicker words them ("Nitrile, powder free" is Nitrile). */
const MATERIALS: readonly (readonly [RegExp, string])[] = [
  [/\bnitrile\b/i, "Nitrile"],
  [/\blatex\b/i, "Latex"],
  [/\b(?:vinyl|pvc)\b/i, "Vinyl"],
  [/\bpolyisoprene\b/i, "Polyisoprene"],
  [/\b(?:poly)?chloroprene\b|\bneoprene\b/i, "Neoprene"],
];

/* ------------------------------------------------------------------ *
 * Building it
 * ------------------------------------------------------------------ */

/** The page's model; null when the inspection has no sampling plan to send. */
export function buildSamplingPlanModel(doc: InspectionExport): SamplingPlanModel | null {
  const plan = moduleOf(doc, "sampling_plan");
  if (!plan) return null;
  const header = moduleOf(doc, "header");
  const config = configOf(plan);
  const sizes = orderedSizes(doc);
  const unit: UnitWords = doc.template.unit === "pairs" ? { one: "pair", many: "pairs" } : { one: "glove", many: "gloves" };
  const inner = innerUnitOf(doc);
  const groups = groupsOf(doc, plan, config, sizes, unit, inner);
  const po = poOf(text(header?.data.poNo));
  const inspectedOn = longDate(text(header?.computed.inspectionDate) ?? text(header?.data.inspectionDate));
  const manufacturer = text(header?.computed.manufacturer) ?? text(doc.template.manufacturer?.name);
  const client = text(header?.computed.client) ?? text(doc.template.client?.name);
  const fact = (key: SamplingPlanFact["key"], label: string, value: string | null): SamplingPlanFact => ({
    key,
    label,
    value: value ?? NOT_STATED,
    stated: value !== null,
  });
  return {
    refNo: doc.refNo,
    status: plan.result.status,
    complete: samplingPlanReady(plan.result.status),
    chrome: {
      letterhead: STERICARE_LETTERHEAD,
      bandTitle: SAMPLING_PLAN_TITLE,
      bandAside: joined([po, inspectedOn ? `Inspection ${inspectedOn}` : null]),
      footerLeft: joined([manufacturer ? `Prepared for ${manufacturer}` : null, po]),
      footerRight: SAMPLING_PLAN_FOOTER,
    },
    kicker: productKind(doc),
    title: text(header?.data.productName) ?? templateWords(doc.template.reportTitle),
    lead: SAMPLING_PLAN_LEAD,
    facts: [
      fact("client", "Client", client),
      fact("poNo", "PO / SO Number", text(header?.data.poNo)),
      fact("manufacturer", "Manufacturer", manufacturer),
      fact("inspectionDate", "Inspection Date", inspectedOn),
    ],
    sizes: sizes.map((size) => ({ value: size, label: sizeLabel(doc, size) })),
    templateSizes: (doc.template.sizes ?? []).map((size) => size.value),
    unit,
    glance: glanceOf(groups, unit, inner),
    order: orderOf(doc, sizes),
    groups,
    showTotal: sizes.length > 1,
    note: showsCodeLetter(config) ? codeLetterNote(doc, plan, sizes) : null,
    po,
  };
}

/** The plan's config as the inspection worked with it; the module's defaults where the export carries none. */
function configOf(plan: ExportModule): SamplingPlanConfig {
  const parsed = SamplingPlanConfigSchema.safeParse(plan.config);
  return parsed.success ? parsed.data : SAMPLING_PLAN_DEFAULT_CONFIG;
}

/** "inner box" and "inner boxes": the packing configuration's inner unit, as the factory names it. */
function innerUnitOf(doc: InspectionExport): UnitWords {
  const packing = moduleOf(doc, "packing_config");
  // Calc names it in its computed values; the config's choice, else an inner box, where those are missing.
  const configured = INNER_UNITS.find((entry) => entry === rec(packing?.config).innerUnit);
  const one = text(packing?.computed.innerUnit) ?? INNER_UNIT_NAMES[configured ?? "inner_box"];
  return { one, many: plural(one) };
}

function plural(noun: string): string {
  return /(?:s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`;
}

const capitalised = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** "Nitrile Examination Gloves": Glove Information's material, if it names one, and the template's product type. */
export function productKind(doc: Pick<InspectionExport, "modules" | "template">): string {
  const gloveType = text(moduleOf(doc, "glove_info")?.data.gloveType);
  const material = gloveType ? MATERIALS.find(([pattern]) => pattern.test(gloveType))?.[1] : undefined;
  const kind = doc.template.productType === "surgical" ? "Surgical Gloves" : "Examination Gloves";
  return material ? `${material} ${kind}` : kind;
}

/** "Preshipment Inspection: Nitrile Disposable Examination Gloves" as "Nitrile Disposable Examination Gloves". */
function templateWords(reportTitle: string): string {
  const index = reportTitle.indexOf(":");
  return (index === -1 ? reportTitle : reportTitle.slice(index + 1)).trim() || reportTitle;
}

function joined(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null);
  return kept.length > 0 ? kept.join(" · ") : null;
}

/* ------------------------------------------------------------------ *
 * The plan by size
 * ------------------------------------------------------------------ */

type RowSpec = Omit<SamplingPlanRow, "cells" | "total"> & { values: (number | null)[] };

/**
 * The table's two groups, as the Sampling Plan step orders its rows
 * (modules/sampling_plan/rows.ts), worded for the factory: the cases to
 * pull, the inner boxes per case and taken, the gloves per inner box, drawn
 * and put back, the gloves sampled; then what each test takes. A row shows
 * where the template shows its column and the inspector has not switched it
 * off; the inner boxes per case where any size has one (data saved before
 * them, or a document that gives only the total, has none).
 */
function groupsOf(
  doc: InspectionExport,
  plan: ExportModule,
  config: SamplingPlanConfig,
  sizes: readonly string[],
  unit: UnitWords,
  inner: UnitWords,
): SamplingPlanGroup[] {
  const off = new Set(list(plan.data.rowsOff).filter((key): key is string => typeof key === "string"));
  const count = (size: string, column: string) => num(at(plan.data, "sizes", size, column));
  const worked = (size: string, key: string) => num(at(plan.computed, "sizes", size, key));
  const valuesOf = (read: (size: string) => number | null) => sizes.map(read);
  const physical = moduleOf(doc, "tensile") && !moduleOf(doc, "force_at_break") ? "Tensile" : "Force at break (FAB)";
  const row = (key: SamplingPlanRowKey, label: string, values: (number | null)[], extra: Partial<RowSpec> = {}): RowSpec => ({
    key,
    label,
    unit: null,
    values,
    summed: true,
    negative: false,
    highlight: false,
    ...extra,
  });
  const columnRow = (column: ShownColumn): RowSpec => {
    const values = valuesOf((size) => count(size, column));
    switch (column) {
      case "cases":
        return row("cases", "Cases to pull", values);
      case "innerUnits":
        return row("innerUnits", `${capitalised(inner.many)} taken`, values);
      case "gloves":
        return row("gloves", `${capitalised(unit.many)} sampled`, values, { highlight: true });
      case "pouches":
        return row("pouches", "Pouches taken", values);
      case "glovesWatertightVisual":
        return row("glovesWatertightVisual", "Watertight & visual", values, { unit: unit.many });
      case "glovesDimensions":
        return row("glovesDimensions", "Dimension", values, { unit: unit.many });
      case "glovesPhysical":
        return row("glovesPhysical", physical, values, { unit: unit.many });
      case "innerUnitsDispensing":
        return row("innerUnitsDispensing", "Packaging & dispensing", values, { unit: inner.many });
      case "pouchesDyeLeak":
        return row("pouchesDyeLeak", "Dye leak", values, { unit: "pouches" });
    }
  };
  const { quantity, tests } = columnGroups(config);
  const shown = (column: ShownColumn) => !off.has(column);

  const quantityRows = quantity.filter(shown).flatMap((column): RowSpec[] => {
    if (column === "innerUnits" && showsInnerUnitsPerCase(config)) {
      const perCase = valuesOf((size) => count(size, "innerUnitsPerCase"));
      const rows = perCase.some((value) => value !== null)
        ? [row("innerUnitsPerCase", `${capitalised(inner.many)} per case`, perCase, { summed: false })]
        : [];
      return [...rows, columnRow(column)];
    }
    if (column === "gloves" && showsGlovesPerInnerBox(config)) {
      const perBox = valuesOf((size) => worked(size, "glovesPerInnerBox"));
      const innerUnits = valuesOf((size) => count(size, "innerUnits"));
      // Per box × inner boxes: what is taken from the boxes before the put back.
      const drawn = perBox.map((each, index) => {
        const boxes = innerUnits[index];
        return each === null || boxes === null ? null : each * boxes;
      });
      return [
        row("glovesPerInnerBox", `${capitalised(unit.many)} per ${inner.one}`, perBox, { summed: false }),
        row("glovesDrawn", `${capitalised(unit.many)} drawn`, drawn),
        row("putBack", "Put back", valuesOf((size) => worked(size, "putBack")), { negative: true }),
        columnRow(column),
      ];
    }
    return [columnRow(column)];
  });
  const testRows = tests.filter(shown).map(columnRow);

  return (
    [
      { key: "quantity", title: GROUP_TITLES.quantity, rows: quantityRows },
      { key: "tests", title: GROUP_TITLES.tests, rows: testRows },
    ] as const
  )
    .filter((group) => group.rows.length > 0)
    .map((group) => ({ key: group.key, title: group.title, rows: group.rows.map(finished) }));
}

function finished({ values, ...spec }: RowSpec): SamplingPlanRow {
  const odd = spec.summed ? values.map(() => false) : oddOnesOut(values);
  return { ...spec, cells: values.map((value, index) => ({ value, odd: odd[index] })), total: spec.summed ? sumOf(values) : null };
}

/** The values entered, summed; null while none is. */
function sumOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

/**
 * The counts that differ from the row's usual one: the count most sizes
 * share, where one does (at least two sizes, and no other as common). None
 * where the counts are all different, or tie.
 */
export function oddOnesOut(values: readonly (number | null)[]): boolean[] {
  const tally = new Map<number, number>();
  for (const value of values) if (value !== null) tally.set(value, (tally.get(value) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first || first[1] < 2 || (second && second[1] === first[1])) return values.map(() => false);
  return values.map((value) => value !== null && value !== first[0]);
}

/* ------------------------------------------------------------------ *
 * At a glance, the order, the code letters
 * ------------------------------------------------------------------ */

/** The table's totals in words: what to pull, take, draw (and put back) and keep. */
function glanceOf(groups: readonly SamplingPlanGroup[], unit: UnitWords, inner: UnitWords): GlanceLine[] {
  const total = (key: SamplingPlanRowKey) => groups.flatMap((group) => group.rows).find((row) => row.key === key)?.total ?? null;
  const lines: GlanceLine[] = [];
  const cases = total("cases");
  if (cases !== null) lines.push({ key: "cases", value: cases, text: cases === 1 ? "case to pull" : "cases to pull", highlight: false });
  const innerUnits = total("innerUnits");
  if (innerUnits !== null) {
    lines.push({ key: "innerUnits", value: innerUnits, text: `${innerUnits === 1 ? inner.one : inner.many} taken`, highlight: false });
  }
  const drawn = total("glovesDrawn");
  if (drawn !== null) {
    const putBack = total("putBack");
    const back = putBack === null ? "" : putBack === 0 ? ", none put back" : `, ${formatCount(putBack)} put back`;
    lines.push({ key: "glovesDrawn", value: drawn, text: `${drawn === 1 ? unit.one : unit.many} drawn${back}`, highlight: false });
  }
  const gloves = total("gloves");
  if (gloves !== null) lines.push({ key: "gloves", value: gloves, text: `${gloves === 1 ? unit.one : unit.many} sampled`, highlight: true });
  return lines;
}

/** Each ordered size's lots, cases and gloves, and the totals; null with nothing ordered. */
function orderOf(doc: InspectionExport, sizes: readonly string[]): SamplingPlanOrder | null {
  const order = moduleOf(doc, "order_lots");
  if (!order || sizes.length === 0) return null;
  const packing = moduleOf(doc, "packing_config");
  const glovesPerCase = num(packing?.data.glovesPerCase) ?? num(packing?.computed.glovesPerCaseCheck);
  const lines = sizes.map((size): SamplingPlanOrderLine => {
    const line = rec(at(order.data, "sizes", size));
    const cases = num(line.qtyCases) ?? 0;
    return {
      size,
      label: sizeLabel(doc, size),
      lots: list(line.lotNumbers).flatMap((lot) => {
        const kept = text(lot);
        return kept === null ? [] : [kept];
      }),
      cases,
      gloves: num(at(order.computed, "lotSizeGloves", size)) ?? (glovesPerCase === null ? null : cases * glovesPerCase),
    };
  });
  const gloves = lines.map((line) => line.gloves);
  return {
    glovesPerCase,
    lines,
    totalCases: lines.reduce((sum, line) => sum + line.cases, 0),
    totalGloves: gloves.every((value) => value !== null) ? sumOf(gloves) : null,
  };
}

/**
 * The note under the table: each size's code letter, the one its gloves are
 * taken from (the Sampling Plan's Code Letter row), else its lot's at the
 * general level (calc's), and "(reduced from N)" where the inspector lowered
 * it (Kenneth, 27 October 2026). Null while no size has one.
 */
function codeLetterNote(doc: InspectionExport, plan: ExportModule, sizes: readonly string[]): string | null {
  const entries = sizes.flatMap((size) => {
    const letter = codeLetter(at(plan.data, "sizes", size, "codeLetter")) ?? codeLetter(at(plan.computed, "sizes", size, "codeLetter"));
    if (letter === null) return [];
    const from = codeLetter(at(plan.computed, "sizes", size, "reducedFrom"));
    return [{ size: sizeLabel(doc, size), letter: from === null ? letter : `${letter} (reduced from ${from})` }];
  });
  if (entries.length === 0) return null;
  const several = entries.length > 1;
  const letters = andList(entries.map((entry) => entry.letter));
  const sizeNames = andList(entries.map((entry) => entry.size));
  return `Sample sizes follow ISO 2859-1 single sampling, code ${several ? "letters" : "letter"} ${letters} for ${several ? "sizes" : "size"} ${sizeNames}.`;
}

function codeLetter(value: unknown): CodeLetter | null {
  const parsed = CodeLetterSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ *
 * The PDF's name
 * ------------------------------------------------------------------ */

/**
 * What the browser's Save as PDF names the file, after the one Kenneth sent
 * (27 October 2026): the day it is made, then the PO,
 * "2026-10-27_sampling-plan_PO-0001", the PO's slashes and spaces as
 * hyphens; the reference number without a PO.
 */
export function samplingPlanFileName(model: Pick<SamplingPlanModel, "po" | "refNo">, today: string): string {
  const reference = (model.po ?? model.refNo)
    .replace(/^P\.?O\.?\s*/i, "PO")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${today}_sampling-plan_${reference || model.refNo}`;
}

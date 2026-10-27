// Section 02, Order, Product & Sampling (TG35 page 2; docs/REPORT.md
// "Adding a section"): what was ordered, how it is packed, and which
// cartons were drawn for inspection. Four blocks, each switched on or off on
// the Report page:
//
// - Glove Information (glove_info, and the header's Factory Glove Code), in
//   the template's labels, a listed colour with its swatch;
// - Packing Configuration (packing_config): gloves per inner unit › inner
//   units per case › gloves per case, the inner unit the template's;
// - Order Lots & Sampling Plan (order_lots and sampling_plan): a row per
//   size with its lots, the cases and gloves ordered and their share, what
//   was sampled and what each test takes (a test row switched off on the
//   Sampling Plan is left out), then the totals;
// - Finished Goods Sampling (carton_sampling): a strip per size, each
//   sampled box/carton number placed along 1 to the cases ordered.
//
// The sizes are those on the order (orderedSizes); a template size not on
// it is named in the lead. A block with nothing recorded is left out, a
// value not entered reads "Not stated", and a value the app judged wrong
// (a sampling count in error, a box/carton number outside the lot or
// entered twice) is marked to print in fail red, a warning in amber. When
// the blocks run past a page, they continue on the next
// (layoutOrderSampling).
import { formatNumber } from "@/lib/format";
import type { ExportIssue, ExportModule, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES, type ReportBlockKey } from "@/lib/schemas/report-options";
import { normaliseSize } from "@/lib/sizes";
import { listedColour } from "@/modules/glove_info/colours";
import { andList, counted, sharesOf } from "../format";
import type { ReportSectionContent } from "../model";
import { at, isRecord, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import { defineSection } from "./index";
import { layoutOrderSampling, lotsColumnWidths, ORDER_SAMPLING_ROOM } from "./order-sampling-layout";

/* ------------------------------------------------------------------ *
 * The content
 * ------------------------------------------------------------------ */

export type GloveFactKey = "surfaceTexture" | "colour" | "indicativeWeight" | "length" | "gloveType" | "factoryGloveCode";

/** One detail of Glove Information: the template's label, the value or "Not stated". */
export type GloveFact = {
  key: GloveFactKey;
  /** "Glove Surface Texture", "Indicative Weight (Size M)". */
  label: string;
  /** "Finger-textured", "3.5 g", "240 mm minimum"; "Not stated" while nothing is entered. */
  value: string;
  stated: boolean;
  /** A listed glove colour's swatch, as CSS: "#111827". */
  swatch: string | null;
};

export type GloveCard = { title: string; facts: GloveFact[] };

export type PackingTileKey = "glovesPerInner" | "innersPerCase" | "glovesPerCase";

/** One step of the packing: its count, null while not entered. */
export type PackingTile = {
  key: PackingTileKey;
  value: number | null;
  /** Under the count: "gloves per inner box", "inner boxes per case", "gloves per case". */
  caption: string;
};

export type PackingCard = { title: string; tiles: PackingTile[] };

/** The sampling plan's counts the table can show, in its order (sampling_plan's columns, never the gloves for weight). */
export const SAMPLING_KEYS = [
  "cases",
  "innerUnits",
  "gloves",
  "pouches",
  "glovesWatertightVisual",
  "glovesDimensions",
  "glovesPhysical",
  "innerUnitsDispensing",
  "pouchesDyeLeak",
] as const;
export type SamplingKey = (typeof SAMPLING_KEYS)[number];

/** The table's header groups: Order, Sampling Quantity, Gloves per Test, Boxes, and a surgical form's pouch test. */
export type LotsGroupKey = "order" | "quantity" | "tests" | "units" | "pouchTests";

export type LotsColumn = {
  /** "order.cases", "order.gloves", "order.share", "sampling.cases", "sampling.glovesDimensions", … */
  id: string;
  group: LotsGroupKey;
  /** "Cases", "Inner Boxes", "Dimension". */
  label: string;
};

export type LotsGroup = { key: LotsGroupKey; label: string; span: number };

/** A value as the app judged it: an error prints in fail red, a warning in amber. */
export type CellTone = "fail" | "warn" | null;

export type LotsCell = { value: number | null; tone: CellTone };

export type LotsRow = {
  size: string;
  /** As the template shows the size. */
  label: string;
  /** The size's lot numbers, as entered. */
  lots: string[];
  /** The lot cell as printed: the lots, or "Not stated". */
  lotText: string;
  /** By column id; the share is in percent, one decimal, the shares adding up to 100. */
  cells: Record<string, LotsCell>;
};

export type OrderLotsTable = {
  title: string;
  /** The template's captions of the first two columns: "Size", "Lot Number". */
  sizeHeader: string;
  lotHeader: string;
  groups: LotsGroup[];
  columns: LotsColumn[];
  rows: LotsRow[];
  /** By column id; the share's total is 100 once anything is ordered. */
  totals: Record<string, number | null>;
  /** Each column's width in percent of the table's: "size", "lot" and the columns' ids. */
  widths: Record<string, number>;
};

/** One size's sampled box/carton numbers. */
export type CartonRow = {
  size: string;
  label: string;
  /** The cases ordered: the lot's box/carton numbers run from 1 to this. */
  ordered: number;
  /** The cases the sampling plan samples; null while not entered. */
  planned: number | null;
  /** Every box/carton number entered, lowest first, a repeat kept. */
  cartons: number[];
  /** As printed, in the same order: zero-padded to the lot's digits, at most three ("015", "1097"). */
  numbers: string[];
  /** Numbers that break 6.2 rule 6: outside 1 to the cases ordered, or entered twice. */
  failing: number[];
  /** More box/carton numbers than the cases sampled (6.2 rule 6). */
  overCount: boolean;
};

export type CartonStrips = {
  title: string;
  /** "67 cartons were opened, spread from the start to the end of each lot." */
  summary: string;
  /** The design's key to the marks. */
  legend: string;
  rows: CartonRow[];
};

/** A size's strip, or a part of its numbers where they run past a page (`continued` from the page before). */
export type CartonSlice = { row: number; from: number; to: number; continued: boolean };

/** What a page prints after the section's heading, in order. */
export type OrderSamplingPart =
  | { kind: "cards" }
  | { kind: "lots" }
  /** The strips; `continued` when the block began on the page before (no summary line then). */
  | { kind: "cartons"; continued: boolean; slices: CartonSlice[] };

export type OrderSamplingPage = { parts: OrderSamplingPart[] };

/** Section 02's content: the blocks switched on that hold something, and the pages they fill. */
export type OrderSamplingContent = ReportSectionContent & {
  /** Under the title: what the section shows, and the template's sizes not on the order. */
  lead: string;
  glove: GloveCard | null;
  packing: PackingCard | null;
  lots: OrderLotsTable | null;
  cartons: CartonStrips | null;
  /** One per page: pageCount of them. */
  pages: OrderSamplingPage[];
};

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

/** The model's NOT_STATED: a builder imports only types from the model. */
const NOT_STATED = "Not stated";

export const ORDER_SAMPLING_LEAD = "What was ordered, how it is packed, and which cartons were drawn for inspection.";

export const CARTON_LEGEND = "One sampled carton, placed by its number in the lot";

type BlockKey = ReportBlockKey<"orderSampling">;

export const orderSampling = defineSection({
  key: "orderSampling",
  build(doc, entry) {
    const sizes = orderedSizes(doc);
    const block = (key: BlockKey) => entry.blocks.find((candidate) => candidate.key === key)?.label ?? null;
    const gloveTitle = block("gloveInformation");
    const packingTitle = block("packingConfiguration");
    const lotsTitle = block("orderLotsSampling");
    const cartonsTitle = block("finishedGoodsSampling");
    const glove = gloveTitle === null ? null : gloveCardOf(doc, gloveTitle, sizes);
    const packing = packingTitle === null ? null : packingCardOf(doc, packingTitle);
    const paper = paperOf(doc);
    const lots = lotsTitle === null ? null : lotsTableOf(doc, lotsTitle, sizes, paper.width - ORDER_SAMPLING_ROOM.margins);
    const cartons = cartonsTitle === null ? null : cartonStripsOf(doc, cartonsTitle, sizes);
    if (!glove && !packing && !lots && !cartons) return null;
    const blocks = { lead: leadOf(doc, sizes), glove, packing, lots, cartons };
    const pages = layoutOrderSampling(blocks, paper, { footerNote: doc.report.footerNote !== null });
    return { ...blocks, pages, pageCount: pages.length };
  },
});

/** The paper upright, in millimetres: the report prints portrait. */
function paperOf(doc: InspectionExport): { width: number; height: number } {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  return { width: paper.width, height: paper.height };
}

/** "… drawn for inspection. Size XS was not on this order.": the template's sizes the order leaves out. */
export function leadOf(doc: Pick<InspectionExport, "template">, sizes: readonly string[]): string {
  if (sizes.length === 0) return ORDER_SAMPLING_LEAD;
  const missing = (doc.template.sizes ?? [])
    .filter((size) => !sizes.includes(normaliseSize(size.value) ?? size.value))
    .map((size) => text(size.label) ?? size.value);
  if (missing.length === 0) return ORDER_SAMPLING_LEAD;
  const one = missing.length === 1;
  return `${ORDER_SAMPLING_LEAD} ${one ? "Size" : "Sizes"} ${andList(missing)} ${one ? "was" : "were"} not on this order.`;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** A size's entry of a per-size record, under the size or another spelling of it in older data. */
function bySize(record: unknown, size: string): Record<string, unknown> {
  const entries = rec(record);
  if (isRecord(entries[size])) return entries[size];
  const key = Object.keys(entries).find((candidate) => (normaliseSize(candidate) ?? candidate) === size);
  return key === undefined ? {} : rec(entries[key]);
}

/** A count above 0, else null: a count of 0 is no packing at all (packing_config's rule). */
function positive(value: unknown): number | null {
  const count = num(value);
  return count !== null && count > 0 ? count : null;
}

function strings(value: unknown): string[] {
  return list(value).flatMap((item) => {
    const entry = text(item);
    return entry === null ? [] : [entry];
  });
}

/** "gloves", or "pairs" where the template counts pairs. */
function unitWordOf(doc: Pick<InspectionExport, "template">): "gloves" | "pairs" {
  return doc.template.unit === "pairs" ? "pairs" : "gloves";
}

/** What one inner unit is, as the template's packing names it: "inner box", "plastic pack". */
function innerUnitOf(doc: Pick<InspectionExport, "modules">): string {
  return (text(moduleOf(doc, "packing_config")?.computed.innerUnit) ?? "inner box").toLowerCase();
}

/** The gloves in a case: as entered, else the inner units' product (packing_config's context). */
function glovesPerCaseOf(doc: Pick<InspectionExport, "modules">): number | null {
  const packing = moduleOf(doc, "packing_config");
  return positive(packing?.data.glovesPerCase) ?? positive(packing?.computed.glovesPerCaseCheck);
}

/** "inner boxes", "plastic packs", "pouches". */
export function pluralOf(noun: string): string {
  return /(?:s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`;
}

/** "inner boxes" as "Inner Boxes": a column's caption, in Title Case. */
function titleCase(words: string): string {
  return words.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

/* ------------------------------------------------------------------ *
 * Glove Information
 * ------------------------------------------------------------------ */

type Variant = Record<string, unknown>;

/** A variant's sizes as the template shows them; none picked: every size. */
function variantSizes(doc: Pick<InspectionExport, "template">, variant: Variant): string[] {
  return strings(variant.sizes).map((size) => sizeLabel(doc, normaliseSize(size) ?? size));
}

/**
 * One field across the glove's variants: its one value, or, for an
 * inspection saved with several variants (before one glove per inspection,
 * 26 October 2026), each variant's with its sizes: "Blue (S, M); Black (L)".
 */
function acrossVariants(doc: Pick<InspectionExport, "template">, variants: readonly Variant[], read: (variant: Variant) => string | null): string | null {
  const values = variants.flatMap((variant) => {
    const value = read(variant);
    return value === null ? [] : [{ value, sizes: variantSizes(doc, variant) }];
  });
  if (values.length === 0) return null;
  if (new Set(values.map((entry) => entry.value)).size === 1) return values[0].value;
  return values.map(({ value, sizes }) => (sizes.length > 0 ? `${value} (${sizes.join(", ")})` : value)).join("; ");
}

const gramsOf = (variant: Variant) => {
  const grams = positive(variant.indicativeWeight);
  return grams === null ? null : formatNumber(grams, { unit: "g" });
};

const lengthOf = (variant: Variant) => {
  const length = positive(variant.length);
  return length === null ? null : formatNumber(length, { unit: "mm" });
};

/**
 * "Indicative Weight (Size M)": the template's label, naming the size the
 * weight is given for (glove_info's weightSizeOf: a variant's one size,
 * else the template's reference size). Several weights name their sizes in
 * the value instead.
 */
function weightLabel(doc: Pick<InspectionExport, "template">, module: ExportModule, variants: readonly Variant[]): string {
  const label = labelOf(module, "indicativeWeight", "Indicative Weight (Size M)");
  const bare = label.replace(/\s*\(size [^)]*\)\s*$/i, "");
  if (/\bsize\b/i.test(bare)) return bare;
  const reference = normaliseSize(text(module.config?.indicativeWeightSize) ?? "M") ?? "M";
  const weighed = variants.filter((variant) => positive(variant.indicativeWeight) !== null);
  if (weighed.length > 1) return bare;
  const sizes = weighed.length === 0 ? [] : strings(weighed[0].sizes).map((size) => normaliseSize(size) ?? size);
  const size = sizes.length === 1 ? sizes[0] : sizes.length === 0 || sizes.includes(reference) ? reference : null;
  return size === null ? bare : `${bare} (Size ${sizeLabel(doc, size)})`;
}

/** "240 mm minimum" where the dimensions' length spec is that minimum for every size on the order (TG35 page 2), else "240 mm". */
function lengthText(doc: InspectionExport, variants: readonly Variant[], sizes: readonly string[]): string | null {
  const value = acrossVariants(doc, variants, lengthOf);
  if (value === null) return null;
  const lengths = new Set(variants.flatMap((variant) => positive(variant.length) ?? []));
  const dimensions = moduleOf(doc, "dimensions");
  if (lengths.size !== 1 || !dimensions || sizes.length === 0) return value;
  const [length] = lengths;
  const minimum = sizes.every((size) => {
    const spec = rec(at(dimensions.computed, "spec", size, "length"));
    return spec.kind === "min" && num(spec.min) === length;
  });
  return minimum ? `${value} minimum` : value;
}

/** The glove's details in the design's order, by the template's labels; a field the template switches off is left out. */
export function gloveCardOf(doc: InspectionExport, title: string, sizes: readonly string[]): GloveCard | null {
  const glove = moduleOf(doc, "glove_info");
  if (!glove) return null;
  const fields = rec(glove.config?.fields);
  const shown = (field: string) => fields[field] !== false;
  const variants = list(glove.data.variants).filter(isRecord);
  const facts: GloveFact[] = [];
  const add = (key: GloveFactKey, label: string, value: string | null, swatch: string | null = null) =>
    facts.push({ key, label, value: value ?? NOT_STATED, stated: value !== null, swatch: value === null ? null : swatch });

  if (shown("surfaceTexture")) {
    add("surfaceTexture", labelOf(glove, "surfaceTexture", "Glove Surface Texture"), acrossVariants(doc, variants, (variant) => text(variant.surfaceTexture)));
  }
  if (shown("colour")) {
    const colour = acrossVariants(doc, variants, (variant) => text(variant.colour));
    add("colour", labelOf(glove, "colour", "Glove Colour"), colour, listedColour(colour)?.swatch ?? null);
  }
  if (shown("indicativeWeight")) add("indicativeWeight", weightLabel(doc, glove, variants), acrossVariants(doc, variants, gramsOf));
  if (shown("length")) add("length", labelOf(glove, "length", "Glove Length"), lengthText(doc, variants, sizes));
  // The design's Glove Category: the Glove Type, once per inspection.
  if (shown("gloveType")) add("gloveType", labelOf(glove, "gloveType", "Glove Type"), text(glove.data.gloveType));
  const header = moduleOf(doc, "header");
  if (header && rec(header.config?.fields).factoryGloveCode !== false) {
    add("factoryGloveCode", labelOf(header, "factoryGloveCode", "Factory Glove Code"), text(header.data.factoryGloveCode));
  }
  return facts.some((fact) => fact.stated) ? { title, facts } : null;
}

/* ------------------------------------------------------------------ *
 * Packing Configuration
 * ------------------------------------------------------------------ */

/** Gloves per inner unit › inner units per case › gloves per case, as the template's packing names the inner unit; null with none entered. */
export function packingCardOf(doc: InspectionExport, title: string): PackingCard | null {
  const packing = moduleOf(doc, "packing_config");
  if (!packing) return null;
  const perInner = positive(packing.data.glovesPerInner);
  const innersPerCase = positive(packing.data.innersPerCase);
  const perCase = glovesPerCaseOf(doc);
  if (perInner === null && innersPerCase === null && perCase === null) return null;
  const unit = unitWordOf(doc);
  const inner = innerUnitOf(doc);
  return {
    title,
    tiles: [
      { key: "glovesPerInner", value: perInner, caption: `${unit} per ${inner}` },
      { key: "innersPerCase", value: innersPerCase, caption: `${pluralOf(inner)} per case` },
      { key: "glovesPerCase", value: perCase, caption: `${unit} per case` },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Order Lots & Sampling Plan
 * ------------------------------------------------------------------ */

/** The sampling plan's issues that point at one count of a size (sampling_plan's calc codes). */
const ISSUE_COUNT: Readonly<Record<string, SamplingKey>> = {
  cases_zero: "cases",
  cases_above_order: "cases",
  inner_units_mismatch: "innerUnits",
  code_letter_mismatch: "gloves",
  invalid_sample_size: "glovesWatertightVisual",
  nonstandard_sample: "glovesWatertightVisual",
};

/** "size:count" → the worst the app said of it: an error over a warning. */
function issueTones(module: ExportModule): Map<string, Exclude<CellTone, null>> {
  const tones = new Map<string, Exclude<CellTone, null>>();
  const mark = (issues: readonly ExportIssue[], tone: Exclude<CellTone, null>) => {
    for (const issue of issues) {
      const count = ISSUE_COUNT[issue.code];
      if (!count || !issue.size) continue;
      const key = `${normaliseSize(issue.size) ?? issue.size}:${count}`;
      if (tone === "fail" || !tones.has(key)) tones.set(key, tone);
    }
  };
  mark(module.warnings, "warn");
  mark(module.errors ?? [], "fail");
  return tones;
}

/**
 * The sampling plan's counts the table shows: those the template shows,
 * less a test row switched off on screen (rowsOff); an export with no
 * config shows those with a value.
 */
function samplingCountsOf(module: ExportModule, sizes: readonly string[]): SamplingKey[] {
  const columns = rec(module.config?.columns);
  const off = new Set(strings(module.data.rowsOff));
  const configured = Object.keys(columns).length > 0;
  return SAMPLING_KEYS.filter((key) => {
    if (off.has(key)) return false;
    if (configured) return columns[key] === true;
    return sizes.some((size) => num(bySize(module.data.sizes, size)[key]) !== null);
  });
}

function groupOf(key: SamplingKey, shown: readonly SamplingKey[]): LotsGroupKey {
  switch (key) {
    case "cases":
    case "innerUnits":
    case "gloves":
    case "pouches":
      return "quantity";
    // A form with no Gloves column counts its watertight and visual gloves as the sample (sampling_plan's columnGroups).
    case "glovesWatertightVisual":
      return shown.includes("gloves") ? "tests" : "quantity";
    case "glovesDimensions":
    case "glovesPhysical":
      return "tests";
    case "innerUnitsDispensing":
      return "units";
    case "pouchesDyeLeak":
      return "pouchTests";
  }
}

/** "# Gloves for Dimension": what a test counts, and what for. */
const COUNTED_FOR = /^#\s*\S.*?\s+for\s+(\S.*)$/i;

/**
 * A test's caption in the template's words, as the capture screen heads it
 * (sampling_plan's rows.ts): "# Gloves for Dimension" as "Dimension", "#
 * Inner Box for Packaging & Dispensing Inspection" as "Packaging &
 * Dispensing", "# Pouches (Dye Leak Test)" as "Dye Leak Test".
 */
export function testCaption(label: string): string {
  const trimmed = label.trim();
  const counted = COUNTED_FOR.exec(trimmed);
  const bracketed = /\(([^()]+)\)\s*$/.exec(trimmed);
  const shown = counted ? counted[1] : bracketed ? bracketed[1] : trimmed.replace(/^#\s*/, "");
  return shown.replace(/\s+Inspection$/i, "").trim() || trimmed;
}

const TEST_FALLBACK: Readonly<Partial<Record<SamplingKey, string>>> = {
  glovesWatertightVisual: "# Gloves for Watertight & Visual",
  glovesDimensions: "# Gloves for Dimension",
  glovesPhysical: "# Gloves for FAB",
  innerUnitsDispensing: "# Inner Box for Packaging & Dispensing Inspection",
  pouches: "Pouches",
  pouchesDyeLeak: "# Pouches (Dye Leak Test)",
};

function countCaption(module: ExportModule, key: SamplingKey, unit: string, inner: string): string {
  switch (key) {
    case "cases":
      return "Cases";
    case "innerUnits":
      return titleCase(pluralOf(inner));
    case "gloves":
      return titleCase(unit);
    default:
      return testCaption(labelOf(module, key, TEST_FALLBACK[key] ?? key));
  }
}

function groupLabel(group: LotsGroupKey, sampling: ExportModule | null, unit: string, inner: string): string {
  switch (group) {
    case "order":
      return "Order";
    case "quantity":
      return sampling ? labelOf(sampling, "samplingQuantity", "Sampling Quantity") : "Sampling Quantity";
    case "tests":
      return `${titleCase(unit)} per Test`;
    case "units":
      // "Boxes": the inner unit's last word, as the design heads the inner boxes for packing and dispensing.
      return titleCase(pluralOf(inner.split(/\s+/).at(-1) ?? inner));
    case "pouchTests":
      return "Pouches per Test";
  }
}

function sumOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

/** A row per size on the order with its lots, the order, what was sampled and what each test takes, then the totals. */
export function lotsTableOf(doc: InspectionExport, title: string, sizes: readonly string[], width: number): OrderLotsTable | null {
  const order = moduleOf(doc, "order_lots");
  if (!order || sizes.length === 0) return null;
  const unit = unitWordOf(doc);
  const inner = innerUnitOf(doc);
  const cases = sizes.map((size) => num(bySize(order.data.sizes, size).qtyCases) ?? 0);
  const shares = sharesOf(cases);
  const perCase = glovesPerCaseOf(doc);
  const lotGloves = rec(order.computed.lotSizeGloves);
  const gloves = sizes.map((size, index) => num(lotGloves[size]) ?? (perCase === null ? null : cases[index] * perCase));
  const sampling = moduleOf(doc, "sampling_plan");
  const shown = sampling ? samplingCountsOf(sampling, sizes) : [];
  const tones = sampling ? issueTones(sampling) : new Map<string, Exclude<CellTone, null>>();

  const columns: LotsColumn[] = [
    { id: "order.cases", group: "order", label: "Cases" },
    // Without the gloves per case the gloves ordered are not known: the column is left out.
    ...(gloves.some((value) => value !== null) ? [{ id: "order.gloves", group: "order" as const, label: titleCase(unit) }] : []),
    { id: "order.share", group: "order", label: "Share" },
    ...(sampling ? shown.map((key) => ({ id: `sampling.${key}`, group: groupOf(key, shown), label: countCaption(sampling, key, unit, inner) })) : []),
  ];
  const groups = columns.reduce<LotsGroup[]>((together, column) => {
    const last = together.at(-1);
    if (last && last.key === column.group) last.span += 1;
    else together.push({ key: column.group, label: groupLabel(column.group, sampling, unit, inner), span: 1 });
    return together;
  }, []);

  const rows: LotsRow[] = sizes.map((size, index) => {
    const counts = sampling ? bySize(sampling.data.sizes, size) : {};
    const cells: Record<string, LotsCell> = {
      "order.cases": { value: cases[index], tone: null },
      "order.gloves": { value: gloves[index], tone: null },
      "order.share": { value: shares[index], tone: null },
    };
    for (const key of shown) cells[`sampling.${key}`] = { value: num(counts[key]), tone: tones.get(`${size}:${key}`) ?? null };
    const lots = [...new Set(strings(bySize(order.data.sizes, size).lotNumbers))];
    return { size, label: sizeLabel(doc, size), lots, lotText: lots.length > 0 ? lots.join(", ") : NOT_STATED, cells };
  });

  const totals: Record<string, number | null> = {
    "order.cases": sumOf(cases),
    "order.gloves": num(order.computed.totalGloves) ?? sumOf(gloves),
    "order.share": cases.some((value) => value > 0) ? 100 : null,
  };
  const planned = rec(sampling?.computed.totals);
  for (const key of shown) totals[`sampling.${key}`] = num(planned[key]) ?? sumOf(rows.map((row) => row.cells[`sampling.${key}`].value));

  const table = { title, sizeHeader: labelOf(order, "size", "Size"), lotHeader: labelOf(order, "lotNumbers", "Lot Number"), groups, columns, rows, totals };
  return { ...table, widths: lotsColumnWidths(table, width) };
}

/* ------------------------------------------------------------------ *
 * Finished Goods Sampling
 * ------------------------------------------------------------------ */

/** "015": a box/carton number padded to the lot's digits, at most three, as the design prints them. */
export function paddedCarton(carton: number, ordered: number): string {
  return String(carton).padStart(Math.min(3, String(Math.max(1, Math.trunc(ordered))).length), "0");
}

/** The lot's first and last fifth both sampled: what "spread from the start to the end" says. */
export const SPREAD_EDGE = 0.2;

function spreadAcross(row: CartonRow): boolean {
  if (row.cartons.length === 0) return false;
  if (row.ordered <= 1) return true;
  const place = (carton: number) => (carton - 1) / (row.ordered - 1);
  return place(row.cartons[0]) <= SPREAD_EDGE && place(row.cartons[row.cartons.length - 1]) >= 1 - SPREAD_EDGE;
}

/** "67 cartons were opened, spread from the start to the end of each lot.": the spread said only where every lot's sample reaches both ends. */
export function cartonSummary(rows: readonly CartonRow[]): string {
  const opened = rows.reduce((sum, row) => sum + row.cartons.length, 0);
  const spread = rows.length > 0 && rows.every(spreadAcross);
  const lots = rows.length === 1 ? "the lot" : "each lot";
  return `${counted(opened, "carton")} ${opened === 1 ? "was" : "were"} opened${spread ? `, spread from the start to the end of ${lots}` : ""}.`;
}

/** A strip per size on the order, its numbers checked as carton_sampling checks them; null with no box/carton number entered. */
export function cartonStripsOf(doc: InspectionExport, title: string, sizes: readonly string[]): CartonStrips | null {
  const sampled = moduleOf(doc, "carton_sampling");
  if (!sampled || sizes.length === 0) return null;
  const order = moduleOf(doc, "order_lots");
  const sampling = moduleOf(doc, "sampling_plan");
  const rows = sizes.map((size): CartonRow => {
    const computed = rec(at(sampled.computed, "sizes", size));
    const ordered = num(computed.orderQty) ?? num(bySize(order?.data.sizes, size).qtyCases) ?? 0;
    const planned = num(computed.sampledCases) ?? num(bySize(sampling?.data.sizes, size).cases);
    const cartons = list(bySize(sampled.data.sizes, size).cartonNumbers)
      .flatMap((carton) => (typeof carton === "number" && Number.isFinite(carton) ? [carton] : []))
      .sort((a, b) => a - b);
    const seen = new Map<number, number>();
    for (const carton of cartons) seen.set(carton, (seen.get(carton) ?? 0) + 1);
    const failing = [...seen].filter(([carton, times]) => carton < 1 || carton > ordered || times > 1).map(([carton]) => carton);
    return {
      size,
      label: sizeLabel(doc, size),
      ordered,
      planned,
      cartons,
      numbers: cartons.map((carton) => paddedCarton(carton, ordered)),
      failing,
      overCount: planned !== null && cartons.length > planned,
    };
  });
  if (rows.every((row) => row.cartons.length === 0)) return null;
  return { title, summary: cartonSummary(rows), legend: CARTON_LEGEND, rows };
}

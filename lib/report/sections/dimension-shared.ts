// What Sections 03 and 04 (TG35 pages 3 and 4) share. The Dimension step as
// they read it: each ordered size's gloves and readings, the statistic the
// template sets (median or average) as printed at its decimals, the spec in
// force (one set for this inspection wins over the template's) and each
// measure's verdict, a P/F set by hand among them, all from the export's data
// and computed values (modules/dimensions/calc.ts). The words they print, in
// the template's wording. The room their parts take on a page, which their
// pages (components/report/sections) are drawn to. Pure, and defensive like
// ../read: a value missing or of another type reads as none.
//
// The builders (./dimensions, ./measurements) are imported by ./index alone,
// which they import back for defineSection: what else needs their figures
// imports them from here.
import { formatNumber, formatSpec, hasLimit } from "@/lib/format";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES } from "@/lib/schemas/report-options";
import { checkSpec, type Spec } from "@/lib/stats";
import { SpecSchema } from "@/modules/_framework/config-schemas";
import type { CheckStatus } from "../checks";
import type { DimensionsFigure } from "../model";
import { at, inTemplateOrder, isRecord, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";

/** What a value never entered reads as (model.ts's NOT_STATED: the model imports the sections, not the other way). */
export const NOT_STATED = "Not stated";

/** A table cell with nothing in it. */
export const NO_FIGURE = "—";

/** A measure's verdict as computed: the P/F set by hand where there is one, else the readings'. */
export type MeasureVerdict = "pass" | "fail" | "not_done";

export type DimensionSize = {
  /** Canonical: "M", "7.0". */
  size: string;
  /** As the template shows it. */
  label: string;
  /** Gloves counted: the sampling plan's n for dimension, else the template's rows. */
  rows: number;
  /** Gloves 1 to `rows`, each glove's reading by measure; null where none is entered. */
  gloves: Record<string, number | null>[];
  /** The statistic at the template's decimals, as printed and judged; null until a reading is entered. */
  shown: Record<string, number | null>;
  /** The spec in force; null without one. */
  spec: Record<string, Spec | null>;
  verdict: Record<string, MeasureVerdict>;
  /** The measures whose P/F the inspector set by hand. */
  byHand: Record<string, boolean>;
  /** The size's verdict: the module's own. */
  status: CheckStatus;
};

export type DimensionReadings = {
  /** The Dimension step as exported. */
  dimension: ExportModule;
  /** The measures the template switches on, in its column order. */
  measures: string[];
  statisticKind: "median" | "average";
  /** "Median", or "Average", as the template words it. */
  statisticLabel: string;
  /** The decimals each measure's statistic is printed at. */
  decimals: Record<string, number>;
  sizes: DimensionSize[];
};

/** Each measure's label where the template has none (modules/dimensions/config.ts). */
const MEASURE_LABELS: Readonly<Record<string, string>> = {
  length: "Length",
  width: "Width",
  fingerThickness: "Finger Thickness",
  palmThickness: "Palm Thickness",
  cuffThickness: "Cuff Thickness",
};

/** The measures read in the thickness group: the design's "Thickness (mm)". */
export function isThickness(measure: string): boolean {
  return /thickness$/i.test(measure);
}

/** A measure as the template words it: "Finger Thickness". */
export function measureLabel(step: Pick<ExportModule, "labels"> | null, measure: string): string {
  return labelOf(step, measure, MEASURE_LABELS[measure] ?? measure);
}

/** A thickness's label without the word, under a "Thickness" heading: "Finger Thickness" is "Finger". */
export function shortLabel(label: string): string {
  return label.replace(/\s*\bthickness\b\s*/i, " ").trim() || label;
}

function asSpec(value: unknown): Spec | null {
  const parsed = SpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asVerdict(value: unknown): MeasureVerdict {
  return value === "pass" || value === "fail" ? value : "not_done";
}

/** A module status as a check's: a record (info, complete without a spec) reads as passed, as the client's report has it. */
function asCheckStatus(value: unknown): CheckStatus {
  if (value === "pass" || value === "info") return "pass";
  return value === "fail" || value === "warn" ? value : "not_done";
}

/** The sizes the step is for: the order's, else those it holds values for, in the template's order. */
export function sizesFor(doc: Pick<InspectionExport, "modules" | "template">, step: ExportModule): string[] {
  const ordered = orderedSizes(doc);
  if (ordered.length > 0) return ordered;
  const held = [...Object.keys(rec(step.computed.rows)), ...Object.keys(rec(step.data.sizes))];
  return inTemplateOrder(doc, [...new Set(held)]);
}

/** The Dimension step's readings for the report; null when the inspection does not include it. */
export function readDimensions(doc: Pick<InspectionExport, "modules" | "template">): DimensionReadings | null {
  const step = moduleOf(doc, "dimensions");
  if (!step) return null;
  const { computed, data } = step;
  const config = rec(step.config);
  const fromComputed = list(computed.measures).filter((measure): measure is string => typeof measure === "string");
  const measures = fromComputed.length > 0 ? fromComputed : list(config.measures).filter((measure): measure is string => typeof measure === "string");
  const statisticKind = (text(computed.statisticKind) ?? text(config.statistic)) === "average" ? "average" : "median";
  const decimals = Object.fromEntries(
    measures.map((measure) => [measure, num(at(computed, "decimals", measure)) ?? num(at(config, "decimals", measure)) ?? (isThickness(measure) ? 2 : 0)]),
  );
  const perSize = step.result.perSize ?? {};
  const sizes = sizesFor(doc, step).map((size): DimensionSize => {
    const saved = list(at(data, "sizes", size, "gloves"));
    const rows = Math.max(0, Math.floor(num(at(computed, "rows", size)) ?? saved.length));
    const gloves = Array.from({ length: rows }, (_, index) => {
      const glove = rec(saved[index]);
      return Object.fromEntries(measures.map((measure) => [measure, num(glove[measure])]));
    });
    const by = <T>(read: (measure: string) => T) => Object.fromEntries(measures.map((measure) => [measure, read(measure)])) as Record<string, T>;
    return {
      size,
      label: sizeLabel(doc, size),
      rows,
      gloves,
      shown: by((measure) => num(at(computed, "shown", size, measure))),
      spec: by((measure) => asSpec(at(computed, "spec", size, measure))),
      verdict: by((measure) => asVerdict(at(computed, "measureResult", size, measure))),
      byHand: by((measure) => isRecord(at(computed, "manual", size, measure))),
      status: asCheckStatus(perSize[size]?.status),
    };
  });
  return {
    dimension: step,
    measures,
    statisticKind,
    statisticLabel: labelOf(step, "statistic", statisticKind === "average" ? "Average" : "Median"),
    decimals,
    sizes,
  };
}

/** A measure's readings for a size, in glove order, the gloves not yet measured left out. */
export function readingsOf(size: DimensionSize, measure: string): number[] {
  return size.gloves.flatMap((glove) => (glove[measure] === null || glove[measure] === undefined ? [] : [glove[measure] as number]));
}

/** True when any glove of any size has a reading. */
export function hasReadings(readings: DimensionReadings): boolean {
  return readings.sizes.some((size) => readings.measures.some((measure) => readingsOf(size, measure).length > 0));
}

/**
 * The decimals a value was typed with: 0.1 has 1, 242 has none. Binary
 * noise (0.11000000000000001) is not typed, and no value is printed past
 * the 10 decimals the app's numbers go to.
 */
export function typedDecimals(value: number): number {
  const written = String(Number(value.toPrecision(12)));
  if (/e/i.test(written)) return 10;
  const [, fraction = ""] = written.split(".");
  return Math.min(10, fraction.length);
}

/**
 * A reading as printed: at the template's decimals for the measure, as the
 * design prints 0.1 as "0.10", and never fewer than it was typed with, so
 * 242.5 stays 242.5 where the statistic prints whole millimetres.
 */
export function readingText(value: number, decimals: number): string {
  return formatNumber(value, { decimals: Math.max(decimals, typedDecimals(value)) });
}

/** A reading outside the spec in force: red in the tables, though the statistic is what is judged. */
export function outsideSpec(value: number, spec: Spec | null): boolean {
  return hasLimit(spec) && checkSpec(value, spec) === "fail";
}

/** The statistic of a measure as a figure: at its decimals, red where the measure failed; "—" without one. */
export function statisticFigure(readings: DimensionReadings, size: DimensionSize, measure: string): DimensionsFigure {
  const shown = size.shown[measure];
  return {
    text: shown === null || shown === undefined ? NO_FIGURE : formatNumber(shown, { decimals: readings.decimals[measure] }),
    failed: size.verdict[measure] === "fail",
  };
}

/** The spec in force as the report prints it: "≥ 240", "80 ± 10", "NA". */
export function specText(spec: Spec | null): string {
  return formatSpec(spec);
}

/** "13 gloves", "13 to 20 gloves": the gloves counted across the sizes; null with none. */
export function glovesCounted(readings: DimensionReadings): string | null {
  const counts = [...new Set(readings.sizes.map((size) => size.rows).filter((rows) => rows > 0))].sort((a, b) => a - b);
  if (counts.length === 0) return null;
  const [low, high] = [counts[0], counts.at(-1) ?? counts[0]];
  if (low === high) return `${low} ${low === 1 ? "glove" : "gloves"}`;
  return `${low} to ${high} gloves`;
}

/**
 * A label inside a sentence: its capitalised words in lower case, the rest
 * as written, so "Palm Width" reads "palm width" and "PVC Length" keeps its
 * capitals.
 */
export function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word))
    .join(" ");
}

/** The first letter in capitals: the start of a sentence. */
export function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ------------------------------------------------------------------ *
 * The room on a page
 *
 * Where a section's page ends is worked out from its parts' heights,
 * estimated in millimetres from the components' sizes
 * (components/report/sections and the primitives they draw with), as
 * model.ts's SUMMARY_ROOM does for page 1.
 * ------------------------------------------------------------------ */

export const PAGE_ROOM = {
  /** The header band and the footer, with the content's padding (model.ts SUMMARY_ROOM.chrome). */
  chrome: 61,
  /** A footer note's second line in the footer. */
  footerNote: 4,
  /** The page's side margins together (components/report/theme.ts PAGE_GUTTER, 13 mm a side). */
  gutters: 26,
  /** The kicker over the title. */
  heading: 14,
} as const;

/** The content's height on the report's paper: what is left inside the chrome. */
export function contentRoom(doc: Pick<InspectionExport, "report">): number {
  const paper = REPORT_PAGE_SIZES.find((entry) => entry.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  return paper.height - PAGE_ROOM.chrome - (doc.report.footerNote ? PAGE_ROOM.footerNote : 0);
}

/** Lines a text takes at about `perLine` characters a line. */
export function linesOf(words: string | null, perLine: number): number {
  if (!words) return 0;
  return Math.max(1, Math.ceil(words.length / perLine));
}

/**
 * The glove length chart's dots (components/report/dot-plot.tsx, its
 * `geometry` prop): smaller than the plot's own and closer stacked, as the design
 * draws them, so four sizes of thirteen gloves leave room on the page for
 * the rest of Section 03.
 */
export const LENGTH_DOT = { size: 2, rise: 2.6, baseline: 3.2, rowMin: 12, headroom: 1.2 } as const;

/** The height of a glove length row with this many dots stacked at most: dot-plot.tsx's dotRowHeight with LENGTH_DOT. */
export function lengthRowHeight(stack: number): number {
  return Math.max(LENGTH_DOT.rowMin, LENGTH_DOT.baseline + stack * LENGTH_DOT.rise + LENGTH_DOT.headroom);
}

/** Section 03's parts (components/report/sections/dimensions.tsx and the primitives it draws with). */
export const DIMENSIONS_ROOM = {
  /** Between the heading and the blocks, and between blocks. */
  gap: 4.6,
  /** The lead under the title: its gap and a line of it, at about this many characters. */
  leadGap: 1.6,
  leadLine: 5.1,
  leadCharacters: 100,
  /** A block's heading and the gap under it. */
  blockHeading: 5.4,
  blockGap: 2.4,
  /** A chart's tick labels. */
  axis: 4.6,
  /** A palm width row and the gap under it (range-band.tsx). */
  bandRow: 10.4,
  /** The results table's header groups, its header row, a row with its chip, and its note. */
  tableGroups: 5.4,
  tableHeader: 8,
  tableRow: 7.1,
  tableNote: 5.9,
  /** A weight bar's row, the gap between rows, the note's gap and a line of it. */
  barRow: 4.8,
  barGap: 2.4,
  weightNoteGap: 2.4,
  weightNoteLine: 4.2,
  /** The note's characters a line, in its column beside the table, or alone. */
  weightNoteCharacters: { beside: 40, alone: 58 },
} as const;

/** Section 04's parts (components/report/sections/measurements.tsx and ReportTable). */
export const MEASUREMENTS_ROOM = {
  /** Between the heading and the first row of tables, and between the last and the page's note. */
  gap: 5,
  /** Between rows of tables, and between the two tables of a row. */
  rowGap: 6,
  columnGap: 7,
  /** A table's heading ("Size S") and the gap under it. */
  sizeHeading: 5.4,
  headingGap: 1.6,
  /** The table's header row. */
  header: 7,
  /** A glove's row. */
  glove: 5,
  /** The statistic's, the spec's and the result's rows, and each line more their words wrap to. */
  summaryRow: 6.4,
  line: 4.2,
  /** The No. column, whose labels ("Average") keep to one line; a cell's padding either side. */
  noColumn: 16,
  cellPadding: 1.2,
  /** A character of a cell's text, about, regular and bold. */
  character: 1.4,
  boldCharacter: 1.55,
  /** The note under a page's tables: its gap, a line, at about this many characters. */
  noteGap: 5,
  noteLine: 3.5,
  noteCharacters: 140,
} as const;

// Section 04, Measurements by Glove (TG35 page 4), from the Dimension step:
// a table per size of every glove's readings, for the measures the template
// switches on, then the statistic it sets (median or average) at its
// decimals, the spec in force and each measure's result in the template's
// words, red where it failed. A reading outside the spec shows in red too,
// though the statistic is what is judged; a P/F set by hand carries a mark,
// and a note under the page's tables says what both mean. Each table is
// headed by its size, its lot and its average weight. Two tables side by
// side, as many rows of them as a page holds (four sizes of thirteen gloves
// on A4); a size whose gloves run past a page goes on in a table of its
// own. Nothing to show without a reading.
import { formatNumber } from "@/lib/format";
import type { InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES } from "@/lib/schemas/report-options";
import { normaliseSize } from "@/lib/sizes";
import type { MeasurementsSection, MeasurementsTable } from "../model";
import { at, labelOf, list, moduleOf, num, rec, text } from "../read";
import {
  contentRoom,
  glovesCounted,
  hasReadings,
  linesOf,
  measureLabel,
  MEASUREMENTS_ROOM as ROOM,
  NO_FIGURE,
  outsideSpec,
  PAGE_ROOM,
  readDimensions,
  readingText,
  shortLabel,
  specText,
  statisticFigure,
  type DimensionReadings,
  type DimensionSize,
} from "./dimension-shared";
import { defineSection } from "./index";

/** A result's word while it is not done: the app's, as the template has none. */
const NOT_DONE = "Not Done";

export const measurements = defineSection({ key: "measurements", build: buildMeasurements });

/** The section has no blocks: its plan entry has nothing to add. */
function buildMeasurements(doc: InspectionExport): MeasurementsSection | null {
  const readings = readDimensions(doc);
  if (!readings || readings.measures.length === 0 || !hasReadings(readings)) return null;
  const { dimension } = readings;
  const room = contentRoom(doc) - PAGE_ROOM.heading - ROOM.gap;
  const sized = { room, measureWidth: measureWidth(doc, readings.measures.length) };
  const tables = readings.sizes.filter((size) => size.rows > 0).flatMap((size) => tablesOf(doc, readings, size, sized));
  if (tables.length === 0) return null;
  const pages = pagesOf(tables, readings, sized);
  const gloves = glovesCounted(readings);
  return {
    pageCount: pages.length,
    aside: gloves ? `All values in mm · ${gloves} per size` : "All values in mm",
    columns: readings.measures.map((measure) => ({ measure, label: shortLabel(measureLabel(dimension, measure)) })),
    labels: {
      no: labelOf(dimension, "rowNo", "No."),
      statistic: readings.statisticLabel,
      spec: labelOf(dimension, "specRow", "Spec."),
      result: "Result",
    },
    pages,
  };
}

/** What a page holds, and a measure column's width in a table (half the page, less the No. column). */
type Sized = { room: number; measureWidth: number };

function measureWidth(doc: Pick<InspectionExport, "report">, measures: number): number {
  const paper = REPORT_PAGE_SIZES.find((entry) => entry.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  const table = (paper.width - PAGE_ROOM.gutters - ROOM.columnGap) / 2;
  return (table - ROOM.noColumn) / Math.max(1, measures);
}

/** "Lot LOT-A01", "Lots LOT-B01, LOT-B02": the size's lots on the order; null without one. */
function lotsOf(doc: InspectionExport, size: string): string | null {
  const lines = rec(moduleOf(doc, "order_lots")?.data.sizes);
  const key = Object.keys(lines).find((candidate) => (normaliseSize(candidate) ?? candidate) === size);
  if (key === undefined) return null;
  const lots = list(rec(lines[key]).lotNumbers).flatMap((lot) => {
    const value = text(lot);
    return value === null ? [] : [value];
  });
  if (lots.length === 0) return null;
  return `${lots.length === 1 ? "Lot" : "Lots"} ${lots.join(", ")}`;
}

/** "Avg. weight 2.90 g": the size's weight at the template's decimals; null without one. */
function weightOf(doc: InspectionExport, size: string): string | null {
  const weight = moduleOf(doc, "weight");
  if (!weight) return null;
  const value = num(at(weight.computed, "shown", size)) ?? num(at(weight.computed, "average", size));
  if (value === null) return null;
  return `Avg. weight ${formatNumber(value, { decimals: num(at(weight.config, "decimals")) ?? 2, unit: "g" })}`;
}

/** Lines a cell's text wraps to in a measure column, at about `character` millimetres a character. */
function cellLines(words: string, width: number, character: number): number {
  const fit = Math.max(1, Math.floor((width - 2 * ROOM.cellPadding) / character));
  return Math.max(1, Math.ceil(words.length / fit));
}

/** A table's height: its heading and header, its gloves, and its statistic, spec and result, each as many lines as its words wrap to. */
function tableHeight(table: Pick<MeasurementsTable, "gloves" | "summary">, measureWidth: number): number {
  const frame = ROOM.sizeHeading + ROOM.headingGap + ROOM.header + table.gloves.length * ROOM.glove;
  const { summary } = table;
  if (!summary) return frame;
  const lines = (words: readonly string[], character: number) => Math.max(1, ...words.map((each) => cellLines(each, measureWidth, character)));
  const spec = lines(Object.values(summary.spec), ROOM.character);
  const result = lines(
    Object.values(summary.result).map((entry) => `${entry.text}${entry.byHand ? "*" : ""}`),
    ROOM.boldCharacter,
  );
  return frame + 3 * ROOM.summaryRow + (spec - 1 + (result - 1)) * ROOM.line;
}

/**
 * A size's table, or its runs of gloves where they pass a page: the last
 * run carries the statistic, the spec and the result.
 */
function tablesOf(doc: InspectionExport, readings: DimensionReadings, size: DimensionSize, sized: Sized): MeasurementsTable[] {
  const { dimension, measures } = readings;
  const pass = labelOf(dimension, "pass", "Passed");
  const fail = labelOf(dimension, "fail", "Failed");
  const gloves = size.gloves.map((glove, index) => ({
    no: index + 1,
    cells: Object.fromEntries(
      measures.map((measure) => {
        const value = glove[measure] ?? null;
        return [
          measure,
          value === null
            ? { text: NO_FIGURE, failed: false }
            : { text: readingText(value, readings.decimals[measure]), failed: outsideSpec(value, size.spec[measure] ?? null) },
        ];
      }),
    ),
  }));
  const summary: NonNullable<MeasurementsTable["summary"]> = {
    statistic: Object.fromEntries(measures.map((measure) => [measure, statisticFigure(readings, size, measure)])),
    spec: Object.fromEntries(measures.map((measure) => [measure, specText(size.spec[measure] ?? null)])),
    result: Object.fromEntries(
      measures.map((measure) => {
        const verdict = size.verdict[measure];
        return [measure, { text: verdict === "pass" ? pass : verdict === "fail" ? fail : NOT_DONE, status: verdict, byHand: size.byHand[measure] === true }];
      }),
    ),
    status: size.status,
  };
  const aside = [lotsOf(doc, size.size), weightOf(doc, size.size)].filter((part): part is string => part !== null).join(" · ") || null;

  // Runs of gloves: as many as a page holds with a line of its note, the last with room for the summary.
  const room = sized.room - ROOM.noteGap - ROOM.noteLine;
  const frame = tableHeight({ gloves: [], summary: null }, sized.measureWidth);
  const tail = tableHeight({ gloves: [], summary }, sized.measureWidth) - frame;
  const runs: { from: number; to: number; last: boolean }[] = [];
  let from = 0;
  for (;;) {
    const rest = gloves.length - from;
    const take = Math.min(rest - 1, Math.floor((room - frame) / ROOM.glove));
    if (frame + rest * ROOM.glove + tail <= room || take < 1) {
      runs.push({ from, to: gloves.length, last: true });
      break;
    }
    runs.push({ from, to: from + take, last: false });
    from += take;
  }
  return runs.map((run, index) => ({
    key: `${size.size}-${index + 1}`,
    size: size.size,
    title: index === 0 ? `Size ${size.label}` : `Size ${size.label} (continued)`,
    aside,
    continued: index > 0,
    gloves: gloves.slice(run.from, run.to),
    summary: run.last ? summary : null,
  }));
}

/** What a page's marks mean, from its tables: a P/F set by hand, a reading outside the spec. */
function noteOf(tables: readonly MeasurementsTable[], readings: DimensionReadings): string | null {
  const byHand = tables.some((table) => table.summary && Object.values(table.summary.result).some((entry) => entry.byHand));
  const outside = tables.some((table) => table.gloves.some((glove) => Object.values(glove.cells).some((cell) => cell.failed)));
  const notes = [
    byHand ? "* Set by the inspector." : null,
    outside ? `Readings in red are outside the spec; the ${readings.statisticLabel.toLowerCase()} is judged.` : null,
  ].filter((note): note is string => note !== null);
  return notes.length > 0 ? notes.join(" ") : null;
}

/** Two tables side by side, row after row, a page holding as many rows as fit with its note. */
function pagesOf(tables: readonly MeasurementsTable[], readings: DimensionReadings, sized: Sized): MeasurementsSection["pages"] {
  const rows: MeasurementsTable[][] = [];
  for (let index = 0; index < tables.length; index += 2) rows.push(tables.slice(index, index + 2));
  const noteHeight = (note: string | null) => (note ? ROOM.noteGap + linesOf(note, ROOM.noteCharacters) * ROOM.noteLine : 0);
  const pages: MeasurementsTable[][][] = [[]];
  let used = 0;
  for (const row of rows) {
    const height = Math.max(...row.map((table) => tableHeight(table, sized.measureWidth)));
    const page = pages[pages.length - 1];
    const note = noteOf([...page.flat(), ...row], readings);
    if (page.length > 0 && used + ROOM.rowGap + height + noteHeight(note) > sized.room) {
      pages.push([row]);
      used = height;
    } else {
      page.push(row);
      used += (page.length > 1 ? ROOM.rowGap : 0) + height;
    }
  }
  return pages.filter((page) => page.length > 0).map((page) => ({ rows: page, note: noteOf(page.flat(), readings) }));
}

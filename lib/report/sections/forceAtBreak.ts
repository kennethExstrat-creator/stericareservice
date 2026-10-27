// Section 05 of the report, Force at Break (TG35 page 5; docs/REPORT.md,
// "Adding a section"): the lab's force at break test as the inspection
// holds it (force_at_break: each specimen's reading per size, read off the
// lab report, its median against the minimum), or Physical Properties
// where the template has the lab report's tensile averages instead
// (tensile), or both. Its blocks, each left out while switched off:
//
// - Laboratory Details: what the inspection records of the lab's test,
//   which is the standard alone. The laboratory, test date, ageing,
//   specimen, test speed, humidity and equipment are not recorded, so the
//   card shows only while a standard is set.
// - Maximum Load per Specimen: every reading as a dot, a row per size, the
//   module's median, the minimum with the zone below it, and a note for
//   each size with a specimen below the minimum or a median below it,
//   saying how the statistic judged the size. Tensile has no specimens:
//   its averages as bars against their minimums.
// - Specimen Readings: test number by size, a reading below the minimum
//   marked "*", the Median under them.
// - Laboratory Summary by Size: the order's lots, the average, SD, lowest,
//   highest and median of the readings, the module's verdict, and the lab
//   reports they come from. The production line and date, the specimens'
//   thickness and who tested and verified are not recorded.
//
// The blocks are split into pages by their estimated heights (FORCE_ROOM,
// from the components' sizes, as SUMMARY_ROOM is for page 1): a block that
// does not fit moves to the next page whole, and only one taller than a
// page is split (the chart by sizes, the readings by rows).
import { formatCount, formatNumber, withUnit } from "@/lib/format";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES } from "@/lib/schemas/report-options";
import { normaliseSize } from "@/lib/sizes";
import { formatReading } from "@/lib/stats";
import { MAX_READINGS } from "@/modules/force_at_break/config";
import type { CheckStatus } from "../checks";
import { andList } from "../format";
import { niceAxis, stackDots, stackHeight, ticksBetween, type Axis } from "../geometry";
import type {
  ForceAtBreakAverage,
  ForceAtBreakDetail,
  ForceAtBreakPage,
  ForceAtBreakPart,
  ForceAtBreakReading,
  ForceAtBreakSection,
  ForceAtBreakSize,
  ForceAtBreakTensile,
  ForceAtBreakTensileSize,
  ForceAtBreakTest,
  ReportSectionPlanEntry,
} from "../model";
import { at, inTemplateOrder, isRecord, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import { defineSection } from "./index";

/* ------------------------------------------------------------------ *
 * The room the blocks take, in millimetres, from the components' sizes
 * (components/report/sections/forceAtBreak.tsx and the primitives it
 * draws with). Estimates: a little is kept free at each page's foot.
 * ------------------------------------------------------------------ */

export const FORCE_ROOM = {
  /** The header band and the footer, with the content's padding (SUMMARY_ROOM.chrome). */
  chrome: 61,
  /** A footer note's second line in the footer. */
  footerNote: 4,
  /** Kept free at the foot of every page. */
  slack: 3,
  /** The kicker and the title, and the gap between them. */
  heading: 14.1,
  /** The lead under the title: the gap over it, a line, and the characters a line holds. */
  leadGap: 1.6,
  leadLine: 5.05,
  leadCharacters: 100,
  /** Between the page's blocks. */
  gap: 5,
  /** The details card: its padding and edges, a row of labels over values, the gap between rows, its columns. */
  cardFrame: 9.4,
  cardRow: 9.6,
  cardRowGap: 3.2,
  cardColumns: 4,
  /** A block's heading, and the gap under it over a chart or a table. */
  blockHeading: 5.3,
  chartGap: 2.4,
  tableGap: 1,
  /** The dot plot (components/report/dot-plot.tsx): a dot, the rise of one stacked on another, the baseline, the room over the top dot, the least row, the axis's labels. */
  dot: 2.6,
  dotRise: 2.8,
  dotBaseline: 3.2,
  dotTop: 2.4,
  dotRowMin: 12,
  axis: 4.6,
  /** The dot plot's columns either side of the plot, and the page's side margins. */
  dotLabelColumn: 12,
  dotAsideColumn: 42,
  gutters: 26,
  /** A line of small print (a note), the gap between notes, the characters across the page. */
  noteLine: 4.2,
  noteGap: 0.8,
  noteCharacters: 115,
  /** The dense table (components/report/report-table.tsx): its header, a row, a hairline, a row holding a chip, the totals row. */
  tableHeader: 7,
  tableRow: 5.6,
  tableRule: 0.25,
  chipRow: 6.4,
  totalsRow: 6,
  /** The readings beside the lab's summary: their column, the gap between, the most sizes the two hold side by side. */
  readingsColumn: 76,
  pairGap: 8,
  pairedSizes: 5,
  /** The lab's summary: a cell's padding, a character's width at the table's size (its label column: summaryLabelShare). */
  cellPadding: 3.2,
  characterWidth: 1.55,
  /** The gap over the note under a summary. */
  summaryNoteGap: 1,
  /** A bar of the tensile charts and the gap between bars. */
  bar: 4,
  barGap: 2.4,
  /** The fewest readings worth a stretch of the table on a page of its own. */
  minimumRows: 5,
} as const;

const R = FORCE_ROOM;

/**
 * The share of a summary table's width its label column takes: less as sizes
 * are added, so each size's cell still holds a lot number and a result. The
 * tensile summary spans the page, its labels the template's long ones.
 */
export function summaryLabelShare(sizes: number, tensile = false): number {
  if (tensile) return 0.3;
  return sizes >= 5 ? 0.22 : sizes === 4 ? 0.26 : 0.3;
}

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

export const forceAtBreak = defineSection({ key: "forceAtBreak", build: buildForceAtBreak });

/** The section's content for its plan entry; null with no size ordered or nothing to show. */
export function buildForceAtBreak(doc: InspectionExport, entry: ReportSectionPlanEntry<"forceAtBreak">): ForceAtBreakSection | null {
  const sizes = orderedSizes(doc);
  if (sizes.length === 0) return null;
  const on = new Set<string>(entry.blocks.map((block) => block.key));
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  const contentWidth = paper.width - R.gutters;

  const forceModule = entry.moduleKeys.includes("force_at_break") ? moduleOf(doc, "force_at_break") : null;
  const tensileModule = entry.moduleKeys.includes("tensile") ? moduleOf(doc, "tensile") : null;
  const force = forceModule ? forceTestOf(doc, forceModule, sizes, contentWidth) : null;
  const tensile = tensileModule ? tensileOf(doc, tensileModule, sizes) : null;
  const recorded = detailsOf([forceModule, tensileModule]);
  const details = on.has("laboratoryDetails") && recorded.length > 0 ? recorded : null;

  const anyReading = force?.sizes.some((size) => size.readings.some((reading) => reading !== null)) ?? false;
  const anyAverage = tensile?.sizes.some((size) => size.tensile !== null || size.elongation !== null) ?? false;
  const show = {
    details: details !== null,
    forceChart: force !== null && on.has("maximumLoad") && anyReading,
    readings: force !== null && on.has("specimenReadings") && anyReading,
    forceSummary: force !== null && on.has("laboratorySummary"),
    tensileChart: tensile !== null && on.has("maximumLoad") && anyAverage,
    tensileSummary: tensile !== null && on.has("laboratorySummary"),
  };
  if (!Object.values(show).some(Boolean)) return null;

  const units: Unit[] = [];
  if (details) units.push({ kind: "details", height: detailsHeight(details.length) });
  if (force && show.forceChart) {
    units.push({ kind: "forceChart", rows: force.sizes.map((size) => ({ size: size.size, height: dotRowHeight(size.stack) })), notes: notesHeight(force.notes) });
  }
  if (force && (show.readings || show.forceSummary)) {
    // Side by side as the design sets them, up to five sizes; past that each takes the page's width, the readings first.
    const paired = show.readings && show.forceSummary && force.sizes.length <= R.pairedSizes;
    const summaryWidth = paired ? contentWidth - R.readingsColumn - R.pairGap : contentWidth;
    const summary = show.forceSummary ? forceSummaryHeight(force, summaryWidth) : null;
    if (paired || !show.readings || !show.forceSummary) {
      units.push({ kind: "forceTables", readings: show.readings ? force.rows : null, summary, paired });
    } else {
      units.push({ kind: "forceTables", readings: force.rows, summary: null, paired: false });
      units.push({ kind: "forceTables", readings: null, summary, paired: false });
    }
  }
  if (tensile && show.tensileChart) units.push({ kind: "tensileChart", height: tensileChartHeight(tensile.sizes.length) });
  if (tensile && show.tensileSummary) units.push({ kind: "tensileSummary", height: tensileSummaryHeight(tensile, contentWidth) });

  const lead = leadOf(force, tensile, [forceModule, tensileModule]);
  const room = paper.height - R.chrome - (doc.report.footerNote ? R.footerNote : 0) - R.slack;
  const pages = paginate(units, room, headingHeight(lead));
  return { pageCount: pages.length, lead, details, force, tensile, pages };
}

/* ------------------------------------------------------------------ *
 * Force at break: the readings per size
 * ------------------------------------------------------------------ */

function forceTestOf(doc: InspectionExport, module: ExportModule, sizes: readonly string[], contentWidth: number): ForceAtBreakTest {
  const config = rec(module.config);
  const { computed } = module;
  const specMin = num(config.specMin) ?? num(computed.specMin);
  const decimals = num(config.decimals) ?? num(computed.decimals);
  const medianLabel = labelOf(module, "median", "Median");

  // Each size's readings as the module counts them: the first n, a reading of 0 N or less not counting.
  // A plan asking for more than the screen's grid holds is the module's error; the grid's rows print.
  const raw = sizes.map((size) => {
    const saved = list(at(module.data, "sizes", size, "values"));
    const n = Math.min(MAX_READINGS, Math.max(0, Math.floor(num(at(computed, "sizes", size, "n")) ?? num(config.n) ?? saved.length)));
    const values = Array.from({ length: n }, (_, index) => {
      const value = num(saved[index]);
      return value !== null && value > 0 ? value : null;
    });
    return { size, n, values };
  });
  const all = raw.flatMap(({ values }) => values.filter((value): value is number => value !== null));
  // As entered, each padded to the most decimals any reading has, so the columns line up.
  const places = all.reduce((most, value) => Math.max(most, placesOf(value)), 0);
  const reading = (value: number): ForceAtBreakReading => ({ value, text: formatReading(value, places), low: specMin !== null && value < specMin });
  const axis = chartAxis(all, specMin);
  const step = stackingStep(axis, places, contentWidth - R.dotLabelColumn - R.dotAsideColumn);
  const shown = decimals ?? places;

  const forceSizes = raw.map(({ size, n, values }): ForceAtBreakSize => {
    const readings = values.map((value) => (value === null ? null : reading(value)));
    const entered = readings.filter((entry): entry is ForceAtBreakReading => entry !== null);
    const sorted = [...entered].sort((a, b) => a.value - b.value);
    const minimum = sorted[0] ?? null;
    const maximum = sorted.at(-1) ?? null;
    const median = num(at(computed, "sizes", size, "median"));
    const { mean, sd } = spreadOf(entered.map((entry) => entry.value));
    return {
      size,
      label: sizeLabel(doc, size),
      n,
      readings,
      median,
      medianText: median === null ? null : formatNumber(median, { decimals: shown }),
      range: minimum && maximum ? (minimum.text === maximum.text ? minimum.text : `${minimum.text} to ${maximum.text}`) : null,
      average: mean === null ? null : formatNumber(mean, { decimals: shown }),
      sd: sd === null ? null : formatNumber(sd, { decimals: Math.max(1, shown) }),
      minimum,
      maximum,
      lots: lotsOf(doc, size),
      status: statusOf(module, size, at(computed, "sizes", size, "result")),
      stack: stackHeight(stackDots(entered.map((entry) => entry.value), step)),
    };
  });

  const specText = specMin === null ? null : formatNumber(specMin, { unit: "N" });
  const test: ForceAtBreakTest = {
    sizes: forceSizes,
    specMin,
    specText,
    medianLabel,
    rowLabel: labelOf(module, "rowNo", "Test No."),
    lotLabel: labelOf(moduleOf(doc, "order_lots"), "lotNumbers", "Lot No."),
    axis,
    tickDecimals: Math.max(tickPlaces(axis), specMin === null ? 0 : placesOf(specMin)),
    step,
    rows: forceSizes.reduce((most, size) => Math.max(most, size.n), 0),
    notes: [],
    labNote: labReportNote(doc, module, sizes, "Readings", false),
  };
  return { ...test, notes: forceNotes(test, standardOf(module), medianLabel) };
}

/**
 * The notes under the chart, one for each size with a specimen below the
 * minimum (marked "*" in the readings) or a median below it: what read low,
 * then how the size is judged, in the template's word for the statistic.
 * "* One size S specimen read 5.5 N. EN 455-2 judges the median, which is
 * 6.4 N for size S, so the size passes."
 */
function forceNotes(test: ForceAtBreakTest, standard: string | null, statistic: string): string[] {
  if (test.specMin === null || test.specText === null) return [];
  const judge = `${standard ?? "The test"} judges the ${inSentence(statistic)}`;
  return test.sizes.flatMap((size) => {
    const low = size.readings.filter((entry): entry is ForceAtBreakReading => entry !== null && entry.low);
    const failed = size.status === "fail" && size.medianText !== null;
    if (low.length === 0 && !failed) return [];
    const specimens = low.length === 1 ? "specimen" : "specimens";
    const read = low.length <= 3 ? `read ${andList(low.map((entry) => entry.text))} N` : `read below ${test.specText}`;
    const opening = low.length > 0 ? `${countWord(low.length)} size ${size.label} ${specimens} ${read}. ` : "";
    if (failed) return [`* ${opening}${judge}, which is ${size.medianText} N for size ${size.label}, below ${test.specText}, so the size fails.`];
    if (size.medianText !== null) return [`* ${opening}${judge}, which is ${size.medianText} N for size ${size.label}, so the size passes.`];
    // Not judged yet: the module's median waits for every reading.
    return [`* ${opening}${judge} once all ${formatCount(size.n)} ${size.n === 1 ? "specimen is" : "specimens are"} read.`];
  });
}

/** The mean and the sample standard deviation (n − 1, as labs give it) of some readings; null where too few. */
export function spreadOf(values: readonly number[]): { mean: number | null; sd: number | null } {
  if (values.length === 0) return { mean: null, sd: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length < 2) return { mean, sd: null };
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(squares / (values.length - 1)) };
}

/**
 * The chart's axis: tidy ticks (niceAxis) from half a step below the lowest
 * of the readings and the minimum, so the zone below the minimum always
 * shows, to the first tick a quarter step past the highest reading, as the
 * design's 5.0 to 7.5 N for readings of 5.5 to 7.3 N.
 */
export function chartAxis(readings: readonly number[], specMin: number | null): Axis {
  const include = specMin === null ? [] : [specMin];
  const axis = niceAxis(readings, { include });
  const step = axis.ticks.length > 1 ? axis.ticks[1] - axis.ticks[0] : 0;
  const known = [...readings, ...include].filter((value) => Number.isFinite(value));
  if (!(step > 0) || known.length === 0) return axis;
  const high = Math.max(...known);
  const max = Math.min(axis.max, Number((Math.ceil((high + step / 4) / step - 1e-9) * step).toPrecision(12)));
  return { min: axis.min, max, ticks: ticksBetween(axis.min, max, step) };
}

/**
 * How close two readings may be before their dots stack: the readings'
 * precision (0.1 N), or a dot's width along the axis where readings are
 * finer than a dot can show apart.
 */
export function stackingStep(axis: Pick<Axis, "min" | "max">, places: number, plotWidth: number): number {
  const precision = 10 ** -places;
  const dot = plotWidth > 0 ? (R.dot / plotWidth) * (axis.max - axis.min) : 0;
  return Number(Math.max(precision, dot).toPrecision(6));
}

/** Decimals a tick label needs for the axis's step: 0.5 needs one, 2 none. */
function tickPlaces(axis: Axis): number {
  const step = axis.ticks.length > 1 ? Math.abs(axis.ticks[1] - axis.ticks[0]) : 1;
  if (!(step > 0)) return 0;
  return Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

/** The decimal places a number is written with: 6.25 has 2. */
function placesOf(value: number): number {
  const written = String(value);
  if (/e/i.test(written)) return 0;
  const dot = written.indexOf(".");
  return dot === -1 ? 0 : written.length - dot - 1;
}

/* ------------------------------------------------------------------ *
 * Physical Properties: the lab report's averages per size
 * ------------------------------------------------------------------ */

function tensileOf(doc: InspectionExport, module: ExportModule, sizes: readonly string[]): ForceAtBreakTensile {
  const config = rec(module.config);
  const { computed } = module;
  const decimals = rec(config.decimals);
  const tensileMin = num(config.tensileMin) ?? num(computed.tensileMin);
  const elongationMin = num(config.elongationMin) ?? num(computed.elongationMin);
  const tensileDecimals = num(decimals.tensileStrength) ?? num(at(computed, "decimals", "tensileStrength"));
  const elongationDecimals = num(decimals.elongationAtBreak) ?? num(at(computed, "decimals", "elongationAtBreak"));
  const average = (value: unknown, places: number | null, unit: string, result: unknown): ForceAtBreakAverage | null => {
    const known = num(value);
    if (known === null || known <= 0) return null;
    const figure = formatNumber(known, { decimals: places ?? undefined });
    return { value: known, figure, text: withUnit(figure, unit), fail: result === "fail" };
  };
  const rows = sizes.map(
    (size): ForceAtBreakTensileSize => ({
      size,
      label: sizeLabel(doc, size),
      tensile: average(at(module.data, "sizes", size, "tensileStrength"), tensileDecimals, "MPa", at(computed, "sizes", size, "tensileResult")),
      elongation: average(at(module.data, "sizes", size, "elongationAtBreak"), elongationDecimals, "%", at(computed, "sizes", size, "elongationResult")),
      lots: lotsOf(doc, size),
      status: statusOf(module, size, undefined),
    }),
  );
  const minimum = (value: number | null, unit: string) => (value === null ? null : { value, text: formatNumber(value, { unit }) });
  const barAxis = (values: (number | undefined)[], min: number | null) => {
    const known = values.filter((value): value is number => value !== undefined);
    return { min: 0, max: niceAxis([0, ...known, ...(min === null ? [] : [min])], { pad: false }).max };
  };
  return {
    sizes: rows,
    tensileLabel: labelOf(module, "tensileStrength", "Tensile Strength (Average) (MPa)"),
    elongationLabel: labelOf(module, "elongationAtBreak", "Elongation at Break, Average (%)"),
    lotLabel: labelOf(moduleOf(doc, "order_lots"), "lotNumbers", "Lot No."),
    tensileMin: minimum(tensileMin, "MPa"),
    elongationMin: minimum(elongationMin, "%"),
    tensileAxis: barAxis(rows.map((row) => row.tensile?.value), tensileMin),
    elongationAxis: barAxis(rows.map((row) => row.elongation?.value), elongationMin),
    labNote: labReportNote(doc, module, sizes, "Averages", true),
  };
}

/* ------------------------------------------------------------------ *
 * Words the blocks share
 * ------------------------------------------------------------------ */

/** "Lab test to EN 455-2. The median of 13 specimens per size must reach 6 N.", and the tensile minimums where shown. */
function leadOf(force: ForceAtBreakTest | null, tensile: ForceAtBreakTensile | null, modules: readonly (ExportModule | null)[]): string | null {
  const standards = unique(modules.flatMap((module) => (module ? [standardOf(module)] : [])).filter((standard): standard is string => standard !== null));
  const sentences: string[] = [];
  if (standards.length > 0) sentences.push(`Lab test to ${andList(standards)}.`);
  if (force) {
    const counts = unique(force.sizes.map((size) => size.n)).sort((a, b) => a - b);
    const most = counts.at(-1) ?? 0;
    const per = force.sizes.length > 1 ? " per size" : "";
    const specimens = `${counts.length > 1 ? `${formatCount(counts[0])} to ${formatCount(most)}` : formatCount(most)} ${most === 1 ? "specimen" : "specimens"}`;
    const statistic = inSentence(force.medianLabel);
    if (force.specText) sentences.push(most > 0 ? `The ${statistic} of ${specimens}${per} must reach ${force.specText}.` : `The ${statistic} must reach ${force.specText}.`);
    else if (most > 0) sentences.push(`${upperFirst(specimens)} tested${per}.`);
  }
  if (tensile) {
    const tensileMin = tensile.tensileMin?.text;
    const elongationMin = tensile.elongationMin?.text;
    if (tensileMin && elongationMin) sentences.push(`Each size's average tensile strength must reach ${tensileMin} and its average elongation at break ${elongationMin}.`);
    else if (tensileMin) sentences.push(`Each size's average tensile strength must reach ${tensileMin}.`);
    else if (elongationMin) sentences.push(`Each size's average elongation at break must reach ${elongationMin}.`);
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}

/** Laboratory Details as the inspection records them: the standard alone (the template's). */
function detailsOf(modules: readonly (ExportModule | null)[]): ForceAtBreakDetail[] {
  const standards = unique(modules.flatMap((module) => (module ? [standardOf(module)] : [])).filter((standard): standard is string => standard !== null));
  return standards.length > 0 ? [{ key: "standard", label: "Standard", value: standards.join(", ") }] : [];
}

function standardOf(module: ExportModule): string | null {
  return text(module.config?.standardLabel) ?? text(module.computed.standardLabel);
}

/**
 * Where the readings come from: "Readings from the lab report attached, for
 * size M." The module keeps each lab report it links with the sizes it gives
 * results for; one added in the gallery keeps none, and counts as any lab
 * report of the module. The printed export lists the inspection's files, so
 * the reports kept are matched to them; the Report page's preview lists none
 * (lib/report/live-export.ts), so there the module's own state says whether
 * one is attached, as it judged it against the files the screen knows.
 * Where none is attached, a module that needs one says so; else nothing.
 */
function labReportNote(doc: InspectionExport, module: ExportModule, sizes: readonly string[], noun: string, required: boolean): string | null {
  const kept = list(module.data.labReports)
    .filter(isRecord)
    .flatMap((entry) => {
      const fileId = text(entry.fileId);
      return fileId ? [{ fileId, sizes: list(entry.sizes).map(text) }] : [];
    });
  const listed = doc.files.filter((file) => file.kind === "lab_report");
  const known = listed.length > 0;
  const files = listed.filter((file) => file.moduleKey === module.key || kept.some((entry) => entry.fileId === file.id));
  const attached = known ? files.length > 0 : module.computed.labReportAttached === true;
  if (!attached) return required ? "No lab report is attached." : null;
  const shown = known ? kept.filter((entry) => files.some((file) => file.id === entry.fileId)) : kept;
  const covered = shown
    .flatMap((entry) => entry.sizes)
    .filter((size): size is string => size !== null)
    .map((size) => normaliseSize(size) ?? size);
  const named = inTemplateOrder(doc, unique(covered).filter((size) => sizes.includes(size))).map((size) => sizeLabel(doc, size));
  const count = known ? files.length : Math.max(1, shown.length);
  const reports = count === 1 ? "the lab report attached" : `the ${formatCount(count)} lab reports attached`;
  const forSizes = named.length === 0 ? "" : `, for ${named.length === 1 ? "size" : "sizes"} ${andList(named)}`;
  return `${noun} from ${reports}${forSizes}.`;
}

/** The size's lots on the order, as typed: "LOT-A01, LOT-A02"; null when none is entered. */
function lotsOf(doc: InspectionExport, size: string): string | null {
  const lines = rec(moduleOf(doc, "order_lots")?.data.sizes);
  const line = Object.entries(lines).find(([key]) => (normaliseSize(key) ?? key) === size)?.[1];
  const lots = list(rec(line).lotNumbers)
    .map(text)
    .filter((lot): lot is string => lot !== null);
  return lots.length > 0 ? lots.join(", ") : null;
}

const CHECK_STATUSES: readonly string[] = ["pass", "fail", "warn", "not_done"];

/** The module's own verdict for a size (its per-size result, else its computed one); not done where it has none. */
function statusOf(module: ExportModule, size: string, computed: unknown): CheckStatus {
  const own = module.result.perSize?.[size]?.status ?? computed;
  return typeof own === "string" && CHECK_STATUSES.includes(own) ? (own as CheckStatus) : "not_done";
}

const COUNT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** A count opening a sentence: "One", "Two", … "Ten", then figures. */
function countWord(count: number): string {
  return COUNT_WORDS[count] ?? formatCount(count);
}

/** A template's label inside a sentence: "Median" as "median"; a word in capitals ("SD") stays. */
function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => (/^[A-Z][a-z]/.test(word) ? word.toLowerCase() : word))
    .join(" ");
}

function upperFirst(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/* ------------------------------------------------------------------ *
 * Heights
 * ------------------------------------------------------------------ */

function headingHeight(lead: string | null): number {
  if (!lead) return R.heading;
  return R.heading + R.leadGap + Math.max(1, Math.ceil(lead.length / R.leadCharacters)) * R.leadLine;
}

function detailsHeight(count: number): number {
  const rows = Math.max(1, Math.ceil(count / R.cardColumns));
  return R.cardFrame + rows * R.cardRow + (rows - 1) * R.cardRowGap;
}

/** A row of the dot plot: its tallest stack over the baseline, at least the least row (dotRowHeight in dot-plot.tsx). */
function dotRowHeight(stack: number): number {
  return Math.max(R.dotRowMin, R.dotBaseline + stack * R.dotRise + R.dotTop);
}

function linesOf(words: string, characters: number): number {
  return Math.max(1, Math.ceil(words.length / Math.max(1, characters)));
}

function notesHeight(notes: readonly string[]): number {
  if (notes.length === 0) return 0;
  const lines = notes.reduce((sum, note) => sum + linesOf(note, R.noteCharacters), 0);
  return R.chartGap + lines * R.noteLine + (notes.length - 1) * R.noteGap;
}

function readingsHeight(rows: number, median: boolean): number {
  return R.blockHeading + R.tableGap + R.tableHeader + rows * R.tableRow + (median ? R.totalsRow : 0);
}

/** A table row whose cells may wrap: the tallest cell's lines. */
function wrappedRow(cells: readonly (string | null)[], characters: number): number {
  const lines = cells.reduce((most, cell) => Math.max(most, cell ? linesOf(cell, characters) : 1), 1);
  return lines * R.noteLine + (R.tableRow - R.noteLine) + R.tableRule;
}

/** Characters of a size's cell in a summary of this width. */
function cellCharacters(width: number, labelShare: number, sizes: number): number {
  return ((width * (1 - labelShare)) / Math.max(1, sizes) - R.cellPadding) / R.characterWidth;
}

function noteHeight(note: string | null, width: number): number {
  return note ? R.summaryNoteGap + linesOf(note, width / R.characterWidth) * R.noteLine : 0;
}

function forceSummaryHeight(force: ForceAtBreakTest, width: number): number {
  const characters = cellCharacters(width, summaryLabelShare(force.sizes.length), force.sizes.length);
  const lots = force.sizes.some((size) => size.lots) ? wrappedRow(force.sizes.map((size) => size.lots), characters) : 0;
  // Average, SD, lowest, highest and the median, then the verdicts' chips.
  const rows = 5 * (R.tableRow + R.tableRule) + R.chipRow;
  return R.blockHeading + R.tableGap + R.tableHeader + lots + rows + noteHeight(force.labNote, width);
}

function tensileChartHeight(sizes: number): number {
  return R.blockHeading + R.chartGap + sizes * R.bar + (sizes - 1) * R.barGap + R.chartGap + R.noteLine;
}

function tensileSummaryHeight(tensile: ForceAtBreakTensile, width: number): number {
  const characters = cellCharacters(width, summaryLabelShare(tensile.sizes.length, true), tensile.sizes.length);
  const lots = tensile.sizes.some((size) => size.lots) ? wrappedRow(tensile.sizes.map((size) => size.lots), characters) : 0;
  // The two averages, then the verdicts' chips.
  const rows = 2 * (R.tableRow + R.tableRule) + R.chipRow;
  return R.blockHeading + R.tableGap + R.tableHeader + lots + rows + noteHeight(tensile.labNote, width);
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

type Unit =
  | { kind: "details" | "tensileChart" | "tensileSummary"; height: number }
  /** The chart's rows, each its height, and the notes under the last. */
  | { kind: "forceChart"; rows: { size: string; height: number }[]; notes: number }
  /** The readings' rows (null while switched off) and the lab's summary's height (null while switched off). */
  | { kind: "forceTables"; readings: number | null; summary: number | null; paired: boolean };

/**
 * The blocks in order, page by page: each page opens with the heading (the
 * lead on the first), a block that does not fit moves to the next page
 * whole, and a block taller than a page is split: the chart by its sizes,
 * the readings by rows (the summary beside the first stretch, the Median
 * under the last).
 */
function paginate(units: readonly Unit[], room: number, firstHeading: number): ForceAtBreakPage[] {
  const pages: ForceAtBreakPart[][] = [[]];
  const freshRoom = room - R.heading;
  let left = room - firstHeading;
  const fresh = () => pages[pages.length - 1].length === 0;
  const fits = (height: number) => R.gap + height <= left + 1e-6;
  const turn = () => {
    pages.push([]);
    left = freshRoom;
  };
  const place = (part: ForceAtBreakPart, height: number) => {
    pages[pages.length - 1].push(part);
    left -= R.gap + height;
  };
  /** A part whole: here, else on the next page, else here anyway, split by the caller. */
  const wholeHere = (height: number): boolean => {
    if (fits(height)) return true;
    if (!fresh() && R.gap + height <= freshRoom) {
      turn();
      return true;
    }
    return false;
  };

  for (const unit of units) {
    switch (unit.kind) {
      case "details":
      case "tensileChart":
      case "tensileSummary":
        if (!fits(unit.height) && !fresh()) turn();
        place({ kind: unit.kind }, unit.height);
        break;
      case "forceChart": {
        const frame = R.blockHeading + R.chartGap + R.axis;
        const whole = frame + unit.rows.reduce((sum, row) => sum + row.height, 0) + unit.notes;
        if (wholeHere(whole)) {
          place({ kind: "forceChart", sizes: unit.rows.map((row) => row.size), notes: unit.notes > 0 }, whole);
          break;
        }
        let rows = unit.rows;
        while (rows.length > 0) {
          let used = frame;
          let count = 0;
          while (count < rows.length) {
            const height = rows[count].height + (count + 1 === rows.length ? unit.notes : 0);
            if (!fits(used + height)) break;
            used += rows[count].height;
            count += 1;
          }
          if (count === 0 && !fresh()) {
            turn();
            continue;
          }
          // A row taller than a fresh page prints alone, as much of it as the page holds.
          count = Math.max(1, count);
          const last = count === rows.length;
          const height = frame + rows.slice(0, count).reduce((sum, row) => sum + row.height, 0) + (last ? unit.notes : 0);
          place({ kind: "forceChart", sizes: rows.slice(0, count).map((row) => row.size), notes: last && unit.notes > 0 }, height);
          rows = rows.slice(count);
          if (rows.length > 0) turn();
        }
        break;
      }
      case "forceTables": {
        const summary = unit.summary;
        if (unit.readings === null) {
          if (summary !== null) {
            if (!fits(summary) && !fresh()) turn();
            place({ kind: "forceTables", readings: null, summary: true, paired: false }, summary);
          }
          break;
        }
        const total = unit.readings;
        const besideSummary = (rows: number, median: boolean, withSummary: boolean) => Math.max(readingsHeight(rows, median), withSummary && summary !== null ? summary : 0);
        if (wholeHere(besideSummary(total, true, true))) {
          place({ kind: "forceTables", readings: { from: 0, to: total, median: true }, summary: summary !== null, paired: unit.paired }, besideSummary(total, true, true));
          break;
        }
        let from = 0;
        let withSummary = summary !== null;
        while (from < total) {
          const remaining = total - from;
          let count = 0;
          while (count < remaining && fits(besideSummary(count + 1, from + count + 1 === total, withSummary))) count += 1;
          if (count < Math.min(remaining, R.minimumRows) && !fresh()) {
            turn();
            continue;
          }
          count = Math.max(1, count);
          const median = from + count === total;
          place(
            { kind: "forceTables", readings: { from, to: from + count, median }, summary: withSummary, paired: unit.paired },
            besideSummary(count, median, withSummary),
          );
          withSummary = false;
          from += count;
          if (from < total) turn();
        }
        break;
      }
    }
  }
  return pages.filter((parts) => parts.length > 0).map((parts) => ({ parts }));
}

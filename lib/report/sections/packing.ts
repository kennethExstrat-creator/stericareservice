// Section 07, Glove Packing & Dispensing (TG35 page 7), from the packing
// check (dispensing_packing, BUILD_SPEC 6.1): what its pages draw
// (components/report/sections/packing.tsx) and how they are laid out.
//
// The lead says what was checked and against what, from the module's
// config: the minimums and which stickiness grades pass. The chart sets each
// size's average layering and dispensing against the minimums, with the
// worst stickiness grade given, and under a dashed rule the aged samples
// entered (one per size, Kenneth 26 October 2026: judged on their own, never
// one of the boxes), their ageing stated as TG35 states it, 70 °C for 7 days
// (AGEING_CONDITION in ../format.ts). The per-box table lists every box by
// its item, size by size, with each size's averages; the aged gloves' table
// each size on the order with its aged sample and its result, a size with
// none entered Not Done (every size needs one: Kenneth, 27 October 2026); the
// grades the template's stickiness codes. Labels are the template's
// (docs/DESIGN.md: the report keeps the template's words); the averages, the
// worst grades and the results are the module's own (calc), worked out here
// only where an export lacks them. A value below its minimum and a failing
// grade print in red; the app never changes a result.
//
// The pages are planned here, so the plan knows their count: heights in
// millimetres from the components' own sizes (PACKING_ROOM), each erring
// long. The per-box table runs on to another page when the boxes do not fit,
// its header repeated and the average row on its last page; a block that
// does not fit moves to the next page whole.
//
// An inspection with no packing check fills the slot from the Safedon
// dispensing check instead (Glove Dispensing, ./glove-dispensing.ts).
import { formatNumber, plainLabel } from "@/lib/format";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES, type ReportBlockKey } from "@/lib/schemas/report-options";
import { roundTo } from "@/lib/stats";
import type { CheckStatus } from "../checks";
import { AGEING_HEADING, AGEING_LINE, andList, counted } from "../format";
import type {
  PackingAged,
  PackingBoxRow,
  PackingFigure,
  PackingGrade,
  PackingPart,
  PackingPerBox,
  PackingSection,
  PackingSlot,
  ReportSectionPlanEntry,
} from "../model";
import { at, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import { buildGloveDispensing } from "./glove-dispensing";
import { defineSection } from "./index";

/* ------------------------------------------------------------------ *
 * The words
 * ------------------------------------------------------------------ */

/** Averages are judged, and so printed, at one decimal (AVERAGE_DECIMALS in modules/dispensing_packing/calc.ts). */
const DECIMALS = 1;

/** The chart's row of the aged samples, after the sizes'. */
export const AGED_ROW_KEY = "aged";

/** The design's names for the aged samples: the chart's row and the table's heading. */
const AGED_GLOVES = "Aged Gloves";
const BOX_AGED_GLOVES = "Box-Aged Gloves";

/** The per-box table's short headings for the template's default words, as the design sets them; any other word is kept whole. */
const SHORT_WORDS: Readonly<Record<string, string>> = { Layering: "Layer", Dispensing: "Disp." };

type Words = PackingSection["words"];
type Minimums = PackingSection["minimums"];

function wordsOf(module: ExportModule): Words {
  const layering = plainLabel(labelOf(module, "layeringPct", "Layering %"));
  const dispensing = plainLabel(labelOf(module, "dispensingPct", "Dispensing %"));
  return {
    layering,
    dispensing,
    stickiness: plainLabel(labelOf(module, "stickiness", "Stickiness **")),
    layeringShort: SHORT_WORDS[layering] ?? layering,
    dispensingShort: SHORT_WORDS[dispensing] ?? dispensing,
    boxNo: labelOf(module, "boxNo", "Box/Carton #"),
    item: labelOf(module, "itemColumn", "Item"),
    average: labelOf(module, "layeringAverage", "Average"),
  };
}

/** A label inside a sentence: "Layering" is "layering"; an acronym ("PO") stays. */
function inSentence(word: string): string {
  const second = word.charAt(1);
  return second !== "" && second === second.toUpperCase() && second !== second.toLowerCase() ? word : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
}

function capitalised(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** "70%", "88.3%": a percentage as the report prints a minimum or an average. */
export function percentText(value: number): string {
  return formatNumber(value, { maxDecimals: DECIMALS, unit: "%" });
}

/** A grade's line in Stickiness Grades: the template's legend as a sentence, then whether it passes. "Non sticky. Passed." */
export function gradeLine(grade: PackingGrade): string {
  const legend = grade.label.trim();
  return `${/[.!?]$/.test(legend) ? legend : `${legend}.`} ${grade.pass ? "Passed." : "Failed."}`;
}

/* ------------------------------------------------------------------ *
 * Reading the module
 * ------------------------------------------------------------------ */

/** The template's stickiness codes from least to most sticky (config.stickinessCodes), each once. */
function gradesOf(module: ExportModule): PackingGrade[] {
  const grades: PackingGrade[] = [];
  for (const entry of list(module.config?.stickinessCodes)) {
    const code = text(rec(entry).code);
    if (code === null || grades.some((grade) => grade.code === code)) continue;
    grades.push({ code, label: text(rec(entry).label) ?? code, pass: rec(entry).pass === true });
  }
  return grades;
}

/** A box row or an aged sample as entered: null for a blank one. */
type Entry = { boxNo: number | null; layering: number | null; dispensing: number | null; stickiness: string | null; note: string | null };

function entryOf(value: unknown): Entry | null {
  const row = rec(value);
  const entry: Entry = {
    boxNo: num(row.boxNo),
    layering: num(row.layeringPct),
    dispensing: num(row.dispensingPct),
    stickiness: text(row.stickiness),
    note: text(row.note),
  };
  return Object.values(entry).every((part) => part === null) ? null : entry;
}

/** What the section reads of one size on the order. */
type SizeReading = {
  size: string;
  label: string;
  /** By item, blank rows null, the blank rows after the last box left out. */
  boxes: (Entry | null)[];
  aged: Entry | null;
  layeringAverage: number | null;
  dispensingAverage: number | null;
  /** The worst grade given to its boxes. */
  worst: PackingGrade | null;
  /** The aged sample's own verdict (calc): not done while none is entered. */
  agedStatus: CheckStatus;
};

/** The mean of the percentages entered within 0 to 100, as calc takes them; null for none. */
function meanOf(values: readonly (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null && value >= 0 && value <= 100);
  return valid.length === 0 ? null : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

const CHECK_STATUSES: readonly CheckStatus[] = ["pass", "fail", "warn", "not_done"];

function statusOf(value: unknown): CheckStatus {
  return CHECK_STATUSES.find((status) => status === value) ?? "not_done";
}

function sizesOf(doc: InspectionExport, module: ExportModule, grades: readonly PackingGrade[]): SizeReading[] {
  const gradeOf = (code: string | null) => grades.find((grade) => grade.code === code) ?? null;
  return orderedSizes(doc).map((size) => {
    const data = rec(at(module.data, "sizes", size));
    const computed = rec(at(module.computed, "sizes", size));
    const boxes = list(data.boxes).map(entryOf);
    while (boxes.length > 0 && boxes[boxes.length - 1] === null) boxes.pop();
    const entered = boxes.filter((box): box is Entry => box !== null);
    return {
      size,
      label: sizeLabel(doc, size),
      boxes,
      aged: entryOf(data.agedSample),
      layeringAverage: num(computed.layeringAverage) ?? meanOf(entered.map((box) => box.layering)),
      dispensingAverage: num(computed.dispensingAverage) ?? meanOf(entered.map((box) => box.dispensing)),
      worst: gradeOf(text(computed.stickinessSummary)) ?? worstOf(grades, entered.map((box) => box.stickiness)),
      agedStatus: statusOf(at(computed, "agedSample", "result")),
    };
  });
}

/** The worst of the codes given, the latest among the template's; null when none of them is one. */
function worstOf(grades: readonly PackingGrade[], codes: readonly (string | null)[]): PackingGrade | null {
  return grades.filter((grade) => codes.includes(grade.code)).at(-1) ?? null;
}

/** A percentage against its minimum, judged at one decimal as calc judges it. */
function figureOf(value: number | null, minimum: number | null): PackingFigure {
  return { value, low: value !== null && minimum !== null && roundTo(value, DECIMALS) < minimum };
}

/* ------------------------------------------------------------------ *
 * The lead
 * ------------------------------------------------------------------ */

/** "inner box" as "inner boxes", "pouch" as "pouches". */
function plural(noun: string): string {
  return /(s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`;
}

/** Codes as a list in a sentence: three or more in a row of the template's order as a run, "A to C"; else "A and B". */
function codesText(codes: readonly PackingGrade[], all: readonly PackingGrade[]): string {
  const places = codes.map((grade) => all.indexOf(grade));
  const inARow = places.every((place, index) => place === places[0] + index);
  return codes.length >= 3 && inARow ? `${codes[0].code} to ${codes[codes.length - 1].code}` : andList(codes.map((grade) => grade.code));
}

/** "stickiness grades A to C pass, D fails"; "stickiness grade A passes, B to D fail". */
function gradesText(stickiness: string, grades: readonly PackingGrade[]): string | null {
  const passing = grades.filter((grade) => grade.pass);
  const failing = grades.filter((grade) => !grade.pass);
  const clauses = [
    passing.length > 0 ? `${codesText(passing, grades)} ${passing.length === 1 ? "passes" : "pass"}` : null,
    failing.length > 0 ? `${codesText(failing, grades)} ${failing.length === 1 ? "fails" : "fail"}` : null,
  ].filter((clause): clause is string => clause !== null);
  if (clauses.length === 0) return null;
  const first = passing.length > 0 ? passing : failing;
  return `${inSentence(stickiness)} ${first.length === 1 ? "grade" : "grades"} ${clauses.join(", ")}`;
}

/**
 * "Inner boxes opened to check glove layering and how cleanly gloves
 * dispense. Minimum 70% layering and 80% dispensing; stickiness grades A to
 * C pass, D fails." The inner unit is the packing configuration's.
 */
function leadOf(doc: InspectionExport, words: Words, minimums: Minimums, grades: readonly PackingGrade[]): string {
  const unit = text(moduleOf(doc, "packing_config")?.computed.innerUnit) ?? "inner box";
  const limits = [
    minimums.layering === null ? null : `${percentText(minimums.layering)} ${inSentence(words.layering)}`,
    minimums.dispensing === null ? null : `${percentText(minimums.dispensing)} ${inSentence(words.dispensing)}`,
  ].filter((limit): limit is string => limit !== null);
  const judged = [limits.length > 0 ? `Minimum ${andList(limits)}` : null, gradesText(words.stickiness, grades)].filter(
    (part): part is string => part !== null,
  );
  const opened = `${capitalised(plural(unit))} opened to check glove ${inSentence(words.layering)} and how cleanly gloves dispense.`;
  return judged.length > 0 ? `${opened} ${capitalised(judged.join("; "))}.` : opened;
}

/* ------------------------------------------------------------------ *
 * The blocks
 * ------------------------------------------------------------------ */

function chartOf(sizes: readonly SizeReading[], minimums: Minimums, aged: AgedSamples | null): NonNullable<PackingSection["chart"]> {
  return {
    rows: sizes.map((size) => ({
      key: size.size,
      label: size.label,
      sublabel: counted(size.boxes.filter((box) => box !== null).length, "box", "boxes"),
      layering: figureOf(size.layeringAverage, minimums.layering),
      dispensing: figureOf(size.dispensingAverage, minimums.dispensing),
      grade: size.worst,
    })),
    // The aged samples entered, averaged: no row while none is.
    aged:
      aged && aged.entered.length > 0
        ? {
            key: AGED_ROW_KEY,
            label: AGED_GLOVES,
            sublabel: `${AGEING_LINE} · ${counted(aged.entered.length, "box", "boxes")}`,
            layering: aged.layering,
            dispensing: aged.dispensing,
            grade: aged.worst,
          }
        : null,
  };
}

function perBoxOf(sizes: readonly SizeReading[], words: Words, minimums: Minimums, grades: readonly PackingGrade[]): PackingPerBox {
  const row = (box: Entry | null): PackingBoxRow | null =>
    box && { boxNo: box.boxNo, layering: figureOf(box.layering, minimums.layering), dispensing: figureOf(box.dispensing, minimums.dispensing) };
  return {
    sizes: sizes.map((size) => ({
      size: size.size,
      label: size.label,
      boxes: size.boxes.map(row),
      layering: figureOf(size.layeringAverage, minimums.layering),
      dispensing: figureOf(size.dispensingAverage, minimums.dispensing),
    })),
    items: Math.max(0, ...sizes.map((size) => size.boxes.length)),
    note: boxNote(sizes, words, grades),
  };
}

type NotePart = PackingPerBox["note"][number];

function notePart(text: string, fail = false): NotePart {
  return fail ? { text, fail } : { text };
}

/**
 * The per-box table's note: "Layering and dispensing in %." and "Every box
 * graded stickiness A." when that is so; else the grades given ("Stickiness
 * grades: 30 boxes A, 2 boxes B and 1 box D."), a failing grade's part in
 * red, and the boxes not graded yet.
 */
function boxNote(sizes: readonly SizeReading[], words: Words, grades: readonly PackingGrade[]): NotePart[] {
  const unit = `${capitalised(words.layering)} and ${inSentence(words.dispensing)} in %.`;
  const boxes = sizes.flatMap((size) => size.boxes.filter((box): box is Entry => box !== null));
  if (boxes.length === 0) return [notePart(unit)];
  const stickiness = inSentence(words.stickiness);
  const given = grades.map((grade) => ({ grade, count: boxes.filter((box) => box.stickiness === grade.code).length })).filter(({ count }) => count > 0);
  const ungraded = boxes.length - given.reduce((sum, { count }) => sum + count, 0);
  if (given.length === 0) return [notePart(`${unit} No box graded for ${stickiness} yet.`)];
  if (given.length === 1 && ungraded === 0) return [notePart(`${unit} `), notePart(`Every box graded ${stickiness} ${given[0].grade.code}.`, !given[0].grade.pass)];
  const parts = [
    ...given.map(({ grade, count }) => notePart(`${counted(count, "box", "boxes")} ${grade.code}`, !grade.pass)),
    ...(ungraded > 0 ? [notePart(`${counted(ungraded, "box", "boxes")} not graded yet`)] : []),
  ];
  const listed = parts.flatMap((part, index) => (index === 0 ? [part] : [notePart(index === parts.length - 1 ? " and " : ", "), part]));
  return [notePart(`${unit} ${capitalised(stickiness)} grades: `), ...listed, notePart(".")];
}

/**
 * Each size on the order with its aged sample, and what the chart's row and
 * the table share of those entered. Their ageing is the report's own
 * (AGEING_CONDITION, ../format.ts): the module has no field for it.
 */
type AgedSamples = {
  /** Every size on the order: one with no aged sample entered keeps its place, not done. */
  sizes: readonly SizeReading[];
  /** The sizes with an aged sample entered. */
  entered: (SizeReading & { aged: Entry })[];
  layering: PackingFigure;
  dispensing: PackingFigure;
  worst: PackingGrade | null;
};

function agedSamplesOf(sizes: readonly SizeReading[], minimums: Minimums, grades: readonly PackingGrade[]): AgedSamples | null {
  if (sizes.length === 0) return null;
  const entered = sizes.filter((size): size is SizeReading & { aged: Entry } => size.aged !== null);
  return {
    sizes,
    entered,
    layering: figureOf(meanOf(entered.map((size) => size.aged.layering)), minimums.layering),
    dispensing: figureOf(meanOf(entered.map((size) => size.aged.dispensing)), minimums.dispensing),
    worst: worstOf(
      grades,
      entered.map((size) => size.aged.stickiness),
    ),
  };
}

/** The aged gloves' table: a row per size on the order, its figures blank and Not Done while none is entered. */
function agedOf(samples: AgedSamples, minimums: Minimums, grades: readonly PackingGrade[]): PackingAged {
  const gradeOf = (code: string | null) => grades.find((grade) => grade.code === code) ?? null;
  const rows = samples.sizes.map((size) => ({
    size: size.size,
    label: size.label,
    layering: figureOf(size.aged?.layering ?? null, minimums.layering),
    dispensing: figureOf(size.aged?.dispensing ?? null, minimums.dispensing),
    grade: gradeOf(size.aged?.stickiness ?? null),
    status: size.agedStatus,
  }));
  const statuses = new Set(rows.map((row) => row.status));
  return {
    title: `${BOX_AGED_GLOVES} (${AGEING_HEADING})`,
    rows,
    average: { layering: samples.layering, dispensing: samples.dispensing, grade: samples.worst },
    status: statuses.size === 1 ? rows[0].status : null,
  };
}

/* ------------------------------------------------------------------ *
 * The section
 * ------------------------------------------------------------------ */

function buildPacking(doc: InspectionExport, entry: ReportSectionPlanEntry<"packing">): PackingSlot | null {
  const check = moduleOf(doc, "dispensing_packing");
  // No packing check: a Safedon template's Glove Dispensing (./glove-dispensing.ts), or "coming next".
  if (!check) return withSafedon(doc, entry);
  const on = (key: ReportBlockKey<"packing">) => entry.blocks.some((block) => block.key === key);
  const words = wordsOf(check);
  const minimums: Minimums = { layering: num(check.config?.minLayeringPct), dispensing: num(check.config?.minDispensingPct) };
  const grades = gradesOf(check);
  const sizes = sizesOf(doc, check, grades);
  const samples = agedSamplesOf(sizes, minimums, grades);
  const body: Omit<PackingSection, "pages" | "pageCount"> = {
    lead: leadOf(doc, words, minimums, grades),
    words,
    minimums,
    chart: on("averageLayeringDispensing") && sizes.length > 0 ? chartOf(sizes, minimums, samples) : null,
    perBox: on("perBoxResults") && sizes.length > 0 ? perBoxOf(sizes, words, minimums, grades) : null,
    aged: on("agedGloves") && samples ? agedOf(samples, minimums, grades) : null,
    grades: on("stickinessGrades") && grades.length > 0 ? grades : null,
  };
  if (!body.chart && !body.perBox && !body.aged && !body.grades) return null;
  const pages = planPages(body, layoutOf(doc));
  return { ...body, pages, pageCount: pages.length };
}

/** Glove Dispensing's content where the inspection has the Safedon dispensing check; null without it. */
function withSafedon(doc: InspectionExport, entry: ReportSectionPlanEntry<"packing">): PackingSlot | null {
  const safedon = moduleOf(doc, "dispensing_safedon");
  return safedon ? buildGloveDispensing(doc, entry, safedon) : null;
}

export const packing = defineSection({ key: "packing", build: buildPacking });

/* ------------------------------------------------------------------ *
 * The pages' room
 *
 * Millimetres, from the components' classes (components/report and
 * components/report/sections/packing.tsx): change one with the other. Text
 * is measured by Outfit's own letter widths (ADVANCES) taken 5% long, so a
 * line estimate errs long, and each page keeps a margin for the rest.
 * ------------------------------------------------------------------ */

export const PACKING_ROOM = {
  /** A page's header band and footer, with the content's padding (as SUMMARY_ROOM's). */
  chrome: 61,
  /** A line of the footer note, at most two. */
  footerNoteLine: 3.7,
  footerNoteCharacters: 100,
  /** Left free at each page's foot, for the estimates' error. */
  margin: 2,
  /** The page's sides, inside which its content is laid out. */
  sides: 26,
  /** The section's kicker and title; the first page's lead under them (SectionHeading: 9.5 pt, at most 175 mm wide). */
  heading: 14.1,
  leadGap: 1.6,
  leadLine: 5.03,
  leadWidth: 175,
  /** Under the heading, and between the page's parts. */
  headingGap: 4,
  partGap: 3.5,
  /** A block's heading (12 pt), the space between its title and its note, and a line of the note where it wraps under the title (8.5 pt). */
  blockTitle: 5.3,
  blockNoteSpace: 6,
  blockNoteLine: 4.2,
  blockNoteGap: 1,
  /** The chart's legend: a bar's or the minimum's swatch with its gap, the grade's chip with its gap, between items. */
  keySwatch: 6,
  keyChip: 7,
  keyGap: 4,
  /** The chart: its gap under the heading, a size's row (two bars, or its label's lines at 9 pt), the aged row's rule, the axis. */
  chartGap: 1.6,
  chartRow: 9.6,
  chartLabelLine: 4.76,
  chartLabelWidth: 34,
  agedRule: 4.3,
  axis: 4.6,
  /** The tables: the gap under a heading, the sizes' row, a header line and its padding, a box's row, the average row. */
  tableGap: 1,
  groupRow: 6,
  headerLine: 3.75,
  headerPadding: 2.8,
  cellPadding: 3.2,
  boxRow: 4.75,
  averageRow: 5.2,
  /** "No boxes are entered yet." */
  emptyLine: 4.8,
  /** The aged gloves' table: its header and a row (dense, with hairlines). */
  agedHeader: 7,
  agedHeaderLine: 4.2,
  agedRow: 5.85,
  /** The two blocks side by side: the gap between them. */
  columnGap: 6,
  /** Stickiness Grades: the gap under its heading, a grade's chip (at least 8 mm wide), its text's lines (8.5 pt) and the gap between grades. */
  gradesGap: 2,
  gradeChip: 5.4,
  gradeChipWidth: 8,
  gradeChipPadding: 3.4,
  gradeTextGap: 3,
  gradeTextTop: 0.6,
  gradeLine: 4.2,
  gradeGap: 1.2,
} as const;

/** The per-box table's sizes keep to this width each while one or two are on the order; three or more share the page's width. */
const PER_BOX_GROUP_MAX = 46;

/** The aged gloves' table's columns, as shares of its width: "Average" and the template's words fit their headings. */
export const AGED_COLUMN_SHARES = { size: 0.18, layering: 0.19, dispensing: 0.22, stickiness: 0.2, result: 0.21 } as const;

const MM_PER_PT = 25.4 / 72;

/**
 * Outfit's advance widths in em, by groups of characters alike: its latin
 * face at a medium weight (bolder is up to 3% wider), each group's widest
 * rounded up. Anything else is taken at 0.6 em. The middle dot and the
 * degree sign are their own, as Chrome sets them (0.146 and 0.392 em): the
 * aged gloves' "70 °C · 7 days · 4 boxes" fits its 34 mm, as TG35 sets it.
 */
const ADVANCES: readonly (readonly [string, number])[] = [
  ["·", 0.15],
  [" ", 0.21],
  ["iIjl'|!.,:;", 0.29],
  ["()[]{}`1", 0.35],
  ["°", 0.4],
  ["frts/\\\"", 0.43],
  ["z*^-?_", 0.51],
  ["ceuvxyk7J~+<=>L", 0.55],
  ["abdghnopq2345689$FSZE", 0.6],
  ["0#%&ABCPRTKYVXU", 0.7],
  ["DGHNOQw@", 0.82],
  ["mM", 0.87],
  ["W", 1],
];
const ADVANCE = new Map(ADVANCES.flatMap(([characters, em]) => Array.from(characters, (character) => [character, em] as const)));
/** Estimates are taken this much long. */
const LONG = 1.05;

/** How wide a text sets at a size, a little long. */
export function textWidth(words: string, pt: number): number {
  let em = 0;
  for (const character of words) em += ADVANCE.get(character) ?? 0.6;
  return em * pt * MM_PER_PT * LONG;
}

/** About how many lines a text takes at a width: breaking at spaces and after a slash, a word too long for a line on a line of its own. */
export function lineCount(words: string, width: number, pt: number): number {
  const parts = words.replace(/\//g, "/ ").split(/\s+/).filter((part) => part !== "");
  const space = textWidth(" ", pt);
  let lines = 1;
  let used = 0;
  for (const part of parts) {
    const length = textWidth(part, pt);
    const next = used === 0 ? length : used + space + length;
    if (used === 0 || next <= width) used = next;
    else {
      lines += 1;
      used = length;
    }
  }
  return lines;
}

/**
 * The per-box table's widths in millimetres: the item column, then each
 * size's box/carton number, layering and dispensing. One or two sizes keep
 * to their own width; three or more fill the page's.
 */
export function perBoxGeometry(sizeCount: number, width: number): { table: number; item: number; box: number; layering: number; dispensing: number } {
  const count = Math.max(1, sizeCount);
  const item = count >= 5 ? 10 : 14;
  const group = count <= 2 ? Math.min(PER_BOX_GROUP_MAX, (width - item) / count) : (width - item) / count;
  return { table: item + count * group, item, box: group * 0.46, layering: group * 0.27, dispensing: group * 0.27 };
}

export type PackingLayout = { room: number; width: number };

/** The room for content on a page, and its width: the paper less the chrome, the footer note and the margin. */
function layoutOf(doc: InspectionExport): PackingLayout {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  const note = doc.report.footerNote;
  const noteLines = note ? Math.min(2, Math.ceil(note.length / PACKING_ROOM.footerNoteCharacters)) : 0;
  return {
    room: paper.height - PACKING_ROOM.chrome - noteLines * PACKING_ROOM.footerNoteLine - PACKING_ROOM.margin,
    width: paper.width - PACKING_ROOM.sides,
  };
}

/** A note beside a block's title: how wide it sets on one line, and its lines where it wraps under the title. */
type HeadingNote = { width: number; lines: number };

function textNote(note: string, width: number): HeadingNote {
  return { width: textWidth(note, 8.5), lines: lineCount(note, width, 8.5) };
}

/** A block's heading (BlockHeading): its title, and its note beside it, or under it where the two do not share a line. */
function blockHeadingHeight(title: string, width: number, note?: HeadingNote): number {
  const titleHeight = lineCount(title, width, 12) * PACKING_ROOM.blockTitle;
  if (!note || textWidth(title, 12) + PACKING_ROOM.blockNoteSpace + note.width <= width) return titleHeight;
  return titleHeight + PACKING_ROOM.blockNoteGap + note.lines * PACKING_ROOM.blockNoteLine;
}

/** The chart's legend (ChartKey): each item's swatch and words, the gaps between them. */
function chartKeyNote(words: Words, minimums: Minimums, graded: boolean, width: number): HeadingNote {
  const room = PACKING_ROOM;
  const items = [
    room.keySwatch + textWidth(words.layering, 8.5),
    room.keySwatch + textWidth(words.dispensing, 8.5),
    ...(minimums.layering !== null || minimums.dispensing !== null ? [room.keySwatch + textWidth("Minimum", 8.5)] : []),
    ...(graded ? [room.keyChip + textWidth(`${words.stickiness} grade`, 8.5)] : []),
  ];
  const total = items.reduce((sum, item) => sum + item, 0) + (items.length - 1) * room.keyGap;
  return { width: total, lines: Math.ceil(total / width) };
}

export function chartTitle(words: Words): string {
  return `Average ${words.layering} & ${words.dispensing}`;
}

export const PER_BOX_TITLE = "Per-Box Results";
export const GRADES_TITLE = "Stickiness Grades";

function chartHeight(body: Omit<PackingSection, "pages" | "pageCount">, width: number): number {
  const chart = body.chart;
  if (!chart) return 0;
  const room = PACKING_ROOM;
  const graded = [...chart.rows, ...(chart.aged ? [chart.aged] : [])].some((row) => row.grade !== null);
  const rows = chart.rows.reduce(
    (sum, row) => sum + Math.max(room.chartRow, lineCount(`${row.label} ${row.sublabel}`, room.chartLabelWidth, 9) * room.chartLabelLine),
    0,
  );
  const aged = chart.aged
    ? room.agedRule + Math.max(room.chartRow, (1 + lineCount(chart.aged.sublabel, room.chartLabelWidth, 9)) * room.chartLabelLine)
    : 0;
  return blockHeadingHeight(chartTitle(body.words), width, chartKeyNote(body.words, body.minimums, graded, width)) + room.chartGap + rows + aged + room.axis;
}

/** The per-box note as one text, as its heading prints it. */
function noteText(note: PackingPerBox["note"]): string {
  return note.map((part) => part.text).join("");
}

/** The per-box table's parts above its rows on a page (the heading, the sizes' row, the header), by the chunk's heading note. */
function perBoxFixed(body: Omit<PackingSection, "pages" | "pageCount">, perBox: PackingPerBox, note: string, width: number): number {
  const room = PACKING_ROOM;
  const geometry = perBoxGeometry(perBox.sizes.length, width);
  const { words } = body;
  const headerLines = Math.max(
    lineCount(words.item, geometry.item - room.cellPadding, 8.5),
    lineCount(words.boxNo, geometry.box - room.cellPadding, 8.5),
    lineCount(words.layeringShort, geometry.layering - room.cellPadding, 8.5),
    lineCount(words.dispensingShort, geometry.dispensing - room.cellPadding, 8.5),
  );
  return blockHeadingHeight(PER_BOX_TITLE, geometry.table, textNote(note, geometry.table)) + room.tableGap + room.groupRow + room.headerPadding + headerLines * room.headerLine;
}

/** "Continued: Item 14 to 26": a later page's note on the per-box table. */
export function continuedNote(words: Words, from: number, to: number): string {
  return `Continued: ${words.item} ${from + 1} to ${to}`;
}

function closingHeight(body: Omit<PackingSection, "pages" | "pageCount">, width: number): number {
  const room = PACKING_ROOM;
  const column = (width - room.columnGap) / 2;
  const { words } = body;
  const headings: [string, number][] = [
    ["Size", AGED_COLUMN_SHARES.size],
    [words.layering, AGED_COLUMN_SHARES.layering],
    [words.dispensing, AGED_COLUMN_SHARES.dispensing],
    [words.stickiness, AGED_COLUMN_SHARES.stickiness],
    ["Result", AGED_COLUMN_SHARES.result],
  ];
  const headerLines = Math.max(...headings.map(([word, share]) => lineCount(word, column * share - room.cellPadding, 8.5)));
  const aged = body.aged
    ? blockHeadingHeight(body.aged.title, column) + room.tableGap + room.agedHeader + (headerLines - 1) * room.agedHeaderLine + (body.aged.rows.length + 1) * room.agedRow
    : 0;
  const grades = body.grades
    ? blockHeadingHeight(GRADES_TITLE, column) +
      room.gradesGap +
      body.grades.reduce((sum, grade) => {
        const chip = Math.max(room.gradeChipWidth, textWidth(grade.code, 9) + room.gradeChipPadding);
        const lines = lineCount(gradeLine(grade), column - chip - room.gradeTextGap, 8.5);
        return sum + Math.max(room.gradeChip, room.gradeTextTop + lines * room.gradeLine);
      }, 0) +
      (body.grades.length - 1) * room.gradeGap
    : 0;
  return Math.max(aged, grades);
}

/**
 * A per-box table split between pages leaves at least this many rows (all
 * but one, of fewer) to go on with its average row, and starts with as many
 * under another part, or starts on the next page.
 */
export const MIN_ROWS = 4;

/**
 * Each page's parts, in order: the chart, the per-box table (split by its
 * items where it does not fit, its average row with its last items) and the
 * aged gloves beside the grades. A part that does not fit where it falls
 * starts the next page; one taller than a page prints regardless, clipped.
 */
export function planPages(body: Omit<PackingSection, "pages" | "pageCount">, { room, width }: PackingLayout): { parts: PackingPart[] }[] {
  const pages: PackingPart[][] = [[]];
  let used = PACKING_ROOM.heading + PACKING_ROOM.leadGap + lineCount(body.lead, Math.min(PACKING_ROOM.leadWidth, width), 9.5) * PACKING_ROOM.leadLine;
  const current = () => pages[pages.length - 1];
  const gap = () => (current().length === 0 ? PACKING_ROOM.headingGap : PACKING_ROOM.partGap);
  const nextPage = () => {
    pages.push([]);
    used = PACKING_ROOM.heading;
  };
  const place = (part: PackingPart, height: number) => {
    if (current().length > 0 && used + gap() + height > room) nextPage();
    used += gap() + height;
    current().push(part);
  };

  if (body.chart) place({ kind: "chart" }, chartHeight(body, width));

  const perBox = body.perBox;
  if (perBox && perBox.items === 0) {
    const geometry = perBoxGeometry(perBox.sizes.length, width);
    const note = textNote(noteText(perBox.note), geometry.table);
    place({ kind: "perBox", from: 0, to: 0 }, blockHeadingHeight(PER_BOX_TITLE, geometry.table, note) + PACKING_ROOM.tableGap + PACKING_ROOM.emptyLine);
  } else if (perBox) {
    let from = 0;
    while (from < perBox.items) {
      const note = from === 0 ? noteText(perBox.note) : continuedNote(body.words, from, perBox.items);
      const fixed = gap() + perBoxFixed(body, perBox, note, width);
      const left = perBox.items - from;
      const free = room - used - fixed;
      const fresh = current().length === 0;
      // Where the rest does not fit with its average row: the rows that fit, leaving MIN_ROWS to go on with that row.
      const take = Math.min(Math.floor(free / PACKING_ROOM.boxRow), left - Math.max(1, Math.min(MIN_ROWS, left - 1)));
      if (left * PACKING_ROOM.boxRow + PACKING_ROOM.averageRow <= free || (fresh && take < 1)) {
        current().push({ kind: "perBox", from, to: perBox.items });
        used += fixed + left * PACKING_ROOM.boxRow + PACKING_ROOM.averageRow;
        break;
      }
      if (!fresh && take < MIN_ROWS) {
        nextPage();
        continue;
      }
      current().push({ kind: "perBox", from, to: from + take });
      from += take;
      nextPage();
    }
  }

  if (body.aged || body.grades) place({ kind: "agedAndGrades" }, closingHeight(body, width));
  return pages.map((parts) => ({ parts }));
}

// Section 07 for a template with the Safedon dispensing check and no packing
// check (SAFEDON_EG): Glove Dispensing, from dispensing_safedon (BUILD_SPEC
// 6.1), what its pages draw (components/report/sections/glove-dispensing.tsx)
// and how they are laid out. The packing builder (./packing.ts) hands an
// inspection without a packing check to this file; both fill the section's
// one slot (PackingSlot in ../model.ts).
//
// No design exists for it, so it follows TG35 page 7, the packing check's
// layout. The lead says what was dispensed, the maximum and how each size
// did. The chart sets each size's defect rate against the template's
// maximum, a dashed red line, with the figures and the size's result at its
// right. The per-box table lists each box by its No. in the box list, size
// by size: its box/carton number and the defects found in it, with each
// size's total. Under them the defects by type (the template's list, then
// the total, the gloves inspected, the rate and the result per size) sit
// beside the template's definitions of the defects, as the design sets the
// aged gloves beside the stickiness grades. Labels are the template's; the
// counts, rates and results are the module's own (calc), never worked out
// again here. A rate over the maximum prints in red, a box/carton number the
// module warns about (not one of the size's sampled numbers) in amber, and
// what is not entered yet as "—".
//
// The chart follows the Average Layering & Dispensing Chart switch (the
// section's chart) and the per-box table Per-Box Results; the defects by
// type and their definitions print whenever the section does (Aged Gloves
// and Stickiness Grades are the packing check's).
//
// The pages are planned here, so the plan knows their count: heights in
// millimetres from the components' own sizes (GLOVE_DISPENSING_ROOM), each
// erring long. The per-box table runs on to another page when the boxes do
// not fit, its header repeated and the total row on its last page. The
// defects and the definitions move to the next page together, or, where a
// page cannot hold them side by side, run on one under the other.
import { boxCartonNumber, formatCount, formatNumber, formatRatio } from "@/lib/format";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES, type ReportBlockKey } from "@/lib/schemas/report-options";
import { BOX_NOT_SAMPLED } from "@/modules/_framework/box-cartons";
import { RATE_DECIMALS } from "@/modules/dispensing_safedon/text";
import { andList, counted } from "../format";
import { niceAxis, type Axis } from "../geometry";
import type { ReportSectionPlanEntry } from "../model";
import { at, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
// ./packing.ts imports this file (it delegates here): its helpers are called inside functions only, never at load.
import { lineCount, textWidth } from "./packing";

/* ------------------------------------------------------------------ *
 * The content
 * ------------------------------------------------------------------ */

/** A size's verdict: the module's own. */
export type DispensingStatus = "pass" | "fail" | "not_done";

/**
 * A figure as it prints: a count, a rate, a box/carton number or a dash, and
 * how it reads (a defect found in bold, a zero in grey, a total or a rate
 * over the maximum in red, a box/carton number warned about in amber).
 */
export type DispensingValue = { text: string; tone: "plain" | "muted" | "zero" | "found" | "total" | "fail" | "warn" | "missing" };

/** The per-box table's words: the template's labels, the defects column's short form. */
export type DispensingWords = {
  /** A box's No. in the box list, as the capture screen and the module's messages number it. */
  no: string;
  /** "Box/Carton #". */
  boxNo: string;
  /** "Defects" for the template's default "Defects / Gloves per Pack"; any other label whole. */
  defects: string;
  /** "Total": the per-box table's last row. */
  total: string;
};

export type DispensingChartRow = {
  size: string;
  /** As the template shows it. */
  label: string;
  /** "5 boxes"; "3 of 5 boxes" while fewer are tested than planned. */
  sublabel: string;
  /** The module's rate in %; null before a box is tested. */
  rate: number | null;
  /** At the row's right: "Defect Rate 0.48%", "Total 3 / 625", in red where the size failed. */
  aside: { text: string; strong: string; tone?: "fail" }[];
  status: DispensingStatus;
};

export type DispensingChart = {
  /** "Defect Rate (%) against Maximum". */
  title: string;
  /** The key's words: the bars ("Defect Rate"); "Not done" where a size's bar is a rate so far. */
  keys: { rate: string; notDone: string | null };
  /** From 0, a step past the maximum and the highest rate; the maximum's tick in place of one too close to it. */
  axis: Axis;
  /** The template's maximum rate in %: a dashed red line, its tick in red. Null where none is set. */
  maximum: number | null;
  rows: DispensingChartRow[];
};

/** A box as the per-box table prints it, by its No. */
export type DispensingBox = { boxNo: DispensingValue; defects: DispensingValue };

export type DispensingPerBox = {
  /** Each size on the order: its boxes by No. (null for a blank row), and its total defects. */
  sizes: { size: string; label: string; boxes: (DispensingBox | null)[]; total: DispensingValue }[];
  /** Rows: as many as the size with the most. */
  items: number;
  /** At the block's top right: what the figures are, and what amber means where a box/carton number is warned about. */
  note: { text: string; tone?: "warn" }[];
};

/** A row of the defects table. */
export type DispensingDefectRow = {
  key: string;
  kind: "tested" | "defect" | "total" | "gloves" | "rate" | "result";
  /** In the template's words. */
  label: string;
  /** One per size, in the sizes' order; the result row's are its verdicts' words. */
  values: DispensingValue[];
  /** The result row's: the module's verdict per size. */
  statuses?: DispensingStatus[];
};

export type DispensingDefects = {
  /** The template's name for its defects: "Safedon Packing Defects". */
  title: string;
  firstHeader: string;
  /** The boxes tested, each defect of the template's list, the total, the gloves inspected, the rate, the result. */
  rows: DispensingDefectRow[];
  /** In the left half of the page, beside the definitions (five sizes at most), or across it. */
  half: boolean;
  /** The table's width in mm: its column's, or less for a size or two (a label column and its sizes'). */
  width: number;
  /** The label column and each size's column, in percent of the table's width. */
  widths: { label: number; value: number };
};

/** A defect of the template with its definition, as the app shows it under the defect's name. */
export type DispensingDefinition = { code: string; label: string; hint: string };

/** A part of a page. */
export type GloveDispensingPart =
  | { kind: "chart" }
  /** Rows `from` to `to` (0-based, `to` left out) of the per-box table. */
  | { kind: "perBox"; from: number; to: number }
  /** The defects table beside the definitions, both whole. */
  | { kind: "closing" }
  /** Rows of the defects table, or definitions, on their own: where a page cannot hold the two side by side. */
  | { kind: "defects"; from: number; to: number }
  | { kind: "definitions"; from: number; to: number };

export type GloveDispensingContent = {
  /** Tells this content from the packing check's in the section's slot. */
  kind: "safedon";
  /** Under the title: what was dispensed and checked for, the maximum, how the sizes did. */
  lead: string;
  /** The sizes on the order, as the template shows them: the tables' columns and the chart's rows. */
  sizes: { size: string; label: string }[];
  words: DispensingWords;
  /** Null while switched off. */
  chart: DispensingChart | null;
  /** Null while switched off. */
  perBox: DispensingPerBox | null;
  defects: DispensingDefects;
  /** The template's defects with a definition; none where it gives none. */
  definitions: DispensingDefinition[];
  /** The parts each page prints, pageCount of them: the first page under the section's heading and lead. */
  pages: { parts: GloveDispensingPart[] }[];
};

/* ------------------------------------------------------------------ *
 * The words
 * ------------------------------------------------------------------ */

export const PER_BOX_TITLE = "Per-Box Results";
export const DEFINITIONS_TITLE = "Defect Definitions";
const DEFECT_HEADER = "Defect";
const NO = "No.";
const DASH = "—";
const MISSING: DispensingValue = { text: DASH, tone: "missing" };

/** The per-box table's short heading for the template's default label; any other is kept whole. */
const SHORT_WORDS: Readonly<Record<string, string>> = { "Defects / Gloves per Pack": "Defects" };

/** The verdicts' words, for the result row and a screen reader. */
const STATUS_WORD: Readonly<Record<DispensingStatus, string>> = { pass: "Passed", fail: "Failed", not_done: "Not Done" };

/** A label without its unit in brackets: "Defect Rate (%)" is "Defect Rate". */
function withoutUnit(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, "").trim() || label;
}

/** "3 / 625 (0.48%)"'s rate: at most two decimals, as the module shows and judges it. */
export function rateText(rate: number): string {
  return formatNumber(rate, { maxDecimals: RATE_DECIMALS, unit: "%" });
}

/** "plastic pack" as "plastic packs", "pouch" as "pouches". */
function plural(noun: string): string {
  return /(s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`;
}

/** A label inside a sentence: "Sampling Code Letter" is "sampling code letter"; an acronym ("AQL") stays. */
function inSentence(label: string): string {
  return label
    .split(" ")
    .map((word) => {
      const second = word.charAt(1);
      return second !== "" && second === second.toUpperCase() && second !== second.toLowerCase() ? word : word.toLowerCase();
    })
    .join(" ");
}

function capitalised(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/* ------------------------------------------------------------------ *
 * Reading the module
 * ------------------------------------------------------------------ */

/** What the section reads of one size on the order: the module's computed values. */
type SizeReading = {
  size: string;
  label: string;
  /** By No., blank rows null, the blank rows after the last box left out. */
  boxes: (BoxReading | null)[];
  /** Boxes with a box/carton number, and the boxes planned (the sampling plan's, else the template's). */
  tested: number;
  planned: number | null;
  total: number;
  gloves: number;
  /** In %; null before a box is tested. */
  rate: number | null;
  /** Defects of the boxes tested, per code of the template's list. */
  counts: Record<string, number>;
  status: DispensingStatus;
};

/** A box as entered: its box/carton number, its defects over the template's list, and whether the module warned about its number. */
type BoxReading = { boxNo: number | null; defects: number; warned: boolean };

const STATUSES: readonly DispensingStatus[] = ["pass", "fail", "not_done"];

function statusOf(value: unknown): DispensingStatus {
  return STATUSES.find((status) => status === value) ?? "not_done";
}

/** The template's defects in its order (config.defects), each once, with the definition the app shows. */
function defectsOf(module: ExportModule): DispensingDefinition[] {
  const defects: DispensingDefinition[] = [];
  for (const entry of list(module.config?.defects)) {
    const code = text(rec(entry).code);
    if (code === null || defects.some((defect) => defect.code === code)) continue;
    defects.push({ code, label: text(rec(entry).label) ?? code, hint: text(rec(entry).hint) ?? "" });
  }
  return defects;
}

/** The warnings the module gives a size's box/carton numbers that are not among its sampled ones: "Box/Carton #2336 is not in M's sampled …". */
function warningsOf(module: ExportModule, size: string): string[] {
  return module.warnings.filter((issue) => issue.code === BOX_NOT_SAMPLED && issue.size === size).map((issue) => issue.message);
}

function boxOf(entry: unknown, computed: unknown, warnings: readonly string[]): BoxReading | null {
  const row = rec(entry);
  const boxNo = num(row.boxNo);
  const counts = Object.values(rec(row.counts)).map(num);
  // A column with no box/carton number and nothing counted is blank: the module ignores it.
  if (boxNo === null && counts.every((count) => count === null || count === 0)) return null;
  const defects = num(rec(computed).boxDefects) ?? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const named = boxNo === null ? null : `${boxCartonNumber(boxNo)} `;
  return { boxNo, defects, warned: named !== null && warnings.some((message) => message.startsWith(named)) };
}

function sizesOf(doc: InspectionExport, module: ExportModule): SizeReading[] {
  return orderedSizes(doc).map((size) => {
    const computed = rec(at(module.computed, "sizes", size));
    const warnings = warningsOf(module, size);
    const computedBoxes = list(computed.boxes);
    const boxes = list(at(module.data, "sizes", size, "boxes")).map((entry, index) => boxOf(entry, computedBoxes[index], warnings));
    while (boxes.length > 0 && boxes[boxes.length - 1] === null) boxes.pop();
    const counts = Object.fromEntries(
      Object.entries(rec(computed.defectCounts)).flatMap(([code, value]): [string, number][] => {
        const count = num(value);
        return count === null ? [] : [[code, count]];
      }),
    );
    return {
      size,
      label: sizeLabel(doc, size),
      boxes,
      tested: num(computed.boxesTested) ?? 0,
      planned: num(computed.boxesExpected),
      total: num(computed.totalDefects) ?? 0,
      gloves: num(computed.glovesInspected) ?? 0,
      rate: num(computed.ratePct),
      counts,
      status: statusOf(computed.result ?? at(module.result.perSize, size, "status")),
    };
  });
}

/* ------------------------------------------------------------------ *
 * The lead
 * ------------------------------------------------------------------ */

/** "size M", "sizes XS and L". */
function sizesNamed(sizes: readonly SizeReading[]): string {
  return `${sizes.length === 1 ? "size" : "sizes"} ${andList(sizes.map((size) => size.label))}`;
}

/** How the sizes did: "every size passed", "size M failed at 6.4%; sizes XS, S and L passed", "size L is not done yet". */
function outcomeOf(sizes: readonly SizeReading[], unit: string): string {
  if (sizes.every((size) => size.tested === 0)) return `no ${unit} is tested yet`;
  const failed = sizes.filter((size) => size.status === "fail");
  const passed = sizes.filter((size) => size.status === "pass");
  const notDone = sizes.filter((size) => size.status === "not_done");
  if (passed.length === sizes.length) return sizes.length === 1 ? `size ${sizes[0].label} passed` : "every size passed";
  const rates = failed.map((size) => (size.rate === null ? DASH : rateText(size.rate)));
  return [
    failed.length > 0 ? `${sizesNamed(failed)} failed at ${andList(rates)}` : null,
    passed.length > 0 ? `${sizesNamed(passed)} passed` : null,
    notDone.length > 0 ? `${sizesNamed(notDone)} ${notDone.length === 1 ? "is" : "are"} not done yet` : null,
  ]
    .filter((clause): clause is string => clause !== null)
    .join("; ");
}

/**
 * "Gloves dispensed from 26 plastic packs of 125 and checked for 6
 * dispensing defects (sampling code letters C and D). A size passes at a
 * defect rate of 5% or less; every size passed." The inner unit is the
 * packing configuration's, the code letters the module's heading's.
 */
function leadOf(doc: InspectionExport, module: ExportModule, sizes: readonly SizeReading[], defects: number): string {
  const unit = text(moduleOf(doc, "packing_config")?.computed.innerUnit) ?? "pack";
  const perPack = num(module.config?.glovesPerPack);
  const maximum = num(module.config?.maxRatePct);
  const tested = sizes.reduce((sum, size) => sum + size.tested, 0);
  const letters = list(module.computed.codeLetters).flatMap((letter) => (typeof letter === "string" && letter.trim() !== "" ? [letter.trim()] : []));
  const letterWord = inSentence(labelOf(module, "codeLetter", "Sampling Code Letter"));
  const lettered = letters.length === 0 ? "" : ` (${letters.length === 1 ? letterWord : plural(letterWord)} ${andList(letters)})`;
  const packs = `${tested > 0 ? counted(tested, unit, plural(unit)) : plural(unit)}${perPack === null ? "" : ` of ${formatCount(perPack)}`}`;
  const checked = `checked for ${defects > 0 ? counted(defects, "dispensing defect") : "dispensing defects"}`;
  const first = tested > 0 ? `Gloves dispensed from ${packs} and ${checked}${lettered}.` : `Gloves are dispensed from ${packs} and ${checked}.`;
  const outcome = outcomeOf(sizes, unit);
  const second = maximum === null ? `${capitalised(outcome)}.` : `A size passes at a defect rate of ${formatNumber(maximum, { unit: "%" })} or less; ${outcome}.`;
  return `${first} ${second}`;
}

/* ------------------------------------------------------------------ *
 * The blocks
 * ------------------------------------------------------------------ */

/** A tick closer to the maximum than this share of the axis gives way to the maximum's own. */
const TICK_CLEARANCE = 0.08;

function chartOf(module: ExportModule, sizes: readonly SizeReading[], maximum: number | null): DispensingChart {
  const rateLabel = labelOf(module, "ratePct", "Defect Rate (%)");
  const rateWord = withoutUnit(rateLabel);
  const totalWord = labelOf(module, "totalDefects", "Total");
  const rates = sizes.flatMap((size) => (size.rate === null ? [] : [size.rate]));
  const top = Math.max(maximum === null ? 0 : maximum * 1.2, ...rates, 1);
  const nice = niceAxis([0, top], { pad: false, count: 6 });
  const span = nice.max - nice.min;
  const ticks = maximum === null ? nice.ticks : nice.ticks.filter((tick) => tick === maximum || Math.abs(tick - maximum) >= span * TICK_CLEARANCE);
  const rows = sizes.map((size): DispensingChartRow => {
    const tone = size.status === "fail" ? ({ tone: "fail" } as const) : {};
    const { planned } = size;
    return {
      size: size.size,
      label: size.label,
      sublabel: planned !== null && size.tested < planned ? `${formatCount(size.tested)} of ${counted(planned, "box", "boxes")}` : counted(size.tested, "box", "boxes"),
      rate: size.tested > 0 ? size.rate : null,
      aside: [
        { text: rateWord, strong: size.tested > 0 && size.rate !== null ? rateText(size.rate) : DASH, ...tone },
        { text: totalWord, strong: size.tested > 0 ? formatRatio(size.total, size.gloves, { spaced: true, grouping: true }) : DASH, ...tone },
      ],
      status: size.status,
    };
  });
  return {
    title: maximum === null ? `${rateLabel} by Size` : `${rateLabel} against Maximum`,
    keys: { rate: rateWord, notDone: rows.some((row) => row.status === "not_done" && row.rate !== null) ? "Not done" : null },
    axis: { min: nice.min, max: nice.max, ticks },
    maximum,
    rows,
  };
}

/** A count in a table: a defect found in bold, none in grey. */
function countValue(count: number): DispensingValue {
  return { text: formatCount(count), tone: count === 0 ? "zero" : "found" };
}

/** A size's total defects: in red where the size failed; a dash before a box is tested. */
function totalValue(size: SizeReading): DispensingValue {
  return size.tested === 0 ? MISSING : { text: formatCount(size.total), tone: size.status === "fail" ? "fail" : "total" };
}

function perBoxOf(module: ExportModule, sizes: readonly SizeReading[]): DispensingPerBox {
  const perPack = num(module.config?.glovesPerPack);
  const warned = sizes.some((size) => size.boxes.some((box) => box?.warned));
  const unit = perPack === null ? "Defects found in each box." : `Defects found in each box of ${formatCount(perPack)} gloves.`;
  return {
    sizes: sizes.map((size) => ({
      size: size.size,
      label: size.label,
      boxes: size.boxes.map(
        (box) =>
          box && {
            boxNo: box.boxNo === null ? MISSING : { text: formatNumber(box.boxNo), tone: box.warned ? "warn" : "plain" },
            defects: countValue(box.defects),
          },
      ),
      total: totalValue(size),
    })),
    items: Math.max(0, ...sizes.map((size) => size.boxes.length)),
    note: warned ? [{ text: `${unit} ` }, { text: "Amber: not one of the size's sampled box/carton numbers.", tone: "warn" }] : [{ text: unit }],
  };
}

/** The boxes tested: "5", or "3 of 5" in grey while fewer are tested than planned. */
function testedValue(size: SizeReading): DispensingValue {
  if (size.planned !== null && size.tested < size.planned) return { text: `${formatCount(size.tested)} of ${formatCount(size.planned)}`, tone: "muted" };
  return { text: formatCount(size.tested), tone: "plain" };
}

/** The size's rate: red where the size failed, grey while it is a rate so far. */
function rateValue(size: SizeReading): DispensingValue {
  if (size.tested === 0 || size.rate === null) return MISSING;
  return { text: rateText(size.rate), tone: size.status === "fail" ? "fail" : size.status === "not_done" ? "muted" : "plain" };
}

function defectRowsOf(module: ExportModule, sizes: readonly SizeReading[], defects: readonly DispensingDefinition[]): DispensingDefectRow[] {
  const blank = (size: SizeReading) => size.tested === 0;
  return [
    { key: "tested", kind: "tested", label: labelOf(module, "boxesTested", "Boxes Tested"), values: sizes.map(testedValue) },
    ...defects.map(
      (defect): DispensingDefectRow => ({
        key: `defect:${defect.code}`,
        kind: "defect",
        label: defect.label,
        values: sizes.map((size) => (blank(size) ? MISSING : countValue(size.counts[defect.code] ?? 0))),
      }),
    ),
    { key: "total", kind: "total", label: labelOf(module, "totalDefects", "Total"), values: sizes.map(totalValue) },
    {
      key: "gloves",
      kind: "gloves",
      label: labelOf(module, "glovesInspected", "Gloves Inspected"),
      values: sizes.map((size) => (blank(size) ? MISSING : { text: formatCount(size.gloves), tone: "plain" })),
    },
    { key: "rate", kind: "rate", label: labelOf(module, "ratePct", "Defect Rate (%)"), values: sizes.map(rateValue) },
    {
      key: "result",
      kind: "result",
      label: labelOf(module, "result", "Conclusion"),
      values: sizes.map((size) => ({ text: STATUS_WORD[size.status], tone: "plain" })),
      statuses: sizes.map((size) => size.status),
    },
  ];
}

/* ------------------------------------------------------------------ *
 * The section
 * ------------------------------------------------------------------ */

/** Section 07's content for a Safedon template; null with no size on the order. */
export function buildGloveDispensing(doc: InspectionExport, entry: ReportSectionPlanEntry<"packing">, module: ExportModule): (GloveDispensingContent & { pageCount: number }) | null {
  const sizes = sizesOf(doc, module);
  if (sizes.length === 0) return null;
  const on = (key: ReportBlockKey<"packing">) => entry.blocks.some((block) => block.key === key);
  const layout = layoutOf(doc);
  const defects = defectsOf(module);
  const definitions = defects.filter((defect) => defect.hint !== "");
  const half = sizes.length <= HALF_SIZES_MAX;
  const rows = defectRowsOf(module, sizes, defects);
  const tableWidth = defectsTableWidth(rows, sizes.length, closingWidth(layout.width, half));
  const defectsWord = labelOf(module, "boxDefects", "Defects / Gloves per Pack");
  const body: GloveDispensingBody = {
    kind: "safedon",
    lead: leadOf(doc, module, sizes, defects.length),
    sizes: sizes.map(({ size, label }) => ({ size, label })),
    words: {
      no: NO,
      boxNo: labelOf(module, "boxNo", "Box/Carton #"),
      defects: SHORT_WORDS[defectsWord] ?? defectsWord,
      total: labelOf(module, "totalDefects", "Total"),
    },
    chart: on("averageLayeringDispensing") ? chartOf(module, sizes, num(module.config?.maxRatePct)) : null,
    perBox: on("perBoxResults") ? perBoxOf(module, sizes) : null,
    defects: {
      title: labelOf(module, "counts", "Safedon Packing Defects"),
      firstHeader: DEFECT_HEADER,
      rows,
      half,
      width: tableWidth,
      widths: defectsWidths(rows, sizes.length, tableWidth),
    },
    definitions,
  };
  const pages = planGloveDispensing(body, layout);
  return { ...body, pages, pageCount: pages.length };
}

/* ------------------------------------------------------------------ *
 * The pages' room
 *
 * Millimetres, from the components' classes (components/report and
 * components/report/sections/glove-dispensing.tsx): change one with the
 * other. Text is measured by the packing check's estimate of Outfit's
 * widths (./packing.ts), taken long, and each page keeps a margin for the
 * rest.
 * ------------------------------------------------------------------ */

export const GLOVE_DISPENSING_ROOM = {
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
  /** The chart's key: a swatch with its gap, between items. */
  keySwatch: 6,
  keyGap: 4,
  /** The chart: the gap under its heading, a size's row (or its label's lines at 9 pt, 34 mm wide), the axis. */
  chartGap: 1.6,
  chartRow: 9.6,
  chartLabelLine: 4.76,
  chartLabelWidth: 34,
  axis: 4.6,
  /** The per-box table (the packing check's): the gap under its heading, the sizes' row, a header line and its padding, a box's row, the total row. */
  tableGap: 1,
  groupRow: 6,
  headerLine: 3.75,
  headerPadding: 2.8,
  cellPadding: 3.2,
  boxRow: 4.75,
  totalRow: 5.2,
  /** "No boxes are entered yet." */
  emptyLine: 4.8,
  /** The defects table (plain, TG35 page 6's): the gap under its heading, the header's padding and rule and a line of it (8.5 pt), a line of a row (9 pt), a row's padding, a total's rule. */
  defectsGap: 1.5,
  defectsHeaderPad: 2.6,
  defectsHeaderLine: 4.2,
  defectsLine: 3.81,
  defectsRowPad: 1,
  totalRule: 0.3,
  /** The result's tick (StatusTick), and its row: the tick and the row's padding. */
  tick: 3.8,
  tickRow: 4.8,
  /** The definitions: the gap under their heading, the name's column and the gap beside it, a line (8.5 pt), between two. */
  definitionsGap: 2,
  definitionLabel: 30,
  definitionGap: 3,
  definitionLine: 4.2,
  definitionRowGap: 1.2,
  /** The two blocks side by side: the gap between them. */
  columnGap: 6,
} as const;

const ROOM = GLOVE_DISPENSING_ROOM;

/** The per-box table's sizes keep to this width each while one or two are on the order; three or more share the page's width. */
const BOX_GROUP_MAX = 40;

/** The defects table sits beside the definitions for this many sizes at most; more take the page's width. */
export const HALF_SIZES_MAX = 5;

/**
 * The defects table's columns: a size's column a share of what a 40 mm
 * label leaves, 10.5 to 15 mm, as wide as its widest figure with 2 mm to
 * spare, while the label keeps 26 mm (TG35 page 6's tables). A size or two
 * keep the table to a label column and 15 mm a size.
 */
const DEFECTS_COLUMNS = { labelMin: 40, labelFloor: 26, valueMin: 10.5, valueMax: 15, figureGap: 2 } as const;

/**
 * A per-box run that splits between pages leaves at least this many rows
 * (all but one, of fewer) to go on with its total row, and starts with as
 * many under another part, or on the next page. The defects table and the
 * definitions keep two together.
 */
export const MIN_BOX_ROWS = 4;
const MIN_ROWS = 2;

/**
 * The per-box table's widths in millimetres: the No. column, then each
 * size's box/carton number and defects. One or two sizes keep to their own
 * width; three or more fill the page's.
 */
export function dispensingBoxGeometry(sizeCount: number, width: number): { table: number; item: number; box: number; defects: number } {
  const count = Math.max(1, sizeCount);
  const item = count >= 5 ? 10 : 14;
  const group = count <= 2 ? Math.min(BOX_GROUP_MAX, (width - item) / count) : (width - item) / count;
  return { table: item + count * group, item, box: group * 0.56, defects: group * 0.44 };
}

/** The defects table's width: half the page's beside the definitions, or all of it. */
export function closingWidth(width: number, half: boolean): number {
  return half ? (width - ROOM.columnGap) / 2 : width;
}

/** The defects table's width in its column: the column's, or a label column (as wide as its widest label, 40 mm at least) and 15 mm a size where that is less. */
function defectsTableWidth(rows: readonly DispensingDefectRow[], sizes: number, column: number): number {
  const label = Math.max(DEFECTS_COLUMNS.labelMin, ...rows.map((row) => textWidth(row.label, 9) + ROOM.cellPadding));
  return Math.min(column, label + Math.max(1, sizes) * DEFECTS_COLUMNS.valueMax);
}

function defectsWidths(rows: readonly DispensingDefectRow[], sizes: number, width: number): { label: number; value: number } {
  const count = Math.max(1, sizes);
  const figures = rows.flatMap((row) => (row.kind === "result" ? [] : row.values.map((value) => textWidth(value.text, 9))));
  // Right-aligned, a figure may use its cell's padding: 2 mm keep it clear of the next.
  const need = Math.max(ROOM.tick, ...figures) + DEFECTS_COLUMNS.figureGap;
  const share = Math.min(DEFECTS_COLUMNS.valueMax, Math.max(DEFECTS_COLUMNS.valueMin, (width - DEFECTS_COLUMNS.labelMin) / count));
  const value = Math.min(Math.max(share, need), (width - DEFECTS_COLUMNS.labelFloor) / count);
  const percent = (mm: number) => Math.round((mm / width) * 100000) / 1000;
  return { label: percent(width - value * count), value: percent(value) };
}

export type GloveDispensingLayout = { room: number; width: number };

/** The room for content on a page, and its width: the paper less the chrome, the footer note and the margin. */
function layoutOf(doc: InspectionExport): GloveDispensingLayout {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  const note = doc.report.footerNote;
  const noteLines = note ? Math.min(2, Math.ceil(note.length / ROOM.footerNoteCharacters)) : 0;
  return { room: paper.height - ROOM.chrome - noteLines * ROOM.footerNoteLine - ROOM.margin, width: paper.width - ROOM.sides };
}

/** What the pages are planned from: the content but its pages. */
type GloveDispensingBody = Omit<GloveDispensingContent, "pages">;

/** A block's heading (BlockHeading): its title, and its note beside it, or under it where the two do not share a line. */
function blockHeadingHeight(title: string, width: number, note?: string): number {
  const titleHeight = lineCount(title, width, 12) * ROOM.blockTitle;
  if (!note) return titleHeight;
  const noteWidth = textWidth(note, 8.5);
  if (textWidth(title, 12) + ROOM.blockNoteSpace + noteWidth <= width) return titleHeight;
  return titleHeight + ROOM.blockNoteGap + lineCount(note, width, 8.5) * ROOM.blockNoteLine;
}

/** The chart's key as one text, for its width: each swatch with its gap, the words, the gaps between items. */
function chartKeyWidth(chart: DispensingChart): number {
  const words = [chart.keys.rate, ...(chart.keys.notDone ? [chart.keys.notDone] : []), ...(chart.maximum !== null ? ["Maximum"] : [])];
  return words.reduce((sum, word) => sum + ROOM.keySwatch + textWidth(word, 8.5), 0) + (words.length - 1) * ROOM.keyGap;
}

function chartHeight(chart: DispensingChart, width: number): number {
  const key = chartKeyWidth(chart);
  const fits = textWidth(chart.title, 12) + ROOM.blockNoteSpace + key <= width;
  const heading = lineCount(chart.title, width, 12) * ROOM.blockTitle + (fits ? 0 : ROOM.blockNoteGap + Math.ceil(key / width) * ROOM.blockNoteLine);
  const rows = chart.rows.reduce((sum, row) => sum + Math.max(ROOM.chartRow, lineCount(`${row.label} ${row.sublabel}`, ROOM.chartLabelWidth, 9) * ROOM.chartLabelLine), 0);
  return heading + ROOM.chartGap + rows + ROOM.axis;
}

/** The per-box note as one text, as its heading prints it. */
function noteText(note: DispensingPerBox["note"]): string {
  return note.map((part) => part.text).join("");
}

/** "Continued: No. 14 to 26": a later page's note on the per-box table. */
export function continuedNote(words: DispensingWords, from: number, to: number): string {
  return `Continued: ${words.no} ${from + 1} to ${to}`;
}

/** The per-box table's parts above its rows on a page (the heading with its note, the sizes' row, the header). */
function perBoxFixed(body: GloveDispensingBody, perBox: DispensingPerBox, note: string, width: number): number {
  const geometry = dispensingBoxGeometry(perBox.sizes.length, width);
  const { words } = body;
  const headerLines = Math.max(
    lineCount(words.no, geometry.item - ROOM.cellPadding, 8.5),
    lineCount(words.boxNo, geometry.box - ROOM.cellPadding, 8.5),
    lineCount(words.defects, geometry.defects - ROOM.cellPadding, 8.5),
  );
  return blockHeadingHeight(PER_BOX_TITLE, geometry.table, note) + ROOM.tableGap + ROOM.groupRow + ROOM.headerPadding + headerLines * ROOM.headerLine;
}

/** The defects table's label column, less its padding, in mm. */
function defectsLabelWidth(defects: DispensingDefects): number {
  return (defects.width * defects.widths.label) / 100 - ROOM.cellPadding;
}

/** A row of the defects table: its label's lines (bold for the total), a total's rule, the result's tick. */
function defectRowHeight(row: DispensingDefectRow, labelWidth: number): number {
  const lines = lineCount(row.label, labelWidth, 9);
  if (row.kind === "result") return Math.max(ROOM.tickRow, lines * ROOM.defectsLine + ROOM.defectsRowPad);
  return lines * ROOM.defectsLine + ROOM.defectsRowPad + (row.kind === "total" ? ROOM.totalRule : 0);
}

/** The defects table's heading across its column (with "Continued" on a later piece) and its header row. */
function defectsFixed(defects: DispensingDefects, width: number, continued: boolean): number {
  const header = ROOM.defectsHeaderPad + lineCount(defects.firstHeader, defectsLabelWidth(defects), 8.5) * ROOM.defectsHeaderLine;
  return blockHeadingHeight(defects.title, closingWidth(width, defects.half), continued ? "Continued" : undefined) + ROOM.defectsGap + header;
}

/** The definitions' column: half the page's beside the table, or all of it under a table across the page. */
function definitionsWidth(body: GloveDispensingBody, width: number): number {
  return closingWidth(width, body.defects.half);
}

function definitionHeight(definition: DispensingDefinition, width: number): number {
  const label = lineCount(definition.label, ROOM.definitionLabel, 8.5);
  const hint = lineCount(definitionText(definition), width - ROOM.definitionLabel - ROOM.definitionGap, 8.5);
  return Math.max(label, hint) * ROOM.definitionLine;
}

/** A definition as a sentence: "Cuff should ideally be at least 2 cm out." */
export function definitionText(definition: DispensingDefinition): string {
  const hint = definition.hint.trim();
  return /[.!?]$/.test(hint) ? hint : `${hint}.`;
}

function definitionsFixed(width: number, continued: boolean): number {
  return blockHeadingHeight(DEFINITIONS_TITLE, width, continued ? "Continued" : undefined) + ROOM.definitionsGap;
}

/** The rows' heights of a run: each row and the gap after it, as the parts are spaced. */
type Run = { rows: number[]; gap: number };

function runHeight(run: Run, from: number, to: number): number {
  let height = 0;
  for (let index = from; index < to; index += 1) height += run.rows[index] + (index > from ? run.gap : 0);
  return height;
}

/**
 * Each page's parts, in order: the chart, the per-box table (split by its
 * rows where it does not fit, the total row with its last rows), then the
 * defects beside the definitions. A part that does not fit where it falls
 * starts the next page; the defects and the definitions, where a page
 * cannot hold them side by side, run on one under the other, split by
 * their rows.
 */
export function planGloveDispensing(body: GloveDispensingBody, { room, width }: GloveDispensingLayout): { parts: GloveDispensingPart[] }[] {
  const pages: GloveDispensingPart[][] = [[]];
  let used = ROOM.heading + ROOM.leadGap + lineCount(body.lead, Math.min(ROOM.leadWidth, width), 9.5) * ROOM.leadLine;
  const current = () => pages[pages.length - 1];
  const gap = () => (current().length === 0 ? ROOM.headingGap : ROOM.partGap);
  const nextPage = () => {
    pages.push([]);
    used = ROOM.heading;
  };
  const place = (part: GloveDispensingPart, height: number) => {
    if (current().length > 0 && used + gap() + height > room) nextPage();
    used += gap() + height;
    current().push(part);
  };
  /**
   * A run of rows split between pages: `fixed` above its rows on each page
   * (continued on a later one), `closing` under its last. Where the rest
   * does not fit with its closing, the rows that fit go here, leaving `keep`
   * rows to go on; fewer than `keep` under another part start the next page.
   */
  const split = (run: Run, fixed: (from: number) => number, closing: number, keep: number, make: (from: number, to: number) => GloveDispensingPart) => {
    const total = run.rows.length;
    let from = 0;
    while (from < total) {
      const head = gap() + fixed(from);
      const free = room - used - head;
      const left = total - from;
      const fresh = current().length === 0;
      let fit = 0;
      while (fit < left && runHeight(run, from, from + fit + 1) <= free) fit += 1;
      const take = Math.min(fit, left - Math.max(1, Math.min(keep, left - 1)));
      if (runHeight(run, from, total) + closing <= free || (fresh && take < 1)) {
        current().push(make(from, total));
        used += head + runHeight(run, from, total) + closing;
        break;
      }
      if (!fresh && take < keep) {
        nextPage();
        continue;
      }
      current().push(make(from, from + take));
      used += head + runHeight(run, from, from + take);
      from += take;
      nextPage();
    }
  };

  if (body.chart) place({ kind: "chart" }, chartHeight(body.chart, width));

  const perBox = body.perBox;
  if (perBox && perBox.items === 0) {
    const geometry = dispensingBoxGeometry(perBox.sizes.length, width);
    place({ kind: "perBox", from: 0, to: 0 }, blockHeadingHeight(PER_BOX_TITLE, geometry.table, noteText(perBox.note)) + ROOM.tableGap + ROOM.emptyLine);
  } else if (perBox) {
    const run: Run = { rows: Array.from({ length: perBox.items }, () => ROOM.boxRow), gap: 0 };
    const fixed = (from: number) => perBoxFixed(body, perBox, from === 0 ? noteText(perBox.note) : continuedNote(body.words, from, perBox.items), width);
    split(run, fixed, ROOM.totalRow, MIN_BOX_ROWS, (from, to) => ({ kind: "perBox", from, to }));
  }

  const { defects, definitions } = body;
  const labelWidth = defectsLabelWidth(defects);
  const defectRows: Run = { rows: defects.rows.map((row) => defectRowHeight(row, labelWidth)), gap: 0 };
  const column = definitionsWidth(body, width);
  const definitionRows: Run = { rows: definitions.map((definition) => definitionHeight(definition, column)), gap: ROOM.definitionRowGap };
  const table = defectsFixed(defects, width, false) + runHeight(defectRows, 0, defectRows.rows.length);
  const legend = definitions.length > 0 ? definitionsFixed(column, false) + runHeight(definitionRows, 0, definitionRows.rows.length) : 0;
  // What a later page holds under its heading.
  const fresh = room - ROOM.heading - ROOM.headingGap;
  // Side by side (five sizes at most) while a page can hold them whole; else one under the other, each whole where a page holds it.
  if (defects.half && Math.max(table, legend) <= fresh) {
    place({ kind: "closing" }, Math.max(table, legend));
    return pages.map((parts) => ({ parts }));
  }
  if (table <= fresh) place({ kind: "defects", from: 0, to: defects.rows.length }, table);
  else split(defectRows, (from) => defectsFixed(defects, width, from > 0), 0, MIN_ROWS, (from, to) => ({ kind: "defects", from, to }));
  if (definitions.length === 0) return pages.map((parts) => ({ parts }));
  if (legend <= fresh) place({ kind: "definitions", from: 0, to: definitions.length }, legend);
  else split(definitionRows, (from) => definitionsFixed(column, from > 0), 0, MIN_ROWS, (from, to) => ({ kind: "definitions", from, to }));
  return pages.map((parts) => ({ parts }));
}

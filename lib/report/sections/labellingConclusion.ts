// Section 08, Packaging Labelling & Conclusion (TG35 page 8): a card per
// labelling level the template inspects (Dispenser Box, Carton Box, in its
// wording) with each check's defects per size, the limit and the result;
// the results matrix, every check the inspection judged by size; and the
// conclusion card: the result, its date, the inspector's signature and the
// remark. The cards and the matrix read the modules' own counts and per-size
// results; nothing here judges anything. Where the template inspects no
// labels the section is the conclusion alone, titled as the conclusion.
//
// The builder is typed by SectionBuilder rather than made by defineSection,
// so it never imports the registry at run time: this file can be imported
// on its own (its test does) without a cycle through lib/report/sections.
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES } from "@/lib/schemas/report-options";
import { shortTitleFor } from "@/lib/templates/short-titles";
import { SignatureSchema, strokePath } from "@/modules/conclusion/signature";
import { checkRows, type CheckStatus } from "../checks";
import { andList } from "../format";
import type {
  FinalConclusion,
  LabelCell,
  LabelLevelCard,
  LabellingBlock,
  LabellingConclusionSection,
  ReportPlanEntryFor,
  ResultsMatrix,
} from "../model";
import { at, isRecord, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import type { SectionBuilder } from "./index";

type Level = LabelLevelCard["level"];

const LEVELS: readonly Level[] = ["inner", "carton"];

/** A level's name where the template gives none (the labelling module's defaults). */
const LEVEL_NAME: Readonly<Record<Level, string>> = { inner: "Dispenser Box", carton: "Carton Box" };

/** What each check reads, as a sentence names it. Box and carton numbers are one number (docs/DESIGN.md). */
const CHECK_WORDS: Readonly<Record<string, string>> = {
  lot_no: "lot number",
  mfg_date: "manufacturing date",
  expiry_date: "expiry date",
  artwork: "artwork",
  carton_no: "box/carton number",
};

/** The card's own rows, in the design's words; the levels and the checks are the template's. */
export const LABEL_CARD_WORDS = { check: "Check", inspected: "Boxes Inspected", defects: "Defects Found", result: "Result" } as const;

/** The signature's caption, as the design words it. */
export const SIGNATURE_LABEL = "Inspector's Signature";

/** The remark's text while none is recorded. */
export const NO_REMARK = "None recorded.";

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

export function buildLabellingConclusion(
  doc: InspectionExport,
  entry: ReportPlanEntryFor<"labellingConclusion">,
): LabellingConclusionSection {
  const on = new Set<string>(entry.blocks.map((block) => block.key));
  const labeling = moduleOf(doc, "labeling");
  const levels = labellingLevels(labeling);
  const sizeValues = orderedSizes(doc);
  const sizes = sizeValues.map((value) => ({ value, label: sizeLabel(doc, value) }));
  const labels = sizes.map((size) => size.label);

  const cards = labeling && on.has("dispenserCartonBox") && sizes.length > 0 ? levels.map((level) => levelCard(labeling, level, sizeValues, labels)) : [];
  // Two cards side by side line up their totals: the shorter is padded with blank rows (TG35's Dispenser Box).
  const longest = Math.max(0, ...cards.map((card) => card.checks.length));
  const padded = cards.map((card) => ({ ...card, padding: cards.length > 1 ? longest - card.checks.length : 0 }));
  const matrix = on.has("resultsMatrix") ? resultsMatrixOf(doc, sizeValues) : null;
  const conclusion = finalConclusionOf(doc, on);
  // Where the template inspects no labels, the section is the conclusion alone, by its own name.
  const title = labeling && levels.length > 0 ? entry.title : (text(moduleOf(doc, "conclusion")?.title) ?? "Conclusion");
  const lead = labeling && padded.length > 0 ? labellingLead(labeling, padded) : null;

  const pages = labellingPages(
    { lead, levels: padded, matrix, conclusion, sizes: sizes.length },
    paperRoom(doc),
    contentWidthOf(doc),
  );
  return { pageCount: pages.length, title, lead, sizes, levels: padded, matrix, conclusion, pages };
}

export const labellingConclusion: SectionBuilder<"labellingConclusion"> = {
  key: "labellingConclusion",
  build: buildLabellingConclusion,
};

/* ------------------------------------------------------------------ *
 * The labelling cards
 * ------------------------------------------------------------------ */

/**
 * The levels the template inspects, in report order: switched on in the
 * module's config, or, for a document from before the export carried the
 * config, those its computed values hold.
 */
export function labellingLevels(labeling: ExportModule | null): Level[] {
  if (!labeling) return [];
  return LEVELS.filter((level) => {
    const config = rec(at(labeling.config, "levels", level));
    if (Object.keys(config).length > 0) return config.include !== false;
    return Object.values(rec(labeling.computed.sizes)).some((size) => isRecord(rec(size)[level]));
  });
}

type CheckItem = { code: string; label: string };

/** A level's checks in the template's order and wording: a label keyed `<level>.<code>` or `<code>`, else the config's. */
export function levelChecks(labeling: ExportModule, level: Level, sizes: readonly string[] = []): CheckItem[] {
  const wording = (code: string, fallback: string) => labelOf(labeling, `${level}.${code}`, labelOf(labeling, code, fallback));
  const listed = list(at(labeling.config, "levels", level, "checks")).flatMap((check) => {
    const code = text(rec(check).code);
    return code ? [{ code, label: wording(code, text(rec(check).label) ?? code) }] : [];
  });
  if (listed.length > 0) return listed;
  // No config: the checks its counts name.
  const codes = new Set(sizes.flatMap((size) => Object.keys(rec(at(labeling.data, "sizes", size, level, "defects")))));
  return [...codes].map((code) => ({ code, label: wording(code, code) }));
}

const cell = (value: number | null, tone: LabelCell["tone"] = null): LabelCell => ({ value, tone });

function levelCard(labeling: ExportModule, level: Level, sizes: readonly string[], labels: readonly string[]): LabelLevelCard {
  const planned = num(at(labeling.config, "levels", level, "n"));
  const entries = sizes.map((size) => rec(at(labeling.data, "sizes", size, level)));
  const computed = sizes.map((size) => rec(at(labeling.computed, "sizes", size, level)));
  const checks = levelChecks(labeling, level, sizes);
  const counts = entries.map((entry) => rec(entry.defects));
  // A size with neither the boxes inspected nor a defect recorded shows dashes, never zeros.
  const recorded = entries.map((entry, index) => num(entry.inspected) !== null || checks.some((check) => (num(counts[index][check.code]) ?? 0) > 0));

  const inspected = entries.map((entry) => {
    const boxes = num(entry.inspected);
    return cell(boxes, boxes !== null && boxes > 0 && planned !== null && boxes < planned ? "warn" : null);
  });
  const rows = checks.map((check) => ({
    code: check.code,
    label: check.label,
    cells: sizes.map((_, index) => {
      if (!recorded[index]) return cell(null);
      const count = num(counts[index][check.code]) ?? 0;
      return cell(count, count > 0 ? "fail" : null);
    }),
  }));
  const defects = sizes.map((_, index) => {
    if (!recorded[index]) return cell(null);
    const total = num(computed[index].total) ?? rows.reduce((sum, row) => sum + (row.cells[index].value ?? 0), 0);
    return cell(total, total > 0 ? "fail" : null);
  });

  // Accept 0 / Reject 1 whatever the number inspected (BUILD_SPEC 7), as the module computed it.
  const limits = computed.find((entry) => num(entry.accept) !== null);
  const accept = num(limits?.accept) ?? 0;
  const reject = num(limits?.reject) ?? accept + 1;
  return {
    level,
    title: labelOf(labeling, `${level}Level`, LEVEL_NAME[level]),
    limit: `${levelWord(labeling, level, "accept", "Accept")} ${accept} · ${levelWord(labeling, level, "reject", "Reject")} ${reject}`,
    inspected,
    checks: rows,
    padding: 0,
    defects,
    result: levelResult(computed.map((entry) => entry.result), labels),
  };
}

/** A level's own word for a limit ("Acc. ="), else the module's ("Accept"). */
function levelWord(labeling: ExportModule, level: Level, field: "accept" | "reject", fallback: string): string {
  return labelOf(labeling, `${level}${field === "accept" ? "Accept" : "Reject"}`, labelOf(labeling, field, fallback));
}

/** "Passed, All Sizes"; else the sizes that failed, or those not done yet (neither passed nor failed). */
function levelResult(verdicts: readonly unknown[], labels: readonly string[]): LabelLevelCard["result"] {
  const failed = labels.filter((_, index) => verdicts[index] === "fail");
  if (failed.length > 0) return { status: "fail", label: `Failed, ${sizesText(failed, labels)}` };
  const open = labels.filter((_, index) => verdicts[index] !== "pass");
  if (open.length === labels.length) return { status: "not_done", label: "Not Done" };
  if (open.length > 0) return { status: "not_done", label: `Not Done, ${sizesText(open, labels)}` };
  return { status: "pass", label: `Passed, ${sizesText(labels, labels)}` };
}

/** "All Sizes" (every one of two or more), "Size M", "Sizes S and M". */
function sizesText(some: readonly string[], all: readonly string[]): string {
  if (some.length === all.length && all.length > 1) return "All Sizes";
  return `${some.length === 1 ? "Size" : "Sizes"} ${andList(some)}`;
}

/**
 * Under the title: "Dispenser and carton boxes checked for lot number,
 * manufacturing date, artwork and box/carton number. Any single error
 * rejects the size." The levels in the template's wording, the checks every
 * level lists, the limit as computed.
 */
export function labellingLead(labeling: ExportModule, cards: readonly Pick<LabelLevelCard, "title" | "checks">[]): string {
  const checks = uniqueChecks(cards.map((card) => card.checks));
  const accept = num(at(firstComputed(labeling), "accept")) ?? 0;
  const rule = accept === 0 ? "Any single error rejects the size." : `${accept + 1} or more errors reject the size.`;
  const read = checkedFor(checks);
  return read.length > 0 ? `${boxesPhrase(cards.map((card) => card.title))} checked for ${andList(read)}. ${rule}` : rule;
}

function firstComputed(labeling: ExportModule): unknown {
  for (const size of Object.values(rec(labeling.computed.sizes))) {
    for (const level of LEVELS) if (isRecord(rec(size)[level])) return rec(size)[level];
  }
  return null;
}

function uniqueChecks(levels: readonly (readonly CheckItem[])[]): CheckItem[] {
  const seen = new Set<string>();
  return levels.flat().filter((check) => (seen.has(check.code) ? false : (seen.add(check.code), true)));
}

/** What the checks read, as words: "lot number", "manufacturing and expiry dates" (both dates together), "box/carton number". */
export function checkedFor(checks: readonly CheckItem[]): string[] {
  const codes = new Set(checks.map((check) => check.code));
  return checks.flatMap((check) => {
    if (check.code === "expiry_date" && codes.has("mfg_date")) return [];
    if (check.code === "mfg_date" && codes.has("expiry_date")) return ["manufacturing and expiry dates"];
    return [CHECK_WORDS[check.code] ?? lowerWords(check.label)];
  });
}

/** "Dispenser and carton boxes" from "Dispenser Box" and "Carton Box"; other names as they are, in lower case after the first. */
function boxesPhrase(names: readonly string[]): string {
  const stems = names.map((name) => /^(.*\S)\s+box(?:es)?$/i.exec(name.trim())?.[1] ?? null);
  const phrase = stems.every((stem): stem is string => stem !== null) ? `${andList(stems.map(lowerWords))} boxes` : andList(names.map(lowerWords));
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Title Case words in lower case, inside a sentence; capitals such as PE stay. */
function lowerWords(words: string): string {
  return words.replace(/\b([A-Z])([a-z]+)\b/g, (_, first: string, rest: string) => `${first.toLowerCase()}${rest}`);
}

/* ------------------------------------------------------------------ *
 * The results matrix
 * ------------------------------------------------------------------ */

const SEVERITY: Readonly<Record<CheckStatus, number>> = { pass: 0, warn: 1, not_done: 2, fail: 3 };
const LEGEND_ORDER: readonly CheckStatus[] = ["pass", "fail", "warn", "not_done"];
const VISUAL_CLASS_WORDS: Readonly<Record<string, string>> = { critical: "Critical", major: "Major", minor: "Minor" };

function asStatus(value: unknown): CheckStatus | null {
  return value === "pass" || value === "fail" || value === "warn" || value === "not_done" ? value : null;
}

function worstOf(statuses: readonly (CheckStatus | null)[]): CheckStatus | null {
  return statuses.reduce<CheckStatus | null>((worst, status) => (status !== null && (worst === null || SEVERITY[status] > SEVERITY[worst]) ? status : worst), null);
}

/**
 * The checks of Results by Check (lib/report/checks.ts), each by size, in
 * its order and words: a module's verdict per size, Visual Inspection once
 * for its classes (TG35: "Visual: Critical, Major, Minor"), the packing
 * check's boxes and its aged sample apart. Null with no size on the order
 * or no check judged.
 */
export function resultsMatrixOf(doc: InspectionExport, sizes: readonly string[]): ResultsMatrix | null {
  if (sizes.length === 0) return null;
  const rows: ResultsMatrix["rows"] = [];
  const visualClasses: string[] = [];
  for (const check of checkRows(doc)) {
    const source = moduleOf(doc, check.moduleKey);
    // A row that only records (the sampling plan's reduced sampling) has no verdict to tick.
    if (!source || check.remark !== null) continue;
    if (check.key.startsWith("visual:")) {
      const word = check.key.slice("visual:".length);
      if (visualClasses.length === 0) rows.push({ key: "visual", label: "", cells: moduleCells(source, sizes) });
      visualClasses.push(VISUAL_CLASS_WORDS[word] ?? word);
      continue;
    }
    const cells = check.key === "dispensing_packing" ? packingCells(source, sizes) : check.key === "dispensing_packing:aged" ? agedCells(source, sizes) : moduleCells(source, sizes);
    rows.push({ key: check.key, label: check.check, cells });
  }
  if (rows.length === 0) return null;
  const visual = rows.find((row) => row.key === "visual");
  if (visual) visual.label = `${shortTitleFor("visual", moduleOf(doc, "visual")?.title ?? "")}: ${visualClasses.join(", ")}`;
  const shown = new Set(rows.flatMap((row) => row.cells.map((status) => status ?? "none")));
  return { rows, legend: [...LEGEND_ORDER.filter((status) => shown.has(status)), ...(shown.has("none") ? (["none"] as const) : [])] };
}

/**
 * A module's verdict by size. Where the module's own result is worse than
 * every size's (a lab report not attached), every size takes it, so a cell
 * never reads better than Results by Check; a module with no verdict by
 * size shows its own in every size.
 */
function moduleCells(module: ExportModule, sizes: readonly string[]): (CheckStatus | null)[] {
  const overall = asStatus(module.result.status);
  const perSize = module.result.perSize;
  const cells = sizes.map((size) => asStatus(perSize?.[size]?.status));
  if (cells.every((status) => status === null)) return sizes.map(() => overall);
  const floor = overall !== null && SEVERITY[overall] > SEVERITY[worstOf(cells) ?? "pass"] ? overall : null;
  return cells.map((status) => (status !== null && floor !== null && SEVERITY[floor] > SEVERITY[status] ? floor : status));
}

/** The packing check's boxes by size: the worst of layering, dispensing and stickiness, as Results by Check judges them. */
function packingCells(module: ExportModule, sizes: readonly string[]): (CheckStatus | null)[] {
  return sizes.map((size) => {
    const entry = rec(at(module.computed, "sizes", size));
    if (Object.keys(entry).length === 0) return null;
    return worstOf([entry.layeringResult, entry.dispensingResult, entry.stickinessResult].map((verdict) => asStatus(verdict) ?? "not_done"));
  });
}

/**
 * The aged sample's own verdict by size. Every size needs one (Kenneth, 27
 * October 2026): a size with none entered is not done. A size the module
 * gave no values has none, as in the boxes' row.
 */
function agedCells(module: ExportModule, sizes: readonly string[]): (CheckStatus | null)[] {
  return sizes.map((size) => {
    const entry = rec(at(module.computed, "sizes", size));
    if (Object.keys(entry).length === 0) return null;
    return asStatus(rec(entry.agedSample).result) ?? "not_done";
  });
}

/* ------------------------------------------------------------------ *
 * The conclusion card
 * ------------------------------------------------------------------ */

function finalConclusionOf(doc: InspectionExport, on: ReadonlySet<string>): FinalConclusion {
  const conclusion = moduleOf(doc, "conclusion");
  const data = rec(conclusion?.data);
  // To Sign After Exported: the export sends no drawn signature, and the line stays blank for the pen.
  const byHand = doc.conclusion.signAfterExport === true || data.signAfterExport === true;
  const signature = SignatureSchema.safeParse(data.signature);
  return {
    heading: labelOf(conclusion, "finalResult", "Conclusion"),
    dateLabel: labelOf(conclusion, "date", "Date"),
    date: slashDate(doc.conclusion.date),
    signature: on.has("inspectorSignature")
      ? {
          label: SIGNATURE_LABEL,
          byHand,
          drawing:
            !byHand && signature.success
              ? { width: signature.data.width, height: signature.data.height, paths: signature.data.strokes.map((stroke) => strokePath(stroke)) }
              : null,
        }
      : null,
    remark: on.has("remark") ? { label: labelOf(conclusion, "remark", "Remark"), text: text(doc.conclusion.remark) } : null,
  };
}

/** `2026-10-23` as "23/10/2026", as the design dates the conclusion; a month as "10/2026"; anything else as it is. */
export function slashDate(iso: string | null | undefined): string | null {
  const value = text(iso);
  if (!value) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  return month ? `${month[2]}/${month[1]}` : value;
}

/* ------------------------------------------------------------------ *
 * The pages
 *
 * Section 08 is one page in the design. Its parts are estimated from the
 * components' sizes (components/report/sections/labellingConclusion.tsx and
 * the primitives it uses, in millimetres) and laid in order: what page one
 * cannot hold goes on a second, under the heading again. A card's check
 * wraps where its words outrun the column; a long remark wraps too.
 * ------------------------------------------------------------------ */

export const LABELLING_ROOM = {
  /** The page's header band and footer with the content's padding (SUMMARY_ROOM.chrome), and a footer note's line. */
  chrome: 61,
  footerNote: 4,
  /** The kicker and the title (SectionHeading). */
  heading: 14.1,
  /** The lead under the title: its gap, a line, and the characters a line holds. */
  leadGap: 1.6,
  leadLine: 5.05,
  leadCharacters: 100,
  /** Between the page's parts. */
  gap: 5,
  /** A card: its edge, padding, heading and table header, the result row; a table row; a line more where a check wraps. */
  cardFrame: 31,
  cardRow: 6.85,
  cardLine: 4.6,
  /** Two cards side by side, and the size columns' width in a card (wider while four or fewer). */
  cardGap: 4.6,
  cardPadding: 9.8,
  sizeColumn: { upToFour: 9, five: 7.6 },
  /** The millimetres a character of a check's words takes, at 9 pt. */
  characterWidth: 1.65,
  /** The matrix: its heading and header row; a row; a line more where a check's name wraps. */
  matrixFrame: 15,
  matrixRow: 8.65,
  matrixLine: 4.8,
  /** A size's column in the matrix, as a share of the width (TG35: about a tenth). */
  matrixColumn: 0.105,
  /** The conclusion card: its edge and padding, the result row, the signature's taller one, the remark and its lines. */
  conclusionFrame: 9.6,
  conclusionRow: 18.2,
  signatureRow: 21,
  remarkFrame: 6.7,
  remarkLine: 4.8,
  remarkCharacters: 100,
} as const;

/** The width of a size's column in a card, in millimetres. */
export function cardSizeColumn(sizes: number): number {
  return sizes > 4 ? LABELLING_ROOM.sizeColumn.five : LABELLING_ROOM.sizeColumn.upToFour;
}

/** The lines some words wrap to, each line typed on its own starting a new one. */
const lines = (words: string, perLine: number) =>
  words.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / Math.max(1, perLine))), 0);

type LabellingParts = Pick<LabellingConclusionSection, "lead" | "levels" | "matrix" | "conclusion"> & { sizes: number };

/** The parts' heights in millimetres, at a content width. */
export function labellingHeights(parts: LabellingParts, width: number): Record<LabellingBlock, number> {
  const room = LABELLING_ROOM;
  const cardWidth = parts.levels.length > 1 ? (width - room.cardGap) / 2 : width;
  const checkColumn = cardWidth - room.cardPadding - parts.sizes * cardSizeColumn(parts.sizes) - 4;
  const perCheckLine = Math.floor(checkColumn / room.characterWidth);
  const cardHeight = (card: LabelLevelCard) =>
    room.cardFrame +
    (card.checks.length + card.padding + 2) * room.cardRow +
    card.checks.reduce((sum, check) => sum + (lines(check.label, perCheckLine) - 1) * room.cardLine, 0);
  const matrixLabel = Math.floor((width * (1 - parts.sizes * room.matrixColumn) - 4) / room.characterWidth);
  const remark = parts.conclusion.remark;
  return {
    levels: parts.levels.length === 0 ? 0 : Math.max(...parts.levels.map(cardHeight)),
    matrix: parts.matrix
      ? room.matrixFrame + parts.matrix.rows.reduce((sum, row) => sum + room.matrixRow + (lines(row.label, matrixLabel) - 1) * room.matrixLine, 0)
      : 0,
    conclusion:
      room.conclusionFrame +
      (parts.conclusion.signature ? room.signatureRow : room.conclusionRow) +
      (remark ? room.remarkFrame + lines(`${remark.label}: ${remark.text ?? NO_REMARK}`, room.remarkCharacters) * room.remarkLine : 0),
  };
}

/** The blocks each page prints: as many as page one holds, in order, the rest on the next under the heading again. */
export function labellingPages(parts: LabellingParts, room: number, width: number): LabellingBlock[][] {
  const heights = labellingHeights(parts, width);
  const blocks: LabellingBlock[] = [...(parts.levels.length > 0 ? (["levels"] as const) : []), ...(parts.matrix ? (["matrix"] as const) : []), "conclusion"];
  const first = LABELLING_ROOM.heading + (parts.lead ? LABELLING_ROOM.leadGap + lines(parts.lead, LABELLING_ROOM.leadCharacters) * LABELLING_ROOM.leadLine : 0);
  const pages: LabellingBlock[][] = [[]];
  let used = first;
  for (const block of blocks) {
    const page = pages[pages.length - 1];
    const height = LABELLING_ROOM.gap + heights[block];
    if (page.length > 0 && used + height > room) {
      pages.push([block]);
      used = LABELLING_ROOM.heading + height;
    } else {
      page.push(block);
      used += height;
    }
  }
  return pages;
}

/** The room a page's content has, in millimetres, on the report's paper. */
export function paperRoom(doc: Pick<InspectionExport, "report">): number {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  return paper.height - LABELLING_ROOM.chrome - (doc.report.footerNote ? LABELLING_ROOM.footerNote : 0);
}

/** The content's width in millimetres, inside the page's side margins (contentWidth in components/report/theme.ts). */
export function contentWidthOf(doc: Pick<InspectionExport, "report">): number {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  return paper.width - 26;
}

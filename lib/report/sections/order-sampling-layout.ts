// How Section 02 fills its pages (TG35 page 2): the heading and its lead,
// Glove Information beside Packing Configuration, the order lots and
// sampling plan table, then the box/carton strips. Each block's height is
// worked out from the sizes the components draw it at
// (components/report/sections/order-sampling.tsx and the primitives it
// uses, ORDER_SAMPLING_ROOM) and from the widths of the report's face,
// Outfit, so the lines text wraps to are counted, not guessed. A block that
// does not fit goes on to the next page; the strips break between sizes,
// keeping at least two together either side of a break, and a size's
// numbers break between lines only where its strip, alone on a page, would
// still not fit. Nothing may run past the page: its content box hides what
// overflows it (components/report/report-page.tsx). Pure, like the builder.
import { formatCount } from "@/lib/format";
import type { CartonSlice, CartonStrips, GloveCard, OrderLotsTable, OrderSamplingContent, OrderSamplingPage, PackingCard } from "./order-sampling";

/* ------------------------------------------------------------------ *
 * Text widths
 * ------------------------------------------------------------------ */

const MM_PER_PT = 25.4 / 72;

/**
 * Outfit's advance widths, in thousandths of an em, for U+0020 to U+007E:
 * the wider of regular (400) and semibold (600) for each character, read
 * from the font the app loads (next/font/google), so text at either weight
 * is never under-counted. Bold is about 1.5% wider still (BOLD).
 */
const OUTFIT: readonly number[] = [
  208, 274, 441, 652, 594, 671, 680, 246, 304, 304, 490, 555, 280, 462, 295, 393, 660, 367, 553, 550, 604, 553, 568, 525, 555, 568, 281, 275,
  555, 555, 555, 505, 750, 715, 631, 688, 747, 602, 578, 778, 721, 280, 513, 688, 556, 850, 727, 800, 616, 820, 640, 569, 629, 696, 705, 992,
  707, 679, 598, 345, 393, 345, 459, 505, 308, 588, 588, 492, 588, 541, 419, 579, 562, 248, 257, 528, 247, 867, 562, 569, 588, 588, 434, 444,
  389, 528, 523, 769, 523, 526, 466, 334, 291, 334, 555,
];
const BOLD = 1.02;
/** tabular-nums: every figure is 0.59 em, at any weight. */
const TABULAR_FIGURE = 590;
const OTHER: Readonly<Record<string, number>> = { "–": 561, "·": 164, "×": 555, "›": 284, "’": 257 };
/** Any other character: generously wide. */
const UNKNOWN = 750;

export type TextStyle = {
  /** Font size in points. */
  pt: number;
  bold?: boolean;
  /** tabular-nums. */
  tabular?: boolean;
  /** Added to every space, in millimetres (word-spacing). */
  wordSpacing?: number;
};

/** A text's width in millimetres, set in Outfit. */
export function textWidth(text: string, { pt, bold = false, tabular = false }: TextStyle): number {
  let units = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (tabular && code >= 48 && code <= 57) units += TABULAR_FIGURE;
    else if (code >= 32 && code <= 126) units += OUTFIT[code - 32];
    else units += OTHER[character] ?? UNKNOWN;
  }
  return (units / 1000) * pt * MM_PER_PT * (bold ? BOLD : 1);
}

/** A caption as the page prints it: "&" kept with the word after it, never alone on a line ("Packaging" over "& Dispensing"). */
export function captionText(label: string): string {
  return label.replace(/ & /g, " &\u00a0");
}

/** The words a line may break between: spaces, but not the one after "&" (captionText). */
function wordsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((word) => word !== "")
    .reduce<string[]>((words, word) => (words.at(-1) === "&" ? [...words.slice(0, -1), `& ${word}`] : [...words, word]), []);
}

/**
 * Where each line starts, as the browser wraps words into a width: broken
 * at spaces, a word wider than a line broken anywhere (overflow-wrap:
 * anywhere), so it starts each line it fills. Word indexes, one per line.
 */
export function lineStarts(words: readonly string[], width: number, style: TextStyle): number[] {
  const space = textWidth(" ", style) + (style.wordSpacing ?? 0);
  const starts: number[] = [];
  let used = 0;
  words.forEach((word, index) => {
    let rest = textWidth(word, style);
    if (starts.length > 0 && used + space + rest <= width) {
      used += space + rest;
      return;
    }
    starts.push(index);
    while (rest > width && width > 0) {
      starts.push(index);
      rest -= width;
    }
    used = rest;
  });
  return starts.length === 0 ? [0] : starts;
}

/** How many lines a text wraps to in a width; one for no text. */
export function wrappedLines(text: string, width: number, style: TextStyle): number {
  return lineStarts(wordsOf(text), width, style).length;
}

/** The narrowest width that holds a text in at most two lines: a column's caption. */
export function twoLineWidth(text: string, style: TextStyle): number {
  const words = wordsOf(text);
  if (words.length <= 1) return textWidth(words[0] ?? "", style);
  let best = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split += 1) {
    const first = textWidth(words.slice(0, split).join(" "), style);
    const second = textWidth(words.slice(split).join(" "), style);
    best = Math.min(best, Math.max(first, second));
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * The sizes the page is drawn at, in millimetres
 * ------------------------------------------------------------------ */

export const ORDER_SAMPLING_ROOM = {
  /** The header band and the footer, with the content's padding: the Summary's (SUMMARY_ROOM in ../model.ts). */
  chrome: 61,
  /** A footer note's line in the footer. */
  footerNote: 4,
  /** Kept free at the foot of the page, for rounding. */
  slack: 1,
  /** The page's side margins, together (PAGE_GUTTER). */
  margins: 26,
  /** Between the page's blocks (gap-[4.6mm]). */
  gap: 4.6,
  heading: {
    /** The kicker (8.5pt × 1.3), 1.6 mm, the title (21pt × 1.15). */
    height: 14.02,
    /** Above the lead. */
    leadGap: 1.6,
    /** A line of the lead (9.5pt × 1.5), at most 175 mm wide. */
    leadLine: 5.03,
    leadPt: 9.5,
    leadWidth: 175,
  },
  card: {
    /** Border (0.3 × 2), padding (4.5 × 2), the title (12pt × 1.25) and 3 mm under it. */
    frame: 17.9,
    /** Inside a card: padding (5) and border (0.3) each side. */
    insetX: 10.6,
    /** Between the two cards. */
    gapX: 4.6,
  },
  facts: {
    /** A line of a label (8.5pt × 1.4). */
    labelLine: 4.2,
    labelPt: 8.5,
    /** Between a label and its value. */
    labelGap: 0.6,
    /** A line of a value (10pt × 1.35). */
    valueLine: 4.77,
    valuePt: 10,
    gapX: 6,
    gapY: 3.2,
    /** A colour's swatch and the gap after it. */
    swatch: 4.8,
  },
  tiles: {
    /** Border (0.3 × 2), padding (3 × 2), the count (18pt × 1.1) and 1 mm under it. */
    frame: 14.6,
    /** A line of the caption (8.5pt × 1.4). */
    line: 4.2,
    pt: 8.5,
    /** Inside a tile: padding (1.4) and border (0.3) each side. */
    insetX: 3.4,
    /** A chevron between two tiles, and the gap either side of each. */
    chevron: 3.2,
    gapX: 1.5,
    /** The tiles' row on a card of its own. */
    maxWidth: 110,
  },
  table: {
    /** The block's heading (12pt × 1.25) and 2 mm under it. */
    heading: 7.3,
    /** The groups' row: a line (8.5pt × 1.4), 1.2 mm under it, the rule. */
    groups: 5.7,
    /** The header row's padding (2 above, 1.4 below) and rule. */
    headerFrame: 3.8,
    headerLine: 4.2,
    headerPt: 8.5,
    /** A row's padding (1.6 × 2) and hairline. */
    rowFrame: 3.45,
    /** A line of a cell (9pt × 1.45). */
    line: 4.61,
    pt: 9,
    /** The totals row's padding (1.6 × 2) and rule. */
    totalsFrame: 3.6,
    /** A cell's padding, both sides: 1.2 mm each, as the design sets the columns. */
    insetX: 2.4,
    /** The share's bar and the gap after it, and the room its percentage keeps (min-w-[9mm]). */
    shareBar: 9.6,
    shareText: 9,
    /** A lot number wider than this wraps. */
    lotMax: 30,
  },
  strips: {
    /** The block's heading (12pt × 1.25), and the legend beside it (8.5pt) after a 6 mm gap. */
    heading: 5.3,
    headingPt: 12,
    legendPt: 8.5,
    /** The legend's mark and the gap after it. */
    legendMark: 1.9,
    legendGap: 6,
    /** The legend wrapped under the heading: a line (8.5pt × 1.4) and 1 mm. */
    legendWrap: 5.2,
    /** Above the summary line, and a line of it (9.5pt × 1.5). */
    summaryGap: 2,
    summaryLine: 5.03,
    summaryPt: 9.5,
    /** Above the strips. */
    top: 3,
    /** Between strips. */
    gapY: 3,
    /** The size (11pt × 1.25) over its count (9pt × 1.5). */
    label: 9.62,
    /** The track and the 1.2 mm under it. */
    track: 6.8,
    /** A line of numbers (9pt × 1.5). */
    line: 4.77,
    pt: 9,
    wordSpacing: 0.6,
    /** The size's and the range's columns, and the gap between columns. */
    labelColumn: 25,
    rangeColumn: 15,
    gapX: 3,
  },
} as const;

const R = ORDER_SAMPLING_ROOM;

type Blocks = Pick<OrderSamplingContent, "lead" | "glove" | "packing" | "lots" | "cartons">;

/* ------------------------------------------------------------------ *
 * Glove Information and Packing Configuration
 * ------------------------------------------------------------------ */

/** The details card: rows of labels over values, as many columns as given. */
export function gloveHeight(card: GloveCard, cardWidth: number, columns: number): number {
  const F = R.facts;
  const column = (cardWidth - R.card.insetX - F.gapX * (columns - 1)) / columns;
  const factHeight = (fact: GloveCard["facts"][number]) =>
    wrappedLines(fact.label, column, { pt: F.labelPt }) * F.labelLine +
    F.labelGap +
    wrappedLines(fact.value, column - (fact.swatch ? F.swatch : 0), { pt: F.valuePt, bold: fact.stated }) * F.valueLine;
  let height = R.card.frame;
  for (let start = 0; start < card.facts.length; start += columns) {
    height += (start > 0 ? F.gapY : 0) + Math.max(...card.facts.slice(start, start + columns).map(factHeight));
  }
  return height;
}

/** The tiles a card's inner width shares with two chevrons. */
export function tileWidth(cardWidth: number, alone: boolean): number {
  const T = R.tiles;
  const inner = Math.min(cardWidth - R.card.insetX, alone ? T.maxWidth : Number.POSITIVE_INFINITY);
  return (inner - 2 * T.chevron - 4 * T.gapX) / 3;
}

export function packingHeight(card: PackingCard, cardWidth: number, alone: boolean): number {
  const T = R.tiles;
  const inside = tileWidth(cardWidth, alone) - T.insetX;
  const lines = Math.max(...card.tiles.map((tile) => wrappedLines(tile.caption, inside, { pt: T.pt })));
  return R.card.frame + T.frame + lines * T.line;
}

/** The two cards side by side, as tall as the taller; one alone across the page. */
function cardsHeight(blocks: Blocks, width: number): number {
  const both = blocks.glove !== null && blocks.packing !== null;
  const cardWidth = both ? (width - R.card.gapX) / 2 : width;
  return Math.max(
    blocks.glove ? gloveHeight(blocks.glove, cardWidth, both ? 2 : 3) : 0,
    blocks.packing ? packingHeight(blocks.packing, cardWidth, !both) : 0,
  );
}

/* ------------------------------------------------------------------ *
 * The order lots and sampling plan
 * ------------------------------------------------------------------ */

/**
 * Each column's width in percent of the table's. A column would have room
 * for its caption in two lines and for its widest figure (the totals' in
 * bold), and the page's width is shared out in proportion to that, as the
 * design spaces them. Where those do not all fit, the captions give way
 * first, down to their longest word; the figures never do.
 */
export function lotsColumnWidths(table: Omit<OrderLotsTable, "widths">, width: number): Record<string, number> {
  const T = R.table;
  const style = { pt: T.headerPt };
  const longestWord = (label: string) => Math.max(0, ...wordsOf(label).map((word) => textWidth(word, style)));
  const figure = (value: number | null | undefined, bold = false) =>
    value === null || value === undefined ? textWidth("—", { pt: T.pt }) : textWidth(formatCount(value), { pt: T.pt, tabular: true, bold });
  const lotWord = (row: OrderLotsTable["rows"][number]) => Math.max(...wordsOf(row.lotText).map((word) => textWidth(word, { pt: T.pt })));
  const columns: { key: string; caption: string; content: number }[] = [
    { key: "size", caption: table.sizeHeader, content: Math.max(textWidth("Total", { pt: T.pt, bold: true }), ...table.rows.map((row) => textWidth(row.label, { pt: T.pt, bold: true }))) },
    { key: "lot", caption: table.lotHeader, content: Math.min(T.lotMax, Math.max(...table.rows.map(lotWord))) },
    ...table.columns.map((column) => ({
      key: column.id,
      caption: column.label,
      content:
        column.id === "order.share"
          ? T.shareBar + Math.max(T.shareText, textWidth("100.0%", { pt: T.pt, tabular: true, bold: true }))
          : Math.max(figure(table.totals[column.id], true), ...table.rows.map((row) => figure(row.cells[column.id]?.value))),
    })),
  ];
  const preferred = columns.map((column) => Math.max(twoLineWidth(column.caption, style), column.content) + T.insetX);
  const least = columns.map((column) => Math.max(longestWord(column.caption), column.content) + T.insetX);
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  let widths: number[];
  if (sum(preferred) <= width) widths = preferred.map((value) => (value * width) / sum(preferred));
  else if (sum(least) < width) {
    const share = (width - sum(least)) / (sum(preferred) - sum(least));
    widths = least.map((value, index) => value + (preferred[index] - value) * share);
  } else widths = least.map((value) => (value * width) / sum(least));
  return Object.fromEntries(columns.map((column, index) => [column.key, (widths[index] / width) * 100]));
}

export function lotsHeight(table: OrderLotsTable, width: number): number {
  const T = R.table;
  const inside = (id: string) => ((table.widths[id] ?? 0) / 100) * width - T.insetX;
  const header = Math.max(
    wrappedLines(table.sizeHeader, inside("size"), { pt: T.headerPt }),
    wrappedLines(table.lotHeader, inside("lot"), { pt: T.headerPt }),
    ...table.columns.map((column) => wrappedLines(column.label, inside(column.id), { pt: T.headerPt })),
  );
  const rows = table.rows.reduce(
    (sum, row) =>
      sum +
      T.rowFrame +
      T.line * Math.max(wrappedLines(row.label, inside("size"), { pt: T.pt, bold: true }), wrappedLines(row.lotText, inside("lot"), { pt: T.pt })),
    0,
  );
  return T.heading + T.groups + T.headerFrame + header * T.headerLine + rows + T.totalsFrame + T.line;
}

/* ------------------------------------------------------------------ *
 * The box/carton strips
 * ------------------------------------------------------------------ */

const NUMBERS: TextStyle = { pt: R.strips.pt, tabular: true, wordSpacing: R.strips.wordSpacing };

/** The track's width: the page's less the size's and the range's columns. */
export function trackWidth(width: number): number {
  const S = R.strips;
  return width - S.labelColumn - S.rangeColumn - 2 * S.gapX;
}

/** The block's heading (and the legend beside it, or under it when they do not fit one line), its summary unless continued, and the room above the strips. */
export function stripsTop(strips: CartonStrips, width: number, continued: boolean): number {
  const S = R.strips;
  const legend = textWidth(strips.legend, { pt: S.legendPt }) + S.legendMark;
  const wraps = textWidth(strips.title, { pt: S.headingPt }) + S.legendGap + legend > width;
  const summary = continued ? 0 : S.summaryGap + wrappedLines(strips.summary, width, { pt: S.summaryPt }) * S.summaryLine;
  return S.heading + (wraps ? S.legendWrap : 0) + summary + S.top;
}

/** A strip's height with this many lines of numbers. */
export function stripHeight(lines: number): number {
  const S = R.strips;
  return Math.max(S.label, S.track + Math.max(1, lines) * S.line);
}

/** A strip still to place: its numbers' line starts, from line `first` on; `continued` once part of it is placed. */
type Pending = { row: number; starts: number[]; first: number; continued: boolean };

const linesOf = (strip: Pending) => strip.starts.length - strip.first;

function stripsHeight(strips: readonly Pending[]): number {
  return strips.reduce((sum, strip, index) => sum + (index > 0 ? R.strips.gapY : 0) + stripHeight(linesOf(strip)), 0);
}

/* ------------------------------------------------------------------ *
 * The pages
 * ------------------------------------------------------------------ */

/**
 * The section's pages: what each prints after the heading (with the lead
 * on the first page, "Continued" on the others). The content box is the
 * paper's height less the chrome, a footer note's line, and a little kept
 * free for rounding.
 */
export function layoutOrderSampling(
  blocks: Blocks,
  paper: { width: number; height: number },
  { footerNote = false }: { footerNote?: boolean } = {},
): OrderSamplingPage[] {
  const width = paper.width - R.margins;
  const room = paper.height - R.chrome - (footerNote ? R.footerNote : 0) - R.slack;
  const pages: OrderSamplingPage[] = [{ parts: [] }];
  let used = R.heading.height + R.heading.leadGap + wrappedLines(blocks.lead, Math.min(R.heading.leadWidth, width), { pt: R.heading.leadPt }) * R.heading.leadLine;
  const current = () => pages[pages.length - 1];
  const turn = () => {
    pages.push({ parts: [] });
    used = R.heading.height;
  };
  /** A block that does not fit goes on to the next page, unless the page holds nothing yet. */
  const place = (part: OrderSamplingPage["parts"][number], height: number) => {
    if (current().parts.length > 0 && used + R.gap + height > room) turn();
    current().parts.push(part);
    used += R.gap + height;
  };

  if (blocks.glove || blocks.packing) place({ kind: "cards" }, cardsHeight(blocks, width));
  if (blocks.lots) place({ kind: "lots" }, lotsHeight(blocks.lots, width));
  const strips = blocks.cartons;
  if (!strips) return pages;

  const S = R.strips;
  const track = trackWidth(width);
  const top = (continued: boolean) => stripsTop(strips, width, continued);
  const queue: Pending[] = strips.rows.map((row, index) => ({ row: index, starts: lineStarts(row.numbers, track, NUMBERS), first: 0, continued: false }));
  const sliceOf = (strip: Pending, lines: number): CartonSlice => {
    const count = strips.rows[strip.row].numbers.length;
    return { row: strip.row, from: count === 0 ? 0 : strip.starts[strip.first], to: strip.starts[strip.first + lines] ?? count, continued: strip.continued };
  };
  let continued = false;
  while (queue.length > 0) {
    // A page that holds nothing yet cannot send the strips on: they fill it.
    const fresh = current().parts.length === 0;
    const available = room - used - R.gap - top(continued);
    let fit = 0;
    while (fit < queue.length && stripsHeight(queue.slice(0, fit + 1)) <= available) fit += 1;
    let take = fit;
    if (fit < queue.length) {
      // At least two strips either side of a break; else they go on together to the next page.
      const kept = Math.min(fit, queue.length - 2);
      take = kept >= 2 ? kept : fresh ? fit : 0;
    }
    if (take === 0 && !fresh) {
      turn();
      continue;
    }
    const taken = queue.splice(0, take);
    const slices = taken.map((strip) => sliceOf(strip, linesOf(strip)));
    let height = stripsHeight(taken);
    if (take === 0) {
      // Alone on its page and still too tall: the strip's numbers break between lines, the rest go on.
      const strip = queue[0];
      const lines = Math.max(1, Math.min(linesOf(strip) - 1, Math.floor((available - S.track) / S.line)));
      slices.push(sliceOf(strip, lines));
      height = stripHeight(lines);
      if (lines >= linesOf(strip)) queue.shift();
      else queue[0] = { ...strip, first: strip.first + lines, continued: true };
    }
    current().parts.push({ kind: "cartons", continued, slices });
    used += R.gap + top(continued) + height;
    continued = true;
    if (queue.length > 0) turn();
  }
  return pages;
}

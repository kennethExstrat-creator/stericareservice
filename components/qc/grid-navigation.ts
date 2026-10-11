// Keyboard and paste rules for MeasurementGrid, kept pure so they can be tested.
import { commitEntry, readEntry, type EntryLimits, type InvalidEntry } from "./numeric-entry";

export type CellPosition = { row: number; col: number };
export type GridSize = { rows: number; cols: number };

/** Where the caret sits in a cell's text. An empty cell, or all text selected, is "all". */
export type Caret = "start" | "end" | "all" | "middle";

export function caretOf(selectionStart: number | null, selectionEnd: number | null, length: number): Caret {
  if (selectionStart === null || selectionEnd === null) return "all";
  if (length === 0 || (selectionStart === 0 && selectionEnd === length)) return "all";
  if (selectionStart === selectionEnd) {
    if (selectionStart === 0) return "start";
    if (selectionStart === length) return "end";
  }
  return "middle";
}

/**
 * The cell a key moves to, or null to leave the key to the input.
 * Enter walks down a column and on to the top of the next, because gloves are
 * measured one measure at a time; Shift+Enter walks back. Left and Right only
 * leave the cell when the caret is already at that edge of the text.
 */
export function targetCell(
  key: string,
  shiftKey: boolean,
  { row, col }: CellPosition,
  { rows, cols }: GridSize,
  caret: Caret,
): CellPosition | null {
  switch (key) {
    case "Enter":
      if (shiftKey) {
        if (row > 0) return { row: row - 1, col };
        return col > 0 ? { row: rows - 1, col: col - 1 } : null;
      }
      if (row + 1 < rows) return { row: row + 1, col };
      return col + 1 < cols ? { row: 0, col: col + 1 } : null;
    case "ArrowDown":
      return row + 1 < rows ? { row: row + 1, col } : null;
    case "ArrowUp":
      return row > 0 ? { row: row - 1, col } : null;
    case "ArrowLeft":
      return (caret === "start" || caret === "all") && col > 0 ? { row, col: col - 1 } : null;
    case "ArrowRight":
      return (caret === "end" || caret === "all") && col + 1 < cols ? { row, col: col + 1 } : null;
    default:
      return null;
  }
}

export type PastedCell = CellPosition & { raw: string };
export type PastePlan = {
  cells: PastedCell[];
  skipped: number;
  /**
   * The values past the last row or column, where they would have gone, in
   * reading order (`skipped` of them): what the grid lists as not stored.
   */
  overflow: PastedCell[];
};

/**
 * Lays pasted text out from the focused cell: one value per line fills down,
 * tab-separated values (a block from a spreadsheet) fill across as well.
 * Returns null for a single value, which the input pastes as usual.
 */
export function planPaste(text: string, from: CellPosition, { rows, cols }: GridSize): PastePlan | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const table = lines.map((line) => line.split("\t"));
  if (table.length === 1 && table[0].length === 1) return null;

  const cells: PastedCell[] = [];
  const overflow: PastedCell[] = [];
  table.forEach((values, r) => {
    values.forEach((raw, c) => {
      const row = from.row + r;
      const col = from.col + c;
      (row < rows && col < cols ? cells : overflow).push({ row, col, raw: raw.trim() });
    });
  });
  return { cells, skipped: overflow.length, overflow };
}

/** A pasted value past the grid's last row or column, with the number it reads as (null for text or a blank). */
export type OverflowCell = PastedCell & { value: number | null };

/**
 * The values a paste could not place, as the grid lists them: blanks are
 * not data, and each keeps the number it reads as, so the grid can tell the
 * ones a module kept past its last row (force at break keeps readings past
 * the gloves tested, and says so) from the ones nobody stored.
 */
export function pasteOverflow(plan: Pick<PastePlan, "overflow">): OverflowCell[] {
  return plan.overflow
    .filter((cell) => cell.raw !== "")
    .map((cell) => {
      const read = readEntry(cell.raw);
      return { ...cell, value: read.ok ? read.value : null };
    });
}

/**
 * Of a paste's overflow, the values nobody stored: those the module does not
 * hold where they would have gone (its values past the last row, which the
 * grid does not show). A value it holds there was kept, and the module says so.
 */
export function overflowNotStored(
  overflow: readonly OverflowCell[],
  measures: readonly { key: string }[],
  values: MeasurementValues,
): OverflowCell[] {
  return overflow.filter((cell) => {
    const measure = measures[cell.col];
    const held = measure ? (values[measure.key]?.[cell.row] ?? null) : null;
    return cell.value === null || held !== cell.value;
  });
}

/**
 * The last paste's overflow as the grid shows it: the values past its last
 * row or column, the cell the paste started in (Dismiss goes back there), and
 * the values nobody stored, judged as the paste lands (null until then).
 */
export type PasteOverflow = {
  readonly cells: readonly OverflowCell[];
  readonly from: CellPosition;
  readonly notStored: readonly OverflowCell[] | null;
};

/**
 * Judges a paste's overflow once, against the values the module holds as
 * the paste lands (overflowNotStored). An overflow already judged comes back
 * as it is: readings the module kept and takes away later (force at break's
 * Clear) were stored, and never become values the paste lost.
 */
export function judgeOverflow(
  overflow: PasteOverflow,
  measures: readonly { key: string }[],
  values: MeasurementValues,
): PasteOverflow {
  if (overflow.notStored !== null) return overflow;
  return { ...overflow, notStored: overflowNotStored(overflow.cells, measures, values) };
}

/** Values per measure key, one per row; null where nothing is entered. */
export type MeasurementValues = Readonly<Record<string, readonly (number | null)[]>>;

/** One cell of the grid: a glove (`row`, 0 is glove 1) and a measure's key. */
export type MeasurementCell = { readonly row: number; readonly measure: string };

/** A cell's new value: what MeasurementGrid's onCellsChange hands over. */
export type MeasurementChange = MeasurementCell & { readonly value: number | null };

/** Rejected entries by cell, keyed with cellKey. */
export type InvalidCells = Readonly<Record<string, InvalidEntry>>;

export function cellKey(measure: string, row: number): string {
  return `${measure}:${row}`;
}

export type PasteResult = {
  values: MeasurementValues;
  /** Every cell the paste reached, with the value it now holds (null where the text was refused). */
  changes: MeasurementChange[];
  invalid: InvalidCells;
  /** For the grid's live region, e.g. "Pasted 13 values. 1 not stored." */
  notice: string;
};

/**
 * Applies a paste plan under the numbers-only rule: each value is committed
 * as if it had been typed into its cell (commitEntry), so a rejected value
 * leaves the cell null and is listed with its text, and a valid one clears
 * an earlier rejection. Columns the paste does not reach are kept as they are.
 */
export function applyPaste(
  plan: PastePlan,
  measures: readonly (EntryLimits & { key: string })[],
  rows: number,
  values: MeasurementValues,
  invalid: InvalidCells,
): PasteResult {
  const columns: Record<string, (number | null)[]> = {};
  const changes: MeasurementChange[] = [];
  const nextInvalid: Record<string, InvalidEntry> = { ...invalid };
  let rejected = 0;
  for (const cell of plan.cells) {
    const measure = measures[cell.col];
    const column = (columns[measure.key] ??= Array.from(
      { length: rows },
      (_, row) => values[measure.key]?.[row] ?? null,
    ));
    const entry = commitEntry(cell.raw, { min: measure.min, max: measure.max, minExclusive: measure.minExclusive });
    column[cell.row] = entry.value;
    changes.push({ row: cell.row, measure: measure.key, value: entry.value });
    if (entry.invalid) {
      nextInvalid[cellKey(measure.key, cell.row)] = entry.invalid;
      rejected += 1;
    } else {
      delete nextInvalid[cellKey(measure.key, cell.row)];
    }
  }
  const pasted = plan.cells.length;
  const notice = [
    `Pasted ${pasted} ${pasted === 1 ? "value" : "values"}.`,
    rejected > 0 && `${rejected} not stored.`,
    plan.skipped > 0 && `${plan.skipped} did not fit.`,
  ]
    .filter(Boolean)
    .join(" ");
  return { values: { ...values, ...columns }, changes, invalid: nextInvalid, notice };
}

/**
 * The width of the grid's label column: the glove numbers, then the footer's
 * captions in the template's wording ("Passed / Failed", "Spec. (EN 455)").
 * Wide enough for the longest caption on one line, up to 16 rem (longer
 * wording wraps at its spaces), and never narrower than 3.5 rem.
 */
export function labelColumnWidth(captions: readonly string[]): string {
  const longest = Math.max(0, ...captions.map((caption) => caption.trim().length));
  return `clamp(3.5rem, calc(${longest}ch + 2rem), 16rem)`;
}

/** Rows `from` up to, not including, `to` (0-based): one group of a flowed grid. */
export type RowGroup = { readonly from: number; readonly to: number };

/**
 * A flowed grid's rows in groups that sit side by side, in order: at most
 * `most`, of the same length but the last, which may be shorter. 13 gloves
 * give rows 1 to 5, 6 to 10 and 11 to 13; 4 give 1 to 2 and 3 to 4.
 */
export function flowGroups(rows: number, most = 3): RowGroup[] {
  if (rows <= 0) return [];
  const per = Math.ceil(rows / Math.max(1, most));
  const groups: RowGroup[] = [];
  for (let from = 0; from < rows; from += per) groups.push({ from, to: Math.min(from + per, rows) });
  return groups;
}

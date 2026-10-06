// Keyboard and paste rules for MeasurementGrid, kept pure so they can be tested.

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
export type PastePlan = { cells: PastedCell[]; skipped: number };

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
  let skipped = 0;
  table.forEach((values, r) => {
    values.forEach((raw, c) => {
      const row = from.row + r;
      const col = from.col + c;
      if (row < rows && col < cols) cells.push({ row, col, raw: raw.trim() });
      else skipped += 1;
    });
  });
  return { cells, skipped };
}

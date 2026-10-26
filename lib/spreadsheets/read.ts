import "server-only";
import * as XLSX from "xlsx";
import { CSV_TYPE, type SpreadsheetType } from "@/lib/photos/paths";
import { isOle2, isZip, zipEntries } from "@/lib/photos/sniff";
import { PREVIEW_COLUMNS, PREVIEW_ROWS, type SheetPreview, type SpreadsheetPreviewResult } from "./preview";

/*
 * Excel and CSV Source Documents (Kenneth, 26 October 2026: "make the source
 * document to support excel and csv file reading"), read on the server with
 * SheetJS, which never reaches the browser. Claude takes no spreadsheet
 * itself, so Steri-AI gets text (spreadsheetText; docs/AI.md, "Source
 * Documents"): a CSV as it is, a workbook sheet by sheet, each as CSV under
 * a line "Sheet: <name>", with the values as Excel displays them (formula
 * results, formatted numbers and dates, never the formulas). Preview gets a
 * table of each sheet's first rows and columns (spreadsheetPreview).
 */

/** Steri-AI reads a spreadsheet up to 10 MB, as it reads a PDF up to 20 MB. */
export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;
/** At most what Steri-AI gets of one spreadsheet (about 75,000 tokens): the rest is cut, with a line saying how many rows. */
export const MAX_SPREADSHEET_TEXT = 300_000;
/** What a workbook's parts may say they unpack to: a zip can unpack to far more than it weighs. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

// Excel's short date and date-time (formats 14 and 22) follow each computer's own settings, which SheetJS
// writes month first (11/3/26): written year first instead, so 3 November is never read as 11 March.
const SHORT_DATE = "yyyy-mm-dd";
XLSX.SSF.load("yyyy-mm-dd h:mm", 22);

/** Splits a sheet's CSV into rows: a cell's own line breaks stay inside its quotes. */
const RECORD = "\u001e";

const MESSAGES = {
  password: "This spreadsheet is password-protected. Save it without a password and upload it again.",
  unreadable: "This spreadsheet could not be opened. Save it again as .xlsx or CSV and upload it again.",
  empty: "This spreadsheet is empty.",
  unpacked: "The spreadsheet is too large to open. Upload it in parts, a few sheets at a time.",
} as const;

export type SpreadsheetResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * A CSV's text: UTF-8 without its byte order mark; windows-1252 when the
 * bytes are not UTF-8 (Excel's plain "CSV" is saved in the computer's code
 * page, windows-1252 on an English Windows); UTF-16 by its byte order mark.
 */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

/** An .xlsx or .xls workbook, its dates and formats as Excel displays them; or why it cannot be opened. */
function openWorkbook(bytes: Uint8Array): SpreadsheetResult<XLSX.WorkBook> {
  if (isZip(bytes)) {
    const entries = zipEntries(bytes);
    if (entries && entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_UNPACKED_BYTES) return { ok: false, message: MESSAGES.unpacked };
  } else if (!isOle2(bytes)) {
    // SheetJS would take anything else as text.
    return { ok: false, message: MESSAGES.unreadable };
  }
  try {
    const workbook = XLSX.read(bytes, {
      type: "array",
      dateNF: SHORT_DATE,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
    return { ok: true, value: workbook };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: /password/i.test(reason) ? MESSAGES.password : MESSAGES.unreadable };
  }
}

function cellText(cell: XLSX.CellObject | undefined): string {
  return cell ? XLSX.utils.format_cell(cell) : "";
}

type Bounds = { s: { r: number; c: number }; e: { r: number; c: number } };

/** The bounds of the cells that hold something; null for a sheet with nothing in it. */
function usedBounds(cells: Iterable<{ r: number; c: number; text: string }>): Bounds | null {
  let bounds: Bounds | null = null;
  for (const { r, c, text } of cells) {
    if (text.trim() === "") continue;
    if (!bounds) bounds = { s: { r, c }, e: { r, c } };
    else {
      bounds.s.r = Math.min(bounds.s.r, r);
      bounds.s.c = Math.min(bounds.s.c, c);
      bounds.e.r = Math.max(bounds.e.r, r);
      bounds.e.c = Math.max(bounds.e.c, c);
    }
  }
  return bounds;
}

function* sheetCells(sheet: XLSX.WorkSheet): Generator<{ r: number; c: number; text: string }> {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    yield { ...XLSX.utils.decode_cell(address), text: cellText(sheet[address] as XLSX.CellObject) };
  }
}

function* gridCells(grid: readonly (readonly string[])[]): Generator<{ r: number; c: number; text: string }> {
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) yield { r, c, text: grid[r][c] };
}

/** The workbook's sheets that hold something, in order, each with the bounds of what it holds. */
function filledSheets(workbook: XLSX.WorkBook): { name: string; hidden: boolean; sheet: XLSX.WorkSheet; bounds: Bounds }[] {
  return workbook.SheetNames.flatMap((name, index) => {
    const sheet = workbook.Sheets[name];
    const bounds = sheet ? usedBounds(sheetCells(sheet)) : null;
    if (!sheet || !bounds) return [];
    // Hidden 1, or 2 for a sheet only a macro shows.
    return [{ name, hidden: Boolean(workbook.Workbook?.Sheets?.[index]?.Hidden), sheet, bounds }];
  });
}

type TextSheet = { title: string | null; rows: readonly string[] };

/**
 * The sheets as one text, a blank line between them, cut at about `max`
 * characters at the end of a row; a last line says how many rows were left
 * out, those of the sheets after it included.
 */
function joinRows(sheets: readonly TextSheet[], max: number): string {
  let text = "";
  for (let index = 0; index < sheets.length; index++) {
    const { title, rows } = sheets[index];
    if (title !== null) text += `${index > 0 ? "\n\n" : ""}${title}`;
    for (let row = 0; row < rows.length; row++) {
      const line = `${text === "" ? "" : "\n"}${rows[row]}`;
      if (text.length + line.length > max) {
        const left = [rows.slice(row), ...sheets.slice(index + 1).map((sheet) => sheet.rows)].flat().filter((rest) => rest.trim() !== "");
        return `${text}\n[truncated: ${left.length} more rows]`;
      }
      text += line;
    }
  }
  return text;
}

/**
 * What Steri-AI gets of a spreadsheet: a CSV's text as it is; a workbook's
 * sheets in order, each as CSV under a line "Sheet: <name>" (with
 * "(hidden)" after a hidden sheet's name), empty sheets and rows left out,
 * the values as Excel displays them. Cut at `max` characters (joinRows).
 */
export function spreadsheetText(bytes: Uint8Array, type: SpreadsheetType, max = MAX_SPREADSHEET_TEXT): SpreadsheetResult<string> {
  if (type === CSV_TYPE) {
    const text = decodeCsv(bytes).replace(/\r\n?/g, "\n").trim();
    return text === "" ? { ok: false, message: MESSAGES.empty } : { ok: true, value: joinRows([{ title: null, rows: text.split("\n") }], max) };
  }
  const opened = openWorkbook(bytes);
  if (!opened.ok) return opened;
  const sheets = filledSheets(opened.value).map(({ name, hidden, sheet, bounds }): TextSheet => {
    // Only the part that holds something: no empty leading columns, nor a range stretched by formatting.
    sheet["!ref"] = XLSX.utils.encode_range(bounds);
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: true, RS: RECORD });
    return { title: `Sheet: ${name}${hidden ? " (hidden)" : ""}`, rows: csv.split(RECORD) };
  });
  return sheets.length === 0 ? { ok: false, message: MESSAGES.empty } : { ok: true, value: joinRows(sheets, max) };
}

const SEPARATORS = [",", ";", "\t", "|"];

/** A CSV's separator: a first "sep=" line's, else the first line's most common of comma, semicolon, tab and bar. */
function csvSeparator(text: string): { separator: string; body: string } {
  const declared = /^sep=(.)\r?\n/.exec(text);
  if (declared) return { separator: declared[1], body: text.slice(declared[0].length) };
  const counts = new Map<string, number>();
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && SEPARATORS.includes(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let separator = ",";
  for (const [char, count] of counts) if (count > (counts.get(separator) ?? 0)) separator = char;
  return { separator, body: text };
}

/**
 * A CSV's rows as written: fields split at the separator outside quotes, a
 * doubled quote inside them one quote, nothing turned into a number or a
 * date. SheetJS would guess the format from the first bytes instead (a CSV
 * starting with "ID" as SYLK).
 */
export function parseCsv(text: string): string[][] {
  const { separator, body } = csvSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (body[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = false;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** A sheet's table for Preview: the first rows and columns of what it holds, each row as wide as the others. */
function sheetPreview(name: string, hidden: boolean, bounds: Bounds, text: (r: number, c: number) => string): SheetPreview {
  const lastRow = Math.min(bounds.e.r, bounds.s.r + PREVIEW_ROWS - 1);
  const lastColumn = Math.min(bounds.e.c, bounds.s.c + PREVIEW_COLUMNS - 1);
  const rows: string[][] = [];
  for (let r = bounds.s.r; r <= lastRow; r++) {
    const row: string[] = [];
    for (let c = bounds.s.c; c <= lastColumn; c++) row.push(text(r, c));
    rows.push(row);
  }
  return {
    name,
    hidden,
    rows,
    firstRow: bounds.s.r,
    firstColumn: bounds.s.c,
    totalRows: bounds.e.r - bounds.s.r + 1,
    totalColumns: bounds.e.c - bounds.s.c + 1,
  };
}

/**
 * Preview's table of a spreadsheet: each sheet that holds something (hidden
 * ones marked), at most PREVIEW_ROWS by PREVIEW_COLUMNS of it, as displayed;
 * a CSV is one sheet, its fields as written.
 */
export function spreadsheetPreview(bytes: Uint8Array, type: SpreadsheetType): SpreadsheetPreviewResult {
  if (type === CSV_TYPE) {
    const grid = parseCsv(decodeCsv(bytes));
    const bounds = usedBounds(gridCells(grid));
    if (!bounds) return { status: "error", message: MESSAGES.empty };
    return { status: "ready", sheets: [sheetPreview("", false, bounds, (r, c) => grid[r]?.[c] ?? "")] };
  }
  const opened = openWorkbook(bytes);
  if (!opened.ok) return { status: "error", message: opened.message };
  const sheets = filledSheets(opened.value).map(({ name, hidden, sheet, bounds }) =>
    sheetPreview(name, hidden, bounds, (r, c) => cellText(sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined)),
  );
  return sheets.length === 0 ? { status: "error", message: MESSAGES.empty } : { status: "ready", sheets };
}

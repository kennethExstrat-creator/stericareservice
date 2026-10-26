// The table Preview shows of an Excel or CSV Source Document (Kenneth, 26
// October 2026): each sheet's first rows and columns as Excel displays them,
// read on the server (read.ts, sheets.ts) and fetched from a Route Handler,
// so SheetJS never reaches the browser and the preview never waits behind a
// Server Action (Next.js runs those one at a time, and a Steri-AI reading
// takes many seconds). Client-safe.
import { z } from "zod";

/** Preview shows at most this many rows and columns of a sheet; Download has the rest. */
export const PREVIEW_ROWS = 200;
export const PREVIEW_COLUMNS = 30;

export const SheetPreviewSchema = z.object({
  /** The sheet's name; empty for a CSV, which is one sheet. */
  name: z.string(),
  hidden: z.boolean(),
  /** The part of the sheet that holds something: its first rows, each cut to its first columns, as displayed. */
  rows: z.array(z.array(z.string())),
  /** Where that part starts in the sheet (0-based), for the row numbers and column letters. */
  firstRow: z.number().int().min(0),
  firstColumn: z.number().int().min(0),
  /** The rows and columns that part spans in full. */
  totalRows: z.number().int().min(0),
  totalColumns: z.number().int().min(0),
});
export type SheetPreview = z.infer<typeof SheetPreviewSchema>;

/** What the server answers: the sheets, or why there are none (every failure has a message for the screen). */
export const SpreadsheetPreviewResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), sheets: z.array(SheetPreviewSchema) }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type SpreadsheetPreviewResult = z.infer<typeof SpreadsheetPreviewResultSchema>;

/** A stored file's sheets (app/api/inspections/[id]/files/[fileId]/sheets). */
export function storedSheetsUrl(inspectionId: string, fileId: string): string {
  return `/api/inspections/${encodeURIComponent(inspectionId)}/files/${encodeURIComponent(fileId)}/sheets`;
}

/** The sheets of a file sent with the request (app/api/sheets): New Inspection's, before Create. */
export const HELD_SHEETS_URL = "/api/sheets";

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";
const UNREADABLE = "The spreadsheet could not be shown. Try again, or download it.";

/** Asks the server for a spreadsheet's table: its answer, or why there is none. */
export async function fetchSheets(url: string, init: RequestInit = {}): Promise<SpreadsheetPreviewResult> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  } catch {
    return { status: "error", message: UNREACHABLE };
  }
  const answer = SpreadsheetPreviewResultSchema.safeParse(await response.json().catch(() => null));
  return answer.success ? answer.data : { status: "error", message: UNREADABLE };
}

/** A column's letters, as Excel heads it: 0 is A, 25 Z, 26 AA. */
export function columnLetters(index: number): string {
  let letters = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  return letters;
}

const COUNT = new Intl.NumberFormat("en-US");

/** What Preview leaves out of a sheet, as a sentence; null when it shows all of it. */
export function previewNote(sheet: SheetPreview): string | null {
  const shownRows = sheet.rows.length;
  const shownColumns = Math.min(sheet.totalColumns, PREVIEW_COLUMNS);
  const parts = [
    sheet.totalRows > shownRows ? `the first ${COUNT.format(shownRows)} of ${COUNT.format(sheet.totalRows)} rows` : null,
    sheet.totalColumns > shownColumns ? `the first ${COUNT.format(shownColumns)} of ${COUNT.format(sheet.totalColumns)} columns` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : `Showing ${parts.join(" and ")}. Download the file to see it all.`;
}

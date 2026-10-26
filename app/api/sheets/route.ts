import type { NextRequest } from "next/server";
import { heldSheets, SHEETS_HEADERS } from "@/lib/spreadsheets/sheets";

/*
 * POST /api/sheets: Preview's table of an Excel or CSV file sent with the
 * request (form data `file`, up to 4 MB), as JSON: New Inspection's Source
 * Documents, which store nothing before Create (lib/spreadsheets/sheets.ts;
 * Kenneth, 26 October 2026). The same answers as a stored file's sheets
 * (app/api/inspections/[id]/files/[fileId]/sheets), and 400 without a file.
 */
export async function POST(request: NextRequest) {
  const answer = await heldSheets(request);
  return Response.json(answer.body, { status: answer.status, headers: SHEETS_HEADERS });
}

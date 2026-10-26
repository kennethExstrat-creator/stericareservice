import type { NextRequest } from "next/server";
import { SHEETS_HEADERS, storedSheets } from "@/lib/spreadsheets/sheets";

/*
 * GET /api/inspections/[id]/files/[fileId]/sheets: Preview's table of one of
 * an inspection's Excel or CSV files, as JSON (lib/spreadsheets/sheets.ts;
 * Kenneth, 26 October 2026).
 *
 *   200  the sheets
 *   401  not signed in
 *   403  signed in, but the account is not active
 *   404  no such file, or not one this account may read (the two look the same)
 *   413  larger than 10 MB
 *   415  not an Excel or CSV file
 *   422  a spreadsheet that cannot be opened (password-protected) or holds nothing
 *   503  Supabase not configured, or the database or storage did not answer
 *
 * Every answer has a message for the screen when it holds no sheets.
 */
export async function GET(_request: NextRequest, context: RouteContext<"/api/inspections/[id]/files/[fileId]/sheets">) {
  const { id, fileId } = await context.params;
  const answer = await storedSheets(id, fileId);
  return Response.json(answer.body, { status: answer.status, headers: SHEETS_HEADERS });
}

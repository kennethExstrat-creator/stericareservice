import "server-only";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { FILE_BUCKET } from "@/lib/photos/paths";
import { isZip, sniffSpreadsheet, zipEntries } from "@/lib/photos/sniff";
import { DOCUMENT_MAX_BYTES } from "@/lib/schemas/document-fill";
import { createClient } from "@/lib/supabase/server";
import type { SpreadsheetPreviewResult } from "./preview";
import { MAX_SPREADSHEET_BYTES, spreadsheetPreview } from "./read";

/*
 * The Route Handlers behind Preview of an Excel or CSV Source Document
 * (Kenneth, 26 October 2026): app/api/inspections/[id]/files/[fileId]/sheets
 * for a stored file, app/api/sheets for one New Inspection holds before
 * Create. Route Handlers, not Server Actions: Next.js runs a page's Server
 * Actions one at a time, so a preview would wait for Steri-AI's reading of
 * another file. proxy.ts lets /api through, so each checks the session
 * itself (lib/auth), and a stored file is read through the caller's own
 * client: Row Level Security and the bucket's policies decide which files
 * they see (whoever can read the inspection). The bytes decide what a file
 * is, as for Steri-AI.
 */

/** Preview's answer with its HTTP status: a failure carries a message for the screen too. */
export type SheetsAnswer = { status: number; body: SpreadsheetPreviewResult };

export const SHEETS_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

const IdSchema = z.uuid();
const NOT_AVAILABLE = "That file is not available.";
const FAILED = "The spreadsheet could not be shown. Try again, or download it.";
/** Room for the form's own parts around a held file. */
const FORM_OVERHEAD = 64 * 1024;

const fail = (status: number, message: string): SheetsAnswer => ({ status, body: { status: "error", message } });

/** Null for a signed-in, active caller; else why not. */
async function refusal(): Promise<SheetsAnswer | null> {
  const session = await getSession();
  switch (session.status) {
    case "unconfigured":
      return fail(503, "Supabase is not configured yet.");
    case "signed-out":
      return fail(401, "Your session has ended. Sign in again.");
    case "deactivated":
      return fail(403, "This account has been deactivated.");
    case "active":
      return null;
  }
}

function preview(bytes: Uint8Array, name: string, declared?: string): SheetsAnswer {
  const type = sniffSpreadsheet(bytes, declared, name, isZip(bytes) ? zipEntries(bytes) : null);
  if (!type) return fail(415, "This file is not an Excel or CSV file the app can show. Download it to open it.");
  const body = spreadsheetPreview(bytes, type);
  return { status: body.status === "ready" ? 200 : 422, body };
}

/** The sheets of one of an inspection's files, from storage: a CSV by its object name, which ends in .csv once uploaded as one. */
export async function storedSheets(inspectionId: string, fileId: string): Promise<SheetsAnswer> {
  try {
    const refused = await refusal();
    if (refused) return refused;
    if (!IdSchema.safeParse(inspectionId).success || !IdSchema.safeParse(fileId).success) return fail(404, NOT_AVAILABLE);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("inspection_files")
      .select("storage_path")
      .eq("id", fileId)
      .eq("inspection_id", inspectionId)
      .maybeSingle();
    if (error) {
      console.error("[sheets] reading the file failed", error.code, error.message);
      return fail(503, FAILED);
    }
    if (!data) return fail(404, NOT_AVAILABLE);
    const download = await supabase.storage.from(FILE_BUCKET).download(data.storage_path);
    if (download.error || !download.data) {
      console.error("[sheets] downloading the file failed", download.error?.message);
      return fail(503, FAILED);
    }
    if (download.data.size > MAX_SPREADSHEET_BYTES) {
      return fail(413, "The spreadsheet is larger than 10 MB, too large to show here. Download it to open it.");
    }
    return preview(new Uint8Array(await download.data.arrayBuffer()), data.storage_path);
  } catch (error) {
    console.error("[sheets] a stored spreadsheet could not be shown", error);
    return fail(503, FAILED);
  }
}

/**
 * The sheets of a file sent with the request (`file` in its form data, up to
 * 4 MB, a request's limit), as readDocument takes it: New Inspection stores
 * nothing before Create.
 */
export async function heldSheets(request: Request): Promise<SheetsAnswer> {
  try {
    const refused = await refusal();
    if (refused) return refused;
    const tooLarge = fail(413, "The file is larger than 4 MB: it can be shown once the inspection is created.");
    if (Number(request.headers.get("content-length") ?? 0) > DOCUMENT_MAX_BYTES + FORM_OVERHEAD) return tooLarge;
    const file = (await request.formData().catch(() => null))?.get("file");
    if (!(file instanceof File) || file.size === 0) return fail(400, "Choose a file to show.");
    if (file.size > DOCUMENT_MAX_BYTES) return tooLarge;
    return preview(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
  } catch (error) {
    console.error("[sheets] a held spreadsheet could not be shown", error);
    return fail(503, FAILED);
  }
}

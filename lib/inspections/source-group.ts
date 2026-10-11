// Where an inspection's Source Documents are, and how far the AI has read
// them (docs/AI.md, "Source Documents"; PO parts in lib/inspections/parts.ts).
// One set of files for the whole inspection, kept on its first part: every
// part shows and uploads to it, and each file is read once for all of them.
// A part whose first part this user cannot read keeps files of its own.
//
// Reads through whichever client the caller holds, so Row Level Security
// decides what comes back: the capture screen uses the browser's, as the
// media store does, so these reads never wait behind a Server Action (the
// client sends those one at a time, and a reading takes a minute or two).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { groupIdOf, type InspectionPart } from "./parts";
import { SOURCE_DOCUMENTS_KEY, type SourceFileStatus } from "./source-documents";

type Client = SupabaseClient<Database>;

export type SourceGroup = {
  /** Where the Source Documents are kept: the first part, or this part when that one cannot be read. */
  homeId: string;
  /** The parts this user can read, first part first; empty when they could not be read. */
  parts: InspectionPart[];
};

/** Where the Source Documents are kept: the first part, or this part when that one cannot be read. */
export function sourceHomeOf(parts: readonly InspectionPart[] | null, inspectionId: string): string {
  return parts?.find((part) => part.primary)?.id ?? inspectionId;
}

/** The inspections whose Source Documents a part shows: its first part's, and its own when it kept some. */
export function sourceHomes(homeId: string, inspectionId: string): string[] {
  return homeId === inspectionId ? [inspectionId] : [homeId, inspectionId];
}

/**
 * The inspection's parts and where its Source Documents are; null when this
 * user cannot read the inspection. Throws when the reads fail (offline).
 */
export async function loadSourceGroup(client: Client, inspectionId: string): Promise<SourceGroup | null> {
  const own = await client.from("inspections").select("id, group_id").eq("id", inspectionId).maybeSingle();
  if (own.error) throw new Error(`The inspection could not be read: ${own.error.message}`);
  if (!own.data) return null;
  const group = groupIdOf(own.data);
  const { data, error } = await client
    .from("inspections")
    .select("id, ref_no, po_no, product_name, status, group_id, created_at")
    .or(`id.eq.${group},group_id.eq.${group}`)
    .order("created_at")
    .order("id");
  if (error) throw new Error(`The inspection's parts could not be read: ${error.message}`);
  const parts = data.map((row) => ({
    id: row.id,
    refNo: row.ref_no,
    poNo: row.po_no,
    productName: row.product_name,
    status: row.status,
    primary: row.group_id === null,
  }));
  return { homeId: sourceHomeOf(parts, inspectionId), parts };
}

/**
 * How long a reading holds its file (source-parts-server.ts claimFile):
 * longer than any reading can take, the page allowing 800 s. An older claim
 * was left by a reading that never finished.
 */
export const CLAIM_MS = 15 * 60 * 1000;

type ReadingRow = { ai_status: string | null; ai_read_at: string | null; ai_summary: string | null };

/**
 * A file's reading as stored: read or failed, or being read (a reading has
 * claimed it: ai_read_at without a status yet, within CLAIM_MS of `now`).
 * Null while it is not read yet.
 */
export function storedReading(row: ReadingRow, now: number = Date.now()): SourceFileStatus | null {
  if (row.ai_status === "read" || row.ai_status === "failed") return { status: row.ai_status, summary: row.ai_summary };
  if (row.ai_read_at !== null && now - Date.parse(row.ai_read_at) < CLAIM_MS) return { status: "reading", summary: null, elsewhere: true };
  return null;
}

/** Each Source Document's reading so far, by file id; null when they could not be read. */
export async function loadSourceReadings(
  client: Client,
  homes: readonly string[],
): Promise<Record<string, SourceFileStatus> | null> {
  const { data, error } = await client
    .from("inspection_files")
    .select("id, ai_status, ai_read_at, ai_summary")
    .in("inspection_id", [...homes])
    .eq("module_key", SOURCE_DOCUMENTS_KEY);
  if (error) return null;
  const readings: Record<string, SourceFileStatus> = {};
  const now = Date.now();
  for (const row of data) {
    const reading = storedReading(row, now);
    if (reading) readings[row.id] = reading;
  }
  return readings;
}

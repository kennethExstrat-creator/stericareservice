import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesUpdate } from "@/lib/supabase/database.types";
import { FAILURE_MESSAGES, postgrestFailure } from "./failures";
import type { AutosaveTransport, SaveOutcome, SaveRequest } from "./protocol";

/* ------------------------------------------------------------------ *
 * The compare-and-set save on public.inspections. Works with the server
 * client inside a Server Action (after the action has checked the session
 * and validated the data) or with the browser client; RLS and the
 * database guards apply either way (docs/OFFLINE.md, "The transport").
 * ------------------------------------------------------------------ */

/** Columns that mirror parts of the data for lists and search. Status, template and audit columns are not among them. */
export type MirroredColumns = Pick<
  TablesUpdate<"inspections">,
  | "po_no"
  | "product_name"
  | "lot_numbers"
  | "inspection_date"
  | "client_id"
  | "manufacturer_id"
  | "remarks"
  | "result"
  | "suggested_result"
>;

export interface SaveInspectionOptions<T> {
  /** Computes the mirrored columns written together with the data. */
  columns?: (data: T) => MirroredColumns;
}

const EDITABLE: ReadonlySet<string> = new Set(["draft", "reopened"]);

type SaveInput<T> = Omit<SaveRequest<T>, "signal"> & { signal?: AbortSignal };

/**
 * Writes `data` only while updated_at still equals baseUpdatedAt. When no
 * row matches, reads the row to tell a conflict (someone saved in between)
 * from an inspection this user may no longer edit.
 */
export async function saveInspectionData<T>(
  client: SupabaseClient<Database>,
  { inspectionId, data, baseUpdatedAt, signal }: SaveInput<T>,
  options: SaveInspectionOptions<T> = {},
): Promise<SaveOutcome<T>> {
  const update = client
    .from("inspections")
    .update({ ...options.columns?.(data), data: data as NonNullable<Json> })
    .eq("id", inspectionId)
    .eq("updated_at", baseUpdatedAt)
    .select("updated_at");
  const written = await (signal ? update.abortSignal(signal) : update).maybeSingle();
  if (written.error) return { ok: false, ...postgrestFailure(written.error, written.status) };
  if (written.data) return { ok: true, updatedAt: written.data.updated_at };

  const read = client.from("inspections").select("data, updated_at, status").eq("id", inspectionId);
  const current = await (signal ? read.abortSignal(signal) : read).maybeSingle();
  if (current.error) return { ok: false, ...postgrestFailure(current.error, current.status) };
  if (!current.data) return { ok: false, reason: "not_found", message: FAILURE_MESSAGES.not_found };
  if (!EDITABLE.has(current.data.status)) {
    return { ok: false, reason: "forbidden", message: "The inspection has been submitted and can no longer be changed." };
  }
  // Same version, yet nothing was written: row level security kept this user out.
  if (current.data.updated_at === baseUpdatedAt) {
    return { ok: false, reason: "forbidden", message: FAILURE_MESSAGES.forbidden };
  }
  return { ok: false, reason: "conflict", server: { data: current.data.data as T, updatedAt: current.data.updated_at } };
}

/** The transport for the browser client. A Server Action calls saveInspectionData itself. */
export function supabaseAutosaveTransport<T>(
  client: SupabaseClient<Database>,
  options: SaveInspectionOptions<T> = {},
): AutosaveTransport<T> {
  return { save: (request) => saveInspectionData(client, request, options) };
}

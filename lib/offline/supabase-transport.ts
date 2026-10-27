import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesUpdate } from "@/lib/supabase/database.types";
import { FAILURE_MESSAGES, postgrestFailure } from "./failures";
import type { AutosaveTransport, SaveOutcome, SaveRequest } from "./protocol";

/* ------------------------------------------------------------------ *
 * The compare-and-set save on public.inspections (docs/OFFLINE.md, "The
 * transport"). Inside a Server Action, after the action has checked the
 * session and validated the data, it writes with the secret key through
 * public.save_inspection() for the signed-in user (`writer`): the database
 * refuses an inspector's own update (migration 20261007190000). Without a
 * writer it updates with `client`, which only an admin's session may do
 * (and anyone's, on a project that has not run that migration).
 * ------------------------------------------------------------------ */

/**
 * Columns that mirror parts of the data for lists and search: the ones
 * public.save_inspection() and submit_inspection() accept. The client, the
 * manufacturer, the status, the template and the audit columns are not
 * among them.
 */
export type MirroredColumns = Pick<
  TablesUpdate<"inspections">,
  "po_no" | "product_name" | "lot_numbers" | "inspection_date" | "remarks" | "result" | "suggested_result"
>;

export interface SaveInspectionOptions<T> {
  /** Computes the mirrored columns written together with the data. */
  columns?: (data: T) => MirroredColumns;
  /**
   * Writes through public.save_inspection() with this secret-key client,
   * for the user `actorId`. `client` still reads the row when nothing was
   * written, so the user is told only what their own session may see. On a
   * project that has not run the migration (PGRST202) the save falls back
   * to an update with `client`.
   */
  writer?: { admin: SupabaseClient<Database>; actorId: string } | null;
  /**
   * Audit rows written with the data, in the same transaction, through
   * public.save_inspection_with_events() (migration 20261026130000): a
   * Dimension P/F set by hand, a Sampling Plan code letter changed
   * (code_letter_changed, migration 20261027120000). Worked out by the
   * server action; needs a `writer`. On a project that has not run the
   * migration, or whose function does not take an event's action yet
   * (refusedEventAction), the data is saved as before and the rows are
   * recorded right after it.
   */
  events?: readonly { action: string; changes: Json }[];
}

/** How save_inspection_with_events() starts the refusal of an event it does not take. */
const REFUSED_ACTION = "a save records only ";

/**
 * save_inspection_with_events() refusing an event for its action (22023, "a
 * save records only …"): code_letter_changed on a project that has not run
 * migration 20261027120000. It wrote nothing, so the save goes on as on a
 * project without the function. Its other refusals stand: more than 200
 * events, or changes over 8 kB.
 */
export function refusedEventAction(error: { code?: string; message: string } | null | undefined): boolean {
  return error?.code === "22023" && error.message.startsWith(REFUSED_ACTION);
}

const EDITABLE: ReadonlySet<string> = new Set(["draft", "reopened"]);

type SaveInput<T> = Omit<SaveRequest<T>, "signal"> & { signal?: AbortSignal };

/** What the write answered: the new version, or none when nothing was written. */
type Written = { error: { code?: string; message: string } | null; status: number; updatedAt: string | null };

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
  const columns = options.columns?.(data);
  let written: Written | null = null;
  if (options.writer) {
    const { admin, actorId } = options.writer;
    const events = options.events ?? [];
    const args = {
      inspection_id: inspectionId,
      actor_id: actorId,
      base_updated_at: baseUpdatedAt,
      data: data as NonNullable<Json>,
      mirrored_columns: (columns ?? {}) as Json,
    };
    const plainSave = async () => {
      const call = admin.rpc("save_inspection", args);
      return await (signal ? call.abortSignal(signal) : call);
    };
    let saved: Awaited<ReturnType<typeof plainSave>>;
    if (events.length > 0) {
      const call = admin.rpc("save_inspection_with_events", { ...args, events: events as unknown as Json });
      saved = await (signal ? call.abortSignal(signal) : call);
      // A project that has not run migration 20261026130000, or not 20261027120000 for code_letter_changed:
      // the data as before, then its rows on their own.
      if (saved.error?.code === "PGRST202" || refusedEventAction(saved.error)) {
        saved = await plainSave();
        if (!saved.error && saved.data) await recordEventsApart(admin, inspectionId, actorId, events);
      }
    } else {
      saved = await plainSave();
    }
    if (saved.error?.code !== "PGRST202") {
      written = { error: saved.error, status: saved.status, updatedAt: saved.data ?? null };
    }
  }
  if (!written) {
    const update = client
      .from("inspections")
      .update({ ...columns, data: data as NonNullable<Json> })
      .eq("id", inspectionId)
      .eq("updated_at", baseUpdatedAt)
      .select("updated_at");
    const updated = await (signal ? update.abortSignal(signal) : update).maybeSingle();
    written = { error: updated.error, status: updated.status, updatedAt: updated.data?.updated_at ?? null };
  }
  if (written.error) return { ok: false, ...postgrestFailure(written.error, written.status) };
  if (written.updatedAt) return { ok: true, updatedAt: written.updatedAt };

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

/**
 * Audit rows recorded after their save, where the database cannot take them
 * with it yet: in the user's name in `changes.by`, since a row the service
 * role writes has no actor.
 */
async function recordEventsApart(
  admin: SupabaseClient<Database>,
  inspectionId: string,
  actorId: string,
  events: readonly { action: string; changes: Json }[],
): Promise<void> {
  for (const event of events) {
    const changes = typeof event.changes === "object" && event.changes !== null && !Array.isArray(event.changes) ? event.changes : {};
    const { error } = await admin.rpc("log_inspection_event", {
      inspection_id: inspectionId,
      action: event.action,
      changes: { ...changes, by: actorId },
    });
    if (error) console.error(`[autosave] could not record ${event.action}`, error.code, error.message);
  }
}

/**
 * The transport for the browser client: an admin's session only, since the
 * database refuses an inspector's own update. A Server Action calls
 * saveInspectionData itself, with the secret-key writer.
 */
export function supabaseAutosaveTransport<T>(
  client: SupabaseClient<Database>,
  options: SaveInspectionOptions<T> = {},
): AutosaveTransport<T> {
  return { save: (request) => saveInspectionData(client, request, options) };
}

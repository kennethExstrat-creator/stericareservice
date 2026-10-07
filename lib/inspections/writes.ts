import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MirroredColumns } from "@/lib/offline/supabase-transport";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";

/*
 * Writing an inspector's inspection (final audit SEC-02 and M3; migration
 * 20261007190000). The database refuses an inspector's own insert or update
 * through the Data API: the app's checks (zod, the capture rules, "errors
 * block submit") run only in its Server Actions, so only they write. Once a
 * Server Action has checked the session and the input, it writes with the
 * secret key through public.create_inspection(), save_inspection()
 * (lib/offline/supabase-transport.ts) or submit_inspection(), for the
 * signed-in user: the functions check the user again (active; the
 * inspection's inspector or an admin; a draft or reopened) and the audit
 * trail names them.
 *
 * Two cases write with the user's own session instead, as before the
 * migration: a project that has not run it yet (PostgREST does not know the
 * function: PGRST202), and a server without the secret key. Admins may
 * always write directly; an inspector's direct write is refused once the
 * migration has run.
 */

type Client = SupabaseClient<Database>;

/** A database error as PostgREST reports it. */
export type WriteError = { code?: string; message: string };

/** Who the secret-key client writes for. */
export type ServerWriter = { admin: Client; actorId: string };

/** The secret-key writer for the signed-in user, or null on a server without the key. */
export function serverWriter(actorId: string): ServerWriter | null {
  return isAdminClientConfigured() ? { admin: createAdminClient(), actorId } : null;
}

/** PostgREST knows no such function: the project has not run the migration yet. */
export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202";
}

export type NewInspectionRow = {
  templateId: string;
  clientId: string | null;
  manufacturerId: string;
  data: Json;
  /** The columns that repeat the data, inspection_date included (lib/inspections/capture/mirror.ts). */
  columns: MirroredColumns;
};

/** Starts the user's draft. Answers its id, or the database's refusal. */
export async function createInspectionRow(
  client: Client,
  writer: ServerWriter | null,
  row: NewInspectionRow,
): Promise<{ id: string } | { error: WriteError }> {
  if (writer) {
    const { data, error } = await writer.admin.rpc("create_inspection", {
      actor_id: writer.actorId,
      template_id: row.templateId,
      manufacturer_id: row.manufacturerId,
      ...(row.clientId ? { client_id: row.clientId } : {}),
      data: row.data,
      mirrored_columns: row.columns as Json,
    });
    if (!isMissingFunction(error)) {
      if (error) return { error };
      return data ? { id: data } : { error: { message: "create_inspection() answered no id" } };
    }
  }
  const inserted = await client
    .from("inspections")
    .insert({
      ...row.columns,
      template_id: row.templateId,
      client_id: row.clientId,
      manufacturer_id: row.manufacturerId,
      data: row.data as NonNullable<Json>,
    })
    .select("id")
    .single();
  return inserted.error ? { error: inserted.error } : { id: inserted.data.id };
}

export type SubmitRow = {
  inspectionId: string;
  /** The version the Server Action validated: the submit is a compare-and-set on it. */
  baseUpdatedAt: string;
  columns: MirroredColumns;
};

/**
 * Moves a draft or reopened inspection to submitted, with the mirrored
 * columns written again from the validated data. `submitted` is false when
 * nothing was written: the inspection changed after it was validated, or is
 * gone.
 */
export async function submitInspectionRow(
  client: Client,
  writer: ServerWriter | null,
  row: SubmitRow,
): Promise<{ submitted: boolean } | { error: WriteError }> {
  if (writer) {
    const { data, error } = await writer.admin.rpc("submit_inspection", {
      inspection_id: row.inspectionId,
      actor_id: writer.actorId,
      base_updated_at: row.baseUpdatedAt,
      mirrored_columns: row.columns as Json,
    });
    if (!isMissingFunction(error)) return error ? { error } : { submitted: data !== null };
  }
  const { data, error } = await client
    .from("inspections")
    .update({ ...row.columns, status: "submitted" })
    .eq("id", row.inspectionId)
    .eq("updated_at", row.baseUpdatedAt)
    .select("id");
  return error ? { error } : { submitted: (data?.length ?? 0) > 0 };
}

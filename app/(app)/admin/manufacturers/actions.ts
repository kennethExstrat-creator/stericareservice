"use server";

import { refresh } from "next/cache";
import {
  EditTargetSchema,
  MANUFACTURER_FIELDS,
  MESSAGES,
  ManufacturerInputSchema,
  RecordTargetSchema,
  deleteBlocker,
  describeDeleteError,
  describeSaveError,
  failed,
  fieldErrors,
  guarded,
  manufacturerLabel,
  readForm,
  readManufacturer,
  readManufacturerSnapshot,
  succeeded,
  type ActionResult,
  type DatabaseClient,
  type ManufacturerField,
  type ManufacturerInput,
} from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Manufacturer actions for /admin/manufacturers (BUILD_SPEC 3 and 10).
 * Server Actions are public HTTP endpoints: each one checks for an active
 * admin, validates its input with zod and re-reads what it needs. Writes go
 * through the admin's own client, so Row Level Security checks them again,
 * and the database's foreign keys stop a delete that the usage check missed.
 */

export type SaveManufacturerResult = ActionResult<ManufacturerField>;

/** Adds a manufacturer (no id) or saves changes to one (id and the version the form started from). */
export async function saveManufacturer(
  _previous: SaveManufacturerResult,
  formData: FormData,
): Promise<SaveManufacturerResult> {
  return guarded("saveManufacturer", async (): Promise<SaveManufacturerResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = EditTargetSchema.safeParse(readForm(formData, ["id", "version"]));
    if (!target.success) return failed(MESSAGES.stale);
    const input = ManufacturerInputSchema.safeParse(readForm(formData, MANUFACTURER_FIELDS));
    if (!input.success) return failed(MESSAGES.checkFields, fieldErrors(input.error));

    const supabase = await createClient();
    const { id, version } = target.data;

    if (!id) {
      const { data, error } = await supabase.from("manufacturers").insert(input.data).select("id").single();
      if (error) return saveFailed(error);
      refresh();
      return succeeded(`${labelOf(input.data)} added.`, { id: data.id });
    }

    // Only the version the form was opened on: a newer save by someone else matches nothing.
    const { data, error } = await supabase
      .from("manufacturers")
      .update(input.data)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return saveFailed(error);
    if (!data) return notSaved(supabase, id);
    refresh();
    return succeeded(`${labelOf(input.data)} saved.`, { id: data.id });
  });
}

const labelOf = (input: ManufacturerInput) => manufacturerLabel({ name: input.name, factoryName: input.factory_name });

function saveFailed(error: { code?: string; message?: string }): SaveManufacturerResult {
  const { message, field } = describeSaveError("manufacturer", error);
  if (!field) console.error("[admin/manufacturers] save refused", error.code, error.message);
  return field ? failed<ManufacturerField>(message, { [field]: message }) : failed(message);
}

/**
 * The update matched nothing: someone else saved first, or deleted the
 * manufacturer. With their version (`latest`), the panel's next save
 * replaces it, as the message offers.
 */
async function notSaved(supabase: DatabaseClient, id: string): Promise<SaveManufacturerResult> {
  const latest = await readManufacturerSnapshot(supabase, id);
  refresh();
  if (!latest) return failed("This manufacturer has been deleted, so your changes were not saved.");
  return {
    ...failed(
      "Someone else changed this manufacturer while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
    ),
    latest,
  };
}

/** Deletes a manufacturer that no template or inspection uses. */
export async function deleteManufacturer(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deleteManufacturer", async (): Promise<ActionResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const current = await readManufacturer(supabase, target.data.id);
    if (!current) {
      refresh();
      return succeeded("This manufacturer was already deleted.");
    }
    const blocker = deleteBlocker(current.usage);
    if (blocker) {
      // The page showed it as unused: show the counts as they are now.
      refresh();
      return failed(blocker);
    }

    const { data, error } = await supabase.from("manufacturers").delete().eq("id", current.id).select("id");
    if (error) {
      console.error("[admin/manufacturers] delete refused", error.code, error.message);
      refresh();
      return failed(describeDeleteError("manufacturer", error));
    }
    if (data.length === 0) return failed(`${manufacturerLabel(current)} could not be deleted. Reload the page and try again.`);

    refresh();
    return succeeded(`${manufacturerLabel(current)} deleted.`);
  });
}

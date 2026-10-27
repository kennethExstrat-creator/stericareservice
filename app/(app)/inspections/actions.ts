"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { authorizeAction } from "@/lib/auth/session";
import {
  DELETE_MESSAGES,
  DeleteInspectionInputSchema,
  deleteDraftInspection,
  deleteFailureMessage,
  removeInspectionObjects,
  type DeletedInspection,
} from "@/lib/inspections/delete";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Server Actions of the inspections list. A Server Action is a public HTTP
 * endpoint: it checks the session first (authorizeAction), validates its
 * input with zod and asks the database, which decides again who may do
 * what (lib/inspections/delete.ts).
 */

export type DeleteInspectionResult = { status: "deleted" } | { status: "error"; message: string };

/**
 * Deletes a draft with its photos and files (the list's Delete), for a role
 * that allows Delete Drafts. The database function checks the caller and
 * deletes the rows as one; the Storage objects go afterwards. On success,
 * and when the row turned out to be gone or no longer a draft, the list
 * re-renders in the same answer.
 */
export async function deleteInspection(input: unknown): Promise<DeleteInspectionResult> {
  try {
    const auth = await authorizeAction({ permission: "delete_drafts" });
    if (!auth.ok) return { status: "error", message: auth.error };

    const parsed = DeleteInspectionInputSchema.safeParse(input);
    if (!parsed.success) return { status: "error", message: DELETE_MESSAGES.invalid };

    const supabase = await createClient();
    const outcome = await deleteDraftInspection(supabase, parsed.data.inspectionId);
    if (outcome.kind === "deleted") {
      await removeObjects(outcome.inspection);
      refresh();
      return { status: "deleted" };
    }
    // The list is out of date: show what is there now, behind the message.
    if (outcome.kind === "gone" || outcome.kind === "not_draft") refresh();
    return { status: "error", message: deleteFailureMessage(outcome) };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[inspections] deleteInspection failed", error);
    return { status: "error", message: DELETE_MESSAGES.failed };
  }
}

/**
 * The deleted inspection's objects in Storage. Its folders are out of every
 * user's reach now (the storage policies follow the inspection, which is
 * gone), so this runs with the secret-key client, after the database has
 * confirmed that this caller deleted this inspection. A failure here is
 * logged, not reported: the inspection is deleted, and what is left can be
 * reached by no one (its id is never used again).
 */
async function removeObjects(deleted: DeletedInspection): Promise<void> {
  const context = { inspectionId: deleted.inspectionId, refNo: deleted.refNo };
  if (!isAdminClientConfigured()) {
    console.error("[inspections] Storage objects of a deleted inspection left: no secret key", context);
    return;
  }
  try {
    const { problems } = await removeInspectionObjects(createAdminClient().storage, deleted);
    if (problems.length > 0) console.error("[inspections] Storage objects of a deleted inspection left", { ...context, problems });
  } catch (error) {
    console.error("[inspections] Storage objects of a deleted inspection left", { ...context, error });
  }
}

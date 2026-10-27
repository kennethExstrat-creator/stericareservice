import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { userCan, type SessionUser } from "@/lib/auth/session";
import { FILE_BUCKET, PHOTO_BUCKET, storageInspectionId, type MediaBucket } from "@/lib/photos/paths";
import type { InspectionStatus } from "@/lib/schemas/common";
import type { Database } from "@/lib/supabase/database.types";

/*
 * Deleting an inspection from the list (Kenneth, 7 October 2026). The
 * database decides: public.delete_draft_inspection() (migration
 * 20261007151500) checks the caller, deletes the row with its photos, files
 * and AI reviews, records the deletion and names the Storage objects the
 * rows pointed at. This module calls it, and removes those objects (and
 * anything else left in the inspection's folders) once the row is gone, so
 * no row ever points at a removed file.
 */

type Client = SupabaseClient<Database>;

/* ------------------------------------------------------------------ *
 * The rule
 * ------------------------------------------------------------------ */

export type DeletableInspection = { status: InspectionStatus; inspectorId: string };
/** The session's user; `grant` absent (test doubles) is the built-in role for `role` and `isLead`. */
export type InspectionDeleter = Pick<SessionUser, "id" | "role" | "isLead" | "grant">;

/**
 * Who may delete an inspection: a draft (never submitted: the status flow
 * never goes back to draft), by its own inspector or an admin, when their
 * role allows Delete Drafts. "An admin" is what they see (every inspection,
 * profiles.role), the switch is what their role lets them do. Submitted,
 * reopened and approved inspections are records and stay. The user is
 * active by the time anything asks (requireUser, authorizeAction).
 *
 * The app's one statement of the rule; the list offers Delete only where it
 * holds. public.delete_draft_inspection() and the inspections' role guard
 * (migration 20261027150000) enforce the same rule for every request, so a
 * change to who may delete changes both.
 */
export function canDeleteInspection(inspection: DeletableInspection, user: InspectionDeleter): boolean {
  if (inspection.status !== "draft" || !userCan(user, "delete_drafts")) return false;
  return user.role === "admin" || inspection.inspectorId === user.id;
}

/* ------------------------------------------------------------------ *
 * The deletion
 * ------------------------------------------------------------------ */

/** What the Delete action sends: the inspection's id, nothing else. */
export const DeleteInspectionInputSchema = z.object({ inspectionId: z.uuid() });

/** The function's answer for a deleted draft. */
const DeletedRowSchema = z.object({
  inspection_id: z.uuid(),
  ref_no: z.string().min(1),
  photo_paths: z.array(z.string()),
  file_paths: z.array(z.string()),
});

export type DeletedInspection = {
  /** Lowercase, as Postgres writes it: the folder name in Storage. */
  inspectionId: string;
  refNo: string | null;
  /** Object names in inspection-photos (photos and thumbnails) and inspection-files. */
  photoPaths: string[];
  filePaths: string[];
};

export type DeleteOutcome =
  | { kind: "deleted"; inspection: DeletedInspection }
  /** No such inspection, or not one the caller may see (it reads as missing). */
  | { kind: "gone" }
  /** Submitted, reopened or approved: only a draft that was never submitted goes. */
  | { kind: "not_draft" }
  /** Not signed in or not active. */
  | { kind: "not_allowed" }
  /** The caller's role does not allow Delete Drafts (the inspections' role guard, migration 20261027150000). */
  | { kind: "role_refused" }
  /** The database does not have the function yet (migration 20261007151500 not applied). */
  | { kind: "unavailable" }
  | { kind: "failed"; reason: "network" | "server" };

/** PostgREST's answer when a function is not in its schema cache. */
const FUNCTION_NOT_FOUND = "PGRST202";

function refusal(error: { code?: string; message: string }, status: number): DeleteOutcome {
  if (error.code === FUNCTION_NOT_FOUND) return { kind: "unavailable" };
  if (error.code === "23514") return { kind: "not_draft" };
  if (error.code === "42501" && /your role cannot/i.test(error.message)) return { kind: "role_refused" };
  if (error.code === "42501" || status === 401 || status === 403) return { kind: "not_allowed" };
  return { kind: "failed", reason: status === 0 ? "network" : "server" };
}

/**
 * Deletes a draft through the database function, as the signed-in user (the
 * caller's client: the function checks who asks). Never throws for a refusal.
 */
export async function deleteDraftInspection(supabase: Client, inspectionId: string): Promise<DeleteOutcome> {
  const { data, error, status } = await supabase.rpc("delete_draft_inspection", { inspection_id: inspectionId });
  if (error) {
    if (!["23514", "42501"].includes(error.code ?? "")) {
      console.error("[inspections] delete refused", { inspectionId, code: error.code, status, message: error.message });
    }
    return refusal(error, status);
  }
  if (data === null) return { kind: "gone" };

  const parsed = DeletedRowSchema.safeParse(data);
  if (!parsed.success) {
    // The row is gone all the same: clear the folders the request named.
    console.error("[inspections] delete answered in an unexpected shape", { inspectionId, issues: parsed.error.issues });
    return {
      kind: "deleted",
      inspection: { inspectionId: inspectionId.toLowerCase(), refNo: null, photoPaths: [], filePaths: [] },
    };
  }
  return {
    kind: "deleted",
    inspection: {
      inspectionId: parsed.data.inspection_id,
      refNo: parsed.data.ref_no,
      photoPaths: parsed.data.photo_paths,
      filePaths: parsed.data.file_paths,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

type StorageAnswer<T> = Promise<{ data: T | null; error: { message: string } | null }>;

/** The part of supabase-js Storage this needs: list a folder, remove objects. */
export type ObjectStore = {
  from(bucket: string): {
    list(
      path: string,
      options: { limit: number; offset: number; sortBy: { column: string; order: string } },
    ): StorageAnswer<{ name: string; id: string | null }[]>;
    remove(paths: string[]): StorageAnswer<unknown>;
  };
};

const LIST_PAGE = 1000;
const REMOVE_BATCH = 100;
/** `<inspection_id>/thumbs/<photo>.jpg` is the deepest name (docs/DATABASE.md, "Storage"). */
const MAX_DEPTH = 3;

/** Every object under `folder`; Storage lists subfolders as entries without an id. */
async function listFolder(bucket: ReturnType<ObjectStore["from"]>, folder: string, depth = 1): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(folder, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error || !data) throw new Error(error?.message ?? "Storage did not answer");
    for (const entry of data) {
      const name = `${folder}/${entry.name}`;
      if (entry.id !== null) names.push(name);
      else if (depth < MAX_DEPTH) names.push(...(await listFolder(bucket, name, depth + 1)));
    }
    if (data.length < LIST_PAGE) return names;
  }
}

export type StorageProblem = { bucket: MediaBucket; step: "list" | "remove"; message: string; objects?: number };

export type StorageCleanup = { removed: number; problems: StorageProblem[] };

/**
 * Removes a deleted inspection's objects from inspection-photos and
 * inspection-files: the ones its rows named, and whatever else is in its
 * folder (an upload whose row never arrived). Only names inside the
 * inspection's own folder are touched. Call it after the row is gone, with
 * a client that may still reach the folder: the storage policies follow the
 * inspection, so once it is deleted no user may (the server's secret-key
 * client can). Reports problems instead of throwing: the deletion has
 * happened either way, and leftovers are out of everyone's reach.
 */
export async function removeInspectionObjects(store: ObjectStore, deleted: DeletedInspection): Promise<StorageCleanup> {
  const report: StorageCleanup = { removed: 0, problems: [] };
  const buckets: [MediaBucket, string[]][] = [
    [PHOTO_BUCKET, deleted.photoPaths],
    [FILE_BUCKET, deleted.filePaths],
  ];
  for (const [bucket, known] of buckets) {
    const api = store.from(bucket);
    const names = new Set(known);
    try {
      for (const name of await listFolder(api, deleted.inspectionId)) names.add(name);
    } catch (error) {
      // The objects the rows named still go.
      report.problems.push({ bucket, step: "list", message: error instanceof Error ? error.message : String(error) });
    }
    const inFolder = [...names].filter((name) => storageInspectionId(name) === deleted.inspectionId);
    for (let start = 0; start < inFolder.length; start += REMOVE_BATCH) {
      const batch = inFolder.slice(start, start + REMOVE_BATCH);
      try {
        const { error } = await api.remove(batch);
        if (error) throw new Error(error.message);
        report.removed += batch.length;
      } catch (error) {
        report.problems.push({
          bucket,
          step: "remove",
          objects: batch.length,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return report;
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

export const DELETE_MESSAGES = {
  invalid: "This inspection cannot be deleted from here. Reload the list and try again.",
  gone: "This inspection is no longer there: it may have been deleted already.",
  notDraft: "This inspection has been submitted, so it can no longer be deleted.",
  notAllowed: "You cannot delete this inspection.",
  roleRefused: "Your role does not allow deleting drafts. Ask an admin to check it.",
  unavailable: "Deleting inspections is not set up on the database yet. Tell an admin.",
  network: "The inspection was not deleted: the database could not be reached. Try again.",
  failed: "The inspection was not deleted. Try again in a moment.",
} as const;

/** The words for an outcome that is not a deletion. */
export function deleteFailureMessage(outcome: Exclude<DeleteOutcome, { kind: "deleted" }>): string {
  switch (outcome.kind) {
    case "gone":
      return DELETE_MESSAGES.gone;
    case "not_draft":
      return DELETE_MESSAGES.notDraft;
    case "not_allowed":
      return DELETE_MESSAGES.notAllowed;
    case "role_refused":
      return DELETE_MESSAGES.roleRefused;
    case "unavailable":
      return DELETE_MESSAGES.unavailable;
    case "failed":
      return outcome.reason === "network" ? DELETE_MESSAGES.network : DELETE_MESSAGES.failed;
  }
}

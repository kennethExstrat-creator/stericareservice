"use server";

import { unstable_rethrow } from "next/navigation";
import { authorizeAction } from "@/lib/auth/session";
import { postgrestFailure, type FailureReason } from "@/lib/offline/failures";
import { FILE_BUCKET, PHOTO_BUCKET } from "@/lib/photos/paths";
import { buildTarget } from "@/lib/photos/target";
import { createClient } from "@/lib/supabase/server";
import { PHOTO_MESSAGES, type PhotoActionState, type PhotoChange } from "./messages";
import {
  FileIdFormSchema,
  PhotoIdFormSchema,
  PhotoReportFormSchema,
  parseForm,
  parsePhotoTagForm,
  type FieldErrors,
  type PhotoTagField,
} from "./schemas";

/*
 * Changes to uploaded photos and files (BUILD_SPEC 8.1): retag and caption,
 * delete, and the admin's report choice. Server Actions are public HTTP
 * endpoints, so each one checks the session, validates its input with zod
 * and works through the signed-in user's client: Row Level Security and the
 * media guard (supabase/migrations) decide again whether the change is
 * allowed (the owner while draft or reopened, admins until approved, only
 * the report choice once approved). Uploads do not come through here: the
 * upload queue writes Storage and the rows from the device.
 *
 * Nothing is refreshed: the screens update their own copy from the answer,
 * so a capture screen mid-entry is never re-rendered from the server.
 */

const RETURNED = "id, module_key, target, caption, include_in_report";

type ReturnedRow = { id: string; module_key: string | null; target: string | null; caption: string | null; include_in_report: boolean };

const toChange = (row: ReturnedRow): PhotoChange => ({
  id: row.id,
  moduleKey: row.module_key,
  target: row.target,
  caption: row.caption,
  includeInReport: row.include_in_report,
});

const fail = (message: string, fieldErrors?: FieldErrors<PhotoTagField | "photoId" | "form">): PhotoActionState => ({
  status: "error",
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/** A database refusal in words. The rows are checked by RLS and guards, so a refusal is usually "not allowed now". */
function refusal(error: { code?: string; message: string }, status: number, gone: string): PhotoActionState {
  const reason: FailureReason = postgrestFailure(error, status).reason;
  const messages: Record<FailureReason, string> = {
    unauthorized: PHOTO_MESSAGES.signedOut,
    forbidden: PHOTO_MESSAGES.forbidden,
    not_found: gone,
    network: PHOTO_MESSAGES.noAnswer,
    server: PHOTO_MESSAGES.noAnswer,
    invalid: PHOTO_MESSAGES.refused,
    too_large: PHOTO_MESSAGES.refused,
  };
  console.error("[inspection photos] change refused", { code: error.code, status, message: error.message });
  return fail(messages[reason]);
}

/** Unexpected failures become a message on the screen instead of an error page. */
async function guarded(name: string, run: () => Promise<PhotoActionState>): Promise<PhotoActionState> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[inspection photos] ${name} failed`, error);
    return fail(PHOTO_MESSAGES.unexpected);
  }
}

/** Retags a photo and sets its caption: module, size, hand, defect, box. */
export async function updatePhotoTags(_previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> {
  return guarded("updatePhotoTags", async () => {
    const auth = await authorizeAction();
    if (!auth.ok) return fail(auth.error);

    const parsed = parsePhotoTagForm(formData);
    if (!parsed.ok) return fail(PHOTO_MESSAGES.checkFields, parsed.fieldErrors);
    const { photoId, moduleKey, target, caption } = parsed.data;

    const supabase = await createClient();
    const { data, error, status } = await supabase
      .from("inspection_photos")
      .update({ module_key: moduleKey, target: buildTarget(target), caption })
      .eq("id", photoId)
      .select(RETURNED)
      .maybeSingle();
    if (error) return refusal(error, status, PHOTO_MESSAGES.photoGone);
    // RLS hides a row this user may not change: no row back means gone, or not allowed now.
    if (!data) return fail(PHOTO_MESSAGES.photoGone);
    return { status: "success", message: PHOTO_MESSAGES.updated, photo: toChange(data) };
  });
}

/**
 * Deletes a photo: the row, then its objects (the full photo and the
 * thumbnail). The row goes first, so a photo is never shown without its
 * file; an object left behind when Storage fails is reachable by no one.
 */
export async function deletePhoto(_previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> {
  return guarded("deletePhoto", async () => {
    const auth = await authorizeAction();
    if (!auth.ok) return fail(auth.error);

    const parsed = parseForm(PhotoIdFormSchema, formData);
    if (!parsed.ok) return fail(parsed.message);
    const { photoId } = parsed.data;

    const supabase = await createClient();
    const { data, error, status } = await supabase
      .from("inspection_photos")
      .delete()
      .eq("id", photoId)
      .select("id, inspection_id, module_key, target, storage_path, thumb_path")
      .maybeSingle();
    if (error) return refusal(error, status, PHOTO_MESSAGES.photoGone);
    if (!data) return fail(PHOTO_MESSAGES.photoGone);

    const paths = [data.storage_path, data.thumb_path].filter((path): path is string => Boolean(path));
    const removed = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
    if (removed.error) console.error("[inspection photos] photo objects left in Storage", { paths, message: removed.error.message });

    await logEvent(supabase, data.inspection_id, "photo.deleted", {
      photo_id: data.id,
      module_key: data.module_key,
      target: data.target,
      storage_path: data.storage_path,
    });
    return { status: "success", message: PHOTO_MESSAGES.deleted, removedId: data.id };
  });
}

/**
 * Admins choose the photos that go into the report, also on an approved
 * inspection: part of approving, so the role's Approve and Reopen (which
 * needs every inspection in sight) decides.
 */
export async function setPhotoInReport(_previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> {
  return guarded("setPhotoInReport", async () => {
    const auth = await authorizeAction({ permission: "approve_inspections" });
    if (!auth.ok) return fail(auth.error);

    const parsed = parseForm(PhotoReportFormSchema, formData);
    if (!parsed.ok) return fail(parsed.message);
    const { photoId, include } = parsed.data;

    const supabase = await createClient();
    const { data, error, status } = await supabase
      .from("inspection_photos")
      .update({ include_in_report: include })
      .eq("id", photoId)
      .select(RETURNED)
      .maybeSingle();
    if (error) return refusal(error, status, PHOTO_MESSAGES.photoGone);
    if (!data) return fail(PHOTO_MESSAGES.photoGone);
    return {
      status: "success",
      message: data.include_in_report ? PHOTO_MESSAGES.inReport : PHOTO_MESSAGES.outOfReport,
      photo: toChange(data),
    };
  });
}

/** Deletes a lab report or certificate: the row, then its object. */
export async function deleteInspectionFile(_previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> {
  return guarded("deleteInspectionFile", async () => {
    const auth = await authorizeAction();
    if (!auth.ok) return fail(auth.error);

    const parsed = parseForm(FileIdFormSchema, formData);
    if (!parsed.ok) return fail(parsed.message);
    const { fileId } = parsed.data;

    const supabase = await createClient();
    const { data, error, status } = await supabase
      .from("inspection_files")
      .delete()
      .eq("id", fileId)
      .select("id, inspection_id, module_key, kind, name, storage_path")
      .maybeSingle();
    if (error) return refusal(error, status, PHOTO_MESSAGES.fileGone);
    if (!data) return fail(PHOTO_MESSAGES.fileGone);

    const removed = await supabase.storage.from(FILE_BUCKET).remove([data.storage_path]);
    if (removed.error) console.error("[inspection photos] file object left in Storage", { path: data.storage_path, message: removed.error.message });

    await logEvent(supabase, data.inspection_id, "file.deleted", {
      file_id: data.id,
      module_key: data.module_key,
      kind: data.kind,
      name: data.name,
      storage_path: data.storage_path,
    });
    return { status: "success", message: PHOTO_MESSAGES.fileDeleted, removedId: data.id };
  });
}

/**
 * Records a deletion in the inspection's audit trail (docs/DATABASE.md,
 * "Audit log"): evidence leaving an inspection should be traceable. The
 * deletion has happened either way, so a failed record is only logged.
 */
async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inspectionId: string,
  action: string,
  changes: Record<string, string | null>,
): Promise<void> {
  const { error } = await supabase.rpc("log_inspection_event", { inspection_id: inspectionId, action, changes });
  if (error) console.error(`[inspection photos] audit record ${action} failed`, { code: error.code, message: error.message });
}

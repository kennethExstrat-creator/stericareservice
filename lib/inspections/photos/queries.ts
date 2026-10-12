// Reads for the photos and files of one inspection (BUILD_SPEC 8.1). Always
// through the signed-in user's client, the server's (the gallery page) or
// the browser's (the capture screen's photo slot): Row Level Security
// decides what comes back, and Storage only signs objects the user may read.
// Nothing here imports server-only code, so both sides share it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_PATTERN } from "@/lib/offline/id";
import { FILE_BUCKET, PHOTO_BUCKET, type MediaBucket } from "@/lib/photos/paths";
import type { InspectionStatus } from "@/lib/schemas/common";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import type { Database } from "@/lib/supabase/database.types";
import { parseModuleOverrides } from "@/lib/templates/overrides";
import { InspectionDataSchema } from "@/modules/_framework/data";
import { isNoConnection } from "./messages";
import {
  FILE_COLUMNS,
  PHOTO_COLUMNS,
  photoObjectPaths,
  tagOptionsFromTemplate,
  toMediaFile,
  toMediaPhoto,
  type FileRow,
  type MediaAccess,
  type MediaFile,
  type MediaPhoto,
  type PhotoRow,
  type PhotoTagOptions,
} from "./view";

type Client = SupabaseClient<Database>;

/** Signed URLs last an hour; the screens sign again before they run out. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Paths per signing request, so a large inspection never sends one huge request. */
const SIGN_BATCH = 200;

export interface InspectionSummary {
  id: string;
  refNo: string;
  status: InspectionStatus;
  inspectorId: string;
}

export interface InspectionMedia {
  inspection: InspectionSummary;
  access: MediaAccess;
  /** Oldest first. */
  photos: MediaPhoto[];
  files: MediaFile[];
  options: PhotoTagOptions;
  /** When the URLs were signed (ms, the clock of whoever loaded them). */
  signedAt: number;
  /** What could not be loaded; the screens show it instead of failing. */
  problems: string[];
}

export type MediaLoad =
  | { kind: "ok"; media: InspectionMedia }
  /** No such inspection, or not one this user may read: the same answer (RLS). */
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export const MEDIA_MESSAGES = {
  loadFailed: "The photos could not be loaded. Check the connection and try again.",
  filesFailed: "The lab reports and certificates could not be loaded.",
  signFailed: "Some photos could not be shown. Reload the page to try again.",
  accessFailed: "Your rights on this inspection could not be checked, so photos are shown read-only.",
} as const;

type LoadOptions = { now?: () => number; ttlSeconds?: number };

/** Everything the gallery and the photo slots show for one inspection. */
export async function loadInspectionMedia(
  client: Client,
  inspectionId: string,
  { now = Date.now, ttlSeconds = SIGNED_URL_TTL_SECONDS }: LoadOptions = {},
): Promise<MediaLoad> {
  if (!UUID_PATTERN.test(inspectionId)) return { kind: "not_found" };

  const found = await client
    .from("inspections")
    .select("id, ref_no, status, inspector_id, module_overrides, data, template:templates(resolved)")
    .eq("id", inspectionId)
    .maybeSingle();
  if (found.error) {
    logFailure("inspection", found.error);
    return { kind: "error", message: MEDIA_MESSAGES.loadFailed };
  }
  if (!found.data) return { kind: "not_found" };
  const inspection = found.data;

  const [canEdit, isAdmin, photos, files, defects] = await Promise.all([
    client.rpc("can_edit_inspection", { inspection_id: inspectionId }),
    client.rpc("is_admin"),
    client.from("inspection_photos").select(PHOTO_COLUMNS).eq("inspection_id", inspectionId).order("created_at").order("id"),
    client.from("inspection_files").select(FILE_COLUMNS).eq("inspection_id", inspectionId).order("created_at").order("id"),
    client.from("defect_codes").select("code, name").eq("active", true).order("name"),
  ]);
  if (photos.error) {
    logFailure("photos", photos.error);
    return { kind: "error", message: MEDIA_MESSAGES.loadFailed };
  }

  const problems: string[] = [];
  if (canEdit.error || isAdmin.error) {
    logFailure("access", (canEdit.error ?? isAdmin.error)!);
    problems.push(MEDIA_MESSAGES.accessFailed);
  }
  if (files.error) {
    logFailure("files", files.error);
    problems.push(MEDIA_MESSAGES.filesFailed);
  }
  if (defects.error) logFailure("defect codes", defects.error);

  const photoRows: PhotoRow[] = photos.data;
  const fileRows: FileRow[] = files.error ? [] : files.data;
  const signedAt = now();
  const [photoUrls, fileUrls] = await Promise.all([
    signPaths(client, PHOTO_BUCKET, photoObjectPaths(photoRows), ttlSeconds),
    signPaths(client, FILE_BUCKET, fileRows.map((row) => row.storage_path), ttlSeconds),
  ]);
  if (!photoUrls.complete || !fileUrls.complete) problems.push(MEDIA_MESSAGES.signFailed);

  const template = inspection.template as { resolved: unknown } | null;
  return {
    kind: "ok",
    media: {
      inspection: {
        id: inspection.id,
        refNo: inspection.ref_no,
        status: inspection.status,
        inspectorId: inspection.inspector_id,
      },
      access: {
        canEdit: !canEdit.error && canEdit.data === true,
        isAdmin: !isAdmin.error && isAdmin.data === true,
      },
      photos: photoRows.map((row) => toMediaPhoto(row, photoUrls.urls)),
      files: fileRows.map((row) => toMediaFile(row, fileUrls.urls)),
      options: tagOptionsFromTemplate(
        await templateAsShown(template?.resolved ?? null, inspection.module_overrides, inspection.data),
        inspection.module_overrides,
        defects.error ? [] : defects.data,
      ),
      signedAt,
      problems,
    },
  };
}

/**
 * The stored template with the titles the inspection shows (a count in a
 * title follows it, as on the capture screen), so the gallery's groups and
 * the photo dialog's modules match the screen. As stored when the template
 * or the data cannot be read, or the module engine cannot be loaded.
 *
 * The engine (the module registry and validation) is loaded on demand, never
 * imported here: this file is part of the photo queue, which the gallery, the
 * review's actions and the account menu's sign-out check (on every page) load,
 * and none of them needs the engine otherwise. The capture screen has it already.
 */
async function templateAsShown(resolved: unknown, moduleOverrides: unknown, data: unknown): Promise<unknown> {
  const template = ResolvedTemplateSchema.safeParse(resolved);
  const saved = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  const parsed = InspectionDataSchema.safeParse({ modules: {}, custom: {}, ...saved });
  if (!template.success || !parsed.success) return resolved;
  try {
    const { storedTemplateWithShownTitles } = await import("@/lib/inspections/capture/evaluate");
    return storedTemplateWithShownTitles({
      template: template.data,
      overrides: parseModuleOverrides(moduleOverrides),
      data: parsed.data,
    });
  } catch (error) {
    // Offline before the engine's code arrived, or a stale page after a deploy: the template's own titles.
    logFailure("the titles as shown", { message: error instanceof Error ? error.message : String(error) });
    return resolved;
  }
}

/**
 * Photos by id with fresh URLs: those the upload queue just finished. Missing
 * ids are left out. `complete` is false when some URLs could not be signed.
 */
export async function loadPhotos(
  client: Client,
  ids: readonly string[],
  { ttlSeconds = SIGNED_URL_TTL_SECONDS }: Pick<LoadOptions, "ttlSeconds"> = {},
): Promise<{ ok: true; photos: MediaPhoto[]; complete: boolean } | { ok: false }> {
  const wanted = ids.filter((id) => UUID_PATTERN.test(id));
  if (wanted.length === 0) return { ok: true, photos: [], complete: true };
  const { data, error } = await client.from("inspection_photos").select(PHOTO_COLUMNS).in("id", wanted);
  if (error) {
    logFailure("new photos", error);
    return { ok: false };
  }
  const signed = await signPaths(client, PHOTO_BUCKET, photoObjectPaths(data), ttlSeconds);
  return { ok: true, photos: data.map((row) => toMediaPhoto(row, signed.urls)), complete: signed.complete };
}

/** Files by id with fresh URLs. `complete` is false when some URLs could not be signed. */
export async function loadFiles(
  client: Client,
  ids: readonly string[],
  { ttlSeconds = SIGNED_URL_TTL_SECONDS }: Pick<LoadOptions, "ttlSeconds"> = {},
): Promise<{ ok: true; files: MediaFile[]; complete: boolean } | { ok: false }> {
  const wanted = ids.filter((id) => UUID_PATTERN.test(id));
  if (wanted.length === 0) return { ok: true, files: [], complete: true };
  const { data, error } = await client.from("inspection_files").select(FILE_COLUMNS).in("id", wanted);
  if (error) {
    logFailure("new files", error);
    return { ok: false };
  }
  const signed = await signPaths(client, FILE_BUCKET, data.map((row) => row.storage_path), ttlSeconds);
  return { ok: true, files: data.map((row) => toMediaFile(row, signed.urls)), complete: signed.complete };
}

/**
 * Fresh signed URLs for objects already shown, by path. `complete` is false
 * when any could not be signed (a missing object, a refused request).
 */
export async function signPaths(
  client: Client,
  bucket: MediaBucket,
  paths: readonly string[],
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<{ urls: Map<string, string>; complete: boolean }> {
  const urls = new Map<string, string>();
  let complete = true;
  for (let start = 0; start < paths.length; start += SIGN_BATCH) {
    const batch = paths.slice(start, start + SIGN_BATCH);
    try {
      const { data, error } = await client.storage.from(bucket).createSignedUrls(batch, ttlSeconds);
      if (error) {
        logFailure(`signing ${bucket}`, error);
        complete = false;
        continue;
      }
      for (const entry of data) {
        if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
        else complete = false;
      }
    } catch (error) {
      logFailure(`signing ${bucket}`, { message: error instanceof Error ? error.message : String(error) });
      complete = false;
    }
  }
  return { urls, complete };
}

/** A read that never reached the server is a warning (isNoConnection): the store tries again. */
function logFailure(what: string, error: { code?: string; message: string }) {
  const log = isNoConnection(error.message) ? console.warn : console.error;
  log(`Inspection photos: loading ${what} failed`, { code: error.code, message: error.message });
}

// What a photo slot and the gallery show: uploaded photos (from the media
// store) and photos still in the upload queue, as one list; and the upload
// state of an inspection, for the pending badge and the submit button. Pure,
// so the rules are unit-tested without a browser.
import type { InspectionMedia } from "@/lib/inspections/photos/queries";
import { showsFullSize, type MediaFile } from "@/lib/inspections/photos/view";
import type { Failure } from "@/lib/offline/failures";
import type { InspectionFileKind } from "@/lib/photos/files";
import { FILE_SIZE_LIMIT, PHOTO_SIZE_LIMIT } from "@/lib/photos/paths";
import type { UploadItem } from "@/lib/photos/upload-queue";
import { NOTHING_PREPARING, QUEUE_PROBLEMS, type PhotoQueueState } from "./queue-state";

export type PhotoUploadState = "waiting" | "uploading" | "failed" | "uploaded";

/** One photo on screen, uploaded or still queued on this device. */
export interface SlotPhoto {
  id: string;
  /** Still in the upload queue: retag and remove go to the queue, not the server. */
  queued: boolean;
  moduleKey: string | null;
  target: string | null;
  caption: string | null;
  takenAt: string | null;
  flagged: boolean;
  includeInReport: boolean;
  state: PhotoUploadState;
  /** 0 to 1. */
  progress: number;
  /** Why the upload stopped, in words the inspector can act on. */
  error: string | null;
  /** Local preview or signed thumbnail. Undefined while a local preview is still being read. */
  thumbUrl: string | null | undefined;
  /**
   * Signed URL of the full photo, where a browser can show it: null while
   * queued, and for an original kept unconverted (HEIC).
   */
  fullUrl: string | null;
  /**
   * Uploaded, but this page has not read its row yet (a slow or dropped
   * connection right after the upload): shown from what the queue knew,
   * without the report choice until the row is in.
   */
  pendingRow: boolean;
}

/** Which photos a slot shows: one module's, the untagged ones (null), or all of them (undefined). */
export type ModuleFilter = string | null | undefined;

const matches = (filter: ModuleFilter, moduleKey: string | null) => filter === undefined || filter === moduleKey;

function queueState(item: UploadItem): PhotoUploadState {
  return item.state;
}

/** Words the queue writes itself about this device ("no longer stored on this device"): already plain. */
const DEVICE_WORDS = /\bthis device\b/i;

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Why an upload stopped, in words the inspector can act on. Storage and the
 * database answer in developer terms ("new row violates row-level security
 * policy"); the reasons map to what to do next. Failures that retry by
 * themselves (network, server, an ended session) keep the queue's own words.
 */
export function failureText(error: Failure | null, kind: "photo" | "file"): string | null {
  if (!error) return null;
  switch (error.reason) {
    case "forbidden":
      return "This inspection can no longer be changed from this account. Ask an admin to reopen it, then try again.";
    case "too_large":
      return kind === "photo"
        ? `The photo is larger than the ${megabytes(PHOTO_SIZE_LIMIT)} the server accepts. Remove it, and add a smaller one.`
        : `The file is larger than the ${megabytes(FILE_SIZE_LIMIT)} the server accepts. Remove it, and add a smaller one.`;
    case "invalid":
      return kind === "photo"
        ? "The server did not accept this photo. Photos must be JPEG, PNG, WebP or HEIC: remove it, and add it again."
        : "The server did not accept this file. Lab reports and certificates must be PDF, JPEG, PNG, WebP or HEIC: remove it, and add it again.";
    case "not_found":
      if (DEVICE_WORDS.test(error.message)) return error.message;
      return `The inspection no longer exists, so the ${kind} cannot upload. Remove it.`;
    default:
      return error.message;
  }
}

/** Why a retag or caption of an uploaded photo did not stick, for the notice above the photos. */
export function retagFailureText(error: Failure): string {
  switch (error.reason) {
    case "forbidden":
      return "This inspection can no longer be changed from this account.";
    case "not_found":
      return "The photo or its inspection no longer exists.";
    case "invalid":
    case "too_large":
      return "The server did not accept the new tag or caption.";
    default:
      return error.message;
  }
}

/** Finished uploads of one inspection whose rows are not read yet, oldest first. */
function settledItems(
  settled: PhotoQueueState["settled"],
  kind: UploadItem["kind"],
  inspectionId: string,
  moduleKey: ModuleFilter,
  shown: ReadonlySet<string>,
): UploadItem[] {
  return Object.values(settled)
    .filter(
      (item) =>
        item.kind === kind && item.inspectionId === inspectionId && matches(moduleKey, item.moduleKey) && !shown.has(item.id),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Uploaded photos (oldest first), then finished uploads whose rows are not
 * read yet, then queued ones in upload order. A photo in both the media and
 * the queue (its row is in, a retag still on its way) shows as queued, with
 * the newer tags. Local previews win over signed thumbnails: no flash when a
 * photo finishes.
 */
export function slotPhotos({
  media,
  queue,
  inspectionId,
  moduleKey,
}: {
  media: InspectionMedia | null;
  queue: Pick<PhotoQueueState, "queue" | "previews" | "settled">;
  inspectionId: string;
  moduleKey: ModuleFilter;
}): SlotPhoto[] {
  const inspectionPhotos = queue.queue.items.filter((item) => item.kind === "photo" && item.inspectionId === inspectionId);
  const queued = inspectionPhotos.filter((item) => matches(moduleKey, item.moduleKey));
  // Shown once, as queued: also when a retag moved it away from the module its row still names.
  const queuedIds = new Set(inspectionPhotos.map((item) => item.id));
  const mediaPhotos = media?.photos ?? [];

  const uploaded: SlotPhoto[] = mediaPhotos
    .filter((photo) => matches(moduleKey, photo.moduleKey) && !queuedIds.has(photo.id))
    .map((photo) => ({
      id: photo.id,
      queued: false,
      moduleKey: photo.moduleKey,
      target: photo.target,
      caption: photo.caption,
      takenAt: photo.takenAt,
      flagged: photo.flagged,
      includeInReport: photo.includeInReport,
      state: "uploaded",
      progress: 1,
      error: null,
      thumbUrl: queue.previews[photo.id] ?? photo.thumbUrl,
      fullUrl: showsFullSize(photo) ? photo.fullUrl : null,
      pendingRow: false,
    }));

  // Uploaded, row not read yet: shown from what the queue knew, never missing from the list.
  const shown = new Set([...queuedIds, ...mediaPhotos.map((photo) => photo.id)]);
  const finishing: SlotPhoto[] = settledItems(queue.settled, "photo", inspectionId, moduleKey, shown).map((item) => ({
    id: item.id,
    queued: false,
    moduleKey: item.moduleKey,
    target: item.target,
    caption: item.caption,
    takenAt: item.takenAt,
    flagged: item.flagged,
    includeInReport: false,
    state: "uploaded",
    progress: 1,
    error: null,
    thumbUrl: item.id in queue.previews ? queue.previews[item.id] : undefined,
    fullUrl: null,
    pendingRow: true,
  }));

  const waiting: SlotPhoto[] = queued.map((item) => {
    const uploadedCopy = mediaPhotos.find((photo) => photo.id === item.id);
    return {
      id: item.id,
      queued: true,
      moduleKey: item.moduleKey,
      target: item.target,
      caption: item.caption,
      takenAt: item.takenAt,
      flagged: item.flagged,
      includeInReport: uploadedCopy?.includeInReport ?? false,
      state: queueState(item),
      progress: item.progress,
      error: item.state === "failed" ? failureText(item.error, "photo") : null,
      thumbUrl: item.id in queue.previews ? queue.previews[item.id] : (uploadedCopy?.thumbUrl ?? undefined),
      fullUrl: uploadedCopy && showsFullSize(uploadedCopy) ? uploadedCopy.fullUrl : null,
      pendingRow: false,
    };
  });

  return [...uploaded, ...finishing, ...waiting];
}

/** One lab report or certificate on screen, uploaded or still queued. */
export interface SlotFile {
  id: string;
  queued: boolean;
  moduleKey: string | null;
  kind: InspectionFileKind | null;
  name: string;
  state: PhotoUploadState;
  progress: number;
  error: string | null;
  url: string | null;
}

/** Uploaded files, then finished uploads whose rows are not read yet, then queued ones, for one module (or all). */
export function slotFiles({
  files,
  queue,
  inspectionId,
  moduleKey,
}: {
  files: readonly MediaFile[];
  queue: Pick<PhotoQueueState, "queue" | "settled">;
  inspectionId: string;
  moduleKey: ModuleFilter;
}): SlotFile[] {
  const queued = queue.queue.items.filter(
    (item) => item.kind === "file" && item.inspectionId === inspectionId && matches(moduleKey, item.moduleKey),
  );
  const queuedIds = new Set(queued.map((item) => item.id));
  const shown = new Set([...queuedIds, ...files.map((file) => file.id)]);
  return [
    ...files
      .filter((file) => matches(moduleKey, file.moduleKey) && !queuedIds.has(file.id))
      .map(
        (file): SlotFile => ({
          id: file.id,
          queued: false,
          moduleKey: file.moduleKey,
          kind: file.kind,
          name: file.name,
          state: "uploaded",
          progress: 1,
          error: null,
          url: file.url,
        }),
      ),
    // Uploaded, row not read yet: listed as uploaded, without its link until the row is in.
    ...settledItems(queue.settled, "file", inspectionId, moduleKey, shown).map(
      (item): SlotFile => ({
        id: item.id,
        queued: false,
        moduleKey: item.moduleKey,
        kind: item.fileKind ?? null,
        name: item.name ?? "Document",
        state: "uploaded",
        progress: 1,
        error: null,
        url: null,
      }),
    ),
    ...queued.map(
      (item): SlotFile => ({
        id: item.id,
        queued: true,
        moduleKey: item.moduleKey,
        kind: item.fileKind ?? null,
        name: item.name ?? "Document",
        state: queueState(item),
        progress: item.progress,
        error: item.state === "failed" ? failureText(item.error, "file") : null,
        url: null,
      }),
    ),
  ];
}

/* ------------------------------------------------------------------ *
 * The inspection's files as modules decide with them
 * ------------------------------------------------------------------ */

/** A file of the inspection as a module's calc reads it (modules/_framework InspectionFileRef). */
export interface FileRef {
  id: string;
  moduleKey: string | null;
  kind: InspectionFileKind | null;
}

/**
 * The inspection's files for InspectionMeta.files (docs/MODULES.md 10.1):
 * the uploaded rows, finished uploads whose rows are not read yet, and the
 * files still queued on this device. Null while either half is unknown (the
 * rows not loaded, or this device's queue not read yet): "none" is never
 * told for "not known", or a kept lab report would read as deleted. A queue
 * that cannot run on this device holds nothing.
 */
export function inspectionFileRefs({
  files,
  queue,
  inspectionId,
}: {
  /** The uploaded rows; null while they are not loaded. */
  files: readonly Pick<MediaFile, "id" | "moduleKey" | "kind">[] | null;
  queue: Pick<PhotoQueueState, "phase" | "queue" | "settled">;
  inspectionId: string;
}): FileRef[] | null {
  if (files === null) return null;
  const queueKnown = queue.phase === "unavailable" || (queue.phase === "ready" && queue.queue.load === "ready");
  if (!queueKnown) return null;
  const refs = new Map<string, FileRef>();
  for (const file of files) refs.set(file.id, { id: file.id, moduleKey: file.moduleKey, kind: file.kind });
  const onDevice = [...Object.values(queue.settled), ...queue.queue.items].filter(
    (item) => item.kind === "file" && item.inspectionId === inspectionId,
  );
  for (const item of onDevice) {
    if (!refs.has(item.id)) refs.set(item.id, { id: item.id, moduleKey: item.moduleKey, kind: item.fileKind ?? null });
  }
  return [...refs.values()];
}

/* ------------------------------------------------------------------ *
 * Upload state of an inspection: the badge and the submit check
 * ------------------------------------------------------------------ */

export interface PhotoUploadStatus {
  /** The queue has read what this device kept; until then nobody knows whether photos wait. */
  ready: boolean;
  /** Being prepared in the browser: the queue does not know them yet. */
  preparing: number;
  /** Queued and not uploaded yet, failed ones included. */
  photos: number;
  files: number;
  /** Stopped on a failure that needs the inspector: Try again or Remove. */
  failed: number;
  /** Everything not uploaded yet: the badge. */
  pending: number;
  online: boolean;
  /** Submit waits (BUILD_SPEC 8.1: submit is blocked until the queue is empty). */
  blocking: boolean;
  /** Why it waits, for the hint next to the submit button. Null when it does not. */
  message: string | null;
}

/** "1 photo", "2 photos and 1 file". */
export function describeItems(photos: number, files: number): string {
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? "photo" : "photos"}`);
  if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  return parts.join(" and ");
}

export function uploadStatusFor(state: PhotoQueueState, inspectionId: string): PhotoUploadStatus {
  const preparingCount = state.preparing[inspectionId] ?? NOTHING_PREPARING;
  const preparing = preparingCount.photos + preparingCount.files;
  const items = state.queue.items.filter((item) => item.inspectionId === inspectionId);
  const photos = items.filter((item) => item.kind === "photo").length;
  const files = items.length - photos;
  const failed = items.filter((item) => item.state === "failed").length;
  const online = state.queue.online;
  const base = { preparing, photos, files, failed, pending: preparing + items.length, online };

  // Uploads cannot run here at all (no Supabase settings), so nothing can be waiting.
  if (state.phase === "unavailable" && state.problem === QUEUE_PROBLEMS.notConfigured) {
    return { ...base, ready: true, blocking: false, message: null };
  }
  if (state.phase === "unavailable") {
    return { ...base, ready: false, blocking: true, message: state.problem ?? QUEUE_PROBLEMS.failedToStart };
  }
  const ready = state.phase === "ready" && state.queue.load === "ready";
  if (preparing > 0) {
    return { ...base, ready, blocking: true, message: `Preparing ${describeItems(preparingCount.photos, preparingCount.files)} for upload.` };
  }
  if (!ready) {
    const message =
      state.queue.load === "failed"
        ? "This device could not check for photos waiting to upload. Retrying."
        : "Checking for photos waiting on this device.";
    return { ...base, ready, blocking: true, message };
  }
  if (failed > 0) {
    const failedPhotos = items.filter((item) => item.state === "failed" && item.kind === "photo").length;
    const what = describeItems(failedPhotos, failed - failedPhotos);
    return { ...base, ready, blocking: true, message: `${capitalise(what)} could not upload. Try again, or remove ${failed === 1 ? "it" : "them"}.` };
  }
  if (items.length > 0) {
    const what = describeItems(photos, files);
    const message = online
      ? `Waiting for ${what} to upload.`
      : `Offline: ${what} ${items.length === 1 ? "waits" : "wait"} on this device and upload${items.length === 1 ? "s" : ""} when the connection is back.`;
    return { ...base, ready, blocking: true, message };
  }
  return { ...base, ready, blocking: false, message: null };
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

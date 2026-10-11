// Source Documents' Media as a board (Kenneth, 12 October 2026): the visit's
// photos and videos listed by category, each row moved to another by
// dragging its grip or with its Move To menu, and Auto-Sort, which uploads
// a heap of them into Other for the AI to sort. Pure, so the rules are
// unit-tested without a browser: which list an item is in, where a drop
// lands, how fast the page scrolls under a drag, what a sort reports.
import type { PhotoUploadState, SlotFile, SlotPhoto } from "@/components/capture/photos/photo-model";
import { tagLine } from "@/components/qc/photo-tags";
import { displayTags, type PhotoTagOptions } from "@/lib/inspections/photos/view";
import { isMediaCategoryKey, MEDIA_CATEGORIES, SOURCE_MEDIA_KEY, type MediaCategoryKey } from "@/lib/inspections/source-documents";

export type MediaKind = "photo" | "video";

/** Where an item is listed: one of Media's categories, or Other. */
export type MediaSectionId = MediaCategoryKey | "other";

export const OTHER_TITLE = "Other";

/** Media's sections in order, as the page and the Move To menu list them. */
export const MEDIA_SECTIONS: readonly { readonly id: MediaSectionId; readonly title: string }[] = [
  ...MEDIA_CATEGORIES.map((category) => ({ id: category.key, title: category.title })),
  { id: "other", title: OTHER_TITLE },
];

export function sectionTitle(id: MediaSectionId): string {
  return MEDIA_SECTIONS.find((section) => section.id === id)?.title ?? OTHER_TITLE;
}

/** Why a dropped or chosen file stayed out: Media holds photos and videos only. */
export const NOT_MEDIA = "Media takes photos and videos. Add documents under Files.";

/**
 * Where a photo or video with this module_key is listed: its category, else
 * Other (a photo untagged or a step's from before the categories, a video
 * of the first Media tab). Null for a file that is not media: Source
 * Documents' own papers, a step's lab report.
 */
export function sectionOf(kind: MediaKind, moduleKey: string | null): MediaSectionId | null {
  if (isMediaCategoryKey(moduleKey)) return moduleKey;
  if (kind === "photo") return "other";
  return moduleKey === SOURCE_MEDIA_KEY ? "other" : null;
}

/** The module_key of an item listed under `section`: in Other, a photo has none and a video the first Media tab's. */
export function moduleKeyFor(kind: MediaKind, section: MediaSectionId): string | null {
  if (section !== "other") return section;
  return kind === "photo" ? null : SOURCE_MEDIA_KEY;
}

/** The section as moveMedia takes it: Other is null. */
export function categoryOf(section: MediaSectionId): MediaCategoryKey | null {
  return section === "other" ? null : section;
}

/** An item's key on the board: photos and videos are rows of two tables. */
export function mediaKey(kind: MediaKind, id: string): string {
  return `${kind}:${id}`;
}

/** One photo or video as Media lists it. */
export type MediaItem = {
  /** mediaKey: "photo:<id>" or "video:<id>". */
  key: string;
  kind: MediaKind;
  id: string;
  /** A video's file name; a photo has none stored, so "Photo 3", in upload order. */
  name: string;
  section: MediaSectionId;
  /** A photo's local preview or signed thumbnail: undefined while a local preview is read, null with none (videos). */
  thumbUrl: string | null | undefined;
  /** What Preview shows and Download saves; null until it is uploaded and its row read. */
  url: string | null;
  /** The name Download saves it under. */
  downloadName: string;
  /** A step's tag on a photo listed under Other: "Visual · Size M". */
  tagLine: string | null;
  state: PhotoUploadState;
  progress: number;
  error: string | null;
  /** Still on this device: Delete takes it off the upload queue. */
  queued: boolean;
  /**
   * It can move now: a photo still on this device (the queue retags it), or
   * a row this page has read (the server moves it). Not a video still
   * uploading, nor a row not read yet: each can a moment later.
   */
  movable: boolean;
  photo: SlotPhoto | null;
  file: SlotFile | null;
};

/** The inspection's photos, then its videos, as Media lists them; files that are not media are left out. */
export function mediaItems({
  photos,
  files,
  options,
  photoPaths,
  readFiles,
}: {
  /** Every photo of the inspection, in upload order. */
  photos: readonly SlotPhoto[];
  /** Every file of the inspection. */
  files: readonly SlotFile[];
  options: PhotoTagOptions;
  /** The uploaded photos' storage paths, by id: the extension Download saves them with. */
  photoPaths: ReadonlyMap<string, string>;
  /** The ids of the file rows this page has read. */
  readFiles: ReadonlySet<string>;
}): MediaItem[] {
  const items = photos.map((photo, index): MediaItem => {
    const section = sectionOf("photo", photo.moduleKey) ?? "other";
    const name = `Photo ${index + 1}`;
    const extension = /\.[a-z0-9]+$/i.exec(photoPaths.get(photo.id) ?? "")?.[0].toLowerCase() ?? ".jpg";
    return {
      key: mediaKey("photo", photo.id),
      kind: "photo",
      id: photo.id,
      name,
      section,
      thumbUrl: photo.thumbUrl,
      url: photo.state === "uploaded" ? photo.fullUrl : null,
      downloadName: `${name}${extension}`,
      tagLine: section === "other" && photo.moduleKey !== null ? tagLine(displayTags(photo.moduleKey, photo.target, options)) || null : null,
      state: photo.state,
      progress: photo.progress,
      error: photo.error,
      queued: photo.queued,
      movable: photo.queued || (photo.state === "uploaded" && !photo.pendingRow),
      photo,
      file: null,
    };
  });
  for (const file of files) {
    const section = sectionOf("video", file.moduleKey);
    if (section === null) continue;
    items.push({
      key: mediaKey("video", file.id),
      kind: "video",
      id: file.id,
      name: file.name,
      section,
      thumbUrl: null,
      url: file.url,
      downloadName: file.name,
      tagLine: null,
      state: file.state,
      progress: file.progress,
      error: file.error,
      queued: file.queued,
      movable: !file.queued && readFiles.has(file.id),
      photo: null,
      file,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * Moves shown before they are saved
 * ------------------------------------------------------------------ */

/**
 * Moves on screen that the server (or the upload queue) has not answered
 * yet, by item key. A newer move of the same item has a newer ticket, so an
 * older answer arriving late leaves it be.
 */
export type PendingMoves = Readonly<Record<string, { readonly section: MediaSectionId; readonly ticket: number }>>;

export function withMove(moves: PendingMoves, key: string, section: MediaSectionId, ticket: number): PendingMoves {
  return { ...moves, [key]: { section, ticket } };
}

/** The move was answered (taken or refused): the item shows where its data puts it, unless it was moved again meanwhile. */
export function withoutMove(moves: PendingMoves, key: string, ticket: number): PendingMoves {
  if (moves[key]?.ticket !== ticket) return moves;
  const rest = { ...moves };
  delete rest[key];
  return rest;
}

/** The items where their pending moves put them; the others as they are. */
export function placeItems(items: readonly MediaItem[], moves: PendingMoves): MediaItem[] {
  return items.map((item) => {
    const move = moves[item.key];
    return move && move.section !== item.section ? { ...item, section: move.section } : item;
  });
}

/* ------------------------------------------------------------------ *
 * Dragging
 * ------------------------------------------------------------------ */

export type Box = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

/** The section under the pointer, or null over none. */
export function sectionAt(
  point: { readonly x: number; readonly y: number },
  boxes: Iterable<readonly [MediaSectionId, Box]>,
): MediaSectionId | null {
  for (const [id, box] of boxes) {
    if (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) return id;
  }
  return null;
}

/** How near the window's top or bottom the page starts to scroll under a drag, and its fastest step a frame. */
export const EDGE_PX = 64;
export const EDGE_STEP_PX = 18;

/**
 * The pixels to scroll this frame under a drag at `y`: up near the top
 * (`top`, where the sticky bars end), down near the bottom, faster closer
 * to the edge; 0 elsewhere.
 */
export function edgeScroll(y: number, top: number, bottom: number): number {
  const step = (depth: number) => Math.ceil(EDGE_STEP_PX * Math.min(1, depth / EDGE_PX));
  if (y < top + EDGE_PX) return -step(top + EDGE_PX - y);
  if (y > bottom - EDGE_PX) return step(y - (bottom - EDGE_PX));
  return 0;
}

/* ------------------------------------------------------------------ *
 * Auto-Sort
 * ------------------------------------------------------------------ */

/** At most this many items a sortMediaWithAi call. */
export const SORT_BATCH_ITEMS = 12;
/** And at most this much preview text: a Server Action's body may be 5 MB (next.config.ts). */
export const SORT_BATCH_CHARS = 4_000_000;

/** The items in calls of at most 12, each call's previews within the body limit. */
export function sortBatches<T extends { readonly preview: string }>(items: readonly T[]): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let chars = 0;
  for (const item of items) {
    if (batch.length === SORT_BATCH_ITEMS || (batch.length > 0 && chars + item.preview.length > SORT_BATCH_CHARS)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(item);
    chars += item.preview.length;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * What a run did, in one line: "Sorted 11: Warehouse 3, Inspection Proof 8.
 * 1 in Other." `total` counts the run's uploads; those the AI left alone,
 * or never saw, are in Other. After a failure, its message and where the
 * rest are.
 */
export function autoSortLine({
  sorted,
  total,
  error,
}: {
  sorted: readonly { readonly category: MediaCategoryKey | null }[];
  total: number;
  error: string | null;
}): string {
  const placed = sorted.filter((item) => item.category !== null);
  const counts = MEDIA_CATEGORIES.map(({ key, title }) => ({ title, count: placed.filter((item) => item.category === key).length }))
    .filter(({ count }) => count > 0)
    .map(({ title, count }) => `${title} ${count}`);
  const head = placed.length > 0 ? `Sorted ${placed.length}: ${counts.join(", ")}.` : "";
  if (error !== null) {
    const message = /[.!?]$/.test(error.trim()) ? error.trim() : `${error.trim()}.`;
    return [head, message, `${placed.length > 0 ? "The rest are" : "They are"} in Other to drag into place.`].filter(Boolean).join(" ");
  }
  const left = total - placed.length;
  return `${head || "None sorted."}${left > 0 ? ` ${left} in Other.` : ""}`;
}

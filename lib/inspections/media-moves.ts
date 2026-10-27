// Media's moves (Kenneth, 12 October 2026): a photo or video on Source
// Documents' Media put in one of its categories (MEDIA_CATEGORIES), or back
// in Other, by hand (drag and drop) or by the AI's Auto-Sort (docs/AI.md,
// "Auto-Sort (Media)"). The inputs of the Server Actions in
// app/(app)/inspections/[id]/media-actions.ts, checked with zod, and their
// words: kept apart because a "use server" file exports async functions
// only. Pure and client-safe.
import { z } from "zod";
import { UUID_PATTERN } from "@/lib/offline/id";
import {
  isMediaCategoryKey,
  MEDIA_CATEGORY_KEYS,
  SOURCE_MEDIA_KEY,
  type MediaCategoryKey,
} from "@/lib/inspections/source-documents";
import { MAX_PHOTO_MARKERS, PhotoMarkersSchema, PhotoSizeSchema } from "@/lib/schemas/photo-markers";

/** Items Auto-Sort sends to the AI in one call. */
export const MEDIA_SORT_MAX_ITEMS = 12;

/** A preview's base64 at most: about 1.5 MB of image, far more than a 1024 px JPEG needs. */
export const PREVIEW_MAX_CHARS = 2_000_000;

/** Shorter than this is no picture at all. */
const PREVIEW_MIN_CHARS = 100;

export const MEDIA_MESSAGES = {
  inspectionGone: "This inspection is not available. Reload the page.",
  itemGone: "That photo or video is not available. Reload the page and try again.",
  chooseCategory: "Choose one of Media's categories, or Other.",
  batchSize: `Sort 1 to ${MEDIA_SORT_MAX_ITEMS} photos or videos at a time.`,
  sentTwice: "The same photo or video was sent twice.",
  badPreview: "A preview could not be read. Try again.",
  forbidden: "The photos and videos of this inspection can no longer be changed from this account.",
  photoGone: "This photo was deleted, or it can no longer be changed from this account.",
  videoGone: "This video was deleted, or it can no longer be changed from this account.",
  noneLeft: "These photos and videos are no longer on this inspection. Reload the page.",
  signedOut: "Your session has ended. Sign in again.",
  noAnswer: "The server did not answer. Try again in a moment.",
  refused: "The server refused the change. Reload the page and try again.",
  unexpected: "Something went wrong. Try again in a moment.",
  badMarkers: "The defect marks could not be read. Try again.",
  tooManyMarkers: `Mark at most ${MAX_PHOTO_MARKERS} defects on one photo.`,
  markersNotReady: "This server cannot save defect marks yet.",
} as const;

/** The category a photo's first defect mark puts it in, and that its last one, taken off, sorts it out of. */
export const DEFECTS_CATEGORY: MediaCategoryKey = "media_defects";

export type MediaKind = "photo" | "video";

/** The image types a preview may be; the AI reads each as it is. */
export type PreviewMediaType = "image/jpeg" | "image/png" | "image/webp";

/**
 * What a base64 preview is, from its first bytes: a JPEG (what the capture
 * screen makes), a PNG or a WebP; null for anything else. atob, so it runs
 * in the browser and on the server alike.
 */
export function previewMediaType(base64: string): PreviewMediaType | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 16));
  } catch {
    return null;
  }
  if (head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff) return "image/jpeg";
  if (head.startsWith("\x89PNG\r\n\x1a\n")) return "image/png";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Where an item shows on Media now: its category, or null for Other (untagged, a step's key, source_media). */
export function mediaPlace(moduleKey: string | null): MediaCategoryKey | null {
  return isMediaCategoryKey(moduleKey) ? moduleKey : null;
}

/** The module_key that puts an item in `category`. Other is no tag for a photo, source_media for a video. */
export function moduleKeyFor(kind: MediaKind, category: MediaCategoryKey | null): string | null {
  return category ?? (kind === "video" ? SOURCE_MEDIA_KEY : null);
}

/** A file on Media: a category's video, or one of Other's (source_media). Source Documents' own files and a step's lab reports are not. */
export function isMediaVideoKey(moduleKey: string | null): boolean {
  return isMediaCategoryKey(moduleKey) || moduleKey === SOURCE_MEDIA_KEY;
}

/** One key per item, its kind with its id: photos and files are separate tables. */
export function itemKey(item: { readonly kind: MediaKind; readonly id: string }): string {
  return `${item.kind}:${item.id}`;
}

/** How many items the AI put in each category, and how many it was unsure of: the audit log's record of a sort. */
export function sortCounts(categories: readonly (MediaCategoryKey | null)[]): {
  categories: Record<MediaCategoryKey, number>;
  unsure: number;
} {
  const counts = Object.fromEntries(MEDIA_CATEGORY_KEYS.map((key) => [key, 0])) as Record<MediaCategoryKey, number>;
  let unsure = 0;
  for (const category of categories) {
    if (category === null) unsure += 1;
    else counts[category] += 1;
  }
  return { categories: counts, unsure };
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

const InspectionIdSchema = z
  .string({ error: MEDIA_MESSAGES.inspectionGone })
  .regex(UUID_PATTERN, { error: MEDIA_MESSAGES.inspectionGone });

/** Photos and files have the ids the upload queue gave them: lowercase UUIDs. */
const ItemShape = {
  kind: z.enum(["photo", "video"], { error: MEDIA_MESSAGES.itemGone }),
  id: z.string({ error: MEDIA_MESSAGES.itemGone }).regex(UUID_PATTERN, { error: MEDIA_MESSAGES.itemGone }),
};

/** One of Media's categories, or null for Other. */
const CategorySchema = z.enum(MEDIA_CATEGORY_KEYS, { error: MEDIA_MESSAGES.chooseCategory }).nullable();

export const MoveMediaInputSchema = z.object({
  inspectionId: InspectionIdSchema,
  item: z.object(ItemShape, { error: MEDIA_MESSAGES.itemGone }),
  category: CategorySchema,
});

/** Base64 only; a "data:image/jpeg;base64," head is forgiven. */
const PreviewSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/^data:[^,]*;base64,/, "") : value),
  z
    .string({ error: MEDIA_MESSAGES.badPreview })
    .min(PREVIEW_MIN_CHARS, { error: MEDIA_MESSAGES.badPreview })
    .max(PREVIEW_MAX_CHARS, { error: MEDIA_MESSAGES.badPreview })
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: MEDIA_MESSAGES.badPreview })
    .refine((value) => value.length % 4 === 0, { error: MEDIA_MESSAGES.badPreview }),
);

const SortItemSchema = z
  .object({ ...ItemShape, preview: PreviewSchema }, { error: MEDIA_MESSAGES.itemGone })
  .transform((item, ctx) => {
    const mediaType = previewMediaType(item.preview);
    if (mediaType === null) {
      ctx.addIssue({ code: "custom", message: MEDIA_MESSAGES.badPreview });
      return z.NEVER;
    }
    return { kind: item.kind, id: item.id, preview: item.preview, mediaType };
  });

export const SortMediaInputSchema = z.object({
  inspectionId: InspectionIdSchema,
  items: z
    .array(SortItemSchema, { error: MEDIA_MESSAGES.batchSize })
    .min(1, { error: MEDIA_MESSAGES.batchSize })
    .max(MEDIA_SORT_MAX_ITEMS, { error: MEDIA_MESSAGES.batchSize })
    .superRefine((items, ctx) => {
      const keys = items.map(itemKey);
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: MEDIA_MESSAGES.sentTwice });
    }),
});

/**
 * A photo's defect marks (lib/schemas/photo-markers.ts) as the preview saves
 * them, with the image's natural size: kept with the marks of a photo stored
 * without one, and dropped, not refused, when it is no size.
 */
export const SaveMarkersInputSchema = z.object({
  inspectionId: InspectionIdSchema,
  photoId: ItemShape.id,
  markers: PhotoMarkersSchema,
  size: PhotoSizeSchema.nullable().catch(null),
});

export type MoveMediaInput = z.output<typeof MoveMediaInputSchema>;
export type SortMediaInput = z.output<typeof SortMediaInputSchema>;
export type SaveMarkersInput = z.output<typeof SaveMarkersInputSchema>;

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

function parsed<T>(result: { success: true; data: T } | { success: false; error: z.ZodError }): Parsed<T> {
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? MEDIA_MESSAGES.itemGone };
}

/** moveMedia's arguments, checked. The first problem comes back in words for the screen. */
export function parseMoveInput(inspectionId: unknown, item: unknown, category: unknown): Parsed<MoveMediaInput> {
  return parsed(MoveMediaInputSchema.safeParse({ inspectionId, item, category }));
}

/** sortMediaWithAi's arguments, checked, each preview with its image type. */
export function parseSortInput(inspectionId: unknown, items: unknown): Parsed<SortMediaInput> {
  return parsed(SortMediaInputSchema.safeParse({ inspectionId, items }));
}

/** savePhotoMarkers' arguments, checked: marks of any other shape are refused in the screen's words. */
export function parseMarkersInput(inspectionId: unknown, photoId: unknown, markers: unknown, size: unknown): Parsed<SaveMarkersInput> {
  const result = SaveMarkersInputSchema.safeParse({ inspectionId, photoId, markers, size });
  if (result.success) return { ok: true, data: result.data };
  const issue = result.error.issues[0];
  if (issue?.path[0] !== "markers") return parsed(result);
  const tooMany = issue.path.length === 1 && issue.code === "too_big";
  return { ok: false, error: tooMany ? MEDIA_MESSAGES.tooManyMarkers : MEDIA_MESSAGES.badMarkers };
}

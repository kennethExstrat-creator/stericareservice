// Defect marks on a photo (Kenneth, 27 October 2026: "in the preview of the
// photos, add in tools to mark defect (red circle), with the red circle being
// able to drag, inrease and decrease size"): the red circles drawn on a
// photo's preview, kept with the photo (inspection_photos.markers, migration
// 20261027210000, whose check holds the same shape), carried by the export
// (photos[].markers, lib/schemas/export.ts) and drawn on the report's photos.
// A circle is placed in fractions of the image, so it stays on its defect
// at any size the photo is shown.
//
// Client-safe leaf: zod only. Imported by its path, not through the
// lib/schemas index.
import { z } from "zod";

/** At most this many circles on one photo (the database's check says the same). */
export const MAX_PHOTO_MARKERS = 20;

/**
 * One circle. `x` and `y`: its centre as a fraction of the image's width and
 * height (0 to 1, from the top left). `r`: its radius as a fraction of the
 * image's shorter side (0 to 1), so a circle stays round on any photo.
 */
export const PhotoMarkerSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  r: z.number().min(0).max(1),
});
export type PhotoMarker = z.infer<typeof PhotoMarkerSchema>;

/** A photo's circles, in the order they were drawn. */
export const PhotoMarkersSchema = z.array(PhotoMarkerSchema).max(MAX_PHOTO_MARKERS);

/** A photo's natural size in pixels (inspection_photos.width and height). */
export const PhotoSizeSchema = z.object({
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
});
export type PhotoSize = z.infer<typeof PhotoSizeSchema>;

/**
 * The circles kept with a photo, as the screens and the export read them:
 * none for a row without the column (a project before migration
 * 20261027210000) or with anything the shape does not allow.
 */
export function readPhotoMarkers(value: unknown): PhotoMarker[] {
  const parsed = PhotoMarkersSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * PostgREST's answer to a read of the markers column on a project that has
 * not run migration 20261027210000 (42703, "column inspection_photos.markers
 * does not exist"): the reader asks again without it, and the photos have no
 * marks, so the screens and the export work before the migration is applied.
 */
export function lacksMarkersColumn(error: { code?: string; message: string } | null | undefined): boolean {
  return error?.code === "42703" && error.message.includes("markers");
}

/** A photo's natural size from its width and height columns; null unless both are whole numbers above 0. */
export function photoSizeOf(width: number | null | undefined, height: number | null | undefined): PhotoSize | null {
  const parsed = PhotoSizeSchema.safeParse({ width, height });
  return parsed.success ? parsed.data : null;
}

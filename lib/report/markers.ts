// The red rings an inspector draws round a defect on a photo (the Media
// photo preview, Kenneth, 27 October 2026), as a report tile shows them. A
// ring is saved in the image's own fractions (lib/schemas/export.ts: x and
// y its centre across and down, r its radius as a share of the shorter
// side), and a tile shows the image as object-fit: cover does, scaled to
// cover the tile's fixed shape and centred, the rest cropped away; so a
// ring is moved through the same scale and centring to sit on its defect.
// Without the image's natural pixels the crop is unknown: no ring is placed
// rather than a ring in the wrong place. Pure and client-safe.
import type { ExportPhoto } from "@/lib/schemas/export";

export type PhotoMarker = ExportPhoto["markers"][number];
export type PhotoSize = NonNullable<ExportPhoto["size"]>;

/** A ring on a tile `aspect` wide and 1 tall: its centre and radius in the tile's units. */
export type TileRing = { cx: number; cy: number; r: number };

/**
 * The rings as a tile of this shape (width over height) shows them, cropped
 * as object-fit: cover crops the image; a ring the crop leaves wholly
 * outside the tile is left out, one partly outside kept (the tile clips
 * it). None without the image's size.
 */
export function coverRings(markers: readonly PhotoMarker[] | undefined, size: PhotoSize | null | undefined, aspect: number): TileRing[] {
  if (!markers || markers.length === 0 || !size || !(size.width > 0 && size.height > 0) || !(aspect > 0)) return [];
  const image = size.width / size.height;
  // Scaled to cover: a wider image fills the tile's height and loses its sides, a taller one fills its width and loses top and bottom.
  const shown = image > aspect ? { width: image, height: 1 } : { width: aspect, height: aspect / image };
  const left = (aspect - shown.width) / 2;
  const top = (1 - shown.height) / 2;
  const shorter = Math.min(shown.width, shown.height);
  return markers
    .map((marker) => ({ cx: left + marker.x * shown.width, cy: top + marker.y * shown.height, r: marker.r * shorter }))
    .filter((ring) => ring.r > 0 && ring.cx + ring.r > 0 && ring.cx - ring.r < aspect && ring.cy + ring.r > 0 && ring.cy - ring.r < 1);
}

/** Whether a photo has rings a tile can place: some drawn, and the image's size known. */
export function hasRings(photo: { markers?: readonly PhotoMarker[]; size?: PhotoSize | null }): boolean {
  return (photo.markers?.length ?? 0) > 0 && !!photo.size;
}

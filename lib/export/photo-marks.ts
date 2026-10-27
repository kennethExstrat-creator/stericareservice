// Defect marks on the capture screen's live export. The Report page previews
// an export assembled from the screen's own copy of the inspection
// (lib/report/live-export.ts), whose photos come without their marks; the
// page lays each photo's marks and natural size over it from the photos it
// holds (the media store), so the preview draws what the print route's
// export carries (lib/export/record.ts, assemble.ts). Pure.
import type { InspectionExport } from "@/lib/schemas/export";
import { photoSizeOf, type PhotoMarker } from "@/lib/schemas/photo-markers";

/** A photo as the screen holds it: its marks (none when not read) and its stored size. */
export type MarkedPhoto = {
  readonly id: string;
  readonly markers?: readonly PhotoMarker[];
  readonly width: number | null;
  readonly height: number | null;
};

/** The export with each photo's marks and size from `photos`, by id; a photo they do not hold is left as it is. */
export function withPhotoMarks(doc: InspectionExport, photos: readonly MarkedPhoto[]): InspectionExport {
  if (photos.length === 0 || doc.photos.length === 0) return doc;
  const byId = new Map(photos.map((photo) => [photo.id, photo] as const));
  return {
    ...doc,
    photos: doc.photos.map((photo) => {
      const own = byId.get(photo.id);
      if (!own) return photo;
      return {
        ...photo,
        markers: (own.markers ?? []).map((marker) => ({ x: marker.x, y: marker.y, r: marker.r })),
        size: photoSizeOf(own.width, own.height) ?? photo.size,
      };
    }),
  };
}

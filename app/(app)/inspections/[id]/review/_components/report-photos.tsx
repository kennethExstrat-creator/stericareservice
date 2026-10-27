// The photos marked "include in report" (BUILD_SPEC 8.1), through signed
// links; each opens full size in a new tab. Every photo, and choosing which
// go into the report, is the gallery's job: /inspections/[id]/photos.
// Lean (Kenneth, 27 October 2026): the count beside the title, the photos,
// and a short line when there are none.
import Link from "next/link";
import { ImagesIcon, TriangleAlertIcon } from "lucide-react";
import { PhotoTile, tagLine } from "@/components/qc";
import { Button } from "@/components/ui/button";
import type { ReviewData } from "@/lib/inspections/review/load";
import type { ReviewPhoto } from "@/lib/inspections/review/photos";
import { CardSection } from "./review-section";

export function photosHref(inspectionId: string): string {
  return `/inspections/${inspectionId}/photos`;
}

/** The link to the gallery, which the empty text names too. */
const ALL_PHOTOS = "All Photos";

/** Beside the title: "2 of 14", "2", or why there are none. */
function countText(photos: ReviewData["photos"], canChoose: boolean): string {
  const marked = photos.items.length;
  if (photos.total === 0) return "No photos taken";
  if (marked === 0) return canChoose ? "None marked yet" : "None marked yet; an admin chooses them";
  return photos.total === null ? String(marked) : `${marked} of ${photos.total}`;
}

export function ReportPhotos({
  inspectionId,
  photos,
  canChoose,
}: {
  inspectionId: string;
  photos: ReviewData["photos"];
  /** Those who approve choose the report photos; others are told who does. */
  canChoose: boolean;
}) {
  return (
    <CardSection
      id="photos"
      title="Report Photos"
      aside={!photos.failed && <span className="text-sm text-muted-foreground">{countText(photos, canChoose)}</span>}
      actions={
        <Button asChild variant="link" size="sm" className="px-0 touch:h-11">
          <Link href={photosHref(inspectionId)}>
            <ImagesIcon aria-hidden />
            {ALL_PHOTOS}
            {photos.total ? ` (${photos.total})` : ""}
          </Link>
        </Button>
      }
    >
      {photos.failed && (
        <p className="mx-5 mb-4 flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          Some photos could not be loaded. Reload the page to try again.
        </p>
      )}
      {photos.items.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 px-5 pb-5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {photos.items.map((photo) => (
            <li key={photo.id} data-photo={photo.id}>
              <ReportPhoto photo={photo} />
            </li>
          ))}
        </ul>
      )}
    </CardSection>
  );
}

function ReportPhoto({ photo }: { photo: ReviewPhoto }) {
  const tile = (
    <PhotoTile
      src={photo.thumbUrl ?? undefined}
      alt={photo.alt}
      tags={photo.tags}
      caption={photo.caption ?? undefined}
      state={photo.flagged ? "flagged" : "uploaded"}
      includeInReport
      className="h-full"
    />
  );
  if (!photo.fullUrl) return tile;
  // Named by the words the tile shows, its caption and tag line, as the AI
  // panel names a photo it cites (WCAG 2.5.3); where it goes is the detail after.
  const shown = [photo.caption, tagLine(photo.tags)].filter(Boolean).join(", ");
  return (
    <a
      href={photo.fullUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${shown} (opens full size in a new tab)`}
      className="block h-full rounded-lg focus-ring"
    >
      {tile}
    </a>
  );
}

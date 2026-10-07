// The photos marked "include in report" (BUILD_SPEC 8.1), through signed
// links; each opens full size in a new tab. Every photo, and choosing which
// go into the report, is the gallery's job: /inspections/[id]/photos.
import Link from "next/link";
import { ImagesIcon, TriangleAlertIcon } from "lucide-react";
import { PhotoTile } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/inspections/review/format";
import type { ReviewData } from "@/lib/inspections/review/load";
import type { ReviewPhoto } from "@/lib/inspections/review/photos";
import { Panel, ReviewSection } from "./review-section";

export function photosHref(inspectionId: string): string {
  return `/inspections/${inspectionId}/photos`;
}

/** "2 of 3 photos marked for the report.", or nothing while there are none to mark. */
function describe(photos: ReviewData["photos"]): string | undefined {
  const marked = photos.items.length;
  if (photos.total === null) return marked > 0 ? `${plural(marked, "photo")} marked for the report.` : undefined;
  if (photos.total === 0) return undefined;
  return `${marked} of ${plural(photos.total, "photo")} marked for the report.`;
}

/** The link to the gallery, which the empty text names too. */
const ALL_PHOTOS = "All Photos";

function emptyText(total: number | null, canChoose: boolean): string {
  if (total === 0) return "No photos have been taken for this inspection.";
  return `None of the photos is marked for the report yet. ${canChoose ? `Choose them in ${ALL_PHOTOS}.` : "An admin chooses them."}`;
}

export function ReportPhotos({
  inspectionId,
  photos,
  canChoose,
}: {
  inspectionId: string;
  photos: ReviewData["photos"];
  /** Admins choose report photos; inspectors are told who does. */
  canChoose: boolean;
}) {
  return (
    <ReviewSection
      id="photos"
      title="Report Photos"
      description={describe(photos)}
      actions={
        <Button asChild variant="outline">
          <Link href={photosHref(inspectionId)}>
            <ImagesIcon aria-hidden />
            {ALL_PHOTOS}{photos.total ? ` (${photos.total})` : ""}
          </Link>
        </Button>
      }
    >
      {photos.failed && (
        <p className="flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          Some photos could not be loaded. Reload the page to try again.
        </p>
      )}
      {photos.items.length === 0 ? (
        !photos.failed && (
          <Panel className="px-5 py-6 text-base text-muted-foreground fine:text-sm">{emptyText(photos.total, canChoose)}</Panel>
        )
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {photos.items.map((photo) => (
            <li key={photo.id} data-photo={photo.id}>
              <ReportPhoto photo={photo} />
            </li>
          ))}
        </ul>
      )}
    </ReviewSection>
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
  return (
    <a
      href={photo.fullUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open full size, in a new tab: ${photo.alt}`}
      className="block h-full rounded-lg focus-ring"
    >
      {tile}
    </a>
  );
}

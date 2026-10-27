"use client";

// A Media photo's preview with its defect marks (Kenneth, 27 October 2026):
// the marking tool (components/capture/photos/photo-markup.tsx) on the photo,
// each change saved through the page's marker saves (marker-saves.ts), and
// the save state quietly at the tools' end, as the capture screen's own:
// Saving…; Sorting… while the last mark comes off a photo in Product Defects
// and Steri-AI sorts it again; Saved, or where the save moved the photo
// ("Moved to Product Defects"); Not Saved, why, and Try Again. Read-only
// wherever the board allows no drag (a submitted or approved inspection,
// someone else's): the circles show, with no tools.
import { RotateCwIcon } from "lucide-react";
import { PhotoMarkup } from "@/components/capture/photos/photo-markup";
import { SaveStatus } from "@/components/qc";
import { Button } from "@/components/ui/button";
import type { MediaPhoto } from "@/lib/inspections/photos/view";
import { photoSizeOf } from "@/lib/schemas/photo-markers";
import { sectionOf, sectionTitle, type MediaSectionId } from "./media-board";
import { changeMarkers, retryMarkers, useMarkerSave, type MarkerSaveView } from "./marker-saves";

export function MediaPhotoMarks({
  inspectionId,
  photoId,
  name,
  src,
  photo,
  section,
  canEdit,
}: {
  inspectionId: string;
  photoId: string;
  /** "Photo 3". */
  name: string;
  /** The full photo's link. */
  src: string;
  /** The photo as the page holds it (its kept marks and stored size); null while its row is not read. */
  photo: MediaPhoto | null;
  /** Where the board lists it now. */
  section: MediaSectionId | null;
  /** Media's board lets the user move the photo: the inspector or an admin while the inspection is a draft or reopened. */
  canEdit: boolean;
}) {
  const save = useMarkerSave(inspectionId, photoId);
  const kept = photo?.markers ?? [];
  const markers = save.markers ?? kept;
  // The last mark coming off in Product Defects: the save sorts the photo again.
  const sorting = kept.length > 0 && markers.length === 0 && section === "media_defects";
  return (
    <PhotoMarkup
      src={src}
      alt={name}
      markers={markers}
      size={photoSizeOf(photo?.width, photo?.height)}
      onMarkersChange={canEdit ? (next, naturalSize) => changeMarkers(inspectionId, photoId, next, { name, size: naturalSize }) : undefined}
      status={canEdit ? <MarkerSaveState view={save} sorting={sorting} onRetry={() => retryMarkers(inspectionId, photoId)} /> : null}
    />
  );
}

function MarkerSaveState({ view, sorting, onRetry }: { view: MarkerSaveView; sorting: boolean; onRetry: () => void }) {
  switch (view.status) {
    case "idle":
      return null;
    case "waiting":
    case "saving":
      return <SaveStatus state="saving" label={sorting ? "Sorting…" : undefined} />;
    case "saved":
      return <SaveStatus state="saved" label={view.moved ? `Moved to ${sectionTitle(sectionOf("photo", view.moved.moduleKey) ?? "other")}` : undefined} />;
    case "failed":
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SaveStatus state="error" />
          {view.error && <p className="text-sm text-fail touch:text-base">{view.error}</p>}
          <Button type="button" variant="outline" size="sm" className="touch:text-base" onClick={onRetry}>
            <RotateCwIcon aria-hidden />
            Try Again
          </Button>
        </div>
      );
  }
}

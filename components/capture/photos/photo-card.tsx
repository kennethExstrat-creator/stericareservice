"use client";

// One photo in a slot or the gallery: the kit's PhotoTile (thumbnail, tags,
// caption, upload state, the admin's report switch) with the actions that
// apply to it underneath: Edit and Delete, or Try again when its upload
// stopped on a failure that needs the inspector.
import { PencilIcon, RotateCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { PhotoTile, type PhotoState } from "@/components/qc";
import { Button } from "@/components/ui/button";
import type { DisplayTags } from "@/lib/inspections/photos/view";
import { cn } from "@/lib/utils";
import type { SlotPhoto } from "./photo-model";
import { useReportChoice } from "./report-choice";

/** A transparent pixel: the tile's image area stays blank (not "No preview") while a local preview is read. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * The tile's image box keeps its 4:3 shape: without a scroll container's
 * zero minimum, a portrait thumbnail's own height stretches the box and the
 * whole grid row (a kit follow-up: overflow-hidden on PhotoTile's box).
 */
const KEEP_RATIO = "[&>div:first-child]:overflow-hidden";

/**
 * A stopped upload is not "Waiting to upload": the kit's tile has no failed
 * state yet (a kit follow-up), so its state badge and progress bar, the
 * image box's only span children, give way to the card's own badge.
 */
const NO_PENDING_OVERLAYS = "[&>div:first-child>span]:hidden";

/** The kit's badge shape (PhotoTile), in fail red. */
const STOPPED_BADGE =
  "pointer-events-none absolute top-2 right-2 inline-flex h-6 items-center gap-1 rounded-full border border-fail-border bg-fail-tint px-2 text-xs font-semibold text-fail shadow-xs [&>svg]:size-3.5";

type PhotoCardProps = {
  inspectionId: string;
  photo: SlotPhoto;
  tags: DisplayTags;
  /** Says what the photo shows: its caption, else its tags. */
  alt: string;
  /** Retag, caption and delete (queued photos: on this device; uploaded ones: the user's rights). */
  canEdit: boolean;
  /** Admins choose report photos once the photo is uploaded. */
  canChooseReport: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  className?: string;
};

function tileState(photo: SlotPhoto): PhotoState {
  if (photo.state !== "uploaded") return "pending";
  return photo.flagged ? "flagged" : "uploaded";
}

export function PhotoCard({
  inspectionId,
  photo,
  tags,
  alt,
  canEdit,
  canChooseReport,
  onOpen,
  onEdit,
  onDelete,
  onRetry,
  className,
}: PhotoCardProps) {
  const report = useReportChoice(inspectionId, photo.id, photo.includeInReport);
  const failed = photo.state === "failed";
  const showActions = canEdit || failed;
  // The report choice needs the photo's row: not while it is being read after the upload.
  const reportChoice = canChooseReport && photo.state === "uploaded" && !photo.pendingRow;

  return (
    <li
      data-slot="photo-card"
      data-photo-id={photo.id}
      data-upload-state={photo.state}
      data-pending-row={photo.pendingRow || undefined}
      className={cn("relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-card shadow-xs ring-1 ring-border", className)}
    >
      <PhotoTile
        className={cn("flex-1 rounded-none shadow-none ring-0", KEEP_RATIO, failed && NO_PENDING_OVERLAYS)}
        src={photo.thumbUrl === undefined ? BLANK : (photo.thumbUrl ?? undefined)}
        alt={alt}
        tags={tags}
        caption={photo.caption ?? undefined}
        state={tileState(photo)}
        progress={Math.round(photo.progress * 100)}
        includeInReport={report.included}
        onIncludeInReportChange={reportChoice ? report.change : undefined}
        onOpen={onOpen}
      />
      {failed && (
        <>
          <span data-slot="upload-stopped" className={STOPPED_BADGE}>
            <TriangleAlertIcon aria-hidden />
            Upload stopped
          </span>
          <p className="flex items-start gap-1.5 border-t border-fail-border bg-fail-tint px-3 py-2 text-sm text-fail">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{photo.error ?? "The upload stopped."}</span>
          </p>
        </>
      )}
      {showActions && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-1.5 py-1.5">
          {failed && (
            <Button type="button" variant="ghost" size="sm" onClick={onRetry} aria-label={`Try again: ${alt}`}>
              <RotateCwIcon aria-hidden />
              Try again
            </Button>
          )}
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit tags and caption: ${alt}`}>
              <PencilIcon aria-hidden />
              Edit
            </Button>
          )}
          {(canEdit || failed) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-fail-tint hover:text-destructive"
              onClick={onDelete}
              aria-label={`${photo.queued ? "Remove" : "Delete"} photo: ${alt}`}
            >
              <Trash2Icon aria-hidden />
              {photo.queued ? "Remove" : "Delete"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

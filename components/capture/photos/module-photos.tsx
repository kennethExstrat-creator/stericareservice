"use client";

// The photos of one module (or the untagged ones) with their actions: the
// heart of PhotoSlot on the capture screen and of each module section in
// the gallery. Uploaded photos and photos still on this device show
// together; new photos are tagged with the module and what is in focus.
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { tagLine } from "@/components/qc";
import { Button } from "@/components/ui/button";
import {
  countPhotos,
  displayTags,
  EMPTY_TAG_OPTIONS,
  type PhotoTagOptions,
} from "@/lib/inspections/photos/view";
import { cn } from "@/lib/utils";
import { useAddPhotos, useInspectionMedia, usePhotoQueue, useStartPhotoQueue, type PhotoFocus } from "./hooks";
import { mediaStore } from "./media-store";
import { PhotoAddControls } from "./photo-add-controls";
import { PhotoCard } from "./photo-card";
import { PhotoDeleteDialog } from "./photo-delete-dialog";
import { PhotoEditDialog } from "./photo-edit-dialog";
import { slotPhotos, type SlotPhoto } from "./photo-model";
import { PhotoViewer, type ViewerPhoto } from "./photo-viewer";
import { PhotoViewerContext } from "./provider";
import { moduleSlotKey, NOTHING_PREPARING, photoQueueStore } from "./queue-store";
import { UploadNotices } from "./upload-notices";

export type ModulePhotosProps = {
  inspectionId: string;
  /** Module or custom module key; null for the photos not tagged yet. */
  moduleKey: string | null;
  /** The size, hand, defect or box in focus: new photos are tagged with it. */
  focus?: PhotoFocus | null;
  /** The screen's own read-only state (approved, not the user's): no adding, editing or deleting. */
  readOnly?: boolean;
  /** False when another control adds the photos (ModuleCard's buttons through useAddPhotos). */
  showAddControls?: boolean;
  /** capture: a compact block under or beside the module. gallery: a section with the module's title. */
  variant?: "capture" | "gallery";
  /** Section heading in the gallery; "Photos" on the capture screen. */
  title?: string;
  headingLevel?: 2 | 3;
  /** Notices about photos waiting on this device. The gallery shows them once, at the top. */
  showNotices?: boolean;
  /** Under the heading, e.g. the hint for untagged photos. */
  description?: ReactNode;
  className?: string;
};

/** What a photo shows, in words: its caption, else its tags with the module. */
export function photoAlt(photo: Pick<SlotPhoto, "caption" | "moduleKey" | "target">, options: PhotoTagOptions): string {
  return photo.caption?.trim() || tagLine(displayTags(photo.moduleKey, photo.target, options)) || "Photo";
}

export function toViewerPhoto(photo: SlotPhoto, options: PhotoTagOptions): ViewerPhoto {
  return {
    id: photo.id,
    alt: photoAlt(photo, options),
    src: photo.fullUrl ?? photo.thumbUrl ?? null,
    tagLine: tagLine(displayTags(photo.moduleKey, photo.target, options)),
    caption: photo.caption,
    takenAt: photo.takenAt,
    state: photo.state,
    flagged: photo.flagged,
  };
}

export function ModulePhotos({
  inspectionId,
  moduleKey,
  focus,
  readOnly = false,
  showAddControls = true,
  variant = "capture",
  title,
  headingLevel = 3,
  showNotices = true,
  description,
  className,
}: ModulePhotosProps) {
  useStartPhotoQueue();
  const headingId = useId();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  const galleryViewer = useContext(PhotoViewerContext);
  const addPhotos = useAddPhotos({ inspectionId, moduleKey, focus });

  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const options = media.media?.options ?? EMPTY_TAG_OPTIONS;
  const access = media.media?.access ?? null;
  const photos = useMemo(
    () => slotPhotos({ media: media.media, queue, inspectionId, moduleKey }),
    [media.media, queue, inspectionId, moduleKey],
  );

  // Photos kept from an earlier page have no preview in memory yet: read it from the device.
  useEffect(() => {
    for (const photo of photos) if (photo.queued && photo.thumbUrl === undefined) photoQueueStore.loadPreview(photo.id);
  }, [photos]);

  // Adding works offline and before the media has loaded (it queues); it stops only when the
  // screen is read-only, the database said no, or the queue cannot run on this device.
  const canAdd =
    !readOnly && queue.phase !== "unavailable" && media.status !== "not_found" && (access === null || access.canEdit);
  const canEditUploaded = !readOnly && access?.canEdit === true;
  const canChooseReport = access?.isAdmin === true;
  const preparing = queue.preparingByModule[moduleSlotKey(inspectionId, moduleKey)] ?? NOTHING_PREPARING;
  const queuedCount = photos.filter((photo) => photo.queued).length;

  const Heading = headingLevel === 2 ? "h2" : "h3";
  const heading = title ?? "Photos";
  const find = (id: string | null) => (id === null ? null : (photos.find((photo) => photo.id === id) ?? null));
  const editingPhoto = find(editing);
  const deletingPhoto = find(deleting);

  const remember = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = () => {
    const target = returnFocus.current;
    returnFocus.current = null;
    // The control that opened the dialog may be gone (a deleted photo): fall back to the heading.
    if (target && target.isConnected) target.focus();
    else document.getElementById(headingId)?.focus();
  };

  const open = (id: string) => {
    if (galleryViewer) galleryViewer.open(id);
    else setViewing(id);
  };

  return (
    <section
      aria-labelledby={headingId}
      data-slot="module-photos"
      data-variant={variant}
      data-module={moduleKey ?? ""}
      className={cn("@container relative flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading
          id={headingId}
          tabIndex={-1}
          className={cn(
            "font-bold text-foreground outline-none",
            variant === "gallery" ? "text-lg leading-snug" : "text-base leading-snug font-semibold",
          )}
        >
          {heading}
        </Heading>
        <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
          {countPhotos(photos.length)}
          {queuedCount > 0 ? `, ${queuedCount} not uploaded yet` : ""}
        </p>
      </div>
      {description && <div className="-mt-1 text-sm text-muted-foreground">{description}</div>}

      {showNotices && <UploadNotices inspectionId={inspectionId} />}

      {media.status === "error" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
          <CircleAlertIcon aria-hidden className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            Photos already uploaded could not be loaded. New photos are still kept and upload as usual.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void mediaStore(inspectionId).load()}>
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
        </div>
      )}

      {photos.length > 0 ? (
        <ul
          className={cn(
            "grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5",
            variant === "gallery" && "@7xl:grid-cols-6",
          )}
        >
          {photos.map((photo) => {
            const alt = photoAlt(photo, options);
            const editable = photo.queued ? canAdd : canEditUploaded;
            return (
              <PhotoCard
                key={photo.id}
                inspectionId={inspectionId}
                photo={photo}
                tags={displayTags(photo.moduleKey, photo.target, options, { withModule: false })}
                alt={alt}
                canEdit={editable}
                canChooseReport={canChooseReport}
                onOpen={() => open(photo.id)}
                onEdit={() => {
                  remember();
                  setEditing(photo.id);
                }}
                onDelete={() => {
                  remember();
                  setDeleting(photo.id);
                }}
                onRetry={() => photoQueueStore.retryNow(photo.id)}
              />
            );
          })}
        </ul>
      ) : media.status === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          Loading photos…
        </p>
      ) : variant === "capture" && preparing.photos === 0 ? (
        <p className="text-sm text-muted-foreground">{canAdd ? "No photos yet." : "No photos."}</p>
      ) : null}

      {preparing.photos > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-brand-700">
          <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
          Preparing {countPhotos(preparing.photos)}…
        </p>
      )}

      {showAddControls && canAdd && (
        <PhotoAddControls onFiles={addPhotos} target={moduleKey === null ? undefined : heading} compact={variant === "gallery"} />
      )}

      {editingPhoto && (
        <PhotoEditDialog
          inspectionId={inspectionId}
          photo={editingPhoto}
          options={options}
          alt={photoAlt(editingPhoto, options)}
          onClose={() => {
            setEditing(null);
            requestAnimationFrame(restoreFocus);
          }}
        />
      )}
      {deletingPhoto && (
        <PhotoDeleteDialog
          inspectionId={inspectionId}
          photo={deletingPhoto}
          alt={photoAlt(deletingPhoto, options)}
          onClose={() => {
            setDeleting(null);
            requestAnimationFrame(restoreFocus);
          }}
        />
      )}
      {!galleryViewer && (
        <PhotoViewer
          photos={photos.map((photo) => toViewerPhoto(photo, options))}
          openId={viewing}
          onOpenIdChange={setViewing}
        />
      )}
    </section>
  );
}

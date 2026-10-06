"use client";

// Lab reports and certificates of one module (BUILD_SPEC 8.1: force at
// break, tensile, documents): PDF or images, uploaded as they are to the
// inspection-files bucket with a row in inspection_files, through the same
// background queue as photos. A certificate must stay the document the lab
// issued, so files are never converted.
import { useId, useMemo } from "react";
import { useInspectionMedia, usePhotoQueue, useStartPhotoQueue, type PhotoFocus } from "@/components/capture/photos/hooks";
import { slotFiles } from "@/components/capture/photos/photo-model";
import { moduleSlotKey, NOTHING_PREPARING, photoQueueStore } from "@/components/capture/photos/queue-store";
import { EMPTY_TAG_OPTIONS, FILE_KIND_LABEL, countFiles } from "@/lib/inspections/photos/view";
import type { InspectionFileKind } from "@/lib/photos/files";
import { cn } from "@/lib/utils";
import { FileAddControls } from "./file-add-controls";
import { FileList } from "./file-list";

/** A file handed to the upload queue: the module can keep its id in its data. */
export interface AddedFile {
  /** The future inspection_files.id. */
  id: string;
  name: string;
  kind: InspectionFileKind;
  moduleKey: string;
  /** What was in focus when it was added, e.g. the size a tensile report is for. */
  focus: PhotoFocus | null;
}

export type FileSlotProps = {
  inspectionId: string;
  moduleKey: string;
  /** What the new files are; the list shows every file of the module with its own kind. */
  kind?: InspectionFileKind;
  /** The size or box in focus: reported with each added file (inspection_files has no target). */
  focus?: PhotoFocus | null;
  readOnly?: boolean;
  /** Heading; by default the kind ("Lab reports"). */
  title?: string;
  headingLevel?: 2 | 3;
  onAdded?: (file: AddedFile) => void;
  className?: string;
};

const PLURAL: Readonly<Record<InspectionFileKind, string>> = {
  lab_report: "Lab reports",
  certificate: "Certificates",
  other: "Documents",
};

export function FileSlot({
  inspectionId,
  moduleKey,
  kind = "lab_report",
  focus = null,
  readOnly = false,
  title,
  headingLevel = 3,
  onAdded,
  className,
}: FileSlotProps) {
  useStartPhotoQueue();
  const headingId = useId();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  const files = useMemo(
    () => slotFiles({ files: media.media?.files ?? [], queue, inspectionId, moduleKey }),
    [media.media, queue, inspectionId, moduleKey],
  );
  const access = media.media?.access ?? null;
  const canAdd = !readOnly && queue.phase !== "unavailable" && media.status !== "not_found" && (access === null || access.canEdit);
  const canEditUploaded = !readOnly && access?.canEdit === true;
  const preparing = queue.preparingByModule[moduleSlotKey(inspectionId, moduleKey)] ?? NOTHING_PREPARING;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const label = `Add ${FILE_KIND_LABEL[kind].toLowerCase()}`;

  return (
    <section
      aria-labelledby={headingId}
      data-slot="file-slot"
      data-module={moduleKey}
      className={cn("relative flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={headingId} className="text-base leading-snug font-semibold text-foreground">
          {title ?? PLURAL[kind]}
        </Heading>
        <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
          {countFiles(files.length)}
        </p>
      </div>

      {files.length > 0 ? (
        <FileList
          inspectionId={inspectionId}
          files={files}
          canEditUploaded={canEditUploaded}
          canEditQueued={canAdd}
          options={media.media?.options ?? EMPTY_TAG_OPTIONS}
        />
      ) : preparing.files === 0 ? (
        <p className="text-sm text-muted-foreground">No {PLURAL[kind].toLowerCase()} yet.</p>
      ) : null}

      {preparing.files > 0 && (
        <p role="status" className="text-sm text-brand-700">
          Preparing {countFiles(preparing.files)}…
        </p>
      )}

      {canAdd && (
        <FileAddControls
          label={label}
          onFiles={(chosen) =>
            photoQueueStore.addFiles({
              inspectionId,
              moduleKey,
              kind,
              files: chosen,
              onQueued: ({ id, name }) => onAdded?.({ id, name, kind, moduleKey, focus }),
            })
          }
        />
      )}
    </section>
  );
}

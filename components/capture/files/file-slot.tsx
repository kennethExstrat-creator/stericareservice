"use client";

// Lab reports and certificates of one module (BUILD_SPEC 8.1: force at
// break, tensile, documents): PDF or images, uploaded as they are to the
// inspection-files bucket with a row in inspection_files, through the same
// background queue as photos. A certificate must stay the document the lab
// issued, so files are never converted.
import { useCallback, useId, useMemo, useRef, type ReactNode } from "react";
import { useInspectionMedia, usePhotoQueue, useStartPhotoQueue, type PhotoFocus } from "@/components/capture/photos/hooks";
import { slotFiles, type SlotFile } from "@/components/capture/photos/photo-model";
import { moduleSlotKey, NOTHING_PREPARING } from "@/components/capture/photos/queue-state";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { EMPTY_TAG_OPTIONS, countFiles } from "@/lib/inspections/photos/view";
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
  /**
   * False while there is nothing to file a new file under (documents before
   * a document is chosen): the add controls go, the list keeps its own,
   * Delete included. Default true.
   */
  canAdd?: boolean;
  /** Heading; by default the kind ("Lab Reports"). */
  title?: string;
  headingLevel?: 2 | 3;
  onAdded?: (file: AddedFile) => void;
  /** A file of the list was deleted, or taken off this device before it uploaded: its id. */
  onRemoved?: (fileId: string) => void;
  /** Turns chosen files into what is uploaded (Source Documents: photos made JPEG for the AI). */
  prepare?: (files: File[]) => Promise<File[]>;
  /** More about a file, under its name in the list. */
  fileExtra?: (file: SlotFile) => ReactNode;
  /** Uploaded files without their kind and state line (the list's compactRows). */
  compactRows?: boolean;
  /** The add button, the picker's types and the drop hint, when not the kind's (Source Documents' videos). */
  addLabel?: string;
  accept?: string;
  hint?: string;
  /** What the files are called in the count and the empty line, when not files of the kind: ["video", "videos"]. */
  noun?: readonly [one: string, many: string];
  className?: string;
};

/** The slot's heading by kind, also the empty state's words ("No lab reports yet."). */
const PLURAL: Readonly<Record<InspectionFileKind, string>> = {
  lab_report: "Lab Reports",
  certificate: "Certificates",
  other: "Documents",
};

/** The add button by kind. */
const ADD_LABEL: Readonly<Record<InspectionFileKind, string>> = {
  lab_report: "Add Lab Report",
  certificate: "Add Certificate",
  other: "Add Document",
};

export function FileSlot({
  inspectionId,
  moduleKey,
  kind = "lab_report",
  focus = null,
  readOnly = false,
  canAdd: addable = true,
  title,
  headingLevel = 3,
  onAdded,
  onRemoved,
  prepare,
  fileExtra,
  compactRows,
  addLabel,
  accept,
  hint,
  noun,
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
  // Files on this device can change as long as the queue runs; adding also needs something to file them under.
  const canQueue = !readOnly && queue.phase !== "unavailable" && media.status !== "not_found" && (access === null || access.canEdit);
  const canAdd = canQueue && addable;
  const canEditUploaded = !readOnly && access?.canEdit === true;
  const preparing = queue.preparingByModule[moduleSlotKey(inspectionId, moduleKey)] ?? NOTHING_PREPARING;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const label = addLabel ?? ADD_LABEL[kind];
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useCallback(() => heading.current?.focus(), []);

  return (
    <section
      aria-labelledby={headingId}
      data-slot="file-slot"
      data-module={moduleKey}
      className={cn("relative flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* A focus target after the last file is deleted, not a control: no ring. */}
        <Heading ref={heading} id={headingId} tabIndex={-1} className="text-base leading-snug font-semibold text-foreground outline-none">
          {title ?? PLURAL[kind]}
        </Heading>
        <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
          {noun ? `${files.length} ${files.length === 1 ? noun[0] : noun[1]}` : countFiles(files.length)}
        </p>
      </div>

      {files.length > 0 ? (
        <FileList
          inspectionId={inspectionId}
          files={files}
          canEditUploaded={canEditUploaded}
          canEditQueued={canQueue}
          options={media.media?.options ?? EMPTY_TAG_OPTIONS}
          focusFallback={focusHeading}
          onRemoved={onRemoved}
          fileExtra={fileExtra}
          compactRows={compactRows}
        />
      ) : preparing.files === 0 ? (
        <p className="text-sm text-muted-foreground">No {noun ? noun[1] : PLURAL[kind].toLowerCase()} yet.</p>
      ) : null}

      {preparing.files > 0 && (
        <p role="status" className="text-sm text-brand-700">
          Preparing {countFiles(preparing.files)}…
        </p>
      )}

      {canAdd && (
        <FileAddControls
          label={label}
          accept={accept}
          hint={hint}
          onFiles={async (chosen) =>
            photoQueueStore.addFiles({
              inspectionId,
              moduleKey,
              kind,
              files: prepare ? await prepare(chosen) : chosen,
              onQueued: ({ id, name }) => onAdded?.({ id, name, kind, moduleKey, focus }),
            })
          }
        />
      )}
    </section>
  );
}

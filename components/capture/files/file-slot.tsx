"use client";

// Lab reports and certificates of one module (BUILD_SPEC 8.1: force at
// break, tensile, documents), and Source Documents' files: PDF or images,
// uploaded as they are to the inspection-files bucket with a row in
// inspection_files, through the same background queue as photos. A
// certificate must stay the document the lab issued, so files are never
// converted.
//
// With `pageSize` (Source Documents, ten a page; Kenneth, 27 October 2026:
// "pagination with 10 files per page, the uplaod section should be pin at the
// top"): the newest file first, the add controls above the rows, pinned
// under the capture screen's bars while the rows scroll under them, and the
// pages under the rows once there are more than ten (file-pages.ts). Adding
// files turns to page 1, where the newest are; a delete that empties the
// last page shows the one before; a file asked for opens its page.
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, type ReactNode } from "react";
import { useInspectionMedia, usePhotoQueue, useStartPhotoQueue, type PhotoFocus } from "@/components/capture/photos/hooks";
import { slotFiles, type SlotFile } from "@/components/capture/photos/photo-model";
import { moduleSlotKey, NOTHING_PREPARING } from "@/components/capture/photos/queue-state";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { EMPTY_TAG_OPTIONS, countFiles } from "@/lib/inspections/photos/view";
import type { InspectionFileKind } from "@/lib/photos/files";
import { cn } from "@/lib/utils";
import { FileAddControls } from "./file-add-controls";
import { FileList } from "./file-list";
import { FIRST_PAGE, newestFirst, pageViewAfter, type PageEvent } from "./file-pages";

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
  /** compactRows: more icon buttons for an uploaded file, before Preview. */
  fileActions?: (file: SlotFile) => ReactNode;
  /** Uploaded files without their kind and state line (the list's compactRows). */
  compactRows?: boolean;
  /**
   * Rows per page (Source Documents: FILES_PER_PAGE, 10): the newest file
   * first, the add controls pinned above the rows, the pages under them.
   * Unset, every file shows, oldest first, with the add controls below.
   */
  pageSize?: number;
  /**
   * With `pageSize`, a file to show (an issue link, a link to one file): its
   * page opens once the file is listed, its row in view and focused. Null
   * again before the same file is asked for again.
   */
  focusFileId?: string | null;
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

/**
 * Brings the list's top into view when it has scrolled up under the pinned
 * add controls: just below them. Without them (read-only), below the page's
 * scroll padding, which clears the capture screen's bars (use-sticky-offsets.ts).
 */
function revealListTop(list: HTMLElement | null, pinned: HTMLElement | null): void {
  if (!list) return;
  const top = list.getBoundingClientRect().top;
  const clear = pinned
    ? pinned.getBoundingClientRect().bottom
    : Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  if (top < clear) window.scrollBy(0, top - clear);
}

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
  fileActions,
  compactRows,
  pageSize,
  focusFileId = null,
  className,
}: FileSlotProps) {
  useStartPhotoQueue();
  const headingId = useId();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  const files = useMemo(() => {
    const oldestFirst = slotFiles({ files: media.media?.files ?? [], queue, inspectionId, moduleKey });
    return pageSize ? newestFirst(oldestFirst, media.media?.files ?? []) : oldestFirst;
  }, [media.media, queue, inspectionId, moduleKey, pageSize]);
  const access = media.media?.access ?? null;
  // Files on this device can change as long as the queue runs; adding also needs something to file them under.
  const canQueue = !readOnly && queue.phase !== "unavailable" && media.status !== "not_found" && (access === null || access.canEdit);
  const canAdd = canQueue && addable;
  const canEditUploaded = !readOnly && access?.canEdit === true;
  const preparing = queue.preparingByModule[moduleSlotKey(inspectionId, moduleKey)] ?? NOTHING_PREPARING;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const heading = title ?? PLURAL[kind];
  const label = ADD_LABEL[kind];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useCallback(() => headingRef.current?.focus(), []);

  // The page shown. A file asked for opens its page, and a delete that emptied the last page shows the one
  // before, in this very render: never a page of nothing.
  const [view, dispatch] = useReducer(pageViewAfter, FIRST_PAGE);
  const listed: PageEvent | null = pageSize ? { type: "listed", rows: files, pageSize, focusFileId } : null;
  if (listed && pageViewAfter(view, listed) !== view) dispatch(listed);
  const listArea = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  // A page turned, or files added: the rows from the top, under the pinned add controls.
  useEffect(() => {
    if (view.turns > 0) revealListTop(listArea.current, pinnedRef.current);
  }, [view.turns]);
  useEffect(() => {
    if (view.focused === null) return;
    const row = listArea.current?.querySelector<HTMLElement>(`[data-file-id="${CSS.escape(view.focused)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }, [view.focused]);

  const pinned = Boolean(pageSize) && canAdd;
  const preparingLine = preparing.files > 0 && (
    <p role="status" className="text-sm text-brand-700">
      Preparing {countFiles(preparing.files)}…
    </p>
  );
  const addControls = canAdd && (
    <FileAddControls
      label={label}
      onFiles={async (chosen) => {
        // At once, before the files are ready (photos take a moment): page 1, where they will be.
        if (pageSize) dispatch({ type: "added" });
        await photoQueueStore.addFiles({
          inspectionId,
          moduleKey,
          kind,
          files: prepare ? await prepare(chosen) : chosen,
          onQueued: ({ id, name }) => onAdded?.({ id, name, kind, moduleKey, focus }),
        });
      }}
    />
  );

  return (
    <section
      aria-labelledby={headingId}
      data-slot="file-slot"
      data-module={moduleKey}
      className={cn("relative flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* A focus target after the last file is deleted, not a control: no ring. */}
        <Heading ref={headingRef} id={headingId} tabIndex={-1} className="text-base leading-snug font-semibold text-foreground outline-none">
          {heading}
        </Heading>
        <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
          {countFiles(files.length)}
        </p>
      </div>

      {pinned && (
        // Above the rows, pinned under the capture screen's bars while they scroll under it, on the card's
        // white. The negative margins keep the gaps around it as they were, and cover the list's edge at
        // its sides; use-sticky-offsets.ts counts its height in the page's scroll padding.
        <div
          ref={pinnedRef}
          data-slot="file-add-bar"
          className="sticky top-[var(--capture-sticky-top,0px)] z-10 -mx-1 -my-2 flex flex-col gap-2 bg-card px-1 py-2"
        >
          {addControls}
          {preparingLine}
        </div>
      )}

      {files.length > 0 ? (
        <div ref={listArea} className="flex min-w-0 flex-col gap-3">
          <FileList
            inspectionId={inspectionId}
            files={files}
            canEditUploaded={canEditUploaded}
            canEditQueued={canQueue}
            options={media.media?.options ?? EMPTY_TAG_OPTIONS}
            focusFallback={focusHeading}
            onRemoved={onRemoved}
            fileExtra={fileExtra}
            fileActions={fileActions}
            compactRows={compactRows}
            paging={
              pageSize
                ? {
                    page: view.page,
                    pageSize,
                    label: `Pages of ${heading.toLowerCase()}`,
                    onPageChange: (page) => dispatch({ type: "turn", page }),
                  }
                : undefined
            }
          />
        </div>
      ) : preparing.files === 0 ? (
        <p className="text-sm text-muted-foreground">No {PLURAL[kind].toLowerCase()} yet.</p>
      ) : null}

      {!pinned && preparingLine}

      {!pageSize && addControls}
    </section>
  );
}

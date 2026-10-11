"use client";

// The lab report or certificate a step keeps, as the capture screen shows it
// (docs/AI.md, "Source Documents"; docs/MODULES.md 10.1): the renderer of a
// module's ModuleFileSlot (section-body.tsx), inside the module's attachment
// line. Every file is uploaded once, on Source Documents, and Steri-AI links
// each lab report or certificate it reads there to its step (readSourceFile,
// only where nothing is linked yet): a step links nothing by hand (Kenneth,
// 12 October 2026). Linked: the file's name, Steri-AI's mark when the file is
// a Source Document, Preview, and Unlink, which never deletes the file. A
// lab report uploaded on its step before 12 October still counts and shows
// the same, without Unlink: it counts by its step, not by a link. A kept file
// that is gone: Unlink beside calc's warning, so Steri-AI can link another.
// Nothing linked: "Steri-AI is reading the Source Documents…" while one of
// them is unread or being read, else "No lab report detected by Steri-AI.".
// Read-only: the same, without Unlink.
import { useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import { EyeIcon, SparklesIcon, UnlinkIcon } from "lucide-react";
import { FilePreviewDialog } from "@/components/capture/files/file-preview-dialog";
import { useInspectionMedia, usePhotoQueue, useStartPhotoQueue } from "@/components/capture/photos/hooks";
import { slotFiles, type SlotFile } from "@/components/capture/photos/photo-model";
import type { PhotoQueueState } from "@/components/capture/photos/queue-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SOURCE_DOCUMENTS_KEY, type SourceFileStatus } from "@/lib/inspections/source-documents";
import type { FileSlotRequest } from "@/modules/_framework/file-slot";
import type { FileKind } from "@/modules/_framework/files";

/** What the slot says once Steri-AI has read every Source Document and linked nothing here, by the kind it keeps. */
const NOT_FOUND: Readonly<Record<FileKind, string>> = {
  lab_report: "No lab report detected by Steri-AI.",
  certificate: "No certificate detected by Steri-AI.",
  other: "No document detected by Steri-AI.",
};

const READING = "Steri-AI is reading the Source Documents…";

/* ------------------------------------------------------------------ *
 * Steri-AI's reading of the Source Documents, shared with the steps
 * ------------------------------------------------------------------ */

/** What the page that reads an inspection's Source Documents knows of the readings (use-source-documents.ts). */
export type SourceReading = {
  /** Each file's reading so far, by id; null until the readings so far are known. */
  readonly statuses: Readonly<Record<string, SourceFileStatus>> | null;
  /** The page reads the files not read yet: false where it cannot change the inspection. */
  readonly reads: boolean;
};

/* One page reads an inspection's Source Documents (the capture screen's
   useSourceDocuments); every step's file line on it listens. Written only
   in the browser, from an effect: the server's answer is always null. */
const READINGS = new Map<string, SourceReading>();
const LISTENERS = new Set<() => void>();

function subscribeReadings(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/** Shares what the page knows of an inspection's readings with its file lines; null forgets it. */
export function shareSourceReading(inspectionId: string, reading: SourceReading | null): void {
  if (reading) READINGS.set(inspectionId, reading);
  else READINGS.delete(inspectionId);
  for (const listener of [...LISTENERS]) listener();
}

/**
 * For the Source Documents reader (useSourceDocuments): shares its readings
 * with the steps' file lines while it is on the page, so a line says
 * "Steri-AI is reading the Source Documents…" until the last one is read.
 */
export function useShareSourceReading(
  inspectionId: string,
  reads: boolean,
  statuses: Readonly<Record<string, SourceFileStatus>> | null,
): void {
  useEffect(() => shareSourceReading(inspectionId, { statuses, reads }), [inspectionId, reads, statuses]);
  useEffect(() => () => shareSourceReading(inspectionId, null), [inspectionId]);
}

function useSourceReading(inspectionId: string): SourceReading | null {
  const read = () => READINGS.get(inspectionId) ?? null;
  return useSyncExternalStore(subscribeReadings, read, read);
}

/**
 * Whether Steri-AI may still link a file: "reading" while one of the Source
 * Documents is still uploading, waits its turn or is being read on this
 * page; "done" once each is read or could not be, and where the page reads
 * none (read-only); "unknown" until the readings so far are known.
 */
export function sourceReadingState(files: readonly SlotFile[], reading: SourceReading | null): "unknown" | "reading" | "done" {
  if (reading === null || reading.statuses === null) return "unknown";
  if (!reading.reads) return "done";
  const statuses = reading.statuses;
  const waiting = files.some((file) => {
    if (file.moduleKey !== SOURCE_DOCUMENTS_KEY || file.state === "failed") return false;
    if (file.state !== "uploaded") return true;
    const status = statuses[file.id]?.status;
    return status === undefined || status === "reading";
  });
  return waiting ? "reading" : "done";
}

/* ------------------------------------------------------------------ *
 * The slot
 * ------------------------------------------------------------------ */

/**
 * The file a slot shows: the one kept, else, for a module that needs one of
 * its kind, the latest uploaded on its page before (calc counts it,
 * moduleFileState), never one whose upload stopped.
 */
export function shownFile(
  files: readonly SlotFile[],
  slot: Pick<FileSlotRequest, "fileId" | "moduleKey" | "kind" | "countsModuleFiles">,
): SlotFile | null {
  const kept = slot.fileId === null ? undefined : files.find((file) => file.id === slot.fileId);
  if (kept) return kept;
  if (!slot.countsModuleFiles) return null;
  const own = files.filter((file) => file.moduleKey === slot.moduleKey && file.kind === slot.kind && file.state !== "failed");
  return own[own.length - 1] ?? null;
}

/** This device's queue is read: a kept file still queued here is among the files by now (inspectionFileRefs). */
function queueKnown(queue: PhotoQueueState): boolean {
  return queue.phase === "unavailable" || (queue.phase === "ready" && queue.queue.load === "ready");
}

/**
 * Unlink takes its own button away: the focus goes to the line it was on,
 * or, where the line goes too (a documents row's file), to the first control
 * left around it, never to the page.
 */
function keepFocusNear(button: HTMLElement): void {
  const around: HTMLElement[] = [];
  for (let node = button.parentElement; node; node = node.parentElement) around.push(node);
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    for (const node of around) {
      if (!node.isConnected) continue;
      const target = node.matches("[tabindex]")
        ? node
        : node.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])");
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
  });
}

export function SourceFileLink({ inspectionId, slot, readOnly }: { inspectionId: string; slot: FileSlotRequest; readOnly: boolean }) {
  useStartPhotoQueue();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  const reading = useSourceReading(inspectionId);
  // Uploaded and still queued, every module's: a kept id may be any of them.
  const files = useMemo(
    () => slotFiles({ files: media.media?.files ?? [], queue, inspectionId, moduleKey: undefined }),
    [media.media, queue, inspectionId],
  );
  const [previewing, setPreviewing] = useState<{ name: string; url: string } | null>(null);

  const unlink = (event: MouseEvent<HTMLButtonElement>, fileId: string) => {
    keepFocusNear(event.currentTarget);
    slot.onRemoved(fileId);
  };

  const shown = shownFile(files, slot);
  if (shown) {
    const url = shown.url;
    // A step's own lab report from before counts whether or not it is kept: nothing to unlink.
    const counted = slot.countsModuleFiles && shown.moduleKey === slot.moduleKey && shown.kind === slot.kind;
    return (
      <>
        {/* The name wraps rather than hides: a documents row's column is narrow on the desktop. */}
        <div data-slot="source-file-link" data-file-id={shown.id} className="relative flex min-w-0 flex-wrap items-center gap-x-1">
          <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{shown.name}</span>
          {shown.moduleKey === SOURCE_DOCUMENTS_KEY && (
            <span data-slot="steri-ai-mark" title="Linked by Steri-AI" className="relative mr-1 inline-flex shrink-0 text-brand-600">
              <SparklesIcon aria-hidden className="size-4" />
              <span className="sr-only">Linked by Steri-AI</span>
            </span>
          )}
          {url && (
            <Button type="button" variant="ghost" size="icon-sm" title="Preview" onClick={() => setPreviewing({ name: shown.name, url })}>
              <EyeIcon aria-hidden />
              <span className="sr-only">Preview {shown.name}</span>
            </Button>
          )}
          {!readOnly && !counted && shown.id === slot.fileId && (
            <Button type="button" variant="ghost" size="icon-sm" title="Unlink" onClick={(event) => unlink(event, shown.id)}>
              <UnlinkIcon aria-hidden />
              <span className="sr-only">Unlink {shown.name}</span>
            </Button>
          )}
        </div>
        <FilePreviewDialog file={previewing} onClose={() => setPreviewing(null)} />
      </>
    );
  }

  // calc counts the kept file, whose name has not arrived yet.
  if (slot.state === "attached") return null;
  const fileId = slot.fileId;
  if (slot.state === "missing") {
    // Kept but gone (calc's warning says so beside it): unlinking it lets Steri-AI link the next one.
    if (readOnly || fileId === null || media.status !== "ready" || !queueKnown(queue)) return null;
    return (
      <span data-slot="source-file-link" data-missing="" className="relative inline-flex">
        <Button type="button" variant="ghost" size="icon-sm" title="Unlink" onClick={(event) => unlink(event, fileId)}>
          <UnlinkIcon aria-hidden />
          <span className="sr-only">Unlink the missing file</span>
        </Button>
      </span>
    );
  }

  // Nothing linked: what Steri-AI is doing about it, once the files and the readings so far are known.
  const progress = media.status === "ready" && queueKnown(queue) ? sourceReadingState(files, reading) : "unknown";
  if (progress === "unknown") return null;
  if (progress === "reading") {
    return (
      <p data-slot="source-file-link" data-reading="" className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Spinner aria-hidden className="size-4 shrink-0 text-brand-600" />
        <span>{READING}</span>
      </p>
    );
  }
  return (
    <p data-slot="source-file-link" data-empty="" className="text-muted-foreground">
      {slot.notFoundText ?? NOT_FOUND[slot.kind]}
    </p>
  );
}

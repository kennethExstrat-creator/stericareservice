"use client";

// Source Documents on the capture screen (docs/AI.md, "Source Documents"):
// each uploaded file is read once by Steri-AI, one at a time, and the screen
// fills the proposals into empty fields. The readings are kept on the file
// rows, so a file is read once, whichever device uploaded it; one it could
// not read waits for Read Again. Files uploaded together (New Inspection
// hands its documents over at once) are each read in turn.
//
// A reading takes some ten seconds and is kept on the file with its
// proposals (Kenneth, 26 October 2026: a sampling plan read while he looked
// at another page was never filled in). The screen that started it fills
// them in and records it (markSourceFilled); one that is gone by then leaves
// them waiting, and the next screen to open the inspection fills them in.
// Read Again reads a file once more, also one already read.
//
// A reading that fills values for sizes the order does not list says so in
// its message, in amber and for longer: no step shows them until the size is
// ordered (Kenneth, 27 October 2026; lib/inspections/capture not-ordered.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInspectionMedia } from "@/components/capture/photos/hooks";
import type { Status } from "@/lib/design/status";
import type { SectionProgress } from "@/lib/inspections/capture/sections";
import {
  filesToFill,
  filledMessage,
  SOURCE_DOCUMENTS_KEY,
  type SourceFileStatus,
  type SourceProposals,
} from "@/lib/inspections/source-documents";
import { getSourceDocumentStatuses, markSourceFilled, readSourceFile } from "../source-actions";
import { useShareSourceReading } from "./source-file-link";

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

/** How long a message with a note stays, as the app's other warnings do. */
const NOTE_TOAST_MS = 12_000;

/** What a reading's proposals did to the data. */
export type SourceFill = {
  /** How many values went in. */
  filled: number;
  /** A sentence about values that went in where no step shows them yet (sizes not on the order); null for none. */
  note: string | null;
};

/** Says what a reading filled in from `name`: in amber, and for longer, when it has a note. */
function toastFilled({ filled, note }: SourceFill, name: string): void {
  if (note === null) toast.success(filledMessage(filled, name));
  else toast.warning(filledMessage(filled, name, note), { duration: NOTE_TOAST_MS });
}

/** Recorded in the background: should it fail, the next screen fills the proposals in again, empty fields only. */
function recordFilled(inspectionId: string, fileId: string): void {
  markSourceFilled(inspectionId, fileId).catch(() => {});
}

export type SourceDocuments = {
  /** By file id; a file without one is not read yet. */
  statuses: Readonly<Record<string, SourceFileStatus>>;
  /** The step's result: "pass" once every uploaded file is Steri-AI Verified. */
  status: Status;
  progress: SectionProgress;
  /** Readings start here: the files wait to be read, and Read Again is offered. */
  canRead: boolean;
  retry: (fileId: string) => void;
};

export function useSourceDocuments({
  inspectionId,
  canRead,
  onProposals,
}: {
  inspectionId: string;
  /**
   * False where this screen cannot change the inspection, or the user's role
   * does not allow Steri-AI Reading: readings are shown, none started.
   */
  canRead: boolean;
  /** Fills a reading's proposals into the data; answers how many values went in, with a note on any no step shows yet. */
  onProposals: (proposals: SourceProposals) => SourceFill;
}): SourceDocuments {
  const media = useInspectionMedia(inspectionId);
  const uploaded = useMemo(
    () => (media.media?.files ?? []).filter((file) => file.moduleKey === SOURCE_DOCUMENTS_KEY),
    [media.media],
  );
  const [statuses, setStatuses] = useState<Record<string, SourceFileStatus> | null>(null);
  const reading = useRef<string | null>(null);
  const apply = useRef(onProposals);
  useEffect(() => {
    apply.current = onProposals;
  });
  // A reading that settles after the screen is gone fills nothing here: its proposals wait on the file.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getSourceDocumentStatuses(inspectionId).then(
      (found) => alive && setStatuses((current) => ({ ...found, ...current })),
      () => alive && setStatuses((current) => current ?? {}),
    );
    return () => {
      alive = false;
    };
  }, [inspectionId]);

  // The next file not read yet, once the readings so far are known and none is being read: that
  // read settling makes the next one new, so files uploaded together are each read in turn.
  const busy = statuses !== null && Object.values(statuses).some((status) => status.status === "reading");
  const next = canRead && statuses !== null && !busy ? (uploaded.find((file) => !statuses[file.id]) ?? null) : null;
  useEffect(() => {
    if (!next || reading.current !== null) return;
    const file = next;
    reading.current = file.id;
    const settle = (status: SourceFileStatus) => {
      reading.current = null;
      setStatuses((current) => ({ ...current, [file.id]: status }));
    };
    queueMicrotask(() => setStatuses((current) => ({ ...current, [file.id]: { status: "reading", summary: null } })));
    readSourceFile(inspectionId, file.id).then(
      (result) => {
        if (!alive.current) return;
        if (result.status !== "read") return settle({ status: "failed", summary: result.message });
        const fill = apply.current(result.proposals);
        recordFilled(inspectionId, file.id);
        if (fill.filled > 0) toastFilled(fill, file.name);
        else toast.success(`Steri-AI read ${file.name}: nothing new to fill.`);
        settle({ status: "read", summary: result.summary, filled: fill.filled });
      },
      () => {
        if (alive.current) settle({ status: "failed", summary: UNREACHABLE });
      },
    );
  }, [next, inspectionId]);

  // Readings kept with their files that no screen has filled in yet: filled in now, empty fields only, once.
  const filling = useRef(new Set<string>());
  const waiting = useMemo(
    () => (canRead && statuses !== null ? filesToFill(uploaded, statuses) : []),
    [canRead, statuses, uploaded],
  );
  useEffect(() => {
    for (const { file, proposals } of waiting) {
      if (filling.current.has(file.id)) continue;
      filling.current.add(file.id);
      const fill = apply.current(proposals);
      recordFilled(inspectionId, file.id);
      if (fill.filled > 0) toastFilled(fill, file.name);
      setStatuses((current) =>
        current
          ? { ...current, [file.id]: { status: "read", summary: current[file.id]?.summary ?? null, filled: fill.filled } }
          : current,
      );
    }
  }, [waiting, inspectionId]);

  const retry = useCallback((fileId: string) => {
    setStatuses((current) => {
      if (!current) return current;
      const rest = { ...current };
      delete rest[fileId];
      return rest;
    });
  }, []);

  // The steps' lab report lines say "Steri-AI is reading…" until the last file is read (source-file-link.tsx).
  useShareSourceReading(inspectionId, canRead, statuses);

  const known = statuses ?? {};
  const verified = uploaded.filter((file) => known[file.id]?.status === "read").length;
  const allVerified = uploaded.length > 0 && verified === uploaded.length;
  return {
    statuses: known,
    status: allVerified ? "pass" : "not_done",
    progress: uploaded.length === 0 ? "not_started" : allVerified ? "done" : "in_progress",
    canRead,
    retry,
  };
}

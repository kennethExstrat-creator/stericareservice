"use client";

// Source Documents on the capture screen (docs/AI.md, "Source Documents"):
// each uploaded file is read once by the AI, one at a time, and the screen
// fills the proposals into empty fields. The readings are kept on the file
// rows, so a file is read once, whichever device uploaded it; one the AI
// could not read waits for Read Again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInspectionMedia } from "@/components/capture/photos/hooks";
import type { Status } from "@/lib/design/status";
import type { SectionProgress } from "@/lib/inspections/capture/sections";
import { SOURCE_DOCUMENTS_KEY, type SourceFileStatus, type SourceProposals } from "@/lib/inspections/source-documents";
import { getSourceDocumentStatuses, readSourceFile } from "../source-actions";

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

export type SourceDocuments = {
  /** By file id; a file without one is not read yet. */
  statuses: Readonly<Record<string, SourceFileStatus>>;
  /** The step's result: "pass" once every uploaded file is AI Verified. */
  status: Status;
  progress: SectionProgress;
  retry: (fileId: string) => void;
};

export function useSourceDocuments({
  inspectionId,
  canRead,
  onProposals,
}: {
  inspectionId: string;
  /** False where this screen cannot change the inspection: readings are shown, none started. */
  canRead: boolean;
  /** Fills a reading's proposals into the data; answers how many values went in. */
  onProposals: (proposals: SourceProposals) => number;
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

  // The next file not read yet, once the readings so far are known.
  const next = canRead && statuses !== null ? (uploaded.find((file) => !statuses[file.id]) ?? null) : null;
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
        if (result.status !== "read") return settle({ status: "failed", summary: result.message });
        const filled = apply.current(result.proposals);
        toast.success(
          filled > 0
            ? `AI filled ${filled} ${filled === 1 ? "field" : "fields"} from ${file.name}.`
            : `AI read ${file.name}: nothing new to fill.`,
        );
        settle({ status: "read", summary: result.summary, filled });
      },
      () => settle({ status: "failed", summary: UNREACHABLE }),
    );
  }, [next, inspectionId]);

  const retry = useCallback((fileId: string) => {
    setStatuses((current) => {
      if (!current) return current;
      const rest = { ...current };
      delete rest[fileId];
      return rest;
    });
  }, []);

  const known = statuses ?? {};
  const verified = uploaded.filter((file) => known[file.id]?.status === "read").length;
  const allVerified = uploaded.length > 0 && verified === uploaded.length;
  return {
    statuses: known,
    status: allVerified ? "pass" : "not_done",
    progress: uploaded.length === 0 ? "not_started" : allVerified ? "done" : "in_progress",
    retry,
  };
}

"use client";

// Source Documents on the capture screen (docs/AI.md, "Source Documents"):
// one set of files for the whole inspection, kept on its first PO part
// (lib/inspections/source-group.ts), so every part shows them and uploads to
// them. Each file is read once by the AI, one at a time, for every part: this
// screen fills its own part's values into empty fields, the server fills the
// other parts and adds the POs no part has yet, and the screen then reloads
// the list of POs (router.refresh). The readings are kept on the file rows,
// so a file is read once, whichever device or part uploaded it; one being
// read elsewhere is waited for, one the AI could not read waits for Read
// Again. The files and their readings are read with the browser's client
// (RLS applies), so they never wait behind a reading: the client sends
// Server Actions one at a time.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInspectionMedia } from "@/components/capture/photos/hooks";
import type { MediaState } from "@/components/capture/photos/media-store";
import type { Status } from "@/lib/design/status";
import type { SectionProgress } from "@/lib/inspections/capture/sections";
import type { InspectionPart } from "@/lib/inspections/parts";
import { SOURCE_DOCUMENTS_KEY, type SourceFileStatus, type SourceProposals } from "@/lib/inspections/source-documents";
import { CLAIM_MS, loadSourceGroup, loadSourceReadings, sourceHomes, type SourceGroup } from "@/lib/inspections/source-group";
import { createClient } from "@/lib/supabase/client";
import { fillSourcePart, readSourceFile } from "../source-actions";

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";
/** How often a file being read elsewhere is looked at again. */
const WAIT_CHECK_MS = 15_000;
/**
 * Waited on this long, a reading elsewhere has stopped, whatever the clocks
 * say: this screen asks for the file itself, and the server's claim decides.
 */
const WAIT_LIMIT_MS = CLAIM_MS + 60_000;

export type SourceDocuments = {
  /** Where the inspection's Source Documents are kept: its first PO part, or this part; null until known. */
  homeId: string | null;
  /** Source Documents this part keeps itself besides (uploaded before it was a PO part, or offline). */
  ownFiles: number;
  /** The inspection's PO parts, first part first (one, or none, for an inspection of one PO). */
  parts: readonly InspectionPart[];
  /** By file id; a file without one is not read yet. */
  statuses: Readonly<Record<string, SourceFileStatus>>;
  /** The step's result: "pass" once every uploaded file is AI Verified. */
  status: Status;
  progress: SectionProgress;
  retry: (fileId: string) => void;
};

/**
 * The screen showing each part in this tab fills a reading's values into it
 * through its own autosave. A reading outlives its screen: by the time it
 * comes back the inspector may have opened another PO, or this one again.
 */
const screens = new Map<string, (proposals: SourceProposals) => number>();

/**
 * A reading in this tab is done, and filled `parts` on the server: a screen
 * open on one of them shows an older copy, and one waiting for the file
 * stops waiting.
 */
type ReadingDone = { fileId: string; fileName: string; summary?: string; parts: readonly string[] };
const readingsDone = new Set<(done: ReadingDone) => void>();
function announce(done: ReadingDone) {
  for (const listener of [...readingsDone]) listener(done);
}

/** The values went in on the server, not on this screen: a reload shows them. */
function offerReload(message: string) {
  toast.info(message, { duration: 30_000, action: { label: "Reload", onClick: () => window.location.reload() } });
}

function sourceFiles(state: MediaState) {
  return (state.media?.files ?? []).filter((file) => file.moduleKey === SOURCE_DOCUMENTS_KEY);
}

function filledMessage(filled: number, name: string): string {
  return filled > 0 ? `AI filled ${filled} ${filled === 1 ? "field" : "fields"} from ${name}.` : `AI read ${name}: nothing new to fill.`;
}

/** This part's values when no screen shows it any more: filled on the server instead. */
function fillOnServer(partId: string, file: { id: string; name: string }, proposals: SourceProposals) {
  const missed = (description: string) => toast.warning(`Not every value AI read from ${file.name} went in.`, { description });
  fillSourcePart(partId, proposals).then(
    (result) => {
      if ("error" in result) return missed(result.error);
      if (result.filled > 0) announce({ fileId: file.id, fileName: file.name, parts: [partId] });
    },
    () => missed(UNREACHABLE),
  );
}

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
  const router = useRouter();

  // Where the files are, and the parts: again once a reading has added or filled parts.
  const [groupVersion, setGroupVersion] = useState(0);
  const [found, setFound] = useState<(SourceGroup & { for: string }) | null>(null);
  useEffect(() => {
    let alive = true;
    const alone = { for: inspectionId, homeId: inspectionId, parts: [] };
    const again = () => setGroupVersion((version) => version + 1);
    Promise.resolve()
      .then(() => loadSourceGroup(createClient(), inspectionId))
      .then(
        (group) => alive && setFound(group ? { ...group, for: inspectionId } : alone),
        // Offline: this part's own files until the connection is back, then the group's.
        () => {
          if (!alive) return;
          setFound((current) => (current?.for === inspectionId ? current : alone));
          window.addEventListener("online", again, { once: true });
        },
      );
    return () => {
      alive = false;
      window.removeEventListener("online", again);
    };
  }, [inspectionId, groupVersion]);
  const group = found?.for === inspectionId ? found : null;
  const homeId = group?.homeId ?? null;

  const home = useInspectionMedia(homeId ?? inspectionId);
  const own = useInspectionMedia(inspectionId);
  const ownFiles = useMemo(() => (homeId === null || homeId === inspectionId ? [] : sourceFiles(own)), [homeId, inspectionId, own]);
  const uploaded = useMemo(() => (homeId === null ? [] : [...sourceFiles(home), ...ownFiles]), [homeId, home, ownFiles]);

  const [statuses, setStatuses] = useState<Record<string, SourceFileStatus> | null>(null);
  const reading = useRef<string | null>(null);
  const apply = useRef(onProposals);
  // For the checks that run outside rendering: the latest statuses and file names.
  const latest = useRef({ statuses, uploaded });
  const waitingSince = useRef(new Map<string, number>());
  // Files whose reading elsewhere this screen has heard the end of, and those it has offered a reload for.
  const heard = useRef(new Set<string>());
  const offered = useRef(new Set<string>());
  useEffect(() => {
    apply.current = onProposals;
    latest.current = { statuses, uploaded };
  });
  // Only a screen that changes the part fills it; elsewhere the server does, or says why not.
  useEffect(() => {
    if (!canRead) return;
    const fill = (proposals: SourceProposals) => apply.current(proposals);
    screens.set(inspectionId, fill);
    return () => {
      if (screens.get(inspectionId) === fill) screens.delete(inspectionId);
    };
  }, [inspectionId, canRead]);

  useEffect(() => {
    if (homeId === null) return;
    let alive = true;
    Promise.resolve()
      .then(() => loadSourceReadings(createClient(), sourceHomes(homeId, inspectionId)))
      .then(
        (readings) => alive && setStatuses((current) => ({ ...readings, ...current })),
        () => alive && setStatuses((current) => current ?? {}),
      );
    return () => {
      alive = false;
    };
  }, [homeId, inspectionId]);

  // A reading in this tab, begun on an earlier screen, is done.
  useEffect(() => {
    const listener = (done: ReadingDone) => {
      const { summary } = done;
      if (summary !== undefined) {
        setStatuses((current) =>
          current?.[done.fileId]?.elsewhere ? { ...current, [done.fileId]: { status: "read", summary } } : current,
        );
      }
      heard.current.add(done.fileId);
      if (done.parts.includes(inspectionId) && !offered.current.has(done.fileId)) {
        offered.current.add(done.fileId);
        offerReload(`AI filled this PO from ${done.fileName}. Reload to see the values.`);
      }
    };
    readingsDone.add(listener);
    return () => {
      readingsDone.delete(listener);
    };
  }, [inspectionId]);

  // The next file not read yet, once the readings so far are known.
  const next = canRead && statuses !== null ? (uploaded.find((file) => !statuses[file.id]) ?? null) : null;
  useEffect(() => {
    if (!next || reading.current !== null) return;
    const file = next;
    const partId = inspectionId;
    reading.current = file.id;
    const settle = (status: SourceFileStatus) => {
      reading.current = null;
      setStatuses((current) => ({ ...current, [file.id]: status }));
    };
    queueMicrotask(() => setStatuses((current) => ({ ...current, [file.id]: { status: "reading", summary: null } })));
    readSourceFile(partId, file.id).then(
      (result) => {
        if (result.status === "busy") {
          waitingSince.current.set(file.id, Date.now());
          return settle({ status: "reading", summary: null, elsewhere: true });
        }
        if (result.status === "done") return settle({ status: "read", summary: result.summary });
        if (result.status === "error") return settle({ status: "failed", summary: result.message });
        // This part on screen (here, or again): its values go in through the autosave, as typing does.
        const fill = screens.get(partId);
        const filled = fill ? fill(result.proposals) : 0;
        if (!fill && Object.keys(result.proposals).length > 0) fillOnServer(partId, file, result.proposals);
        toast.success(fill ? filledMessage(filled, file.name) : `AI read ${file.name}.`, {
          description: result.others || undefined,
        });
        announce({ fileId: file.id, fileName: file.name, summary: result.summary, parts: result.changedParts });
        if (result.changedParts.length > 0) {
          router.refresh();
          setGroupVersion((version) => version + 1);
        }
        settle(fill ? { status: "read", summary: result.summary, filled } : { status: "read", summary: result.summary });
      },
      () => settle({ status: "failed", summary: UNREACHABLE }),
    );
  }, [next, inspectionId, router]);

  // Files being read elsewhere: looked at again until that reading is done, or has stopped.
  const waiting = useMemo(
    () =>
      Object.entries(statuses ?? {})
        .filter(([, status]) => status.status === "reading" && status.elsewhere)
        .map(([id]) => id)
        .sort()
        .join(" "),
    [statuses],
  );
  useEffect(() => {
    if (!waiting || homeId === null) return;
    const homes = sourceHomes(homeId, inspectionId);
    const timer = window.setInterval(() => {
      Promise.resolve()
        .then(() => loadSourceReadings(createClient(), homes))
        .then((readings) => {
          if (!readings) return;
          const now = Date.now();
          const settled = new Map<string, SourceFileStatus | null>();
          for (const id of waiting.split(" ")) {
            if (!latest.current.statuses?.[id]?.elsewhere) continue;
            const there = readings[id];
            if (!waitingSince.current.has(id)) waitingSince.current.set(id, now);
            const stopped = now - (waitingSince.current.get(id) ?? now) > WAIT_LIMIT_MS;
            // Read or failed there; given back, or stopped: read here.
            if (there && there.status !== "reading") settled.set(id, there);
            else if (!there || stopped) settled.set(id, null);
          }
          if (settled.size === 0) return;
          for (const id of settled.keys()) waitingSince.current.delete(id);
          setStatuses((current) => {
            const next = { ...current };
            for (const [id, status] of settled) {
              if (!next[id]?.elsewhere) continue;
              if (status) next[id] = status;
              else delete next[id];
            }
            return next;
          });
          // Read on another device or tab: what it filled in here shows after a reload.
          for (const [id, status] of settled) {
            if (status?.status !== "read" || heard.current.has(id) || offered.current.has(id)) continue;
            heard.current.add(id);
            offered.current.add(id);
            const name = latest.current.uploaded.find((file) => file.id === id)?.name ?? "a file";
            offerReload(`AI read ${name} on another screen. Reload to see what it filled in.`);
          }
        })
        .catch(() => undefined);
    }, WAIT_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [waiting, homeId, inspectionId]);

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
    homeId,
    ownFiles: ownFiles.length,
    parts: group?.parts ?? [],
    statuses: known,
    status: allVerified ? "pass" : "not_done",
    progress: uploaded.length === 0 ? "not_started" : allVerified ? "done" : "in_progress",
    retry,
  };
}

"use client";

// Autosave for the capture screen (BUILD_SPEC 8, docs/OFFLINE.md): every
// change goes to the local IndexedDB copy at once and to the server after
// about 800 ms without changes, through the saveCaptureData Server Action.
// On load the local copy is settled against the server's (a newer local copy
// is restored and saved; a clash with another device asks the inspector).
// One controller per user and inspection: a second tab gets "busy" and
// stays read-only.
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureDataSchema } from "@/lib/inspections/capture/schemas";
import {
  createAutosave,
  getOfflineDatabase,
  type AutosaveController,
  type AutosaveSnapshot,
  type AutosaveTransport,
  type FlushResult,
  type ServerCopy,
  type StartResult,
} from "@/lib/offline";
import type { InspectionData } from "@/modules/_framework";
import { saveCaptureData } from "../actions";

/**
 * off: not editable here, nothing to save. starting: reading the local copy.
 * busy: another tab is the writer. failed: saving could not start (reload).
 */
export type AutosavePhase = "off" | "starting" | "running" | "busy" | "failed";

export type CaptureAutosave = {
  phase: AutosavePhase;
  /** Null until the controller exists. */
  snapshot: AutosaveSnapshot<InspectionData> | null;
  change: (data: InspectionData) => void;
  flush: () => Promise<FlushResult>;
  retryNow: () => void;
  /** Returns the data to show. */
  resolveConflict: (keep: "local" | "server") => InspectionData | null;
};

const transport: AutosaveTransport<InspectionData> = {
  // A Server Action cannot be aborted: the controller waits for it instead of piling up requests.
  save: ({ inspectionId, data, baseUpdatedAt }) => saveCaptureData({ inspectionId, data, baseUpdatedAt }),
};

const NOT_RUNNING: FlushResult = { ok: false, reason: "stopped", message: "Saving has not started on this page." };

export function useCaptureAutosave({
  inspectionId,
  userId,
  server,
  enabled,
  onStart,
}: {
  inspectionId: string;
  userId: string;
  /** The page's copy: data and updated_at as the server rendered them. Read once. */
  server: ServerCopy<InspectionData>;
  enabled: boolean;
  /** What the local copy decided: render its data, tell the inspector what happened. */
  onStart: (result: StartResult<InspectionData>) => void;
}): CaptureAutosave {
  const [phase, setPhase] = useState<AutosavePhase>(enabled ? "starting" : "off");
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot<InspectionData> | null>(null);
  const controller = useRef<AutosaveController<InspectionData> | null>(null);
  const initial = useRef(server);
  const startHandler = useRef(onStart);
  useEffect(() => {
    startHandler.current = onStart;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let current: AutosaveController<InspectionData> | null = null;
    let unsubscribe = () => {};

    void (async () => {
      const db = await getOfflineDatabase();
      if (cancelled) return;
      current = createAutosave<InspectionData>({
        inspectionId,
        userId,
        transport,
        store: db.store("drafts"),
        persistent: db.persistent,
        dataSchema: CaptureDataSchema,
      });
      const own = current;
      controller.current = own;
      unsubscribe = own.subscribe(() => setSnapshot(own.getSnapshot()));
      setSnapshot(own.getSnapshot());
      const result = await own.start(initial.current);
      if (cancelled) return;
      startHandler.current(result);
      setPhase(result.kind === "busy" ? "busy" : "running");
      setSnapshot(own.getSnapshot());
    })().catch((error: unknown) => {
      console.error("[capture] autosave could not start", error);
      if (!cancelled) setPhase("failed");
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (controller.current === current) controller.current = null;
      // Writes the local copy a last time and lets go of the lock; unsaved changes wait for the next start.
      void current?.stop();
    };
  }, [enabled, inspectionId, userId]);

  const change = useCallback((data: InspectionData) => {
    const own = controller.current;
    if (!own) return;
    try {
      own.change(data);
    } catch (error) {
      // Not running (another tab, or stopping): the screen is read-only then.
      console.error("[capture] change not kept", error);
    }
  }, []);

  const flush = useCallback(() => controller.current?.flush() ?? Promise.resolve(NOT_RUNNING), []);
  const retryNow = useCallback(() => controller.current?.retryNow(), []);
  const resolveConflict = useCallback((keep: "local" | "server") => {
    const own = controller.current;
    if (!own) return null;
    try {
      return own.resolveConflict(keep);
    } catch (error) {
      console.error("[capture] conflict not resolved", error);
      return null;
    }
  }, []);

  return { phase, snapshot, change, flush, retryNow, resolveConflict };
}

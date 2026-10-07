"use client";

// Autosave for the capture screen (BUILD_SPEC 8, docs/OFFLINE.md): every
// change goes to the local IndexedDB copy at once and to the server after
// about 800 ms without changes, through the saveCaptureData Server Action.
// On load the local copy is settled against the server's (a newer local copy
// is restored and saved; a clash with another device asks the inspector).
// One controller per user and inspection: a second tab gets "busy" and
// stays read-only. Leaving the screen (Photos, Review, the menu, Back) sends
// what is waiting before the controller stops, so the review and other
// devices see it without this one opening the inspection again.
import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureDataSchema } from "@/lib/inspections/capture/schemas";
import {
  AUTOSAVE_LOCK_WAIT_MS,
  createAutosave,
  getOfflineDatabase,
  type AutosaveController,
  type AutosaveSnapshot,
  type AutosaveTransport,
  type FlushResult,
  type SaveOutcome,
  type ServerCopy,
  type StartResult,
} from "@/lib/offline";
import type { InspectionData } from "@/modules/_framework";
import { saveCaptureData, type CaptureSaveOutcome, type CaptureServerState } from "../actions";

/**
 * off: not editable here, nothing to save. starting: reading the local copy.
 * busy: another tab is the writer. failed: saving could not start (reload).
 */
export type AutosavePhase = "off" | "starting" | "running" | "busy" | "failed";

export type CaptureAutosave = {
  phase: AutosavePhase;
  /** Null until the controller exists. */
  snapshot: AutosaveSnapshot<InspectionData> | null;
  /**
   * The controller's state now, even within the event that just changed it
   * (`snapshot` is as of the last render): for a page that is about to go.
   */
  getSnapshot: () => AutosaveSnapshot<InspectionData> | null;
  change: (data: InspectionData) => void;
  flush: (options?: { timeoutMs?: number }) => Promise<FlushResult>;
  retryNow: () => void;
  /** Returns the data to show. */
  resolveConflict: (keep: "local" | "server") => InspectionData | null;
};

/**
 * How long leaving the screen waits for its last save. Below the time a
 * screen opened again waits for the writer lock (AUTOSAVE_LOCK_WAIT_MS), so
 * coming straight back never finds the inspection "open in another tab". A
 * save still on its way then lands anyway; the next start recognises it.
 */
export const LEAVE_FLUSH_MS = AUTOSAVE_LOCK_WAIT_MS - 1_000;

/** The outcome as lib/offline knows it, without the screen's extra. */
function plainOutcome(outcome: CaptureSaveOutcome): SaveOutcome<InspectionData> {
  if (outcome.ok) return { ok: true, updatedAt: outcome.updatedAt };
  if (outcome.reason === "conflict") return { ok: false, reason: "conflict", server: outcome.server };
  return outcome.message === undefined
    ? { ok: false, reason: outcome.reason }
    : { ok: false, reason: outcome.reason, message: outcome.message };
}

/** The Server Action as the autosave's transport; the inspection's state goes to the screen. */
function captureTransport(onState: (state: CaptureServerState) => void): AutosaveTransport<InspectionData> {
  return {
    // A Server Action cannot be aborted: the controller waits for it instead of piling up requests.
    save: async ({ inspectionId, data, baseUpdatedAt }) => {
      const outcome = await saveCaptureData({ inspectionId, data, baseUpdatedAt });
      if (outcome.state) onState(outcome.state);
      return plainOutcome(outcome);
    },
  };
}

const NOT_RUNNING: FlushResult = { ok: false, reason: "stopped", message: "Saving has not started on this page." };

export function useCaptureAutosave({
  inspectionId,
  userId,
  server,
  enabled,
  onStart,
  onServerState,
}: {
  inspectionId: string;
  userId: string;
  /** The page's copy: data and updated_at as the server rendered them. Read once. */
  server: ServerCopy<InspectionData>;
  enabled: boolean;
  /** What the local copy decided: render its data, tell the inspector what happened. */
  onStart: (result: StartResult<InspectionData>) => void;
  /** The status and module overrides a save found (actions.ts, CaptureServerState). */
  onServerState: (state: CaptureServerState) => void;
}): CaptureAutosave {
  const [phase, setPhase] = useState<AutosavePhase>(enabled ? "starting" : "off");
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot<InspectionData> | null>(null);
  const controller = useRef<AutosaveController<InspectionData> | null>(null);
  const initial = useRef(server);
  const startHandler = useRef(onStart);
  const stateHandler = useRef(onServerState);
  useEffect(() => {
    startHandler.current = onStart;
    stateHandler.current = onServerState;
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
        // Answers that arrive after the screen has gone change nothing on it.
        transport: captureTransport((state) => {
          if (!cancelled) stateHandler.current(state);
        }),
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
      const leaving = current;
      if (!leaving) return;
      // Leaving the screen: send what is waiting now, then write the local copy a last time and
      // let go of the lock. Whatever is not on the server by then waits for the next start.
      void leaving.flush({ timeoutMs: LEAVE_FLUSH_MS }).finally(() => leaving.stop());
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

  const flush = useCallback(
    (options?: { timeoutMs?: number }) => controller.current?.flush(options) ?? Promise.resolve(NOT_RUNNING),
    [],
  );
  const retryNow = useCallback(() => controller.current?.retryNow(), []);
  const getSnapshot = useCallback(() => controller.current?.getSnapshot() ?? null, []);
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

  return { phase, snapshot, getSnapshot, change, flush, retryNow, resolveConflict };
}

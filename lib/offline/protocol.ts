import { z } from "zod";
import { FAILURE_REASONS, type FailureReason } from "./failures";

/* ------------------------------------------------------------------ *
 * The autosave transport: how the controller hands data to the server.
 * The real one is a Server Action or a Supabase update (docs/OFFLINE.md,
 * "The transport"); tests use a fake server.
 * ------------------------------------------------------------------ */

/**
 * The server's copy of an inspection's data. `updatedAt` is
 * inspections.updated_at exactly as Postgres returned it: an opaque
 * version. Never pass it through Date, which drops the microseconds and
 * makes every compare-and-set miss.
 */
export interface ServerCopy<T> {
  data: T;
  updatedAt: string;
}

export interface SaveRequest<T> {
  inspectionId: string;
  data: T;
  /** The version this data was edited from: write only if the server is still at it. */
  baseUpdatedAt: string;
  /** Aborted when the request runs past the controller's timeout. A Server Action may ignore it. */
  signal: AbortSignal;
}

export type SaveOutcome<T> =
  | { ok: true; updatedAt: string }
  /** The server moved past baseUpdatedAt (and is still editable): here is its copy. */
  | { ok: false; reason: "conflict"; server: ServerCopy<T> }
  | { ok: false; reason: FailureReason; message?: string };

export interface AutosaveTransport<T> {
  /**
   * Compare-and-set: write `data` only while the row's updated_at equals
   * `baseUpdatedAt`. A transport that throws is treated as a network
   * failure and retried.
   */
  save(request: SaveRequest<T>): Promise<SaveOutcome<T>>;
}

/* ------------------------------------------------------------------ *
 * Wire schemas for a Server Action transport: the request crosses from
 * the browser to the server, the outcome comes back.
 * ------------------------------------------------------------------ */

export function saveRequestSchema<T>(data: z.ZodType<T>) {
  return z.object({
    inspectionId: z.uuid(),
    data,
    baseUpdatedAt: z.string().min(1),
  });
}

export function saveOutcomeSchema<T>(data: z.ZodType<T>) {
  return z.union([
    z.object({ ok: z.literal(true), updatedAt: z.string().min(1) }),
    z.object({
      ok: z.literal(false),
      reason: z.literal("conflict"),
      server: z.object({ data, updatedAt: z.string().min(1) }),
    }),
    z.object({ ok: z.literal(false), reason: z.enum(FAILURE_REASONS), message: z.string().optional() }),
  ]);
}

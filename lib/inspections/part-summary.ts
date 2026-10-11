// An inspection of several POs as one row of the list (PO parts,
// lib/inspections/parts.ts; Kenneth, 11 October 2026). Each part keeps its
// own status and result; the row shows what they add up to, and says Mixed
// when they differ. Pure and client-safe.
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";

/**
 * The workflow from least to most advanced. A reopened part is back with its
 * inspector, so it is behind a submitted one, but ahead of a draft that was
 * never submitted. public.parts_status() (migration 20261011150400) uses the
 * same order for the list's status filter.
 */
export const STATUS_PROGRESS: readonly InspectionStatus[] = ["draft", "reopened", "submitted", "approved"];

/**
 * Results from the worst: Failed, On Hold, Not Done (null: no final result
 * yet), Passed. One failed PO makes the inspection's row read Failed; it
 * reads Passed only when every PO passed.
 */
export const RESULT_SEVERITY: readonly (InspectionResult | null)[] = ["fail", "hold", null, "pass"];

export type Summed<T> = { value: T; mixed: boolean };

function summed<T>(values: readonly T[], order: readonly T[]): Summed<T> {
  if (values.length === 0) throw new Error("an inspection has at least one part");
  const value = values.reduce((least, next) => (order.indexOf(next) < order.indexOf(least) ? next : least));
  return { value, mixed: values.some((other) => other !== values[0]) };
}

/** The inspection's status: its parts' when they agree, else the least advanced (`mixed`). */
export function summedStatus(statuses: readonly InspectionStatus[]): Summed<InspectionStatus> {
  return summed(statuses, STATUS_PROGRESS);
}

/** The inspection's result: its parts' when they agree, else the worst (`mixed`). */
export function summedResult(results: readonly (InspectionResult | null)[]): Summed<InspectionResult | null> {
  return summed(results, RESULT_SEVERITY);
}

/** "+1 PO", "+2 POs": the parts after the first, beside the first part's PO. */
export function morePosLabel(count: number): string {
  return `+${count} ${count === 1 ? "PO" : "POs"}`;
}

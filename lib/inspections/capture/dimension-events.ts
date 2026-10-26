// The audit rows a capture save writes with its data (Kenneth, 26 October
// 2026): a Dimension P/F set by hand "with comment recorded and audit logged
// (due to special action by inspector)", and a Dimension spec set for the
// inspection, by hand or read from a document ("the specification should be
// adjustable, manually or AI auto"). The server works them out from the data
// it read and the data it saves, never from what the browser says, and
// saveCaptureData writes them in the save's own transaction
// (public.save_inspection_with_events). Each row keeps the template's words,
// the readings' verdict and the specs of that moment, so the Audit Log reads
// as the screen did.
import { formatSpec, type Spec } from "@/lib/stats";
import type { Json } from "@/lib/supabase/database.types";
import type { ModuleEvaluation } from "@/modules/_framework";
import { readModuleEntry, type InspectionData } from "@/modules/_framework/data";
import { specFor } from "@/modules/dimensions/calc";
import { DimensionsConfigSchema, type Measure } from "@/modules/dimensions/config";
import {
  DimensionsDataSchema,
  manualResultChanges,
  specOverrideChanges,
  type DimensionsData,
} from "@/modules/dimensions/schema";

export const PASS_FAIL_CHANGED = "pass_fail_changed";
export const SPEC_CHANGED = "spec_changed";

/** An audit row a save writes: its action and what it records. */
export type AuditEvent = { action: string; changes: { [key: string]: Json } };

/** The module's evaluation of the data saved: its words, config and verdicts. */
type DimensionsEvaluation = Pick<ModuleEvaluation, "title" | "labels" | "config" | "computed">;

/** What pass_fail_changed records. `from` and `to` are the P/F set by hand; null where the readings decide. */
export type PassFailChange = {
  module: string;
  moduleTitle: string;
  size: string;
  column: string;
  columnLabel: string;
  from: "pass" | "fail" | null;
  to: "pass" | "fail" | null;
  /** The readings' own verdict when the change was saved: pass, fail, not_done. */
  calculated: string | null;
  /** The inspector's reason for `to`; null when it was given back to the readings. */
  comment: string | null;
  previousComment: string | null;
};

/**
 * What spec_changed records. `from` and `to` are the specs the column is
 * judged by before and after: the one set for the inspection, else the
 * template's; null when there is none. The texts are as the screen prints them.
 */
export type SpecChange = {
  module: string;
  moduleTitle: string;
  size: string;
  column: string;
  columnLabel: string;
  from: Spec | null;
  to: Spec | null;
  fromText: string;
  toText: string;
  /** The template's spec, which applies whenever none is set for the inspection. */
  template: Spec | null;
  /** set: where the template's applied; changed: one set for another; cleared: back to the template's. */
  change: "set" | "changed" | "cleared";
};

function dimensionsOf(data: InspectionData): DimensionsData | null {
  const entry = readModuleEntry(data, "modules", "dimensions");
  if (!entry.hasData) return null;
  const parsed = DimensionsDataSchema.safeParse(entry.value);
  return parsed.success ? parsed.data : null;
}

/**
 * Every audit row a save from `before` (what the server read) to `after`
 * (what it writes) records for Dimension: the specs first, then the P/F set
 * by hand. `dimensions` is the module's evaluation of `after`.
 */
export function dimensionEvents(
  before: InspectionData,
  after: InspectionData,
  dimensions: DimensionsEvaluation | undefined,
): AuditEvent[] {
  return [...specEvents(before, after, dimensions), ...passFailEvents(before, after, dimensions)];
}

/** The pass_fail_changed rows: one per P/F set by hand, changed (result or comment) or given back. */
export function passFailEvents(
  before: InspectionData,
  after: InspectionData,
  dimensions: Pick<DimensionsEvaluation, "title" | "labels" | "computed"> | undefined,
): AuditEvent[] {
  const labels = dimensions?.labels ?? {};
  const computed = dimensions?.computed as { calculated?: Record<string, Record<string, string>> } | undefined;
  return manualResultChanges(dimensionsOf(before), dimensionsOf(after)).map(({ size, measure, from, to }) => {
    const change: PassFailChange = {
      module: "dimensions",
      moduleTitle: dimensions?.title ?? "Dimension",
      size,
      column: measure,
      columnLabel: labels[measure] ?? measure,
      from: from?.result ?? null,
      to: to?.result ?? null,
      calculated: computed?.calculated?.[size]?.[measure] ?? null,
      comment: to?.comment ?? null,
      previousComment: from?.comment ?? null,
    };
    return { action: PASS_FAIL_CHANGED, changes: change };
  });
}

/** The spec_changed rows: one per spec set for the inspection, changed or given back to the template's. */
export function specEvents(
  before: InspectionData,
  after: InspectionData,
  dimensions: Pick<DimensionsEvaluation, "title" | "labels" | "config"> | undefined,
): AuditEvent[] {
  const labels = dimensions?.labels ?? {};
  const config = DimensionsConfigSchema.safeParse(dimensions?.config);
  const templateSpec = (size: string, measure: Measure): Spec | null =>
    config.success ? (specFor(config.data, size, measure) ?? null) : null;
  return specOverrideChanges(dimensionsOf(before), dimensionsOf(after)).map(({ size, measure, from, to }) => {
    const template = templateSpec(size, measure);
    const judgedBefore = from ?? template;
    const judgedAfter = to ?? template;
    const change: SpecChange = {
      module: "dimensions",
      moduleTitle: dimensions?.title ?? "Dimension",
      size,
      column: measure,
      columnLabel: labels[measure] ?? measure,
      from: judgedBefore,
      to: judgedAfter,
      fromText: specText(judgedBefore),
      toText: specText(judgedAfter),
      template,
      change: from === null ? "set" : to === null ? "cleared" : "changed",
    };
    return { action: SPEC_CHANGED, changes: change as unknown as { [key: string]: Json } };
  });
}

/** "≥ 240", "0.18 ± 0.04", "NA"; "no spec" where neither the inspection nor the template has one. */
export function specText(spec: Spec | null | undefined): string {
  return spec ? formatSpec(spec) : "no spec";
}

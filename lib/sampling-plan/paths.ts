// Where the sampling plan for the manufacturer prints, and when it may
// (Kenneth, 27 October 2026: "though the whole inspection is not done,
// sampling plan should be can be exported once the sampling plan section is
// done"): /inspections/[id]/sampling-plan/print renders its one A4 landscape
// page at true size for the browser's print dialog, which saves the PDF.
// Client-safe and light: the Sampling Plan's Capture reads it too.
import type { ModuleStatus } from "@/lib/schemas/module-result";

export function samplingPlanPrintPath(inspectionId: string): string {
  return `/inspections/${encodeURIComponent(inspectionId)}/sampling-plan/print`;
}

/** Back from the print route: the inspection's Sampling Plan step. */
export function samplingPlanStepPath(inspectionId: string): string {
  return `/inspections/${encodeURIComponent(inspectionId)}?module=sampling_plan`;
}

/**
 * The Sampling Plan step is complete, so its plan can go to the manufacturer:
 * its result is a pass, complete with nothing to pass or fail (info, the tick
 * named "Done"; lib/inspections/capture/sections.ts stepIcon), or complete with
 * a warning (the plan's print bar names it). Whatever the rest of the
 * inspection, draft or read-only.
 */
export function samplingPlanReady(status: ModuleStatus | null | undefined): boolean {
  // Warnings included: a plan with a warning is complete (Kenneth, 27 October 2026: "once the sampling plan section is done").
  return status === "pass" || status === "info" || status === "warn";
}

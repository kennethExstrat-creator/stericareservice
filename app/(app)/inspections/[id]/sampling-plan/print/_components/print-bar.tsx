"use client";

// The sampling plan's bar over its page, never printed: what it is, Back to
// the inspection's Sampling Plan, and Print / Save as PDF, which opens the
// browser's print dialog (choose Save as PDF there). Export Sampling Plan
// waits for the step to be complete, warnings allowed; this address may still
// be opened before then. A line says what to look at: counts not entered (they
// print as dashes), or the step's warnings.
import Link from "next/link";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { samplingPlanReady } from "@/lib/sampling-plan/paths";
import type { ModuleStatus } from "@/lib/schemas/module-result";

export const PLAN_NOT_COMPLETE = "The Sampling Plan is not complete yet: counts not entered print as dashes.";
export const PLAN_HAS_WARNINGS = "The Sampling Plan step has warnings: check them before you send it.";

/** What the bar says over a plan with warnings, or whose step is not complete; null over a plan that is Done. */
export function planNotice(status: ModuleStatus): string | null {
  if (status === "warn") return PLAN_HAS_WARNINGS;
  if (samplingPlanReady(status)) return null;
  return status === "not_done" ? PLAN_NOT_COMPLETE : PLAN_HAS_WARNINGS;
}

export type SamplingPlanPrintBarProps = {
  refNo: string;
  /** The Sampling Plan step's result. */
  status: ModuleStatus;
  backHref: string;
};

export function SamplingPlanPrintBar({ refNo, status, backHref }: SamplingPlanPrintBarProps) {
  const notice = planNotice(status);
  return (
    <div
      data-slot="sampling-plan-print-bar"
      className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl bg-card px-5 py-3 shadow-sm ring-1 ring-border print:hidden"
    >
      <div className="min-w-0">
        <h1 className="text-lg leading-snug font-bold text-foreground">{refNo} Sampling Plan</h1>
        <p className="text-sm text-muted-foreground touch:text-base">
          1 page · A4 landscape, for the manufacturer. In the print dialog, choose Save as PDF.
        </p>
        {notice && <p className="mt-1 text-sm font-medium text-warn touch:text-base">{notice}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={backHref}>
            <ArrowLeftIcon aria-hidden />
            Back
          </Link>
        </Button>
        <Button type="button" onClick={() => window.print()}>
          <PrinterIcon aria-hidden />
          Print / Save as PDF
        </Button>
      </div>
    </div>
  );
}

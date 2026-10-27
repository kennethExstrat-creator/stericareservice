import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SamplingPlanDocument } from "@/components/sampling-plan";
import { requireUser } from "@/lib/auth/session";
import { buildInspectionExport, parseInspectionId } from "@/lib/export";
import { todayInMalaysia } from "@/lib/inspections/create";
import { buildSamplingPlanModel, samplingPlanFileName } from "@/lib/sampling-plan/model";
import { samplingPlanStepPath } from "@/lib/sampling-plan/paths";
import { createClient } from "@/lib/supabase/server";
import { SamplingPlanPrintBar } from "./_components/print-bar";
import { SamplingPlanPrintStyles } from "./_components/print-styles";

/**
 * The plan built once per request, for the title and the page, as the
 * report's print route builds its report: the inspection export (BUILD_SPEC
 * 9.1) read through the signed-in user's client, with the export's own rule
 * on top (canExportInspection: the inspection's inspector, their lead
 * inspector or an admin), so whoever may print the report may print its
 * sampling plan, and anyone else gets the same 404 as for an inspection that
 * does not exist. The session is checked first. An inspection with no
 * Sampling Plan step has none to print.
 */
const loadPlan = cache(async (id: string) => {
  const user = await requireUser();
  const inspectionId = parseInspectionId(id);
  if (!inspectionId) notFound();
  const result = await buildInspectionExport(await createClient(), inspectionId, {
    viewer: { id: user.id, role: user.role, isLead: user.isLead },
  });
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    // The app's error screen offers Try again: nothing prints without the export.
    throw new Error(result.message);
  }
  const model = buildSamplingPlanModel(result.export);
  if (!model) notFound();
  return { inspectionId, model };
});

/** What the browser's Save as PDF names the file: "2026-10-27_sampling-plan_PO-0001" (samplingPlanFileName). */
export async function generateMetadata({ params }: PageProps<"/inspections/[id]/sampling-plan/print">): Promise<Metadata> {
  const { id } = await params;
  const { model } = await loadPlan(id);
  return { title: { absolute: samplingPlanFileName(model, todayInMalaysia()) } };
}

/**
 * /inspections/[id]/sampling-plan/print (Kenneth, 27 October 2026; BUILD_SPEC
 * section 10): the sampling plan for the manufacturer, to prepare the samples
 * before the inspector arrives, on one A4 landscape page at its true size for
 * the browser's print dialog to save as a PDF. Export Sampling Plan on the
 * Sampling Plan step opens it in a new tab once the step is Done, on a draft
 * as on a read-only inspection: the rest of the inspection need not be done.
 * A slim bar over the page (never printed) offers Print / Save as PDF and
 * Back. It renders inside the app shell, whose padding it keeps on screen.
 */
export default async function SamplingPlanPrintPage({ params }: PageProps<"/inspections/[id]/sampling-plan/print">) {
  const { id } = await params;
  const { inspectionId, model } = await loadPlan(id);
  return (
    <div className="flex w-full flex-col">
      <SamplingPlanPrintStyles />
      <SamplingPlanPrintBar refNo={model.refNo} status={model.status} backHref={samplingPlanStepPath(inspectionId)} />
      {/* At true size: a page wider than the screen scrolls across rather than shrinking. */}
      <div className="overflow-x-auto rounded-xl bg-slate-200/70 p-6 print:overflow-visible print:bg-transparent print:p-0">
        <SamplingPlanDocument model={model} className="w-fit min-w-full [&_[data-sampling-plan-page]]:shadow-md" />
      </div>
    </div>
  );
}

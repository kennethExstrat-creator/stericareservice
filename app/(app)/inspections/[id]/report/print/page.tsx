import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ReportDocument } from "@/components/report";
import { requireUser, userCan } from "@/lib/auth/session";
import { buildInspectionExport, parseInspectionId } from "@/lib/export";
import { buildReportModel } from "@/lib/report/model";
import { REPORT_AUTO_PRINT_PARAM, reportPagePath } from "@/lib/report/paths";
import { createClient } from "@/lib/supabase/server";
import { ReportPrintBar } from "./_components/print-bar";
import { ReportPrintStyles } from "./_components/print-styles";

/**
 * The report built once per request, for the title and the page: the
 * inspection export (BUILD_SPEC 9.1) read through the signed-in user's
 * client, with the export's own rule on top (canExportInspection: the
 * inspection's inspector, their lead inspector or an admin), so whoever may
 * download the export may print the report, and anyone else gets the same
 * 404 as for an inspection that does not exist. The session is checked
 * first, then the role's Export Reports, as the export route checks it.
 */
const loadReport = cache(async (id: string) => {
  const user = await requireUser();
  if (!userCan(user, "export_reports")) notFound();
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
  return { inspectionId, refNo: result.export.refNo, model: buildReportModel(result.export) };
});

/** The reference and the report's title: what the browser's Save as PDF names the file. */
export async function generateMetadata({ params }: PageProps<"/inspections/[id]/report/print">): Promise<Metadata> {
  const { id } = await params;
  const { refNo, model } = await loadReport(id);
  return { title: { absolute: `${refNo} ${model.chrome.title}` } };
}

/**
 * /inspections/[id]/report/print (docs/REPORT.md): the inspection's report
 * in the new design, every page at its true size, for the browser's print
 * dialog to save as a PDF. A slim bar over the pages (never printed) offers
 * Print / Save as PDF and Back; `?print=1` (Download PDF on the Report page)
 * opens the dialog by itself once the pages are ready. The print rules put
 * nothing but the pages on paper, one sheet each. It renders inside the app
 * shell, whose padding it keeps on screen.
 */
export default async function ReportPrintPage({ params, searchParams }: PageProps<"/inspections/[id]/report/print">) {
  const { id } = await params;
  const [{ inspectionId, refNo, model }, query] = await Promise.all([loadReport(id), searchParams]);
  const pages = model.pageCount === 1 ? "1 page" : `${model.pageCount} pages`;
  return (
    <div className="flex w-full flex-col">
      <ReportPrintStyles paper={model.paper} />
      <ReportPrintBar
        refNo={refNo}
        summary={`${pages} · ${model.paper.label}`}
        backHref={reportPagePath(inspectionId)}
        autoPrint={query[REPORT_AUTO_PRINT_PARAM] === "1"}
      />
      {/* At true size: a page wider than the screen scrolls across rather than shrinking. */}
      <div className="overflow-x-auto rounded-xl bg-slate-200/70 p-6 print:overflow-visible print:bg-transparent print:p-0">
        <ReportDocument model={model} className="w-fit min-w-full [&_[data-report-page]]:shadow-md" />
      </div>
    </div>
  );
}

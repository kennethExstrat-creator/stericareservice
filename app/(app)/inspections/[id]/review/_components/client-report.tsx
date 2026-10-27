// The client's report from the review (Kenneth, 27 October 2026: "put
// report generation to a convenient place"): which report and paper the
// inspection's Report page has chosen, Download PDF, which opens the
// report's print page in a new tab where the browser saves the PDF, and
// Report Options, the inspection's Report page, where the title, content
// and photos are chosen. Only for those who may download it: the inspection's
// inspector and admins, with Export Reports (the Report page's own rule).
import Link from "next/link";
import { ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportPagePath, reportPrintPath } from "@/lib/report/paths";
import { REPORT_PAGE_SIZES, REPORT_TEMPLATES, type ReportOptions } from "@/lib/schemas/report-options";

/** "Standard Preshipment Report · A4". */
export function reportLine(options: Pick<ReportOptions, "template" | "pageSize">): string {
  const template = REPORT_TEMPLATES.find((entry) => entry.value === options.template)?.label ?? "Report";
  const paper = REPORT_PAGE_SIZES.find((entry) => entry.value === options.pageSize)?.label;
  return paper ? `${template} · ${paper}` : template;
}

export function ClientReport({ inspectionId, options }: { inspectionId: string; options: ReportOptions }) {
  return (
    <section
      id="client-report"
      aria-labelledby="client-report-heading"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-card px-5 py-4 shadow-sm ring-1 ring-border"
    >
      <PageSketch />
      <div className="min-w-0 flex-1">
        <h2 id="client-report-heading" className="text-lg leading-snug font-bold text-foreground">
          Client Report
        </h2>
        <p className="text-base text-muted-foreground fine:text-sm">{reportLine(options)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="link" className="px-0">
          <Link href={reportPagePath(inspectionId)}>
            Report Options
            <ChevronRightIcon aria-hidden />
          </Link>
        </Button>
        <Button asChild>
          <a href={reportPrintPath(inspectionId, { autoPrint: true })} target="_blank" rel="noopener">
            <DownloadIcon aria-hidden />
            Download PDF
          </a>
        </Button>
      </div>
    </section>
  );
}

/**
 * A first page in outline, as the Report page draws its preview: white on
 * the card, the running header in slate, the title bar brand-50 with a
 * brand-700 rule, text and a table in slate. Decoration only.
 */
function PageSketch() {
  return (
    <span
      aria-hidden
      className="flex h-[4.75rem] w-14 shrink-0 flex-col gap-1 rounded-[3px] border border-slate-300 bg-card px-1.5 py-1.5"
    >
      <span className="h-0.5 w-3/5 bg-slate-600" />
      <span className="h-2 border-b-2 border-brand-700 bg-brand-50" />
      <span className="h-0.5 bg-slate-200" />
      <span className="h-0.5 w-4/5 bg-slate-200" />
      <span className="h-3 bg-slate-100" />
      <span className="h-0.5 w-2/3 bg-slate-200" />
    </span>
  );
}

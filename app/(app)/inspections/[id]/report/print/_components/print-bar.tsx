"use client";

// The print route's slim bar over the pages, never printed: what is shown
// (the reference, the pages, the paper), Back to the inspection's Report
// page, and Print / Save as PDF, which opens the browser's print dialog
// (choose Save as PDF there). Opened by Download PDF (`?print=1`), the
// dialog opens by itself once the fonts and photos have loaded, so the PDF
// is never taken half-drawn; the address then loses the query, so a reload
// does not print again.
import Link from "next/link";
import { useEffect } from "react";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Resolves once every web font and every image on the page has loaded (or failed). */
export function pageReady(doc: Document = document): Promise<void> {
  const images = Array.from(doc.images)
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    );
  return Promise.all([doc.fonts?.ready, ...images]).then(() => undefined);
}

export type ReportPrintBarProps = {
  refNo: string;
  /** "9 pages · A4". */
  summary: string;
  backHref: string;
  autoPrint: boolean;
};

export function ReportPrintBar({ refNo, summary, backHref, autoPrint }: ReportPrintBarProps) {
  useEffect(() => {
    if (!autoPrint) return;
    let cancelled = false;
    void pageReady().then(() => {
      if (cancelled) return;
      window.history.replaceState(window.history.state, "", window.location.pathname);
      window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [autoPrint]);

  return (
    <div
      data-slot="report-print-bar"
      data-auto-print={autoPrint || undefined}
      className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl bg-card px-5 py-3 shadow-sm ring-1 ring-border print:hidden"
    >
      <div className="min-w-0">
        <h1 className="text-lg leading-snug font-bold text-foreground">{refNo} Report</h1>
        <p className="text-sm text-muted-foreground touch:text-base">{summary}. In the print dialog, choose Save as PDF.</p>
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

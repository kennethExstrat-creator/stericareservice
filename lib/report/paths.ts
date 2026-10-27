// Where the report prints: /inspections/[id]/report/print renders every page
// at true size for the browser's print dialog, which saves the PDF. Download
// PDF opens it with `?print=1`, so the dialog opens by itself once the pages
// are ready; without it the page waits for Print / Save as PDF.

/** The query that opens the print dialog on arrival. */
export const REPORT_AUTO_PRINT_PARAM = "print";

export function reportPrintPath(inspectionId: string, options: { autoPrint?: boolean } = {}): string {
  const path = `/inspections/${encodeURIComponent(inspectionId)}/report/print`;
  return options.autoPrint ? `${path}?${REPORT_AUTO_PRINT_PARAM}=1` : path;
}

/** Back from the print route: the inspection's Report page. */
export function reportPagePath(inspectionId: string): string {
  return `/inspections/${encodeURIComponent(inspectionId)}?module=report`;
}

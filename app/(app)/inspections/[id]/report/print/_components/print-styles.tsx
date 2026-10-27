// The print route's print rules: the paper at its size with no margin, so
// each report page is one sheet, and nothing but the pages on paper (the app
// shell, the toolbar and the toasts go; the elements around the pages give
// up their boxes). Scoped to this route: printing any other screen prints it
// as it is. Plain CSS in the page, since the paper changes with the options.
import type { ReportPaper } from "@/lib/report/model";

export function printCss(paper: Pick<ReportPaper, "width" | "height">): string {
  return `
@page { size: ${paper.width}mm ${paper.height}mm; margin: 0; }
@media print {
  html, body { background: #ffffff !important; }
  body { display: block !important; min-height: 0 !important; margin: 0 !important; }
  body *:not([data-report-document]):not([data-report-document] *):not(:has([data-report-document])) { display: none !important; }
  body *:has([data-report-document]) { display: contents !important; }
  [data-report-document] { display: block !important; }
  [data-report-page] {
    width: ${paper.width}mm !important;
    height: calc(${paper.height}mm - 0.2mm) !important;
    margin: 0 !important;
    box-shadow: none !important;
    outline: none !important;
    break-inside: avoid;
  }
  [data-report-page]:last-child { break-after: auto !important; }
}`.trim();
}

export function ReportPrintStyles({ paper }: { paper: Pick<ReportPaper, "width" | "height"> }) {
  return <style data-slot="report-print-styles">{printCss(paper)}</style>;
}

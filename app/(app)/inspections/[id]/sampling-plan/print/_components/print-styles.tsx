// The sampling plan's print rules: A4 landscape with no margin, so its page
// is one sheet at its true size, and nothing but the page on paper (the app
// shell, the bar and the toasts go; the elements around the page give up
// their boxes). Scoped to this route: printing any other screen prints it as
// it is.
export const SAMPLING_PLAN_PRINT_CSS = `
@page { size: A4 landscape; margin: 0; }
@media print {
  html, body { background: #ffffff !important; }
  body { display: block !important; min-height: 0 !important; margin: 0 !important; }
  body *:not([data-sampling-plan]):not([data-sampling-plan] *):not(:has([data-sampling-plan])) { display: none !important; }
  body *:has([data-sampling-plan]) { display: contents !important; }
  [data-sampling-plan] { display: block !important; }
  [data-sampling-plan-page] {
    width: 297mm !important;
    height: calc(210mm - 0.2mm) !important;
    margin: 0 !important;
    box-shadow: none !important;
    outline: none !important;
    break-inside: avoid;
    break-after: auto !important;
  }
}`.trim();

export function SamplingPlanPrintStyles() {
  return <style data-slot="sampling-plan-print-styles">{SAMPLING_PLAN_PRINT_CSS}</style>;
}

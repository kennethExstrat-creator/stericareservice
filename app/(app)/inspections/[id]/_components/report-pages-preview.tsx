"use client";

// The Report page's preview: the report's own pages (components/report),
// drawn at their true size and zoomed to the preview's width, never above
// it, so what is seen is what Download PDF prints. The width is measured as
// the column changes; before the first measure the pages show at half size.
// Zoom In and Zoom Out step through ZOOM_STEPS from there, past the width
// too, the preview scrolling sideways (Kenneth, 27 October 2026: "give a +
// and - to zoom in and out the report in the preview section").
import { useEffect, useRef, useState } from "react";
import { ReportDocument } from "@/components/report";
import type { ReportModel } from "@/lib/report/model";

/** CSS pixels in a millimetre. */
const PX_PER_MM = 96 / 25.4;
/** Until the column is measured (and in the server's render). */
export const FIRST_ZOOM = 0.5;

/** The zooms + and - step through, as a share of true size. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;

/** The step after `current` going in (1) or out (-1), from wherever it is; at either end, that end. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const past = direction > 0 ? ZOOM_STEPS.find((step) => step > current + 0.005) : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.005);
  return past ?? (direction > 0 ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : ZOOM_STEPS[0]);
}

/** The zoom that fits a page of `paperWidth` millimetres into `width` pixels, never above true size. */
export function fitZoom(width: number | null, paperWidth: number): number {
  if (width === null || !(width > 0) || !(paperWidth > 0)) return FIRST_ZOOM;
  return Math.min(1, width / (paperWidth * PX_PER_MM));
}

export function ReportPagesPreview({
  model,
  zoom: chosen = null,
  onFit,
}: {
  model: ReportModel;
  /** A zoom chosen with + or -; null fits the pages to the width. */
  zoom?: number | null;
  /** Hears the zoom that fits the width, as the column changes: what + and - step from. */
  onFit?: (fit: number) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = fitZoom(width, model.paper.width);
  useEffect(() => onFit?.(fit), [fit, onFit]);
  const zoom = chosen ?? fit;
  return (
    <div ref={frame} data-slot="report-preview-pages" className="w-full">
      <div data-zoom={zoom.toFixed(3)} style={{ zoom }}>
        <ReportDocument model={model} className="[&_[data-report-page]]:shadow-md [&_[data-report-page]]:ring-1 [&_[data-report-page]]:ring-slate-200" />
      </div>
    </div>
  );
}

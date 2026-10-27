"use client";

// The Report page's preview: the report's own pages (components/report),
// drawn at their true size and zoomed to the preview's width, never above
// it, so what is seen is what Download PDF prints. The width is measured as
// the column changes; before the first measure the pages show at half size.
import { useEffect, useRef, useState } from "react";
import { ReportDocument } from "@/components/report";
import type { ReportModel } from "@/lib/report/model";

/** CSS pixels in a millimetre. */
const PX_PER_MM = 96 / 25.4;
/** Until the column is measured (and in the server's render). */
export const FIRST_ZOOM = 0.5;

/** The zoom that fits a page of `paperWidth` millimetres into `width` pixels, never above true size. */
export function fitZoom(width: number | null, paperWidth: number): number {
  if (width === null || !(width > 0) || !(paperWidth > 0)) return FIRST_ZOOM;
  return Math.min(1, width / (paperWidth * PX_PER_MM));
}

export function ReportPagesPreview({ model }: { model: ReportModel }) {
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

  const zoom = fitZoom(width, model.paper.width);
  return (
    <div ref={frame} data-slot="report-preview-pages" className="w-full">
      <div data-zoom={zoom.toFixed(3)} style={{ zoom }}>
        <ReportDocument model={model} className="[&_[data-report-page]]:shadow-md [&_[data-report-page]]:ring-1 [&_[data-report-page]]:ring-slate-200" />
      </div>
    </div>
  );
}

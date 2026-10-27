// Marks along a track of 1 to N (the design's page 2, the sampled box/carton
// numbers): each sampled number a short blue line at its place in the lot,
// so the spread from the lot's start to its end shows at a glance, and one
// that breaks the rules (outside the lot, entered twice) in fail red; the
// numbers themselves can follow under the track, and the range at its right.
// Set at the design's sizes: the size large and bold, the rest at body size.
import type { ReactNode } from "react";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

/** A number's place on a track of 1 to `total`, 0 to 1: 1 at the start, `total` at the end. */
export function stripPosition(mark: number, total: number): number {
  if (!(total > 1)) return 0.5;
  return Math.min(1, Math.max(0, (mark - 1) / (total - 1)));
}

export type StripRow = {
  key: string;
  /** "S". */
  label: string;
  /** Under the label: "16 of 1,120". */
  sublabel?: ReactNode;
  marks: readonly number[];
  /** Marks drawn in fail red: numbers outside the lot, or entered twice. */
  failing?: readonly number[];
  /** The track's end: the lot's size. */
  total: number;
  /** Under the track, as printed: "015 066 196 …". */
  numbers?: ReactNode;
};

export type StripPlotProps = {
  rows: readonly StripRow[];
  label: string;
  className?: string;
};

/** The marks in drawing order: a failing one last, so no blue mark hides it. */
function marksOf(row: StripRow): { mark: number; failing: boolean }[] {
  const failing = new Set(row.failing ?? []);
  const ordered = [...row.marks.filter((mark) => !failing.has(mark)), ...row.marks.filter((mark) => failing.has(mark))];
  return ordered.map((mark) => ({ mark, failing: failing.has(mark) }));
}

export function StripPlot({ rows, label, className }: StripPlotProps) {
  return (
    <figure data-slot="report-strip-plot" aria-label={label} className={cn("grid grid-cols-[25mm_minmax(0,1fr)_15mm] gap-x-[3mm] gap-y-[3mm]", className)}>
      {rows.map((row) => (
        <div key={row.key} data-row={row.key} className="contents">
          <div>
            <p className="text-[11pt] leading-[1.25] font-bold text-slate-900">{row.label}</p>
            {row.sublabel && <div className={cn("text-slate-600 tabular-nums", TYPE.body)}>{row.sublabel}</div>}
          </div>
          <div className="min-w-0">
            <div className="relative h-[5.6mm] rounded-[1.2mm] bg-brand-100">
              {marksOf(row).map(({ mark, failing }, index) => (
                <span
                  key={`${mark}-${index}`}
                  aria-hidden
                  data-mark={mark}
                  data-failing={failing || undefined}
                  className={cn("absolute top-[0.9mm] h-[3.8mm] w-[0.5mm] -translate-x-1/2 rounded-full", failing ? "bg-fail-solid" : "bg-brand-600")}
                  style={{ left: `calc(1.5mm + (100% - 3mm) * ${stripPosition(mark, row.total).toFixed(4)})` }}
                />
              ))}
            </div>
            {row.numbers && <div className={cn("mt-[1.2mm] text-slate-600 tabular-nums [word-spacing:0.6mm]", TYPE.body)}>{row.numbers}</div>}
          </div>
          <p className={cn("pt-[0.4mm] text-right whitespace-nowrap text-slate-600 tabular-nums", TYPE.body)}>
            {row.total > 0 ? `1–${formatCount(row.total)}` : ""}
          </p>
        </div>
      ))}
    </figure>
  );
}

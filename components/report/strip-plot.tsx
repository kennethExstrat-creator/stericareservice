// Marks along a track of 1 to N (the design's page 2, the sampled box/carton
// numbers): each sampled number a short blue line at its place in the lot,
// so the spread from the lot's start to its end shows at a glance; the
// numbers themselves can follow under the track, and the range at its right.
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
  sublabel?: string;
  marks: readonly number[];
  /** The track's end: the lot's size. */
  total: number;
  /** Under the track, as printed: "015 066 196 …". */
  numbers?: string;
};

export type StripPlotProps = {
  rows: readonly StripRow[];
  label: string;
  className?: string;
};

export function StripPlot({ rows, label, className }: StripPlotProps) {
  return (
    <figure data-slot="report-strip-plot" aria-label={label} className={cn("grid grid-cols-[30mm_minmax(0,1fr)_18mm] gap-x-[3mm] gap-y-[3mm]", className)}>
      {rows.map((row) => (
        <div key={row.key} data-row={row.key} className="contents">
          <div>
            <p className={cn("font-bold text-slate-900", TYPE.body)}>{row.label}</p>
            {row.sublabel && <p className={cn("text-slate-600", TYPE.small)}>{row.sublabel}</p>}
          </div>
          <div className="min-w-0">
            <div className="relative h-[5.6mm] rounded-[1.2mm] bg-brand-100">
              {row.marks.map((mark, index) => (
                <span
                  key={`${mark}-${index}`}
                  aria-hidden
                  data-mark={mark}
                  className="absolute top-[0.9mm] h-[3.8mm] w-[0.5mm] -translate-x-1/2 rounded-full bg-brand-600"
                  style={{ left: `calc(1.5mm + (100% - 3mm) * ${stripPosition(mark, row.total).toFixed(4)})` }}
                />
              ))}
            </div>
            {row.numbers && <p className={cn("mt-[1.2mm] text-slate-600 tabular-nums [word-spacing:0.6mm]", TYPE.small)}>{row.numbers}</p>}
          </div>
          <p className={cn("pt-[0.8mm] text-right text-slate-600 tabular-nums", TYPE.small)}>
            {row.total > 0 ? `1–${formatCount(row.total)}` : ""}
          </p>
        </div>
      ))}
    </figure>
  );
}

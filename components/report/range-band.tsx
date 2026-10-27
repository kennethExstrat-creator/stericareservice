// A measure against its tolerance, a row per size (the design's page 3, palm width
// against size tolerance): the band the spec allows in light blue, the range
// measured as a dark bar, the median as a teal ring, along one axis. The
// row's note (the spec and the median) sits at its right.
import type { Axis } from "@/lib/report/geometry";
import { position } from "@/lib/report/geometry";
import { cn } from "@/lib/utils";
import { along, AsideLines, AxisTicks, plainTick, type AsideLine } from "./chart-parts";
import { TYPE } from "./theme";

export type RangeBandRow = {
  key: string;
  label: string;
  /** The tolerance band: bandEdges(spec, axis) from lib/report/geometry. Null for NA. */
  band?: { from: number; to: number } | null;
  /** The lowest and highest reading. */
  range?: { min: number; max: number } | null;
  median?: number | null;
  aside?: readonly AsideLine[];
};

export type RangeBandProps = {
  rows: readonly RangeBandRow[];
  axis: Axis;
  format?: (value: number) => string;
  label: string;
  className?: string;
};

/** The left and the width of a stretch of the axis, as CSS percentages, clamped to the plot. */
export function stretch(from: number, to: number, axis: Pick<Axis, "min" | "max">): { left: string; width: string } {
  const start = position(Math.min(from, to), axis);
  const end = position(Math.max(from, to), axis);
  return { left: `${(start * 100).toFixed(3)}%`, width: `${((end - start) * 100).toFixed(3)}%` };
}

export function RangeBand({ rows, axis, format = plainTick, label, className }: RangeBandProps) {
  const hasAside = rows.some((row) => row.aside && row.aside.length > 0);
  const columns = hasAside ? "grid-cols-[12mm_minmax(0,1fr)_42mm]" : "grid-cols-[12mm_minmax(0,1fr)]";
  return (
    <figure data-slot="report-range-band" aria-label={label} className={cn("grid items-stretch gap-y-[1.4mm]", columns, className)}>
      {rows.map((row) => (
        <div key={row.key} data-row={row.key} className="contents">
          <p className={cn("flex items-center font-bold text-slate-900", TYPE.body)}>{row.label}</p>
          <div className="relative h-[9mm]">
            <span aria-hidden className="absolute inset-x-0 top-[1.5mm] h-[6mm] rounded-[1.2mm] bg-slate-100" />
            {row.band && (
              <span
                aria-hidden
                data-slot="report-band"
                data-from={row.band.from}
                data-to={row.band.to}
                className="absolute top-[1.5mm] h-[6mm] rounded-[1.2mm] border-[0.3mm] border-brand-300 bg-brand-100"
                style={stretch(row.band.from, row.band.to, axis)}
              />
            )}
            {row.range && (
              <span
                aria-hidden
                data-slot="report-range"
                className="absolute top-[3.8mm] h-[1.4mm] min-w-[0.6mm] rounded-full bg-brand-900"
                style={stretch(row.range.min, row.range.max, axis)}
              />
            )}
            {row.median !== null && row.median !== undefined && (
              <span
                aria-hidden
                data-slot="report-median"
                data-median={row.median}
                className="absolute top-[2.9mm] size-[3.2mm] -translate-x-1/2 rounded-full border-[0.8mm] border-accent-700 bg-white"
                style={{ left: along(row.median, axis) }}
              />
            )}
          </div>
          {hasAside && <AsideLines lines={row.aside} className="pl-[4mm]" />}
        </div>
      ))}
      <span />
      <AxisTicks axis={axis} format={format} />
      {hasAside && <span />}
    </figure>
  );
}

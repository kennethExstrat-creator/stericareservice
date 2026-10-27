// Every reading as a dot, a row per size (the design's page 3, glove length; page 5,
// force at break): dots stack where readings repeat, a teal triangle under
// the baseline marks the median, a dashed red line marks the minimum with
// the reject zone tinted below it, and the axis's ticks run along the
// bottom. The row's note sits at its right.
import { stackDots, stackHeight, type Axis } from "@/lib/report/geometry";
import { cn } from "@/lib/utils";
import { along, AsideLines, AxisTicks, GridLines, LimitLine, plainTick, type AsideLine } from "./chart-parts";
import { TYPE } from "./theme";

export type DotPlotRow = {
  key: string;
  /** "S". */
  label: string;
  values: readonly (number | null | undefined)[];
  median?: number | null;
  /** At the row's right: "Median 243 mm", "Range 242 to 245". */
  aside?: readonly AsideLine[];
};

export type DotPlotProps = {
  rows: readonly DotPlotRow[];
  axis: Axis;
  /** A limit: a dashed red line, the zone that rejects tinted ("below" a minimum, "above" a maximum). */
  limit?: { value: number; side?: "below" | "above" } | null;
  /** Readings within this of each other stack: the readings' precision (1 mm, 0.1 N). */
  step?: number;
  format?: (value: number) => string;
  /** What a screen reader hears the chart called; the rows' notes follow in text. */
  label: string;
  className?: string;
};

/** A dot's diameter and the rise of each dot stacked on another, in millimetres. */
export const DOT = { size: 2.6, rise: 2.8, baseline: 3.2, rowMin: 12 } as const;

/** A row's height: room for its tallest stack over the baseline and the median's mark under it. */
export function dotRowHeight(stack: number): number {
  return Math.max(DOT.rowMin, DOT.baseline + stack * DOT.rise + 2.4);
}

export function DotPlot({ rows, axis, limit, step = 0, format = plainTick, label, className }: DotPlotProps) {
  const hasAside = rows.some((row) => row.aside && row.aside.length > 0);
  const columns = hasAside ? "grid-cols-[12mm_minmax(0,1fr)_42mm]" : "grid-cols-[12mm_minmax(0,1fr)]";
  return (
    <figure data-slot="report-dot-plot" aria-label={label} className={cn("grid items-stretch", columns, className)}>
      {rows.map((row) => {
        const dots = stackDots(row.values, step);
        const height = dotRowHeight(stackHeight(dots));
        return (
          <div key={row.key} data-row={row.key} className="contents">
            <p className={cn("flex items-center font-bold text-slate-900", TYPE.body)}>{row.label}</p>
            <div className="relative" style={{ height: `${height}mm` }}>
              {limit && (
                <span
                  aria-hidden
                  data-slot="report-reject-zone"
                  className="absolute top-0 bottom-0 bg-fail-tint"
                  style={limit.side === "above" ? { left: along(limit.value, axis), right: 0 } : { left: 0, width: along(limit.value, axis) }}
                />
              )}
              <GridLines axis={axis} />
              {limit && <LimitLine value={limit.value} axis={axis} />}
              <span aria-hidden className="absolute right-0 left-0 h-[0.3mm] bg-slate-400" style={{ bottom: `${DOT.baseline}mm` }} />
              {dots.map((dot, index) => (
                <span
                  key={index}
                  aria-hidden
                  data-dot={dot.value}
                  data-level={dot.level}
                  className="absolute -translate-x-1/2 rounded-full bg-brand-600"
                  style={{
                    left: along(dot.value, axis),
                    bottom: `${DOT.baseline + 0.3 + dot.level * DOT.rise}mm`,
                    width: `${DOT.size}mm`,
                    height: `${DOT.size}mm`,
                  }}
                />
              ))}
              {row.median !== null && row.median !== undefined && (
                <svg
                  aria-hidden
                  data-slot="report-median"
                  data-median={row.median}
                  viewBox="0 0 10 8"
                  className="absolute -translate-x-1/2 fill-accent-700"
                  style={{ left: along(row.median, axis), bottom: `${DOT.baseline - 2.6}mm`, width: "2.6mm", height: "2.1mm" }}
                >
                  <path d="M5 0 L10 8 L0 8 Z" />
                </svg>
              )}
            </div>
            {hasAside && <AsideLines lines={row.aside} className="pl-[4mm]" />}
          </div>
        );
      })}
      <span />
      <AxisTicks axis={axis} format={format} marked={limit ? [limit.value] : []} extra={limit ? [limit.value] : []} />
      {hasAside && <span />}
    </figure>
  );
}

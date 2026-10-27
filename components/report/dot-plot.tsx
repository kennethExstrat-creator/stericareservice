// Every reading as a dot, a row per size (the design's page 3, glove length; page 5,
// force at break): dots stack where readings repeat, a teal triangle under
// the baseline marks the median, a dashed red line marks the minimum with
// the reject zone tinted below it, and the axis's ticks run along the
// bottom. The row's note sits at its right.
import { stackDots, stackHeight, type Axis } from "@/lib/report/geometry";
import { cn } from "@/lib/utils";
import { along, AsideLines, AxisTicks, GridLines, LimitLine, plainTick, type AsideLine } from "./chart-parts";
import { TYPE } from "./theme";

/** A limit across a row: a dashed red line, the zone that rejects tinted ("below" a minimum, "above" a maximum). */
export type DotPlotLimit = { value: number; side?: "below" | "above" };

export type DotPlotRow = {
  key: string;
  /** "S". */
  label: string;
  values: readonly (number | null | undefined)[];
  median?: number | null;
  /** At the row's right: "Median 243 mm", "Range 242 to 245". */
  aside?: readonly AsideLine[];
  /** The row's own limits in place of the plot's `limit`: a size with its own spec, or a range's two. */
  limits?: readonly DotPlotLimit[];
};

export type DotPlotProps = {
  rows: readonly DotPlotRow[];
  axis: Axis;
  /** A limit across every row: a dashed red line, the zone that rejects tinted ("below" a minimum, "above" a maximum). */
  limit?: DotPlotLimit | null;
  /** Readings within this of each other stack: the readings' precision (1 mm, 0.1 N). */
  step?: number;
  /** The dots' sizes where a page needs them tighter (TG35 page 3, four sizes of thirteen gloves); DOT's otherwise. */
  geometry?: Partial<DotGeometry>;
  format?: (value: number) => string;
  /** What a screen reader hears the chart called; the rows' notes follow in text. */
  label: string;
  className?: string;
};

/** A dot's diameter, the rise of each dot stacked on another, the baseline's height, a row's least height and the room over its stack, in millimetres. */
export const DOT = { size: 2.6, rise: 2.8, baseline: 3.2, rowMin: 12, headroom: 2.4 } as const;

export type DotGeometry = { size: number; rise: number; baseline: number; rowMin: number; headroom: number };

/** A row's height: room for its tallest stack over the baseline and the median's mark under it. */
export function dotRowHeight(stack: number, dot: DotGeometry = DOT): number {
  return Math.max(dot.rowMin, dot.baseline + stack * dot.rise + dot.headroom);
}

export function DotPlot({ rows, axis, limit, step = 0, geometry, format = plainTick, label, className }: DotPlotProps) {
  const shape: DotGeometry = { ...DOT, ...geometry };
  const hasAside = rows.some((row) => row.aside && row.aside.length > 0);
  const columns = hasAside ? "grid-cols-[12mm_minmax(0,1fr)_42mm]" : "grid-cols-[12mm_minmax(0,1fr)]";
  const shared = limit ? [limit] : [];
  // Every limit's tick in red, the plot's and the rows' own.
  const marked = [...new Set([...shared, ...rows.flatMap((row) => row.limits ?? [])].map((entry) => entry.value))];
  return (
    <figure data-slot="report-dot-plot" aria-label={label} className={cn("grid items-stretch", columns, className)}>
      {rows.map((row) => {
        const dots = stackDots(row.values, step);
        const height = dotRowHeight(stackHeight(dots), shape);
        const limits = row.limits ?? shared;
        return (
          <div key={row.key} data-row={row.key} className="contents">
            <p className={cn("flex items-center font-bold text-slate-900", TYPE.body)}>{row.label}</p>
            <div className="relative" style={{ height: `${height}mm` }}>
              {limits.map((entry, index) => (
                <span
                  key={index}
                  aria-hidden
                  data-slot="report-reject-zone"
                  className="absolute top-0 bottom-0 bg-fail-tint"
                  style={entry.side === "above" ? { left: along(entry.value, axis), right: 0 } : { left: 0, width: along(entry.value, axis) }}
                />
              ))}
              <GridLines axis={axis} />
              {limits.map((entry, index) => (
                <LimitLine key={index} value={entry.value} axis={axis} />
              ))}
              <span aria-hidden className="absolute right-0 left-0 h-[0.3mm] bg-slate-400" style={{ bottom: `${shape.baseline}mm` }} />
              {dots.map((dot, index) => (
                <span
                  key={index}
                  aria-hidden
                  data-dot={dot.value}
                  data-level={dot.level}
                  className="absolute -translate-x-1/2 rounded-full bg-brand-600"
                  style={{
                    left: along(dot.value, axis),
                    bottom: `${shape.baseline + 0.3 + dot.level * shape.rise}mm`,
                    width: `${shape.size}mm`,
                    height: `${shape.size}mm`,
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
                  style={{ left: along(row.median, axis), bottom: `${shape.baseline - 2.6}mm`, width: "2.6mm", height: "2.1mm" }}
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
      <AxisTicks axis={axis} format={format} marked={marked} extra={marked} />
      {hasAside && <span />}
    </figure>
  );
}

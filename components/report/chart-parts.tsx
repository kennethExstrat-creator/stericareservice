// Parts the report's charts share (the design's pages 2 to 8): a value's place along
// the plot as a percentage, the axis's tick labels under it, faint grid
// lines at the ticks, a limit as a dashed red line, and the lines of text at
// a row's right ("Median 243 mm", "Range 242 to 245"). The charts are HTML
// and CSS, placed by lib/report/geometry.ts: text wraps and sits at the
// report's own sizes at any width, and prints as drawn.
import type { CSSProperties, ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { position, type Axis } from "@/lib/report/geometry";
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

/** A value's place along the plot, as CSS: "37.5%". */
export function along(value: number, axis: Pick<Axis, "min" | "max">): string {
  return `${(position(value, axis) * 100).toFixed(3)}%`;
}

/** A tick's label: the number as stored, less binary noise. */
export const plainTick = (value: number) => formatNumber(value);

/** A line of a row's note at its right: words, then the figure in bold ("Median **243 mm**"). */
export type AsideLine = { text: string; strong?: string };

export function AsideLines({ lines, className }: { lines?: readonly AsideLine[]; className?: string }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div data-slot="report-chart-aside" className={cn("flex flex-col justify-center text-slate-900", TYPE.small, className)}>
      {lines.map((line, index) => (
        <p key={index} className="tabular-nums">
          {line.text}
          {line.strong !== undefined && <span className="font-bold"> {line.strong}</span>}
        </p>
      ))}
    </div>
  );
}

export type AxisTicksProps = {
  axis: Axis;
  format?: (value: number) => string;
  /** Ticks drawn in red and bold: a minimum. */
  marked?: readonly number[];
  /** Extra marked labels where no tick falls: a minimum of 70 on a 0 to 100 axis stepped by 20. */
  extra?: readonly number[];
  className?: string;
};

/** The tick labels along the bottom of a plot, each centred on its value. */
export function AxisTicks({ axis, format = plainTick, marked = [], extra = [], className }: AxisTicksProps) {
  const values = [...axis.ticks, ...extra.filter((value) => !axis.ticks.includes(value))];
  return (
    <div data-slot="report-axis" aria-hidden className={cn("relative h-[4.6mm]", TYPE.tiny, className)}>
      {values.map((value) => {
        const isMarked = marked.includes(value);
        return (
          <span
            key={value}
            data-tick={value}
            className={cn("absolute top-[0.8mm] -translate-x-1/2 tabular-nums whitespace-nowrap", isMarked ? "font-bold text-fail" : "text-slate-600")}
            style={{ left: along(value, axis) }}
          >
            {format(value)}
          </span>
        );
      })}
    </div>
  );
}

/** Faint vertical lines at the ticks, behind a plot's marks. */
export function GridLines({ axis, className }: { axis: Axis; className?: string }) {
  return (
    <>
      {axis.ticks.map((value) => (
        <span
          key={value}
          aria-hidden
          className={cn("absolute top-0 bottom-0 w-[0.25mm] -translate-x-1/2 bg-slate-100", className)}
          style={{ left: along(value, axis) }}
        />
      ))}
    </>
  );
}

/** A limit across a plot: a dashed red line. */
export function LimitLine({ value, axis, className, style }: { value: number; axis: Axis; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      data-slot="report-limit-line"
      className={cn("absolute top-0 bottom-0 -translate-x-1/2 border-l-[0.3mm] border-dashed border-fail", className)}
      style={{ left: along(value, axis), ...style }}
    />
  );
}

/** A chart's key: swatches and words in a row, at the top right of its block (the design's "● One glove ▲ Median"). */
export function ChartKey({ items, className }: { items: readonly { key: string; swatch: ReactNode; label: string; tone?: "fail" }[]; className?: string }) {
  return (
    <ul data-slot="report-chart-key" className={cn("flex flex-wrap items-center justify-end gap-x-[4mm] gap-y-[1mm] text-slate-600", TYPE.small, className)}>
      {items.map((item) => (
        <li key={item.key} className={cn("flex items-center gap-[1.4mm]", item.tone === "fail" && "font-semibold text-fail")}>
          <span aria-hidden className="inline-flex items-center">
            {item.swatch}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// Horizontal bars (the design's page 3, weight per glove; page 7, average layering
// and dispensing): one bar per row with its figure at the end, or a group
// of bars per row, one per series, each with its minimum as a dashed red
// line across its lane. Bars start at the axis's start; a minimum's tick is
// labelled in red under the plot.
import type { ReactNode } from "react";
import type { Status } from "@/lib/design/status";
import type { Axis } from "@/lib/report/geometry";
import { position } from "@/lib/report/geometry";
import { cn } from "@/lib/utils";
import { along, AsideLines, AxisTicks, GridLines, plainTick, type AsideLine } from "./chart-parts";
import { StatusChip } from "./status-chip";
import { TYPE } from "./theme";

/** A bar's length along the plot as CSS, from the axis's start. */
export function barLength(value: number, axis: Pick<Axis, "min" | "max">): string {
  return `${(position(value, axis) * 100).toFixed(3)}%`;
}

export type HBarRow = {
  key: string;
  label: string;
  value: number | null;
  /** The figure at the bar's end: "3.3 g". */
  display?: string;
  /** The bar and its figure in a status colour: a value out of its spec (fail), or one with a warning. */
  tone?: "fail" | "warn" | null;
};

const BAR_TONE = { fail: "bg-fail-solid", warn: "bg-warn-solid" } as const;
const FIGURE_TONE = { fail: "font-semibold text-fail", warn: "font-semibold text-warn" } as const;

export type HBarsProps = {
  rows: readonly HBarRow[];
  axis: Pick<Axis, "min" | "max">;
  /** A dashed red line at a minimum across every row. */
  minimum?: number | null;
  label: string;
  className?: string;
};

/** One bar per row: the design's weight per glove. */
export function HBars({ rows, axis, minimum, label, className }: HBarsProps) {
  return (
    <figure data-slot="report-h-bars" aria-label={label} className={cn("grid grid-cols-[9mm_minmax(0,1fr)_16mm] items-center gap-y-[2.4mm]", className)}>
      {rows.map((row) => (
        <div key={row.key} data-row={row.key} className="contents">
          <p className={cn("font-bold text-slate-900", TYPE.body)}>{row.label}</p>
          <div className="relative h-[4mm]">
            {row.value !== null && (
              <span
                aria-hidden
                data-slot="report-bar"
                data-value={row.value}
                className={cn("absolute inset-y-0 left-0 rounded-[0.8mm]", row.tone ? BAR_TONE[row.tone] : "bg-brand-500")}
                style={{ width: barLength(row.value, axis) }}
              />
            )}
            {minimum !== null && minimum !== undefined && (
              <span
                aria-hidden
                data-slot="report-limit-line"
                className="absolute -top-[0.8mm] -bottom-[0.8mm] border-l-[0.3mm] border-dashed border-fail"
                style={{ left: along(minimum, axis) }}
              />
            )}
          </div>
          <p data-tone={row.tone ?? undefined} className={cn("text-right tabular-nums", TYPE.body, row.tone ? FIGURE_TONE[row.tone] : "text-slate-900")}>
            {row.display ?? (row.value === null ? "" : plainTick(row.value))}
          </p>
        </div>
      ))}
    </figure>
  );
}

/** The series' fills: the design's layering in blue and dispensing in teal, and two more. */
export const SERIES_TONE = {
  brand: { bar: "bg-brand-600", swatch: "bg-brand-600" },
  accent: { bar: "bg-accent-500", swatch: "bg-accent-500" },
  light: { bar: "bg-brand-300", swatch: "bg-brand-300" },
  dark: { bar: "bg-brand-900", swatch: "bg-brand-900" },
} as const;

export type GroupedHBarSeries = { key: string; label: string; tone: keyof typeof SERIES_TONE };

export type GroupedHBarRow = {
  key: string;
  /** "S". */
  label: string;
  /** Beside the label, in grey: "8 boxes". */
  sublabel?: string;
  /** The sublabel on a line of its own under the label: the aged gloves' "70 °C · 7 days · 4 boxes". */
  sublabelBelow?: boolean;
  values: Readonly<Record<string, number | null | undefined>>;
  aside?: readonly AsideLine[];
  /** A grade at the row's end, as a chip: the stickiness grade "A". */
  tag?: { text: string; status: Status };
  /** A rule above the row: the aged gloves set apart from the sizes. */
  separated?: boolean;
};

export type GroupedHBarsProps = {
  rows: readonly GroupedHBarRow[];
  series: readonly GroupedHBarSeries[];
  axis: Axis;
  /** Each series' minimum, by series key: a dashed red line across that series' lane. */
  minimums?: Readonly<Record<string, number>>;
  format?: (value: number) => string;
  label: string;
  className?: string;
};

export function GroupedHBars({ rows, series, axis, minimums = {}, format = plainTick, label, className }: GroupedHBarsProps) {
  const hasAside = rows.some((row) => row.aside && row.aside.length > 0);
  const hasTag = rows.some((row) => row.tag);
  const columns = cn(
    "grid items-center",
    hasAside && hasTag
      ? "grid-cols-[34mm_minmax(0,1fr)_34mm_12mm]"
      : hasAside
        ? "grid-cols-[34mm_minmax(0,1fr)_34mm]"
        : hasTag
          ? "grid-cols-[34mm_minmax(0,1fr)_12mm]"
          : "grid-cols-[34mm_minmax(0,1fr)]",
  );
  const limits = Object.values(minimums);
  return (
    <figure data-slot="report-grouped-h-bars" aria-label={label} className={cn(columns, className)}>
      {rows.map((row) => (
        <div key={row.key} data-row={row.key} className="contents">
          <Cell separated={row.separated}>
            <p className={cn("text-slate-900", TYPE.body)}>
              <span className="font-bold">{row.label}</span>
              {row.sublabel && (
                <span className={cn("text-slate-600", row.sublabelBelow && "block")}>
                  {row.sublabelBelow ? "" : " "}
                  {row.sublabel}
                </span>
              )}
            </p>
          </Cell>
          <Cell separated={row.separated}>
            {/* As wide as its column: its bars are placed absolutely and give it no width of their own. */}
            <div className="relative flex w-full flex-col gap-[0.8mm] py-[1.6mm]">
              <GridLines axis={axis} />
              {series.map((entry) => {
                const value = row.values[entry.key];
                const minimum = minimums[entry.key];
                return (
                  <div key={entry.key} data-series={entry.key} className="relative h-[2.8mm]">
                    {typeof value === "number" && (
                      <span
                        aria-hidden
                        data-slot="report-bar"
                        data-value={value}
                        className={cn("absolute inset-y-0 left-0 rounded-r-[0.8mm]", SERIES_TONE[entry.tone].bar)}
                        style={{ width: barLength(value, axis) }}
                      />
                    )}
                    {minimum !== undefined && (
                      <span
                        aria-hidden
                        data-slot="report-limit-line"
                        className="absolute -top-[0.6mm] -bottom-[0.6mm] border-l-[0.3mm] border-dashed border-fail"
                        style={{ left: along(minimum, axis) }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Cell>
          {hasAside && (
            <Cell separated={row.separated}>
              <AsideLines lines={row.aside} className="border-l-[0.25mm] border-slate-200 pl-[3mm]" />
            </Cell>
          )}
          {hasTag && (
            <Cell separated={row.separated} className="justify-end">
              {row.tag && <StatusChip status={row.tag.status} label={row.tag.text} className="rounded-[1mm] px-[2mm] [&>svg]:hidden" />}
            </Cell>
          )}
        </div>
      ))}
      <span />
      <AxisTicks axis={axis} format={format} marked={limits} extra={limits} />
      {hasAside && <span />}
      {hasTag && <span />}
    </figure>
  );
}

function Cell({ separated, className, children }: { separated?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn("flex h-full items-center", separated && "mt-[2mm] border-t-[0.3mm] border-dashed border-slate-300 pt-[2mm]", className)}>{children}</div>;
}

// A whole split into its parts along one bar (the design's page 1, Order Mix by
// Size): each part's width its share, in blues light to dark (a size in its
// own blue, sizeTone), its name inside where there is room, and a legend
// under it that says each part in words.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sequenceFor, TYPE, type SequenceStep } from "./theme";

export type StackedSegment = {
  key: string;
  /** Inside the bar and in the legend: "S". */
  label: string;
  value: number;
  /** Its blue: a size's own (sizeTone); light to dark in order when left out. */
  tone?: SequenceStep;
};

/** Each part's share of the whole, 0 to 1; a whole of nothing shares nothing. */
export function segmentShares(segments: readonly Pick<StackedSegment, "value">[]): number[] {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return segments.map((segment) => (total > 0 ? Math.max(0, segment.value) / total : 0));
}

/** The segments' blues: their own, else the sequence's. */
function tonesOf(segments: readonly StackedSegment[]): SequenceStep[] {
  const sequence = sequenceFor(segments.length);
  return segments.map((segment, index) => segment.tone ?? sequence[index]);
}

/** A part narrower than this keeps its name to the legend. */
const LABEL_MIN_SHARE = 0.035;

export type StackedBarProps = {
  segments: readonly StackedSegment[];
  /** Height in millimetres. */
  height?: number;
  /** Read out for the whole bar: "Order mix by size: S 24.6%, M 45.7% …". */
  label: string;
  className?: string;
};

export function StackedBar({ segments, height = 6.2, label, className }: StackedBarProps) {
  const shares = segmentShares(segments);
  const tones = tonesOf(segments);
  return (
    <div
      data-slot="report-stacked-bar"
      role="img"
      aria-label={label}
      className={cn("flex w-full gap-[0.5mm] overflow-hidden rounded-[1.4mm]", className)}
      style={{ height: `${height}mm` }}
    >
      {segments.map((segment, index) =>
        shares[index] > 0 ? (
          <span
            key={segment.key}
            data-segment={segment.key}
            data-share={shares[index].toFixed(4)}
            className={cn("flex min-w-0 items-center overflow-hidden px-[2mm] font-bold", TYPE.small, tones[index].fill, tones[index].text)}
            style={{ flexBasis: 0, flexGrow: shares[index] }}
          >
            {shares[index] >= LABEL_MIN_SHARE && (
              <span aria-hidden className="truncate">
                {segment.label}
              </span>
            )}
          </span>
        ) : null,
      )}
    </div>
  );
}

export type StackedLegendProps = {
  segments: readonly StackedSegment[];
  /** What follows the part's name: "1,120 cartons · 24.6%". */
  detail: (segment: StackedSegment, index: number) => ReactNode;
  className?: string;
};

/** The parts in words, each with its swatch: "■ S · 1,120 cartons · 24.6%". */
export function StackedLegend({ segments, detail, className }: StackedLegendProps) {
  const tones = tonesOf(segments);
  return (
    <ul data-slot="report-stacked-legend" className={cn("flex flex-wrap gap-x-[7mm] gap-y-[1.2mm] text-slate-900", TYPE.small, className)}>
      {segments.map((segment, index) => (
        <li key={segment.key} data-segment={segment.key} className="flex items-center gap-[1.6mm] tabular-nums">
          <span aria-hidden className={cn("size-[2.6mm] shrink-0 rounded-[0.6mm]", tones[index].fill)} />
          <span>
            <span className="font-bold">{segment.label}</span> · {detail(segment, index)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// A computed number as the app prints it (BUILD_SPEC 6.2 rule 2: totals,
// averages and medians are shown, never typed): tabular figures so columns
// line up, fixed decimals rounded like the reports, the unit in secondary
// text, and a dash with a spoken "No value" when there is nothing yet.
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

type FigureProps = {
  value: number | null | undefined;
  /** Fixed decimals: 2.9 at 2 is "2.90". */
  decimals?: number;
  /** At most this many decimals, trailing zeros dropped. */
  maxDecimals?: number;
  /** Thousands separators: 5,800,000. */
  grouping?: boolean;
  /** Canonical unit: "mm", "g", "N", "MPa", "%". */
  unit?: string;
  className?: string;
};

export function Figure({ value, decimals, maxDecimals, grouping, unit, className }: FigureProps) {
  const text = formatNumber(value, { decimals, maxDecimals, grouping });
  if (text === "") {
    return (
      <span data-slot="figure" data-empty="" className={cn("text-muted-foreground", className)}>
        <span aria-hidden>—</span>
        <span className="sr-only">No value</span>
      </span>
    );
  }
  return (
    <span data-slot="figure" className={cn("whitespace-nowrap tabular-nums", className)}>
      {text}
      {unit && <span className="font-normal text-muted-foreground">{unit === "%" ? "%" : ` ${unit}`}</span>}
    </span>
  );
}

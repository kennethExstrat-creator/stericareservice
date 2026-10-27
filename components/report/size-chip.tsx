// A size as a small rounded block in its own blue (the sampling plan's
// column headers and order rows; the report's size labels): S light blue, M
// blue, L dark blue, XL navy (sizeTone), the label as the template shows it.
import { cn } from "@/lib/utils";
import { sizeTone } from "./theme";

export type SizeChipProps = {
  /** The canonical size: "M", "7.0". */
  size: string;
  /** As the template shows it; the size when left out. */
  label?: string;
  /** The template's sizes in order: a size that is not a letter takes its blue by its place among them. */
  templateSizes?: readonly string[];
  className?: string;
};

export function SizeChip({ size, label, templateSizes, className }: SizeChipProps) {
  const tone = sizeTone(size, templateSizes);
  return (
    <span
      data-slot="report-size-chip"
      data-size={size}
      className={cn(
        "inline-flex h-[5.4mm] min-w-[8.4mm] items-center justify-center rounded-[1.2mm] px-[1.6mm] text-[9pt] leading-none font-bold",
        tone.fill,
        tone.text,
        className,
      )}
    >
      {label ?? size}
    </span>
  );
}

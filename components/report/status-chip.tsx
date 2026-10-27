// A result in the report: the chip of a table row ("✓ Passed", Results by
// Check on the design's page 1) and the solid tick of a matrix cell or the conclusion
// card. The app's status colours and words (lib/design/status.ts: Passed,
// Failed, Warning, On Hold, Not Done), each with its own shape, so a result
// never rests on colour alone (docs/DESIGN.md, Status colours).
import { CheckIcon, CircleDashedIcon, InfoIcon, PauseIcon, TriangleAlertIcon, XIcon, type LucideIcon } from "lucide-react";
import { STATUS_LABEL, STATUS_SOLID_CLASS, STATUS_TINT_CLASS, type Status } from "@/lib/design/status";
import { cn } from "@/lib/utils";

/** A glyph per status: a check, a cross, a triangle, a pause, an i, a dashed ring. */
export const REPORT_STATUS_ICON: Readonly<Record<Status, LucideIcon>> = {
  pass: CheckIcon,
  fail: XIcon,
  warn: TriangleAlertIcon,
  hold: PauseIcon,
  info: InfoIcon,
  not_done: CircleDashedIcon,
};

const CHIP_SIZE = {
  sm: "h-[4.2mm] gap-[0.8mm] px-[1.8mm] text-[7.5pt] [&>svg]:size-[2.4mm]",
  md: "h-[4.8mm] gap-[1mm] px-[2.2mm] text-[8.5pt] [&>svg]:size-[2.8mm]",
} as const;

export type StatusChipProps = {
  status: Status;
  /** Replaces the status's word: a template's own, such as "Passed, All Sizes". */
  label?: string;
  size?: keyof typeof CHIP_SIZE;
  className?: string;
};

/** The tinted pill: glyph and word on the status's tint, edged in its border colour. */
export function StatusChip({ status, label, size = "md", className }: StatusChipProps) {
  const Icon = REPORT_STATUS_ICON[status];
  return (
    <span
      data-slot="report-status-chip"
      data-status={status}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border font-semibold whitespace-nowrap",
        CHIP_SIZE[size],
        STATUS_TINT_CLASS[status],
        className,
      )}
    >
      <Icon aria-hidden strokeWidth={3} />
      <span>{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

export type StatusTickProps = {
  status: Status;
  /** Diameter in millimetres. */
  size?: number;
  /** What a screen reader hears; the status's word when left out. */
  label?: string;
  className?: string;
};

/** A solid disc with the status's glyph in it: a cell of the results matrix, the conclusion's mark. */
export function StatusTick({ status, size = 5, label, className }: StatusTickProps) {
  const Icon = REPORT_STATUS_ICON[status];
  return (
    <span
      data-slot="report-status-tick"
      data-status={status}
      role="img"
      aria-label={label ?? STATUS_LABEL[status]}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full border", STATUS_SOLID_CLASS[status], className)}
      style={{ width: `${size}mm`, height: `${size}mm` }}
    >
      <Icon aria-hidden strokeWidth={3} style={{ width: `${size * 0.55}mm`, height: `${size * 0.55}mm` }} />
    </span>
  );
}

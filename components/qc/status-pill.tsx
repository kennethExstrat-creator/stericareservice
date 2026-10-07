// A result as icon plus text: module results, the suggested and final result,
// P/F cells. Tint for everyday use, solid for emphasis. Both sizes read 16 px
// on iPad (docs/DESIGN.md), so a small pill in a table, a footer or a legend
// needs no class of its own; with a mouse "sm" stays the compact pill.
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_SOLID_CLASS, STATUS_TINT_CLASS, type Status } from "@/lib/design/status";
import { StatusIcon } from "./status-icon";

/**
 * A small pill at the touch size: 16 px text on iPad.
 * @deprecated StatusPill's `size="sm"` has this built in; pass nothing.
 */
export const SMALL_PILL_TOUCH = "touch:h-8 touch:gap-1.5 touch:px-3 touch:text-base touch:[&>svg]:size-4";

const SIZE_CLASS = {
  sm: cn("h-6 gap-1 px-2 text-xs [&>svg]:size-3.5", SMALL_PILL_TOUCH),
  md: "h-7 gap-1.5 px-3 text-sm [&>svg]:size-4 touch:h-8 touch:text-base",
} as const;

type StatusPillProps = Omit<ComponentProps<"span">, "children"> & {
  status: Status;
  /** Replaces the default label, e.g. the template's "Accept" or "P". */
  label?: ReactNode;
  variant?: "tint" | "solid";
  /** "sm" for tables and footers. Either size is 16 px on touch. */
  size?: "sm" | "md";
};

export function StatusPill({
  status,
  label,
  variant = "tint",
  size = "md",
  className,
  ...props
}: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border font-semibold whitespace-nowrap",
        SIZE_CLASS[size],
        variant === "solid" ? STATUS_SOLID_CLASS[status] : STATUS_TINT_CLASS[status],
        className,
      )}
      {...props}
    >
      <StatusIcon status={status} />
      <span>{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

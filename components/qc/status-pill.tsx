// A result as icon plus text: module results, the suggested and final result,
// P/F cells. Tint for everyday use, solid for emphasis.
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_SOLID_CLASS, STATUS_TINT_CLASS, type Status } from "@/lib/design/status";
import { StatusIcon } from "./status-icon";

type StatusPillProps = Omit<ComponentProps<"span">, "children"> & {
  status: Status;
  /** Replaces the default label, e.g. the template's "Accept" or "P". */
  label?: ReactNode;
  variant?: "tint" | "solid";
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
        size === "md" ? "h-7 gap-1.5 px-3 text-sm [&>svg]:size-4" : "h-6 gap-1 px-2 text-xs [&>svg]:size-3.5",
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

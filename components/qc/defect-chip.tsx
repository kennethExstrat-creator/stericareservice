"use client";

// Tap-to-add defect chip (BUILD_SPEC 8): tapping the chip adds one; the
// attached minus removes one. Unmapped one-off labels carry a dashed amber
// edge and a flag until an admin maps them to a defect code.
import { useRef } from "react";
import { FlagIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type DefectChipProps = {
  label: string;
  count: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** A one-off label with no defect code yet. */
  unmapped?: boolean;
  disabled?: boolean;
  /** Id of shared instructions, e.g. the group's "tap to add" hint. */
  describedBy?: string;
  className?: string;
};

export function DefectChip({
  label,
  count,
  onIncrement,
  onDecrement,
  unmapped = false,
  disabled = false,
  describedBy,
  className,
}: DefectChipProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const active = count > 0;

  const decrement = () => {
    // The minus disappears at zero; keep keyboard focus on the chip.
    if (count === 1) addRef.current?.focus();
    onDecrement();
  };

  return (
    <span
      data-slot="defect-chip"
      data-active={active || undefined}
      data-unmapped={unmapped || undefined}
      className={cn(
        "inline-flex max-w-full items-stretch rounded-full border bg-card text-foreground shadow-xs transition-colors",
        "border-input data-active:border-primary data-active:bg-brand-50 data-active:text-brand-700",
        "data-unmapped:border-dashed data-unmapped:border-warn-border data-active:data-unmapped:border-warn-border",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        ref={addRef}
        type="button"
        disabled={disabled}
        onClick={onIncrement}
        aria-describedby={describedBy}
        className="inline-flex h-8 min-w-0 items-center gap-2 rounded-full pr-2 pl-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-brand-100 touch:h-11 touch:pr-3 touch:pl-4 touch:text-base"
      >
        {unmapped && <FlagIcon aria-hidden className="size-4 shrink-0 text-warn" />}
        <span className="truncate">{label}</span>
        <span className="sr-only">
          {unmapped ? ", unmapped label" : ""}, {count}
        </span>
        {active && (
          <span
            aria-hidden
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums touch:h-6 touch:min-w-6 touch:text-sm"
          >
            {count}
          </span>
        )}
      </button>
      {active && (
        <button
          type="button"
          disabled={disabled}
          onClick={decrement}
          aria-label={`Remove one ${label}`}
          className="inline-flex w-8 shrink-0 items-center justify-center rounded-full border-l border-brand-200 text-brand-700 outline-none hover:bg-brand-100 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-brand-200 touch:w-11 [&_svg]:size-4"
        >
          <MinusIcon aria-hidden />
        </button>
      )}
    </span>
  );
}

"use client";

// Right / left hand switch for modules with a hand split (BUILD_SPEC 6.1
// `handSplit` on watertight and visual, surgical templates). A segmented
// radio group: R and L, plus "Both" to show the hands side by side where the
// screen is wide enough. Put it in SizeTabs' `actions` so it sticks with the
// size bar. Switching hands only changes the view, so it works read-only too.
import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { rovingIndex } from "./roving";

export type HandView = "R" | "L" | "both";

const OPTIONS: readonly { value: HandView; short: string; name: string }[] = [
  { value: "R", short: "R", name: "Right hand" },
  { value: "L", short: "L", name: "Left hand" },
  { value: "both", short: "Both", name: "Both hands" },
];

/** The hands a HandView shows, in R, L order. */
export function handsOf(view: HandView): ("R" | "L")[] {
  return view === "both" ? ["R", "L"] : [view];
}

type HandToggleProps = {
  value: HandView;
  onValueChange: (value: HandView) => void;
  /** Offer "Both" (R and L side by side). */
  allowBoth?: boolean;
  /** Group name; shown as a small label with `showLabel`. */
  label?: string;
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
};

export function HandToggle({
  value,
  onValueChange,
  allowBoth = false,
  label = "Hand",
  showLabel = false,
  disabled = false,
  className,
}: HandToggleProps) {
  const labelId = useId();
  const buttons = useRef(new Map<HandView, HTMLButtonElement>());
  const options = allowBoth ? OPTIONS : OPTIONS.filter((option) => option.value !== "both");
  // "both" without the option on screen reads as right hand selected.
  const selected = options.some((option) => option.value === value) ? value : "R";

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = rovingIndex(event.key, index, options.length, { vertical: true });
    if (next === null || disabled) return;
    event.preventDefault();
    const target = options[next].value;
    buttons.current.get(target)?.focus();
    if (target !== selected) onValueChange(target);
  };

  return (
    <div data-slot="hand-toggle" className={cn("inline-flex items-center gap-2", className)}>
      {showLabel && (
        <span id={labelId} className="text-sm font-medium text-muted-foreground touch:text-base">
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={showLabel ? undefined : label}
        aria-labelledby={showLabel ? labelId : undefined}
        aria-disabled={disabled || undefined}
        className="inline-flex items-center gap-0.5 rounded-full bg-muted p-1 aria-disabled:opacity-50"
      >
        {options.map((option, index) => {
          const checked = option.value === selected;
          return (
            <button
              key={option.value}
              ref={(element) => {
                if (element) buttons.current.set(option.value, element);
                else buttons.current.delete(option.value);
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.name}
              title={option.name}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              data-active={checked || undefined}
              onClick={() => !checked && onValueChange(option.value)}
              onKeyDown={onKeyDown(index)}
              className={cn(
                "inline-flex h-7 min-w-9 items-center justify-center rounded-full px-2.5 text-sm font-bold outline-none transition-colors",
                "text-slate-700 hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                "data-active:bg-card data-active:text-brand-700 data-active:shadow-sm data-active:ring-1 data-active:ring-brand-300",
                "touch:h-11 touch:min-w-12 touch:px-3.5 touch:text-base",
              )}
            >
              {option.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

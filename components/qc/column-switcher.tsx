"use client";

// Previous and Next for a CounterTable that shows one column at a time on the
// iPad layout (its activeColumn), such as Safedon's boxes on an iPad:
// "Box/Carton #253 · 2 / 5" between the two buttons, said again when it
// changes. On the
// desktop layout (`xl`: 1280 px and wider with a mouse or trackpad), where
// every column shows side by side, it hides. At either end its button stays
// focusable (aria-disabled) and greys out, so keyboard focus is never dropped.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { switcherIndex, switcherStep } from "./selection";

type ColumnSwitcherProps = {
  /** How many columns there are. Nothing shows for one or none. */
  count: number;
  /** The column on screen, 0 first. */
  index: number;
  onIndexChange: (index: number) => void;
  /** What the column on screen is called, e.g. "Box/Carton #253" or "Box/Carton # (2)". */
  current: string;
  /** The buttons' accessible names. */
  previousLabel?: string;
  nextLabel?: string;
  /** Keep it on the desktop layout too, for a table that shows one column at every width. */
  alwaysShown?: boolean;
  className?: string;
};

// Greys out at an end instead of fading, so its focus ring keeps full contrast.
const AT_END = "aria-disabled:cursor-not-allowed aria-disabled:bg-transparent aria-disabled:text-slate-400";

export function ColumnSwitcher({
  count,
  index,
  onIndexChange,
  current,
  previousLabel = "Previous",
  nextLabel = "Next",
  alwaysShown = false,
  className,
}: ColumnSwitcherProps) {
  if (count <= 1) return null;
  const at = switcherIndex(index, count);
  const previous = switcherStep(at, count, -1);
  const next = switcherStep(at, count, 1);
  return (
    <div data-slot="column-switcher" className={cn("relative flex items-center gap-1", !alwaysShown && "xl:hidden", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={previousLabel}
        aria-disabled={previous === null || undefined}
        className={AT_END}
        onClick={() => previous !== null && onIndexChange(previous)}
      >
        <ChevronLeftIcon aria-hidden />
      </Button>
      <span className="min-w-24 text-center text-sm tabular-nums touch:text-base" aria-live="polite">
        {`${current} · ${at + 1} / ${count}`}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={nextLabel}
        aria-disabled={next === null || undefined}
        className={AT_END}
        onClick={() => next !== null && onIndexChange(next)}
      >
        <ChevronRightIcon aria-hidden />
      </Button>
    </div>
  );
}

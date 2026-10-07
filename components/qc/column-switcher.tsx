"use client";

// Previous and Next for a CounterTable that shows one column at a time below
// 1280 px (its activeColumn), such as Safedon's boxes on an iPad: "Box 253 ·
// 2 / 5" between the two buttons, said again when it changes. From 1280 px,
// where every column shows side by side, it hides. At either end its button
// stays focusable (aria-disabled) and greys out, so keyboard focus is never
// dropped.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ColumnSwitcherProps = {
  /** How many columns there are. Nothing shows for one or none. */
  count: number;
  /** The column on screen, 0 first. */
  index: number;
  onIndexChange: (index: number) => void;
  /** What the column on screen is called, e.g. "Box 253" or "Box (2)". */
  current: string;
  /** The buttons' accessible names. */
  previousLabel?: string;
  nextLabel?: string;
  /** Keep it from 1280 px too, for a table that shows one column at every width. */
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
  const at = Math.min(Math.max(index, 0), count - 1);
  const first = at === 0;
  const last = at === count - 1;
  return (
    <div data-slot="column-switcher" className={cn("relative flex items-center gap-1", !alwaysShown && "xl:hidden", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={previousLabel}
        aria-disabled={first || undefined}
        className={AT_END}
        onClick={() => !first && onIndexChange(at - 1)}
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
        aria-disabled={last || undefined}
        className={AT_END}
        onClick={() => !last && onIndexChange(at + 1)}
      >
        <ChevronRightIcon aria-hidden />
      </Button>
    </div>
  );
}

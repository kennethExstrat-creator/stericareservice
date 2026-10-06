"use client";

// +/- counter for defect counts (BUILD_SPEC 8: counts by tapping, never
// typing). Holding a button repeats; Arrow, Page, Home and End keys work
// anywhere in the group. Buttons stay focusable at the limits (aria-disabled)
// so keyboard focus is never dropped.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const REPEAT_DELAY_MS = 450;
const REPEAT_INTERVAL_MS = 75;

type StepperProps = {
  value: number;
  onValueChange: (value: number) => void;
  /** Accessible name, e.g. "Holes, palm". */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
};

const BUTTON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 touch:size-11 [&_svg]:size-4 touch:[&_svg]:size-5";

export function Stepper({
  value,
  onValueChange,
  label,
  min = 0,
  max,
  step = 1,
  disabled = false,
  id,
  className,
}: StepperProps) {
  const [announcement, setAnnouncement] = useState("");
  // Long-press state lives outside render: the value it steps from and
  // whether it fired, so the click that ends the press does not add one more.
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; value: number; fired: boolean }>({
    value,
    fired: false,
  });

  useEffect(() => {
    const state = press.current;
    return () => clearTimeout(state.timer);
  }, []);

  const clamp = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, n));
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && (max === undefined || value < max);

  const stopRepeat = () => {
    clearTimeout(press.current.timer);
    press.current.timer = undefined;
  };

  const startRepeat = (event: PointerEvent<HTMLButtonElement>, direction: 1 | -1) => {
    if (event.button !== 0) return;
    stopRepeat();
    press.current.value = value;
    press.current.fired = false;
    const tick = (delay: number) => {
      press.current.timer = setTimeout(() => {
        const next = clamp(press.current.value + direction * step);
        if (next === press.current.value) return stopRepeat();
        press.current.value = next;
        press.current.fired = true;
        onValueChange(next);
        tick(REPEAT_INTERVAL_MS);
      }, delay);
    };
    tick(REPEAT_DELAY_MS);
  };

  const stepBy = (direction: 1 | -1) => {
    if (press.current.fired) {
      press.current.fired = false;
      setAnnouncement(String(press.current.value));
      return;
    }
    const next = clamp(value + direction * step);
    if (next === value) return;
    onValueChange(next);
    setAnnouncement(String(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A long press released off the button leaves no click to consume its flag.
    if (event.key === "Enter" || event.key === " ") press.current.fired = false;
    if (disabled) return;
    const target: Record<string, number | undefined> = {
      ArrowUp: value + step,
      ArrowDown: value - step,
      PageUp: value + step * 10,
      PageDown: value - step * 10,
      Home: min,
      End: max,
    };
    if (!(event.key in target)) return;
    event.preventDefault();
    const wanted = target[event.key];
    if (wanted === undefined) return;
    const next = clamp(wanted);
    if (next === value) return;
    onValueChange(next);
    // The spinbutton announces its own value; from a button, say it.
    if (event.target instanceof HTMLButtonElement) setAnnouncement(String(next));
  };

  // A long press must not open the touch callout or a context menu.
  const preventMenu = (event: MouseEvent) => event.preventDefault();

  return (
    <div
      role="group"
      id={id}
      data-slot="stepper"
      data-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-input bg-card p-0.5 shadow-xs select-none [-webkit-touch-callout:none] data-disabled:opacity-50",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        aria-disabled={!canDecrease}
        className={cn(BUTTON, "text-foreground hover:bg-muted active:bg-slate-200")}
        onPointerDown={(event) => canDecrease && startRepeat(event, -1)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        onClick={() => canDecrease && stepBy(-1)}
        onContextMenu={preventMenu}
      >
        <MinusIcon aria-hidden />
      </button>
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled || undefined}
        className="min-w-[3ch] rounded-sm px-1 text-center text-base font-semibold tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50 touch:text-lg"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        aria-disabled={!canIncrease}
        className={cn(BUTTON, "bg-secondary text-secondary-foreground hover:bg-brand-200 active:bg-brand-300")}
        onPointerDown={(event) => canIncrease && startRepeat(event, 1)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        onClick={() => canIncrease && stepBy(1)}
        onContextMenu={preventMenu}
      >
        <PlusIcon aria-hidden />
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

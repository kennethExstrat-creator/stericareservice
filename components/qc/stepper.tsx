"use client";

// +/- counter for defect counts (BUILD_SPEC 8: counts by tapping, never
// typing). Holding a button repeats; a finger that slides off the press (a
// swipe to the next size) ends it without counting. Arrow, Page, Home and End
// keys work anywhere in the group (stepper-keys.ts). Buttons stay focusable at
// the limits (aria-disabled) so keyboard focus is never dropped; a disabled
// stepper (an approved inspection) leaves the tab order.
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
import { clampCount, isDrag, stepperKeyValue } from "./stepper-keys";

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
  /**
   * Say the new value after a button press (default). Off where the parent
   * says more in one message, as CounterTable does with its total.
   */
  announce?: boolean;
  id?: string;
  className?: string;
};

// A button is the whole target, 28 px (44 px on touch), and its fill a circle
// inside its padding (bg-clip-content), 24 px (36 px on touch): the pill has no
// padding of its own, so it is 30 px tall (46 px on touch) and a column of
// steppers in a CounterTable has room between its rows. The inset focus ring
// sits in that padding, around the circle. At a limit a button greys its icon
// and drops its fill instead of fading as a whole: opacity would fade the
// focus ring with it.
const BUTTON =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-clip-content p-0.5 outline-none transition-colors focus-ring-inset aria-disabled:cursor-not-allowed aria-disabled:bg-transparent aria-disabled:text-slate-400 touch:size-11 touch:p-1 [&_svg]:size-4 touch:[&_svg]:size-5";

export function Stepper({
  value,
  onValueChange,
  label,
  min = 0,
  max,
  step = 1,
  disabled = false,
  announce = true,
  id,
  className,
}: StepperProps) {
  const [announcement, setAnnouncement] = useState("");
  // Long-press state lives outside render: the value it steps from, whether
  // it fired (so the click that ends the press does not add one more), where
  // the pointer went down and whether it has since moved like a drag.
  const press = useRef<{
    timer?: ReturnType<typeof setTimeout>;
    value: number;
    fired: boolean;
    start: { x: number; y: number } | null;
    dragged: boolean;
  }>({ value, fired: false, start: null, dragged: false });

  useEffect(() => {
    const state = press.current;
    return () => clearTimeout(state.timer);
  }, []);

  const clamp = (n: number) => clampCount(n, { min, max });
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && (max === undefined || value < max);

  const stopRepeat = () => {
    clearTimeout(press.current.timer);
    press.current.timer = undefined;
  };

  const startRepeat = (event: PointerEvent<HTMLButtonElement>, direction: 1 | -1, enabled: boolean) => {
    if (event.button !== 0) return;
    stopRepeat();
    press.current.start = { x: event.clientX, y: event.clientY };
    press.current.dragged = false;
    if (!enabled) return;
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

  // Touch keeps the pointer on the button while the finger moves, so leaving
  // the button never ends a hold: moving like a drag does (stepper-keys.ts).
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = press.current.start;
    if (!start || press.current.dragged || !isDrag(start, { x: event.clientX, y: event.clientY })) return;
    press.current.dragged = true;
    stopRepeat();
  };

  const stepBy = (direction: 1 | -1) => {
    // A drag is not a press: whatever click ends it counts nothing more.
    if (press.current.dragged) {
      press.current.dragged = false;
      press.current.fired = false;
      return;
    }
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
    // A long press or a drag released off the button leaves no click to consume its flags.
    if (event.key === "Enter" || event.key === " ") {
      press.current.fired = false;
      press.current.dragged = false;
    }
    if (disabled) return;
    const next = stepperKeyValue(event.key, value, { min, max, step });
    if (next === null) return;
    event.preventDefault();
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
        // gap-0.5: the value's focus ring, 2 px clear of it, ends where a button's circle starts.
        "relative inline-flex items-center gap-0.5 rounded-full border border-input bg-card shadow-xs select-none [-webkit-touch-callout:none] data-disabled:opacity-50",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        aria-disabled={!canDecrease}
        tabIndex={disabled ? -1 : undefined}
        className={cn(BUTTON, "text-foreground hover:bg-muted active:bg-slate-200")}
        onPointerDown={(event) => startRepeat(event, -1, canDecrease)}
        onPointerMove={onPointerMove}
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
        // leading-5: one line, so its focus ring stays inside the 30 px pill.
        className="min-w-[3ch] rounded-sm px-1 text-center text-base leading-5 font-semibold tabular-nums outline-none focus-ring touch:text-lg"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        aria-disabled={!canIncrease}
        tabIndex={disabled ? -1 : undefined}
        className={cn(BUTTON, "bg-secondary text-secondary-foreground hover:bg-brand-200 active:bg-brand-300")}
        onPointerDown={(event) => startRepeat(event, 1, canIncrease)}
        onPointerMove={onPointerMove}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
        onClick={() => canIncrease && stepBy(1)}
        onContextMenu={preventMenu}
      >
        <PlusIcon aria-hidden />
      </button>
      {announce && (
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      )}
    </div>
  );
}

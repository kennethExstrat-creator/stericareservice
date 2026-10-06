// Keyboard and press rules for Stepper, kept pure so they can be tested: the
// keys of an ARIA spinbutton, clamped to the limits, and when a held button
// stops being a press.

export type StepperLimits = { min: number; max?: number; step: number };

/** How far a finger may wander while holding a button, in CSS px, before the hold is a drag. */
export const PRESS_SLOP = 10;

/**
 * A held button is a drag once the pointer has moved more than PRESS_SLOP
 * from where it went down: a swipe that starts on a stepper (to turn the
 * size) must not count defects. Touch keeps the pointer on the button while
 * it moves, so leaving the button never ends the hold on its own.
 */
export function isDrag(start: { x: number; y: number }, point: { x: number; y: number }, slop = PRESS_SLOP): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) > slop;
}

export function clampCount(value: number, { min, max }: Pick<StepperLimits, "min" | "max">): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, value));
}

/**
 * The value a key moves the stepper to. null when the key is not the
 * stepper's, so it is left to the browser (Tab, Enter, Space on a button).
 * The result equals the current value at a limit, or for End without a max.
 */
export function stepperKeyValue(key: string, value: number, limits: StepperLimits): number | null {
  const { min, max, step } = limits;
  switch (key) {
    case "ArrowUp":
      return clampCount(value + step, limits);
    case "ArrowDown":
      return clampCount(value - step, limits);
    case "PageUp":
      return clampCount(value + step * 10, limits);
    case "PageDown":
      return clampCount(value - step * 10, limits);
    case "Home":
      return min;
    case "End":
      return max ?? value;
    default:
      return null;
  }
}

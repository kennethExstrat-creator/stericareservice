// Keyboard rules for Stepper, kept pure so they can be tested: the keys of an
// ARIA spinbutton, clamped to the limits.

export type StepperLimits = { min: number; max?: number; step: number };

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

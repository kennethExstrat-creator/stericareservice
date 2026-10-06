// Swipe between sizes on touch (BUILD_SPEC 8 "Speed"). The panel sets
// `touch-action: pan-y pinch-zoom`, so the browser keeps vertical scrolling
// (and cancels the pointer when a scroll starts) while horizontal moves reach
// these rules. Kept pure so the thresholds are tested.

export type SwipePoint = { x: number; y: number; time: number };

export type SwipeOptions = {
  /** Horizontal travel needed, in CSS pixels. */
  distance?: number;
  /** Horizontal travel must beat vertical travel by this factor. */
  ratio?: number;
  /** A slower drag is not a swipe, in milliseconds. */
  maxDuration?: number;
};

export const SWIPE_DEFAULTS = { distance: 64, ratio: 1.5, maxDuration: 800 } as const satisfies Required<SwipeOptions>;

/**
 * +1 for the next item (finger moved left, like turning a page), -1 for the
 * previous one (finger moved right), 0 for no swipe.
 */
export function swipeStep(start: SwipePoint, end: SwipePoint, options: SwipeOptions = {}): -1 | 0 | 1 {
  const { distance, ratio, maxDuration } = { ...SWIPE_DEFAULTS, ...options };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.time - start.time > maxDuration) return 0;
  if (Math.abs(dx) < distance || Math.abs(dx) < Math.abs(dy) * ratio) return 0;
  return dx < 0 ? 1 : -1;
}

/** The neighbour of `value` one `step` away, or null at either end (swipes never wrap). */
export function stepValue<T>(values: readonly T[], value: T, step: -1 | 0 | 1): T | null {
  if (step === 0) return null;
  const index = values.indexOf(value);
  if (index === -1) return null;
  return values[index + step] ?? null;
}

/**
 * Swipes never start in text areas, selects, lists or anything marked
 * data-no-swipe, nor in the field being edited (SizeTabs checks focus).
 * Other fields may start one: a dispensing row is nearly all fields.
 */
export const NO_SWIPE_SELECTOR =
  'textarea, select, [contenteditable="true"], [role="slider"], [role="listbox"], [data-no-swipe]';

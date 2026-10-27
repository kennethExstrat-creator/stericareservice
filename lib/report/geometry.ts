// The report's charts (components/report) placed by plain arithmetic, so
// every rule is unit-tested and the components only draw: where a value sits
// on an axis, a tidy axis around some values, dots that stack where readings
// repeat, a tolerance band's edges, and a defect track's end. Pure and
// client-safe.
import type { Spec } from "@/lib/stats";

export type Axis = { min: number; max: number; ticks: number[] };

/** Where a value sits along an axis, 0 at its start and 1 at its end, clamped to the axis. */
export function position(value: number, axis: Pick<Axis, "min" | "max">): number {
  const span = axis.max - axis.min;
  if (!(span > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, (value - axis.min) / span));
}

/** A step of 1, 2 or 5 times a power of ten, about `count` of which cover `span`. */
export function niceStep(span: number, count = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Ticks from `min` to `max` at `step`, without binary noise (0.1 + 0.2 is 0.3). */
export function ticksBetween(min: number, max: number, step: number): number[] {
  if (!(step > 0) || !(max >= min)) return [min];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const ticks: number[] = [];
  for (let index = 0; index <= 1000; index += 1) {
    const value = Number((min + index * step).toFixed(decimals));
    if (value > max + step / 1000) break;
    ticks.push(value);
  }
  return ticks;
}

/**
 * An axis around some values with tidy ticks: the values, any `include`d
 * (a minimum, a tolerance's edges) and one step of room either side, unless
 * `pad` is false. With no values a 0 to 1 axis, so a chart of nothing still
 * draws its frame.
 */
export function niceAxis(values: readonly number[], options: { include?: readonly number[]; count?: number; step?: number; pad?: boolean } = {}): Axis {
  const known = [...values, ...(options.include ?? [])].filter((value) => Number.isFinite(value));
  if (known.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  let low = Math.min(...known);
  let high = Math.max(...known);
  if (low === high) {
    const nudge = low === 0 ? 1 : Math.abs(low) * 0.05;
    low -= nudge;
    high += nudge;
  }
  const step = options.step ?? niceStep(high - low, options.count ?? 5);
  const pad = options.pad ?? true;
  const min = Math.floor(low / step - (pad ? 0.5 : 0)) * step;
  const max = Math.ceil(high / step + (pad ? 0.5 : 0)) * step;
  const clean = (value: number) => Number(value.toPrecision(12));
  return { min: clean(min), max: clean(max), ticks: ticksBetween(clean(min), clean(max), step) };
}

export type StackedDot = { value: number; level: number };

/**
 * Dots for a row of readings: readings that round to the same place (within
 * `step`, the readings' precision) stack one above the other, level 0 on
 * the baseline, in the order read. Non-numbers are left out.
 */
export function stackDots(values: readonly (number | null | undefined)[], step = 0): StackedDot[] {
  const levels = new Map<string, number>();
  return values.flatMap((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    const key = step > 0 ? String(Math.round(value / step)) : String(value);
    const level = levels.get(key) ?? 0;
    levels.set(key, level + 1);
    return [{ value, level }];
  });
}

/** The tallest stack of a row: how many dots high it draws. */
export function stackHeight(dots: readonly StackedDot[]): number {
  return dots.reduce((height, dot) => Math.max(height, dot.level + 1), 0);
}

/** The median of the numbers given; null for none. */
export function median(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}

/**
 * The tolerance band a spec allows, along an axis: nominal ± tolerance, a
 * range, or open to the axis's end for a minimum or a maximum. Null for NA:
 * nothing to draw.
 */
export function bandEdges(spec: Spec | null | undefined, axis: Pick<Axis, "min" | "max">): { from: number; to: number } | null {
  if (!spec) return null;
  switch (spec.kind) {
    case "tolerance":
      return { from: spec.nominal - spec.tolerance, to: spec.nominal + spec.tolerance };
    case "range":
      return { from: spec.min, to: spec.max };
    case "min":
      return { from: spec.min, to: Math.max(axis.max, spec.min) };
    case "max":
      return { from: Math.min(axis.min, spec.max), to: spec.max };
    case "na":
      return null;
  }
}

/**
 * A defect track ("2 found · accept ≤ 10"): it ends at the reject number
 * (accept + 1 where none is given), the found count fills it from the start
 * and the last step, from the accept number to the end, is the reject zone.
 * `over` when the found count reaches the reject number. Fractions of the
 * track, 0 to 1.
 */
export function trackGeometry({ found, accept, reject }: { found: number; accept: number; reject?: number | null }): {
  end: number;
  fill: number;
  rejectFrom: number;
  over: boolean;
} {
  const end = Math.max(1, reject ?? accept + 1, accept + 1);
  const safeFound = Math.max(0, Number.isFinite(found) ? found : 0);
  return {
    end,
    fill: Math.min(1, safeFound / end),
    rejectFrom: Math.min(1, Math.max(0, accept) / end),
    over: safeFound >= end,
  };
}

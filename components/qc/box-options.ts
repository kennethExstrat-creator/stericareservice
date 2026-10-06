// The list behind BoxPicker, kept pure so it can be tested: which carton
// numbers to offer, which are already picked elsewhere, and which one Enter
// picks.

/** The size's carton numbers to offer: unique whole numbers from 1, ascending, filtered by the digits typed. */
export function boxOptions(cartons: readonly number[], query = ""): number[] {
  const digits = query.replace(/\D/g, "");
  const unique = [...new Set(cartons.filter((carton) => Number.isInteger(carton) && carton > 0))].sort(
    (a, b) => a - b,
  );
  return digits === "" ? unique : unique.filter((carton) => String(carton).includes(digits));
}

/**
 * How many other rows picked each box. `used` holds every row's pick in the
 * size, this row included, so one occurrence of `value` is this row's own.
 */
export function pickedElsewhere(
  used: readonly (number | null | undefined)[],
  value: number | null,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const box of used) {
    if (typeof box === "number") counts.set(box, (counts.get(box) ?? 0) + 1);
  }
  if (value !== null) {
    const own = (counts.get(value) ?? 0) - 1;
    if (own > 0) counts.set(value, own);
    else counts.delete(value);
  }
  return counts;
}

/** The option Enter picks: the box typed exactly, else the first one left. */
export function bestOption(options: readonly number[], query: string): number | null {
  const digits = query.replace(/\D/g, "");
  if (digits !== "" && options.includes(Number(digits))) return Number(digits);
  return options[0] ?? null;
}

/**
 * A stored box that is not in the size's carton list (BUILD_SPEC 6.2 rule 7).
 * Without a list (carton sampling off or not filled in yet) nothing can be
 * checked, so nothing is flagged (docs/MODULES.md, the inspection context).
 */
export function isUnlisted(value: number | null, cartons: readonly number[]): value is number {
  return value !== null && cartons.length > 0 && !cartons.includes(value);
}

/** A box number typed while there is no carton list: a whole number from 1, else null. */
export function readBoxNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 ? value : null;
}

/** Moves the active option in a grid of `columns`: arrows by one or by a row; null for other keys. */
export function moveInGrid(key: string, index: number, count: number, columns: number): number | null {
  if (count === 0) return null;
  const clamp = (next: number) => Math.min(count - 1, Math.max(0, next));
  switch (key) {
    case "ArrowRight":
      return clamp(index + 1);
    case "ArrowLeft":
      return clamp(index - 1);
    case "ArrowDown":
      return index < 0 ? 0 : clamp(index + columns);
    case "ArrowUp":
      return clamp(index - columns);
    case "PageDown":
      return count - 1;
    case "PageUp":
      return 0;
    default:
      return null;
  }
}

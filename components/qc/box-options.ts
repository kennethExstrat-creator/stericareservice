// The suggestions behind BoxNumberField, kept pure so they can be tested:
// which of the size's sampled box/carton numbers to offer for the digits
// typed, which other rows already hold, when the list shows and where the
// arrows move the choice (BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026:
// box # and carton # are one number, "yes link again").

/** The digits of what was typed: " 2 2" is "22". */
export function typedDigits(text: string | null | undefined): string {
  return (text ?? "").replace(/\D/g, "");
}

/** The size's sampled numbers to offer: unique whole numbers from 1, ascending, those holding the digits typed. */
export function boxOptions(cartons: readonly number[], query = ""): number[] {
  const digits = typedDigits(query);
  const unique = [...new Set(cartons.filter((carton) => Number.isInteger(carton) && carton > 0))].sort(
    (a, b) => a - b,
  );
  return digits === "" ? unique : unique.filter((carton) => String(carton).includes(digits));
}

/**
 * How many other rows hold each number. `used` holds every row's number in
 * the list, this row's included, so one occurrence of `value` is this row's own.
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

/**
 * Whether the suggestions show: only where the number can change, while the
 * size has sampled numbers holding the digits typed (as you type), or once
 * the arrow key opened the list without typing. Text with no digits, or none
 * the list holds, shows nothing: typing never waits for the list.
 */
export function showsSuggestions({
  readOnly,
  typed,
  browsing,
  options,
}: {
  readOnly: boolean;
  /** The text typed since the field took the focus; null while nothing is typed. */
  typed: string | null;
  /** The list was opened with the arrow key. */
  browsing: boolean;
  /** How many suggestions there are for what is typed. */
  options: number;
}): boolean {
  if (readOnly || options === 0) return false;
  return browsing || typedDigits(typed) !== "";
}

/**
 * Where the arrows move the chosen suggestion, from `index` (-1: none yet)
 * among `count`: Down to the next, Up to the one before, both wrapping round,
 * as a list combobox does (WAI-ARIA APG); Page Up and Page Down to the first
 * and the last (Home and End stay the caret's). Null for any other key, which
 * the field keeps for itself.
 */
export function moveSuggestion(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return index < 0 || index >= count - 1 ? 0 : index + 1;
    case "ArrowUp":
      return index <= 0 ? count - 1 : index - 1;
    case "PageDown":
      return count - 1;
    case "PageUp":
      return 0;
    default:
      return null;
  }
}

/**
 * What a suggestion says about the other rows holding it: "Used" (and how
 * often, "Used ×2"), with the words a screen reader hears; null when no other
 * row holds it. Still offered: one carton can supply several inner boxes.
 */
export function usedNote(others: number): { shown: string; spoken: string } | null {
  if (others <= 0) return null;
  return {
    shown: others === 1 ? "Used" : `Used ×${others}`,
    spoken: others === 1 ? "in another row" : `in ${others} other rows`,
  };
}

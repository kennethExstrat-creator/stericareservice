// ISO 6346 container numbers: owner code (3 letters), category (U, J or Z),
// serial (6 digits) and a check digit. A mistyped container number breaks the
// shipment's paper trail, and the check digit catches most typos.

export type ContainerNumberCheck =
  | { ok: true; normalised: string }
  | { ok: false; reason: "format" }
  | { ok: false; reason: "check_digit"; normalised: string; expected: number };

const PATTERN = /^[A-Z]{3}[UJZ]\d{7}$/;

// A = 10 upwards, skipping multiples of 11 (so B = 12, L = 23, V = 34).
const LETTER_VALUES: Readonly<Record<string, number>> = (() => {
  const values: Record<string, number> = {};
  let value = 10;
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (value % 11 === 0) value += 1;
    values[letter] = value;
    value += 1;
  }
  return values;
})();

/** Upper case without the spaces, hyphens, dots and slashes painted or typed between the parts. */
export function normaliseContainerNumber(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-./]/g, "");
}

/** The check digit of the first ten characters (owner code, category, serial). */
export function containerCheckDigit(firstTen: string): number {
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = firstTen[index];
    const value = /\d/.test(char) ? Number(char) : LETTER_VALUES[char];
    sum += value * 2 ** index;
  }
  return (sum % 11) % 10;
}

export function checkContainerNumber(raw: string): ContainerNumberCheck {
  const normalised = normaliseContainerNumber(raw);
  if (!PATTERN.test(normalised)) return { ok: false, reason: "format" };
  const expected = containerCheckDigit(normalised.slice(0, 10));
  return Number(normalised[10]) === expected
    ? { ok: true, normalised }
    : { ok: false, reason: "check_digit", normalised, expected };
}

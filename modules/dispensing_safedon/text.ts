// Wording for summaries, messages and the heading. Labels are headings in the
// template's wording ("Box #"); inside a sentence the app uses their words
// without the footnote marks. Rates are printed the way the report prints
// them: "3 / 625 (0.48%)".
import { CODE_LETTERS, formatCount } from "@/lib/aql";
import { roundTo } from "@/lib/stats";

/** Rates are shown, and so judged, at two decimals at most: 0.48%, 1.1%, 0%. */
export const RATE_DECIMALS = 2;

/** "Box #" is "Box", "Others:" is "Others". */
export function plainLabel(label: string): string {
  const plain = label.replace(/^[\s*#]+/, "").replace(/[\s%#*:]+$/, "");
  return plain === "" ? label.trim() : plain;
}

/** "C", "C & D", "C, D & E": as the report headings list code letters. */
export function joinWithAmpersand(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} & ${items.at(-1)}`;
}

/** Distinct code letters in table order (A to R), for a heading's {codeLetters}. */
export function codeLettersOf(letters: Iterable<string | null>): string[] {
  const present = new Set(letters);
  return CODE_LETTERS.filter((letter) => present.has(letter));
}

/** Fills `{name}` placeholders of a caption; a placeholder without a value stays as written. */
export function fillPlaceholders(caption: string, values: Readonly<Record<string, string>>): string {
  return caption.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => values[name] ?? match);
}

/** defects / gloves x 100: 3 of 625 is 0.48. Null without gloves. */
export function ratePercent(defects: number, gloves: number): number | null {
  return gloves > 0 ? (defects * 100) / gloves : null;
}

/** A rate in % as shown: at most two decimals, trailing zeros dropped (0.48, 1.1, 0). */
export function formatRatePct(rate: number): string {
  return String(roundTo(rate, RATE_DECIMALS));
}

/** "3 / 625 (0.48%)", "11 / 1,000 (1.1%)": the size total line of the report. */
export function formatSizeRate(defects: number, gloves: number): string {
  const rate = ratePercent(defects, gloves);
  const counts = `${formatCount(defects)} / ${formatCount(gloves)}`;
  return rate === null ? counts : `${counts} (${formatRatePct(rate)}%)`;
}

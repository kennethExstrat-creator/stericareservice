// Wording for summaries, messages and the heading. Labels are column
// headings in the template's wording ("Layering %", "Stickiness **",
// "Box/Carton #"); inside a sentence the app uses their words without the
// unit or the footnote marks.
import { CODE_LETTERS } from "@/lib/aql";

/** "Layering %" is "Layering", "Stickiness **" is "Stickiness", "Box/Carton #" is "Box/Carton", "Others:" is "Others". */
export function plainLabel(label: string): string {
  const plain = label.replace(/^[\s*#]+/, "").replace(/[\s%#*:]+$/, "");
  return plain === "" ? label.trim() : plain;
}

/** A label inside a sentence: "Item" becomes "item"; an acronym ("PO") stays. */
export function inSentence(label: string): string {
  const word = plainLabel(label);
  const second = word.charAt(1);
  return second !== "" && second === second.toUpperCase() && second !== second.toLowerCase()
    ? word
    : `${word.charAt(0).toLowerCase()}${word.slice(1)}`;
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

// Template captions in sentences and headings: "{codeLetters}" filled in,
// the code letters of a heading ("C & D"), and a column heading's words
// without its unit or footnote marks ("Layering %" is "Layering").
import { CODE_LETTERS } from "@/lib/aql";

/** Fills a caption's `{name}` placeholders; a placeholder without a value stays as written. */
export function fillCaption(caption: string, values: Readonly<Record<string, string>>): string {
  return caption.replace(/\{([A-Za-z]\w*)\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * The distinct code letters, in ISO 2859-1 order, as the report headings
 * list them: "J", "J & L", "C, D & E"; `empty` (default "") with none.
 */
export function formatCodeLetters(letters: Iterable<string | null | undefined>, { empty = "" }: { empty?: string } = {}): string {
  const present = new Set(letters);
  const found = CODE_LETTERS.filter((letter) => present.has(letter));
  if (found.length === 0) return empty;
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(", ")} & ${found[found.length - 1]}`;
}

/**
 * A column heading's words for a sentence: "Layering %" is "Layering",
 * "Stickiness **" is "Stickiness", "Box/Carton #" is "Box/Carton", "Others:" is "Others".
 * A heading that is only marks stays as it is.
 */
export function plainLabel(label: string): string {
  const plain = label.replace(/^[\s*#]+/, "").replace(/[\s%#*:]+$/, "");
  return plain === "" ? label.trim() : plain;
}

// The capitalisation rule (docs/DESIGN.md, Capitalisation) as code, so a test
// can hold a list of labels to it, and so the code that writes labels from
// keys (lib/zod-form, the review's history) follows the same rule: every word
// of a label starts with a capital letter, apart from the small words below
// in the middle of a label. The first and the last word always start with a
// capital ("Used In", "Base Moved On"), so does the first word after a colon
// or an opening bracket ("Accent: Logo Teal (The Brand, Never a Result)"),
// and each part of a hyphenated word ("Sign-In Emails"). A small word may
// still start with a capital in the middle ("Sign In Again": the "In"
// belongs to the verb), so only the other words are checked there. Units keep
// their own case wherever they stand ("Weight (g)", UNITS). Codes and names
// keep theirs too (px, brand-500, iPad) and are not for this check.

/** The words that stay lower case in the middle of a label: "Inspector in Charge", "Gloves per Case". */
export const SMALL_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "of",
  "in",
  "on",
  "at",
  "to",
  "by",
  "for",
  "per",
  "via",
  "vs",
  "as",
]);

/**
 * The units a label may name, which keep their own case, in brackets or not:
 * "Weight (g)", "Length (mm)", "Total (pcs)", "Force (N)" (docs/DESIGN.md:
 * mm, g, N, MPa, %, pcs and pairs, as lib/schemas/common's units and a
 * template's unit). A word in brackets is no unit: "Qty (Cases)".
 */
export const UNITS: ReadonlySet<string> = new Set(["mm", "g", "N", "MPa", "%", "pcs", "pairs"]);

/**
 * True when the word at `index` of a label's `count` words stays lower case:
 * a small word that is neither the first nor the last ("Boxes per Size", but
 * "Shown As"). For code that writes a label word by word.
 */
export function staysLowerCase(word: string, index: number, count: number): boolean {
  return index > 0 && index < count - 1 && SMALL_WORDS.has(word.toLowerCase());
}

/** A word without the brackets, quotes and marks around it: "(optional)" is "optional". */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

const startsLowerCase = (word: string) => /^\p{Ll}/u.test(word);

/** A word for where it stands: "#" reads "Number", so "# of Case" has "of" in the middle (Kenneth, 27 October 2026). */
const isWord = (token: string) => bare(token) !== "" || token === "#";

/** A token that opens a part of the label: its first word takes a capital, "(The Brand". */
const OPENS = /^[(\[{“‘"']/u;

/**
 * The words of `label` that break the rule, as written; empty when the label
 * is in Title Case. "Product name (optional)" gives ["name", "optional"],
 * "Sign-in emails" gives ["in", "emails"], "Used in" gives ["in"]. Marks such
 * as "+", "−" or "·" count as words for where a word stands ("Tap + and −"
 * ends on "−"), but have no case of their own; nor have units ("Weight (g)").
 * A label opens on its first word, or on a "#", which reads "Number" ("# of
 * Gloves").
 */
export function lowerCaseWords(label: string): string[] {
  const tokens = label.split(/\s+/).filter(Boolean);
  const first = tokens.findIndex(isWord);
  const last = tokens.length - 1;
  return tokens.flatMap((token, index) => {
    if (bare(token) === "" || UNITS.has(bare(token))) return [];
    const [head, ...rest] = token.split("-").map(bare);
    const wrong = rest.filter(startsLowerCase);
    const opens = index === first || index === last || OPENS.test(token) || (tokens[index - 1] ?? "").endsWith(":");
    const small = !opens && SMALL_WORDS.has(head.toLowerCase());
    return startsLowerCase(head) && !small ? [head, ...wrong] : wrong;
  });
}

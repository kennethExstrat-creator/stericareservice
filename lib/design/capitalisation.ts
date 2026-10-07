// The capitalisation rule (docs/DESIGN.md, Capitalisation) as code, so a test
// can hold a list of labels to it: every word of a label starts with a capital
// letter, apart from the small words below when they are not the first word,
// and each part of a hyphenated word starts with one too ("Sign-In Emails").
// A small word may still start with a capital ("Sign In": the "In" belongs to
// the verb), so only the other words are checked. For labels the app writes
// itself: units, codes and names keep their own case (px, brand-500, iPad)
// and are not for this check.

/** The words that stay lower case inside a label: "Inspector in Charge", "Gloves per Case". */
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

/** A word without the brackets, quotes and marks around it: "(optional)" is "optional". */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

const startsLowerCase = (word: string) => /^\p{Ll}/u.test(word);

/**
 * The words of `label` that break the rule, as written; empty when the label
 * is in Title Case. "Product name (optional)" gives ["name", "optional"],
 * "Sign-in emails" gives ["in", "emails"].
 */
export function lowerCaseWords(label: string): string[] {
  const words = label.split(/\s+/).map(bare).filter(Boolean);
  return words.flatMap((word, index) => {
    const [first, ...rest] = word.split("-").map(bare);
    const wrong = rest.filter(startsLowerCase);
    const small = index > 0 && SMALL_WORDS.has(first.toLowerCase());
    return startsLowerCase(first) && !small ? [first, ...wrong] : wrong;
  });
}

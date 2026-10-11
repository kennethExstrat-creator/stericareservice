/**
 * Escaping for PostgREST filter strings. Search text comes from the URL, so it
 * is never interpolated raw: every value is escaped for the pattern language
 * it lands in (regular expression or Postgres array), then quoted for
 * PostgREST. Pure functions, unit-tested in postgrest.test.ts and checked
 * against the live API by e2e/list.
 *
 * PostgREST's grammar, from its docs ("Reserved characters") and parser:
 * - In a logic tree (`or=(a.eq.1,b.eq.2)`) commas and parentheses separate
 *   conditions, and dots separate column, operator and value. A value wrapped
 *   in double quotes is read literally up to the closing quote; inside it a
 *   backslash escapes the next character (`\"`, `\\`).
 * - In `like` and `ilike` patterns PostgREST turns every `*` into `%`, with no
 *   way to escape it. A literal asterisk therefore cannot be searched with
 *   ilike, so contains-searches use `imatch` (Postgres `~*`, a case-insensitive
 *   regular expression) with every metacharacter escaped instead.
 */

/** Wraps a value in double quotes for a PostgREST filter, escaping `"` and `\`. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * Escapes the metacharacters of a Postgres regular expression (ARE), so the
 * text matches itself. Letters and digits are never escaped: in an ARE a
 * backslash before one starts a class shorthand such as `\d`.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

/** A Postgres array literal of text values: `{"a","b"}`, each element quoted and escaped. */
export function arrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
}

/** Case-insensitive "contains" on a text column, with the text taken literally. */
export function containsFilter(column: string, text: string): string {
  return `${column}.imatch.${quoteFilterValue(escapeRegex(text))}`;
}

/**
 * A lot number as typed and in capitals (lot numbers are printed in capitals;
 * an iPad keyboard may not be). Each is still an exact, whole-value match.
 */
export function lotVariants(text: string): string[] {
  return [...new Set([text, text.toUpperCase()])];
}

/** The columns inspectionSearchFilter() reads: an inspection row's own, or every part's (lib/inspections/query.ts). */
export type SearchColumnNames = { ref: string; po: string; lots: string };

const OWN_COLUMNS: SearchColumnNames = { ref: "ref_no", po: "po_no", lots: "lot_numbers" };

/**
 * The `.or()` filter for the list search (BUILD_SPEC 10): the ref or the PO
 * contains the text, or one of the inspection's lot numbers is exactly the
 * text, as typed or in capitals. The carton number and any-case lot
 * conditions live in listSearchFilter() in lib/inspections/query.ts until
 * migration 20261007191137, which adds the columns they read, is live; on a
 * project without it the list searches with this filter alone.
 */
export function inspectionSearchFilter(text: string, columns: SearchColumnNames = OWN_COLUMNS): string {
  return [
    containsFilter(columns.ref, text),
    containsFilter(columns.po, text),
    `${columns.lots}.ov.${quoteFilterValue(arrayLiteral(lotVariants(text)))}`,
  ].join(",");
}

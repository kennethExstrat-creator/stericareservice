// Glove sizes (BUILD_SPEC 4.2 rule 5). Examination gloves come in letters,
// surgical gloves in half sizes. Every size is stored in one canonical
// spelling, so "7", "7.0" and "7,0" are one size and "m" is "M".
import { z } from "zod";

export const LETTER_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type LetterSize = (typeof LETTER_SIZES)[number];

/** Surgical sizes: 5.5 to 9.0 in half sizes. */
export const NUMERIC_SIZES = ["5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"] as const;
export type NumericSize = (typeof NUMERIC_SIZES)[number];

export type SizeKind = "letter" | "numeric";

const NUMERIC_MIN = 5.5;
const NUMERIC_MAX = 9;

// Keys are upper case with spaces, hyphens and underscores removed.
const LETTER_ALIASES: Readonly<Record<string, LetterSize>> = {
  XS: "XS",
  XSMALL: "XS",
  EXTRASMALL: "XS",
  S: "S",
  SMALL: "S",
  M: "M",
  MEDIUM: "M",
  L: "L",
  LARGE: "L",
  XL: "XL",
  XLARGE: "XL",
  EXTRALARGE: "XL",
  XXL: "XXL",
  "2XL": "XXL",
  XXLARGE: "XXL",
  "2XLARGE": "XXL",
};

const NUMERIC_PATTERN = /^\d{1,2}(?:[.,]\d{1,3})?$/;

export const SIZE_HINT = "Use XS, S, M, L, XL, XXL, or 5.5 to 9.0 in half sizes.";

export type ParseSizeResult = { ok: true; size: string; kind: SizeKind } | { ok: false; error: string };

export function parseSize(raw: string): ParseSizeResult {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "Enter a size." };

  const letter = LETTER_ALIASES[text.toUpperCase().replace(/[\s_-]+/g, "")];
  if (letter) return { ok: true, size: letter, kind: "letter" };

  if (NUMERIC_PATTERN.test(text)) {
    const value = Number(text.replace(",", "."));
    if (value >= NUMERIC_MIN && value <= NUMERIC_MAX && Number.isInteger(value * 2)) {
      return { ok: true, size: value.toFixed(1), kind: "numeric" };
    }
    return { ok: false, error: `${text} is not a surgical size: 5.5 to 9.0 in half sizes.` };
  }
  return { ok: false, error: `Unknown size "${text}". ${SIZE_HINT}` };
}

/** The canonical spelling ("7" -> "7.0", "m" -> "M"), or null for anything that is not a size. */
export function normaliseSize(raw: string): string | null {
  const parsed = parseSize(raw);
  return parsed.ok ? parsed.size : null;
}

export function isValidSize(raw: string): boolean {
  return parseSize(raw).ok;
}

/** Already in its canonical spelling: what stored data, results and contexts use. */
export function isCanonicalSize(value: string): boolean {
  return normaliseSize(value) === value;
}

export function sizeKind(raw: string): SizeKind | null {
  const parsed = parseSize(raw);
  return parsed.ok ? parsed.kind : null;
}

function rank(raw: string): number {
  const parsed = parseSize(raw);
  if (!parsed.ok) return Number.POSITIVE_INFINITY;
  return parsed.kind === "letter"
    ? LETTER_SIZES.indexOf(parsed.size as LetterSize)
    : LETTER_SIZES.length + Number(parsed.size);
}

/** Canonical order: XS to XXL, then 5.5 to 9.0; anything else last, alphabetically. */
export function compareSizes(a: string, b: string): number {
  const difference = rank(a) - rank(b);
  if (Number.isNaN(difference) || difference === 0) return a.localeCompare(b);
  return difference;
}

export function sortSizes(sizes: readonly string[]): string[] {
  return [...sizes].sort(compareSizes);
}

/**
 * Canonical spellings without duplicates, in the order of `reference` (a
 * template's size list), then canonical order for sizes it does not list.
 * Anything that is not a size is dropped.
 */
export function orderSizes(sizes: Iterable<string>, reference: readonly string[] = []): string[] {
  const position = new Map<string, number>();
  for (const value of reference) {
    const size = normaliseSize(value);
    if (size !== null && !position.has(size)) position.set(size, position.size);
  }
  const unique = new Set<string>();
  for (const value of sizes) {
    const size = normaliseSize(value);
    if (size !== null) unique.add(size);
  }
  return [...unique].sort((a, b) => {
    const pa = position.get(a);
    const pb = position.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return compareSizes(a, b);
  });
}

/** A size in any accepted spelling (template definitions, imports). */
export const SizeInputSchema = z.string().refine(isValidSize, { error: SIZE_HINT });

/** A size in its canonical spelling (stored data, resolved templates, results). */
export const CanonicalSizeSchema = z.string().refine(isCanonicalSize, {
  error: `Not a canonical size. ${SIZE_HINT} Write 7.0, not 7; M, not m.`,
});

// Size and hand labels for headings, tabs, accessible names and photo tags.
// Sizes arrive canonical ("M", "7.0"; lib/sizes normalises them); a template
// may give a size its own label ("Medium"), which wins.

/** A template size: canonical value and optional label (the resolved template's shape). */
export type SizeOption = { readonly value: string; readonly label?: string };

export type SizeFormat = {
  /** The template's sizes; a matching label replaces the value. */
  sizes?: readonly SizeOption[];
  /** "Size M" instead of "M". */
  prefix?: boolean;
};

/** "M", "Medium" (template label), or "Size M" with `prefix`. */
export function formatSize(size: string, { sizes, prefix = false }: SizeFormat = {}): string {
  const label = sizes?.find((option) => option.value === size)?.label?.trim() || size;
  return prefix ? `Size ${label}` : label;
}

/** "XS, S, M": sizes in the order given. */
export function formatSizeList(list: readonly string[], format: Omit<SizeFormat, "prefix"> = {}): string {
  return list.map((size) => formatSize(size, format)).join(", ");
}

export type HandCode = "R" | "L";

const HAND_NAME: Readonly<Record<HandCode, string>> = { R: "Right Hand", L: "Left Hand" };

/** "R" in "short" style, "Right Hand" in "long" (default), as the capture kit names a hand (HandToggle). */
export function formatHand(hand: HandCode, style: "short" | "long" = "long"): string {
  return style === "short" ? hand : HAND_NAME[hand];
}

/**
 * "Size M, Right Hand" (or "Size M" without a hand): labels and accessible
 * names, in Title Case as the capture screen names the place. A sentence
 * that says where lowers the hand itself ("Photo: …, Size M, right hand").
 */
export function formatSizeHand(size: string, hand?: HandCode | null, format: Omit<SizeFormat, "prefix"> = {}): string {
  const sizeText = formatSize(size, { ...format, prefix: true });
  return hand ? `${sizeText}, ${HAND_NAME[hand]}` : sizeText;
}

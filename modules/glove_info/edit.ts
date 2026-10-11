// Edits of the glove variants, pure so they are tested without a browser.
// Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md), so a value committed on blur and one typed in the
// same event both stay. An edit that changes nothing returns `data` itself,
// and no change is saved. Every edit returns data the schema keeps: the
// weight comes from NumberField (a number, more than 0 g) and text is cut to
// the schema's limit. The screen shows one blank variant while none is
// saved: an edit of variant 0 then creates it.
import {
  emptyVariant,
  MAX_VARIANTS,
  TEXT_MAX_LENGTH,
  type GloveInfoData,
  type GloveInfoTextField,
  type GloveVariant,
} from "./schema";

/** `data` with variant `index` changed, the variants before it created blank; `data` itself when nothing changes. */
function withVariant(data: GloveInfoData, index: number, change: (variant: GloveVariant) => GloveVariant): GloveInfoData {
  const current = data.variants[index] ?? emptyVariant();
  const next = change(current);
  if (next === current && index < data.variants.length) return data;
  const variants = [...data.variants];
  while (variants.length < index) variants.push(emptyVariant());
  variants[index] = next;
  return { ...data, variants };
}

/** Text as typed, spaces between words included, cut to what the schema keeps; blank is null. */
export function setText(data: GloveInfoData, index: number, field: GloveInfoTextField, value: string): GloveInfoData {
  const next = value === "" ? null : clampText(value, TEXT_MAX_LENGTH);
  return withVariant(data, index, (variant) => (variant[field] === next ? variant : { ...variant, [field]: next }));
}

/** Trims a field once it is left; nothing but spaces is blank. */
export function tidyText(data: GloveInfoData, index: number, field: GloveInfoTextField): GloveInfoData {
  if (index >= data.variants.length) return data;
  return withVariant(data, index, (variant) => {
    const value = variant[field];
    if (value === null || value === value.trim()) return variant;
    const trimmed = value.trim();
    return { ...variant, [field]: trimmed === "" ? null : trimmed };
  });
}

/** The indicative weight in g, or null when cleared. */
export function setIndicativeWeight(data: GloveInfoData, index: number, grams: number | null): GloveInfoData {
  return withVariant(data, index, (variant) => (variant.indicativeWeight === grams ? variant : { ...variant, indicativeWeight: grams }));
}

/** Picks a size for the variant, or drops it; the sizes stay in the template's order. */
export function toggleSize(data: GloveInfoData, index: number, size: string, order: readonly string[]): GloveInfoData {
  return withVariant(data, index, (variant) => {
    const picked = variant.sizes.includes(size) ? variant.sizes.filter((entry) => entry !== size) : [...variant.sizes, size];
    picked.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return { ...variant, sizes: picked };
  });
}

/** A blank variant at the end (two, while none is saved: the one on screen and the new one). */
export function addVariant(data: GloveInfoData): GloveInfoData {
  const base = data.variants.length === 0 ? [emptyVariant()] : data.variants;
  if (base.length >= MAX_VARIANTS) return data;
  return { ...data, variants: [...base, emptyVariant()] };
}

export function removeVariant(data: GloveInfoData, index: number): GloveInfoData {
  if (index >= data.variants.length) return data;
  return { ...data, variants: data.variants.filter((_, position) => position !== index) };
}

/** At most `max` UTF-16 units, as the schema and the field count them, without cutting a character in two. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

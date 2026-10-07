// Edits of the glove information, pure so they are tested without a browser.
// Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md), so a value committed on blur and one typed in the
// same event both stay. An edit that changes nothing returns `data` itself,
// and no change is saved. Every edit returns data the schema keeps: the
// weight comes from NumberField (a number, more than 0 g) and text is cut to
// the schema's limit.
import { TEXT_MAX_LENGTH, type GloveInfoData, type GloveInfoTextField } from "./schema";

/** Text as typed, spaces between words included, cut to what the schema keeps; blank is null. */
export function setText(data: GloveInfoData, field: GloveInfoTextField, value: string): GloveInfoData {
  const next = value === "" ? null : clampText(value, TEXT_MAX_LENGTH);
  return data[field] === next ? data : { ...data, [field]: next };
}

/** Trims a field once it is left; nothing but spaces is blank. */
export function tidyText(data: GloveInfoData, field: GloveInfoTextField): GloveInfoData {
  const value = data[field];
  if (value === null || value === value.trim()) return data;
  const trimmed = value.trim();
  return { ...data, [field]: trimmed === "" ? null : trimmed };
}

/** The indicative weight in g, or null when cleared. */
export function setIndicativeWeight(data: GloveInfoData, grams: number | null): GloveInfoData {
  return data.indicativeWeight === grams ? data : { ...data, indicativeWeight: grams };
}

/** At most `max` UTF-16 units, as the schema and the field count them, without cutting a character in two. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

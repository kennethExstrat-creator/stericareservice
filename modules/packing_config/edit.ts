// Edits of the packing configuration, pure so they are tested without a
// browser. Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md): the three counts form one run of fields, so a pasted
// "200, 10, 2000" fills all three in one change and none is lost. An edit
// that changes nothing returns `data` itself, and no change is saved. Every
// edit returns data the schema keeps: the counts come from NumberField
// (whole numbers from 1) and the text is cut to the schema's limit.
import type { PackingCount } from "./config";
import { TEXT_MAX_LENGTH, type PackingConfigData } from "./schema";

export function setCount(data: PackingConfigData, field: PackingCount, value: number | null): PackingConfigData {
  return data[field] === value ? data : { ...data, [field]: value };
}

/** The packing mode as typed, spaces between words included, cut to what the schema keeps; blank is null. */
export function setPackingMode(data: PackingConfigData, value: string): PackingConfigData {
  const next = value === "" ? null : clampText(value, TEXT_MAX_LENGTH);
  return data.packingMode === next ? data : { ...data, packingMode: next };
}

/** Trims the packing mode once it is left; nothing but spaces is blank. */
export function tidyPackingMode(data: PackingConfigData): PackingConfigData {
  const value = data.packingMode;
  if (value === null || value === value.trim()) return data;
  const trimmed = value.trim();
  return { ...data, packingMode: trimmed === "" ? null : trimmed };
}

/** At most `max` UTF-16 units, as the schema and the field count them, without cutting a character in two. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

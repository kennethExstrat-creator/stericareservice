// Edits of the header, pure so they are tested without a browser. Capture
// applies each to the latest data through useDataUpdater (docs/CAPTURE_KIT.md),
// so a value committed on blur and one typed in the same event both stay. An
// edit that changes nothing returns `data` itself, and no change is saved.
// Every edit returns data the schema keeps, so the header always loads.
import { DateCellSchema } from "@/modules/_framework";
import { TEXT_MAX_LENGTH, type HeaderData, type HeaderDateField, type HeaderTextField } from "./schema";

/** Text as typed, spaces between words included, cut to what the schema keeps; blank is null. */
export function setText(data: HeaderData, field: HeaderTextField, value: string): HeaderData {
  const next = value === "" ? null : clampText(value, TEXT_MAX_LENGTH);
  return data[field] === next ? data : { ...data, [field]: next };
}

/** Trims a field once it is left; nothing but spaces is blank. */
export function tidyText(data: HeaderData, field: HeaderTextField): HeaderData {
  const value = data[field];
  if (value === null || value === value.trim()) return data;
  const trimmed = value.trim();
  return { ...data, [field]: trimmed === "" ? null : trimmed };
}

/**
 * A date picker's value, or null when cleared. A browser may hand over a
 * five-digit year while one is typed: no date the schema keeps (rule 3), so
 * the date is left blank rather than saved as data that fails to load.
 */
export function setDate(data: HeaderData, field: HeaderDateField, value: string | null): HeaderData {
  const next = value !== null && DateCellSchema.safeParse(value).success ? value : null;
  return data[field] === next ? data : { ...data, [field]: next };
}

/** At most `max` UTF-16 units, as the schema and the field count them, without cutting a character in two. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

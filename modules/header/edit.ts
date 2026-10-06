// Edits of the header, pure so they are tested without a browser. Capture
// applies each to the latest data through useDataUpdater (docs/CAPTURE_KIT.md),
// so a value committed on blur and one typed in the same event both stay. An
// edit that changes nothing returns `data` itself, and no change is saved.
import { DateCellSchema } from "@/modules/_framework";
import type { HeaderData, HeaderDateField, HeaderTextField } from "./schema";

/** Text as typed, spaces between words included; blank is null. */
export function setText(data: HeaderData, field: HeaderTextField, value: string): HeaderData {
  const next = value === "" ? null : value;
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

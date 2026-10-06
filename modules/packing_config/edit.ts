// Edits of the packing configuration, pure so they are tested without a
// browser. Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md): the three counts form one run of fields, so a pasted
// "200, 10, 2000" fills all three in one change and none is lost. An edit
// that changes nothing returns `data` itself, and no change is saved.
import type { PackingCount } from "./config";
import type { PackingConfigData } from "./schema";

export function setCount(data: PackingConfigData, field: PackingCount, value: number | null): PackingConfigData {
  return data[field] === value ? data : { ...data, [field]: value };
}

/** The packing mode as typed, spaces between words included; blank is null. */
export function setPackingMode(data: PackingConfigData, value: string): PackingConfigData {
  const next = value === "" ? null : value;
  return data.packingMode === next ? data : { ...data, packingMode: next };
}

/** Trims the packing mode once it is left; nothing but spaces is blank. */
export function tidyPackingMode(data: PackingConfigData): PackingConfigData {
  const value = data.packingMode;
  if (value === null || value === value.trim()) return data;
  const trimmed = value.trim();
  return { ...data, packingMode: trimmed === "" ? null : trimmed };
}

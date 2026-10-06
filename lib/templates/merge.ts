// How config is merged down an extends chain (BUILD_SPEC 4.2 rule 9):
//
// - objects merge key by key, recursively: a child sets only what differs;
// - everything else replaces: arrays (a defect list, the measures), numbers,
//   strings, booleans and null. A list is never half-merged;
// - a key the child leaves out keeps the base's value.
//
// Module defaults come first, then each template from the root down. The
// result is validated by the module's config schema.
import type { JsonValue } from "@/lib/schemas/common";

export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeConfig(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isJsonObject(current) && isJsonObject(value) ? mergeConfig(current, value) : value;
  }
  return merged;
}

// How config is merged down an extends chain (BUILD_SPEC 4.2 rule 9):
//
// - objects merge key by key, recursively: a child sets only what differs;
// - a tagged object, one with a `kind` key such as a lib/stats Spec, is one
//   value: a child that sets it replaces it whole. So a spec can change kind
//   (STD_EG's XS width ≤ 80 becomes SAFEDON_EG's 76 ± 4) without keeping the
//   old limit;
// - everything else replaces: arrays (a defect list, the measures), numbers,
//   strings, booleans and null. A list is never half-merged;
// - a key the child leaves out keeps the base's value.
//
// Module defaults come first, then each template from the root down. The
// config itself is always merged key by key; the rules apply to its values.
// The result is validated by the module's config schema.
import type { JsonValue } from "@/lib/schemas/common";

export type JsonObject = { [key: string]: JsonValue };

/** The key that tags a variant of a union (lib/stats Spec): such an object is replaced, never merged. */
export const TAG_KEY = "kind";

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTagged(value: JsonObject): boolean {
  return Object.hasOwn(value, TAG_KEY);
}

export function mergeConfig(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isMergeable(current) && isMergeable(value) ? mergeConfig(current, value) : value;
  }
  return merged;
}

function isMergeable(value: unknown): value is JsonObject {
  return isJsonObject(value) && !isTagged(value);
}

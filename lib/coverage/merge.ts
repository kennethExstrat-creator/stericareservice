// How module config merges down a template's extends chain (BUILD_SPEC 4.2
// rule 9), as phase2/framework's lib/templates/merge.ts does it: the module's
// default config first, then each template from the root down. Objects merge
// key by key, recursively; everything else replaces whole (lists, numbers,
// strings, booleans, null).
//
// Two consequences for the dictionary's config shapes:
// - a value a child template must be able to replace whole is a list: the
//   spec rows per size, the defect lists. A spec kept in an object keyed by
//   size would merge into the base's, mixing two specs into one;
// - an object a template writes keeps every key its base has, because a
//   merge can add or change a key but never remove one.
// templates.test.ts resolves every seed template this way and checks the
// result is the dictionary's config.

export type ConfigObject = { readonly [key: string]: unknown };

export function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `override` merged over `base`, as the framework resolves a template. */
export function mergeConfig(base: ConfigObject, override: ConfigObject): ConfigObject {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isConfigObject(current) && isConfigObject(value) ? mergeConfig(current, value) : value;
  }
  return merged;
}

/** Structural equality of JSON-like values (key order ignored). */
export function configEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => configEqual(item, b[index]));
  }
  if (isConfigObject(a) && isConfigObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && configEqual(a[key], b[key]));
  }
  return false;
}

/**
 * What a child template writes for a module: only what differs from its base,
 * objects down to the changed keys, lists and values whole. Merging it over
 * the base gives `target` back as long as `target` keeps every key the base
 * has (see `droppedKeys`).
 */
export function configDiff(base: ConfigObject, target: ConfigObject): ConfigObject {
  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    const current = base[key];
    if (isConfigObject(current) && isConfigObject(value)) {
      const nested = configDiff(current, value);
      if (Object.keys(nested).length > 0) diff[key] = nested;
    } else if (!(key in base) || !configEqual(current, value)) {
      diff[key] = value;
    }
  }
  return diff;
}

/** Dotted paths of the values a diff sets: `fields.client`, `specs`. */
export function diffPaths(diff: ConfigObject, prefix = ""): string[] {
  return Object.entries(diff).flatMap(([key, value]) =>
    isConfigObject(value) ? diffPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/**
 * Keys an object in `base` has and the same object in `target` lacks: what a
 * merge over `base` cannot remove, so `target` can never be reached from it.
 */
export function droppedKeys(base: ConfigObject, target: ConfigObject, prefix = ""): string[] {
  return Object.entries(base).flatMap(([key, value]) => {
    if (!(key in target)) return [`${prefix}${key}`];
    const next = target[key];
    return isConfigObject(value) && isConfigObject(next) ? droppedKeys(value, next, `${prefix}${key}.`) : [];
  });
}

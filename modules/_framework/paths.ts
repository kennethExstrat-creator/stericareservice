// Canonical paths (BUILD_SPEC 4.3 Field.mapsTo): a custom field that maps to
// `modules.<key>.<path>` reads and writes that module's value instead of
// keeping its own copy, so a value is entered once (6.2 rule 10) and stored
// under our key whatever the form calls it (4.2 rule 3).
import type { FieldType } from "@/lib/schemas/common";
import { isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import type { CanonicalPath, ModuleRegistry } from "./contract";

export type ParsedCanonicalPath = { moduleKey: ModuleKey; segments: string[] };

export function parseCanonicalPath(value: string): ParsedCanonicalPath | null {
  const [root, moduleKey, ...segments] = value.split(".");
  if (root !== "modules" || moduleKey === undefined || !isModuleKey(moduleKey) || segments.length === 0) return null;
  if (segments.some((segment) => !/^[A-Za-z0-9_]+$/.test(segment))) return null;
  return { moduleKey, segments };
}

export function canonicalPathOf(moduleKey: ModuleKey, path: string): string {
  return `modules.${moduleKey}.${path}`;
}

/** The module path a mapping points at, if that module declares it. */
export function findCanonicalPath(
  registry: ModuleRegistry,
  mapsTo: string,
): { moduleKey: ModuleKey; canonical: CanonicalPath } | null {
  const parsed = parseCanonicalPath(mapsTo);
  if (!parsed) return null;
  const path = parsed.segments.join(".");
  const canonical = registry[parsed.moduleKey].canonicalPaths.find((entry) => entry.path === path);
  return canonical ? { moduleKey: parsed.moduleKey, canonical } : null;
}

/** Whether a custom field of `fieldType` can hold the value at a path of `pathType`. */
export function isMappableType(fieldType: FieldType, pathType: FieldType): boolean {
  if (fieldType === pathType) return true;
  const text: ReadonlySet<FieldType> = new Set(["text", "textarea"]);
  if (text.has(fieldType) && text.has(pathType)) return true;
  // A counter holds whole numbers, which a number path accepts; not the other way round.
  return fieldType === "counter" && pathType === "number";
}

export function readPath(value: unknown, segments: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** A copy of `value` with `next` at the path; missing objects on the way are created. */
export function writePath(value: unknown, segments: readonly (string | number)[], next: unknown): unknown {
  if (segments.length === 0) return next;
  const [head, ...rest] = segments;
  const base =
    typeof value === "object" && value !== null
      ? Array.isArray(value)
        ? [...value]
        : { ...(value as Record<string, unknown>) }
      : typeof head === "number"
        ? []
        : {};
  const child = (base as Record<string | number, unknown>)[head];
  (base as Record<string | number, unknown>)[head] = writePath(child, rest, next);
  return base;
}

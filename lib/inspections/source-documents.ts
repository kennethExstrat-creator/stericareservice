// Source Documents (docs/AI.md, "Source Documents"): the first step of every
// inspection. The inspector uploads every file about it; the AI reads each
// one and proposes values for the modules after it. Pure and client-safe:
// the capture screen lays the proposals over its own data, so they go
// through the same autosave as typing, and only into fields still empty.
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { readModuleEntry, writeModuleData, type InspectionData } from "@/modules/_framework/data";

/** The page's key on the capture screen (?module=source_documents) and the files' module_key. */
export const SOURCE_DOCUMENTS_KEY = "source_documents";
export const SOURCE_DOCUMENTS_TITLE = "Source Documents";

/**
 * Modules the AI never fills: the conclusion holds the inspector's own
 * result, remark and signature (the AI never decides a result).
 */
export const NOT_FILLED_BY_AI: readonly ModuleKey[] = ["conclusion"];

/** What a reading proposes: partial data per module key, in each module's own shape. */
export type SourceProposals = Record<string, Record<string, unknown>>;

export type SourceFileStatus = { status: "reading" | "read" | "failed"; summary: string | null; filled?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Nothing entered: null, blank text, or an array or object holding nothing. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (isRecord(value)) return Object.values(value).every(isEmptyValue);
  return false;
}

/** `proposed` laid into `current` wherever current holds nothing; what is entered stays. */
export function fillEmpty(current: unknown, proposed: unknown): unknown {
  if (proposed === undefined) return current;
  if (isEmptyValue(current) && !isRecord(current) && !Array.isArray(current)) return isEmptyValue(proposed) ? current : proposed;
  if (Array.isArray(current) && Array.isArray(proposed)) {
    if (current.every(isEmptyValue)) return proposed.length >= current.length ? proposed : [...proposed, ...current.slice(proposed.length)];
    return current.map((entry, index) => (index < proposed.length ? fillEmpty(entry, proposed[index]) : entry));
  }
  if (isRecord(current) && isRecord(proposed)) {
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(proposed)) next[key] = key in current ? fillEmpty(current[key], value) : value;
    return next;
  }
  if (isEmptyValue(current) && (Array.isArray(current) || isRecord(current))) return isEmptyValue(proposed) ? current : proposed;
  return current;
}

/** Values that were empty in `before` and hold something in `after`. */
export function countFilled(before: unknown, after: unknown): number {
  if (isRecord(after)) {
    const from = isRecord(before) ? before : {};
    return Object.entries(after).reduce((sum, [key, value]) => sum + countFilled(from[key], value), 0);
  }
  if (Array.isArray(after)) {
    const from = Array.isArray(before) ? before : [];
    return after.reduce((sum: number, value, index) => sum + countFilled(from[index], value), 0);
  }
  return isEmptyValue(before) && !isEmptyValue(after) ? 1 : 0;
}

type Schema = { safeParse(value: unknown): { success: true; data: unknown } | { success: false } };

/**
 * One module's proposal over its data, checked with the module's schema: the
 * whole proposal if it passes, else each top-level field on its own, and
 * each size of a per-size module on its own, so one bad value does not
 * spoil the rest.
 */
export function fillModule(schema: Schema, current: Record<string, unknown>, proposal: Record<string, unknown>): Record<string, unknown> {
  const whole = schema.safeParse(fillEmpty(current, proposal));
  if (whole.success && isRecord(whole.data)) return whole.data;

  let accepted = current;
  const tryValue = (candidate: Record<string, unknown>) => {
    const parsed = schema.safeParse(candidate);
    if (parsed.success && isRecord(parsed.data)) accepted = parsed.data;
    return parsed.success;
  };
  for (const [key, value] of Object.entries(proposal)) {
    if (tryValue({ ...accepted, [key]: fillEmpty(accepted[key], value) })) continue;
    // A per-size module ({ sizes: { M: …, L: … } }): each size on its own.
    if (isRecord(value) && isRecord(accepted[key])) {
      for (const [inner, innerValue] of Object.entries(value)) {
        const host = accepted[key] as Record<string, unknown>;
        tryValue({ ...accepted, [key]: { ...host, [inner]: fillEmpty(host[inner], innerValue) } });
      }
    }
  }
  return accepted;
}

/**
 * The inspection's data with a reading's proposals filled in: only modules
 * the template includes (never the conclusion), only fields still empty,
 * only values each module's schema accepts. `filled` counts the values.
 */
export function applyProposals(
  data: InspectionData,
  proposals: SourceProposals,
  registry: ModuleRegistry,
  included: ReadonlySet<string>,
): { data: InspectionData; filled: number; modules: string[] } {
  let next = data;
  let filled = 0;
  const modules: string[] = [];
  for (const [key, proposal] of Object.entries(proposals)) {
    if (!included.has(key) || !(key in registry) || NOT_FILLED_BY_AI.includes(key as ModuleKey) || !isRecord(proposal)) continue;
    const definition = registry[key as ModuleKey];
    const entry = readModuleEntry(next, "modules", key);
    const current = isRecord(entry.value) && entry.hasData ? entry.value : (definition.emptyData() as Record<string, unknown>);
    const value = fillModule(definition.dataSchema as Schema, current, proposal);
    const count = countFilled(current, value);
    if (count === 0) continue;
    next = writeModuleData(next, "modules", key, value);
    filled += count;
    modules.push(key);
  }
  return { data: next, filled, modules };
}

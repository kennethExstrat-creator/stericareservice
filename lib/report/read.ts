// Reading the export (lib/schemas/export.ts) for the report: a module's
// data, computed values and config are JSON in each module's own shape
// (modules/<key>/schema.ts and calc.ts), so the report reads them
// defensively. A value that is missing or of another type reads as nothing,
// never as a crash: an inspection in progress, or saved by an older build,
// still prints. Pure and client-safe, like the rest of lib/report.
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { normaliseSize } from "@/lib/sizes";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An object, or an empty one. */
export function rec(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** A list, or an empty one. */
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A finite number, else null. */
export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Text with something in it, trimmed; else null. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A value down a path of keys and indexes: `at(computed, "sizes", "M", "median")`. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof segment === "number") current = Array.isArray(current) ? current[segment] : undefined;
    else current = isRecord(current) ? current[segment] : undefined;
    if (current === undefined) return undefined;
  }
  return current;
}

/** The included module of this key, or null: switched off, not in the template, or not built. */
export function moduleOf(doc: Pick<InspectionExport, "modules">, key: ModuleKey): ExportModule | null {
  return doc.modules.find((module) => module.key === key) ?? null;
}

/** A label of the module in the template's wording, else the fallback (docs/DESIGN.md: the report keeps the template's words). */
export function labelOf(module: Pick<ExportModule, "labels"> | null, key: string, fallback: string): string {
  return text(module?.labels[key]) ?? fallback;
}

/**
 * The sizes on the order, in the template's order (then any other, as
 * saved): a size with cases and not switched off (order_lots; 6.2 rule 4,
 * Kenneth 26 October 2026). Every module's per-size values are for these.
 */
export function orderedSizes(doc: Pick<InspectionExport, "modules" | "template">): string[] {
  const order = moduleOf(doc, "order_lots");
  if (!order) return [];
  const off = new Set(list(order.data.sizesOff).flatMap((size) => (typeof size === "string" ? [normaliseSize(size) ?? size] : [])));
  const sizes = Object.entries(rec(order.data.sizes)).flatMap(([key, line]) => {
    const size = normaliseSize(key) ?? key;
    const cases = num(rec(line).qtyCases);
    return cases !== null && cases > 0 && !off.has(size) ? [size] : [];
  });
  return inTemplateOrder(doc, [...new Set(sizes)]);
}

/** Sizes in the template's order; sizes it does not list keep theirs, after. */
export function inTemplateOrder(doc: Pick<InspectionExport, "template">, sizes: readonly string[]): string[] {
  const order = (doc.template.sizes ?? []).map((size) => size.value);
  const rank = (size: string) => {
    const index = order.indexOf(size);
    return index === -1 ? order.length : index;
  };
  return sizes.map((size, index) => ({ size, index })).sort((a, b) => rank(a.size) - rank(b.size) || a.index - b.index).map(({ size }) => size);
}

/** A size as the template shows it: its "Shown As", else the size. */
export function sizeLabel(doc: Pick<InspectionExport, "template">, size: string): string {
  return text(doc.template.sizes?.find((entry) => entry.value === size)?.label) ?? size;
}

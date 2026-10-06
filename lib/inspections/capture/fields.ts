// Plain forms the capture screen draws itself, for what has no Capture of
// its own:
//
// - custom modules (BUILD_SPEC 4.3): the one-off fields a template adds, in
//   a fields, table or grid layout (stored as lib/validation/custom.ts says);
// - a built module that has no Capture.tsx yet: its canonical paths, the
//   entered values a template may show elsewhere (docs/MODULES.md 3), as
//   plain fields, so its data can be entered until its own form lands.
//   Fields its config switches off (`fields: { <key>: false }`, the
//   convention for "fields on/off") are left out.
import type { FieldType, Unit } from "@/lib/schemas/common";
import type { CustomModule, Field } from "@/lib/schemas/template";
import { labelFor, type AnyModuleDefinition, type Labels } from "@/modules/_framework";

export type FormField = {
  /** The field's key, or the canonical path it edits. */
  key: string;
  /** Where the value sits inside the record the form edits. */
  segments: readonly string[];
  label: string;
  type: FieldType;
  unit?: Unit;
  options?: readonly string[];
  min?: number;
  max?: number;
  required?: boolean;
  hint?: string;
};

/** The canonical paths of a module without its own Capture, minus the fields its config switches off. */
export function fallbackFields(
  definition: Pick<AnyModuleDefinition, "canonicalPaths">,
  config: unknown,
  labels: Labels,
): FormField[] {
  return definition.canonicalPaths
    .filter((path) => path.type !== "photo" && !isSwitchedOffField(config, path.path))
    .map((path) => {
      const segments = path.path.split(".");
      return {
        key: path.path,
        segments,
        label: labelFor(labels, ...segments),
        type: path.type,
        ...(path.unit ? { unit: path.unit } : {}),
      };
    });
}

/** `config.fields.<key> === false`: the template switched this field off. */
export function isSwitchedOffField(config: unknown, path: string): boolean {
  if (!isRecord(config) || !isRecord(config.fields)) return false;
  return config.fields[path] === false;
}

export function customFormField(field: Field): FormField {
  return {
    key: field.key,
    segments: [field.key],
    label: field.label,
    type: field.type,
    ...(field.unit ? { unit: field.unit } : {}),
    ...(field.options ? { options: field.options } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.required ? { required: true } : {}),
    ...(field.hint ? { hint: field.hint } : {}),
  };
}

/** Text as stored: blank is null, anything else exactly as typed. */
export function textValue(raw: string): string | null {
  return raw.trim() === "" ? null : raw;
}

/** A date input's value as stored: `YYYY-MM-DD`, or null. */
export function dateValue(raw: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** The columns a grid shows: its default count, or more if more were added. */
export function gridColumnCount(custom: CustomModule, record: unknown): number {
  const base = custom.grid?.columns.default ?? 0;
  if (!isRecord(record)) return base;
  let widest = base;
  for (const field of custom.fields) {
    const cells = record[field.key];
    if (Array.isArray(cells)) widest = Math.max(widest, cells.length);
  }
  return widest;
}

/**
 * A grid record with one cell set: `{ <field>: [value per column] }`. The
 * row grows with nulls up to the column; other fields and columns are kept.
 * Never changes `record`.
 */
export function withGridCell(
  record: Readonly<Record<string, unknown>>,
  fieldKey: string,
  column: number,
  value: unknown,
): Record<string, unknown> {
  const stored = record[fieldKey];
  const row: unknown[] = Array.isArray(stored) ? [...stored] : [];
  while (row.length <= column) row.push(null);
  row[column] = value;
  return { ...record, [fieldKey]: row };
}

/** A grid record with one more, empty, column in every row of its own fields. Never changes `record`. */
export function withGridColumn(custom: CustomModule, record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const count = gridColumnCount(custom, record) + 1;
  const next: Record<string, unknown> = { ...record };
  for (const field of ownCustomFields(custom)) {
    const stored = record[field.key];
    const row: unknown[] = Array.isArray(stored) ? [...stored] : [];
    while (row.length < count) row.push(null);
    next[field.key] = row;
  }
  return next;
}

/** Custom fields that keep their own value (a field mapped to a module keeps none here). */
export function ownCustomFields(custom: CustomModule): Field[] {
  return custom.fields.filter((field) => field.mapsTo === undefined);
}

/** Per size: a table, or a grid repeated per size. */
export function isPerSizeCustom(custom: CustomModule): boolean {
  return custom.layout === "table" || (custom.layout === "grid" && custom.grid?.repeatPer === "size");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

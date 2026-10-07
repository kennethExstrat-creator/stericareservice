// Values of custom modules (BUILD_SPEC 4.3 CustomModule): the one-off fields
// a template adds. Saved in `data.custom.<key>`, shaped by the layout:
//
//   fields  { <field>: value }
//   table   { sizes: { <size>: { <field>: value } } }          one row per ordered size
//   grid    { <field>: [value per column] }                    a row per field, repeated columns
//           { sizes: { <size>: { <field>: [...] } } }          with grid.repeatPer = "size"
//
// A field that maps to a module (mapsTo) keeps no value here: it shows and
// edits the module's value, so it is entered once (6.2 rule 10).
import { z } from "zod";
import type { CustomModule, Field } from "@/lib/schemas/template";
import { rangeError } from "@/lib/stats";
import { CountCellSchema, DateCellSchema, DecimalCellSchema, isBlank, TextCellSchema, YesNoCellSchema } from "./cells";
import { errorIssue, warningIssue, type CalcIssue, type IssuePath } from "./issues";
import {
  FRAMEWORK_ISSUE_CODES as CODES,
  describeDataPath,
  invalidDataIssues,
  restrictToOrderedSizes,
  sizeDuplicateIssues,
  sizeNotOrderedIssues,
} from "./rules";

type Values = Record<string, unknown>;

/** The saved value of one cell of `field`. Photos are a list of photo ids. */
export function fieldValueSchema(field: Field): z.ZodType<unknown> {
  switch (field.type) {
    case "counter":
      return CountCellSchema;
    case "number":
      return DecimalCellSchema;
    case "text":
    case "textarea":
    case "select":
      return TextCellSchema;
    case "yes_no":
      return YesNoCellSchema;
    case "date":
      return DateCellSchema;
    case "photo":
      return z.array(z.string().min(1)).default([]);
  }
}

function ownFields(custom: CustomModule): Field[] {
  return custom.fields.filter((field) => field.mapsTo === undefined);
}

function bySize(row: z.ZodType<unknown>) {
  return z.looseObject({ sizes: z.record(z.string(), row).default({}) });
}

/** Loose objects: a key the template does not define is kept in the database, not exported. */
export function customValuesSchema(custom: CustomModule): z.ZodType<Values> {
  const fields = ownFields(custom);
  const record = z.looseObject(Object.fromEntries(fields.map((field) => [field.key, fieldValueSchema(field)])));
  switch (custom.layout) {
    case "fields":
      return record;
    case "table":
      return bySize(record);
    case "grid": {
      const rows = z.looseObject(
        Object.fromEntries(fields.map((field) => [field.key, z.array(fieldValueSchema(field)).default([])])),
      );
      return custom.grid?.repeatPer === "size" ? bySize(rows) : rows;
    }
  }
}

export function emptyCustomValues(custom: CustomModule): Values {
  return customValuesSchema(custom).parse({});
}

export type CustomEvaluationInput = {
  custom: CustomModule;
  /** `data.custom.<key>` without its comment; undefined when nothing is saved. */
  value: unknown;
  /** Ordered sizes from the context. */
  sizes: readonly string[];
  /** The module value a mapped field shows (Field.mapsTo). */
  readMapped: (mapsTo: string) => unknown;
};

export type CustomEvaluation = {
  /** What the export shows: saved values, mapped fields filled in from their modules, ordered sizes only. */
  values: Values;
  issues: CalcIssue[];
};

export function evaluateCustomValues({ custom, value, sizes, readMapped }: CustomEvaluationInput): CustomEvaluation {
  const parsed = customValuesSchema(custom).safeParse(value ?? {});
  if (!parsed.success) {
    const labels = Object.fromEntries(custom.fields.map((field) => [field.key, field.label]));
    return {
      values: {},
      issues: invalidDataIssues(custom.title, parsed.error, [], { describe: (path) => describeDataPath(path, labels) }),
    };
  }

  const perSize = custom.layout === "table" || (custom.layout === "grid" && custom.grid?.repeatPer === "size");
  if (!perSize) {
    const issues: CalcIssue[] = [];
    const values = checkRecord(custom, parsed.data, [], undefined, issues);
    if (custom.layout === "fields") fillMapped(custom, parsed.data, values, readMapped, issues);
    return { values, issues };
  }

  const { data, ignored, duplicates } = restrictToOrderedSizes(parsed.data, sizes);
  const issues = [...sizeNotOrderedIssues(ignored, custom.title), ...sizeDuplicateIssues(duplicates, custom.title)];
  const saved = (data.sizes ?? {}) as Record<string, Values>;
  const values: Values = {
    sizes: Object.fromEntries(
      sizes.map((size) => [size, checkRecord(custom, saved[size] ?? {}, ["sizes", size], size, issues)]),
    ),
  };
  return { values, issues };
}

/** Checks one record (a form, a table row or a grid) and returns its defined fields. */
function checkRecord(custom: CustomModule, record: Values, root: IssuePath, size: string | undefined, issues: CalcIssue[]) {
  const values: Values = {};
  for (const field of ownFields(custom)) {
    const value = record[field.key] ?? (custom.layout === "grid" ? [] : null);
    values[field.key] = value;
    if (custom.layout !== "grid") {
      issues.push(...checkValue(field, value, [...root, field.key], size));
      continue;
    }
    const cells = Array.isArray(value) ? value : [];
    const columns = custom.grid?.columns;
    if (columns && !columns.addable && cells.length > columns.default) {
      issues.push(
        errorIssue(CODES.tooManyColumns, `${field.label}: at most ${columns.default} ${columns.label} columns.`, {
          size,
          path: [...root, field.key],
        }),
      );
    }
    const count = Math.max(columns?.default ?? 0, cells.length);
    for (let column = 0; column < count; column += 1) {
      issues.push(...checkValue(field, cells[column] ?? null, [...root, field.key, column], size));
    }
  }
  return values;
}

function fillMapped(
  custom: CustomModule,
  saved: Values,
  values: Values,
  readMapped: (mapsTo: string) => unknown,
  issues: CalcIssue[],
): void {
  for (const field of custom.fields) {
    if (field.mapsTo === undefined) continue;
    const value = readMapped(field.mapsTo) ?? null;
    values[field.key] = value;
    if (field.key in saved) {
      issues.push(
        warningIssue(
          CODES.mappedValueIgnored,
          `${field.label}: a second value was saved here; the one in ${field.mapsTo} is used.`,
          { path: [field.key] },
        ),
      );
    }
    if (field.required && isBlank(value)) {
      issues.push(errorIssue(CODES.required, `${field.label} is required.`, { path: [field.key] }));
    }
  }
}

function checkValue(field: Field, value: unknown, path: IssuePath, size: string | undefined): CalcIssue[] {
  const where = size === undefined ? "" : ` (size ${size})`;
  if (isBlank(value)) {
    return field.required ? [errorIssue(CODES.required, `${field.label}${where} is required.`, { size, path })] : [];
  }
  if (typeof value === "number") {
    const problem = rangeError(value, { min: field.min, max: field.max });
    if (problem) return [errorIssue(CODES.outOfRange, `${field.label}${where}: ${problem}`, { size, path })];
  }
  if (field.type === "select" && typeof value === "string" && !field.options?.includes(value)) {
    return [
      errorIssue(
        CODES.invalidOption,
        `${field.label}${where}: "${value}" is not one of ${(field.options ?? []).join(", ")}.`,
        { size, path },
      ),
    ];
  }
  return [];
}

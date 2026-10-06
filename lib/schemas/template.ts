import { z } from "zod";
import { CanonicalSizeSchema, normaliseSize, SizeInputSchema } from "@/lib/sizes";
import {
  FieldTypeSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  ProductTypeSchema,
  StandardSchema,
  UnitSchema,
} from "./common";
import { ALWAYS_ON_MODULE_KEYS, isModuleKey, ModuleKeySchema, type ModuleKey } from "./module-result";

/* ------------------------------------------------------------------ *
 * Template definitions (BUILD_SPEC 4.3)
 *
 * What an admin writes and `templates.definition` stores. A template that
 * extends another lists only what differs; lib/templates resolves the chain
 * into a ResolvedTemplate (below), which `templates.resolved` stores and the
 * capture screen, validation and export read. Objects are strict: a
 * mistyped key is an error, never silently dropped (4.2 rule 2).
 * ------------------------------------------------------------------ */

/** Same rule as the `templates.code` check constraint: STD_EG, SAFEDON_EG. */
export const TEMPLATE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const TemplateCodeSchema = z
  .string()
  .regex(TEMPLATE_CODE_PATTERN, { error: "Use capitals, digits and underscores, starting with a letter: STD_EG." });

/** Custom module keys: stored as keys of `data.custom`. */
const CUSTOM_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Field and label keys: canonical keys such as `indicativeWeight` or a defect code such as `thin_spot`. */
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** `modules.<module key>.<path>`: where a custom field's value is stored (Field.mapsTo). */
export const CANONICAL_PATH_PATTERN = /^modules\.[a-z][a-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;

export const TemplateUnitSchema = z.enum(["pcs", "pairs"]);
export type TemplateUnit = z.infer<typeof TemplateUnitSchema>;

export const TemplateScopeSchema = z.strictObject({
  productType: ProductTypeSchema,
  standard: StandardSchema,
  clientId: z.uuid().optional(),
  manufacturerId: z.uuid().optional(),
});
export type TemplateScope = z.infer<typeof TemplateScopeSchema>;

export const TemplateSizeSchema = z.strictObject({
  /** Any accepted spelling; resolution stores the canonical one ("7" becomes "7.0"). */
  value: SizeInputSchema,
  /** Shown instead of the value, e.g. "Medium". */
  label: z.string().trim().min(1).optional(),
});
export type TemplateSize = z.infer<typeof TemplateSizeSchema>;

const LabelsSchema = z.record(
  z.string().regex(FIELD_KEY_PATTERN, { error: "Label keys are canonical field keys, e.g. indicativeWeight." }),
  z.string().trim().min(1),
);

/** Module config is always a JSON object: it is merged key by key down the extends chain. */
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const ModuleConfigSchema = z.strictObject({
  key: ModuleKeySchema,
  include: z.boolean(),
  /** Heading in the source form's wording. */
  title: z.string().trim().min(1).optional(),
  /** Field label overrides, keyed by canonical field key. */
  labels: LabelsSchema.optional(),
  /** Validated by that module's config schema when the template is resolved. */
  config: JsonObjectSchema.optional(),
});
export type ModuleConfig = z.infer<typeof ModuleConfigSchema>;

const NUMERIC_FIELD_TYPES: ReadonlySet<string> = new Set(["counter", "number"]);

export const FieldSchema = z
  .strictObject({
    key: z.string().regex(FIELD_KEY_PATTERN, { error: "Start with a letter; letters, digits and _ only." }),
    label: z.string().trim().min(1),
    type: FieldTypeSchema,
    unit: UnitSchema.optional(),
    options: z.array(z.string().trim().min(1)).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    required: z.boolean().optional(),
    hint: z.string().trim().min(1).optional(),
    /** Store the value in a module instead of the custom module, e.g. "modules.glove_info.indicativeWeight". */
    mapsTo: z
      .string()
      .regex(CANONICAL_PATH_PATTERN, { error: "Write modules.<module key>.<field>, e.g. modules.glove_info.colour." })
      .refine((path) => isModuleKey(path.split(".")[1]), { error: "Not a module key." })
      .optional(),
  })
  .superRefine((field, ctx) => {
    const flag = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (field.type === "select") {
      if (!field.options?.length) flag("options", "A select field needs at least one option.");
      else if (new Set(field.options).size !== field.options.length) flag("options", "Options must be unique.");
    } else if (field.options !== undefined) {
      flag("options", "Only select fields have options.");
    }
    if (!NUMERIC_FIELD_TYPES.has(field.type)) {
      for (const key of ["unit", "min", "max"] as const) {
        if (field[key] !== undefined) flag(key, `Only counter and number fields have a ${key}.`);
      }
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      flag("max", "max must not be below min.");
    }
  });
export type Field = z.infer<typeof FieldSchema>;

export const CUSTOM_LAYOUTS = ["fields", "table", "grid"] as const;
export type CustomLayout = (typeof CUSTOM_LAYOUTS)[number];

export const CustomGridSchema = z.strictObject({
  /** One grid per ordered size. */
  repeatPer: z.literal("size").optional(),
  /** The repeated column, e.g. 13 "Box #" columns the inspector can add to. */
  columns: z.strictObject({
    label: z.string().trim().min(1),
    default: z.number().int().min(1).max(500),
    addable: z.boolean(),
  }),
});
export type CustomGrid = z.infer<typeof CustomGridSchema>;

/**
 * One-off fields a template needs and no module captures (4.2 rule 2).
 * Layouts: `fields` is a form; `table` has one row per ordered size and a
 * column per field; `grid` has a row per field and repeated columns (boxes),
 * once per size with `grid.repeatPer`.
 */
export const CustomModuleSchema = z
  .strictObject({
    key: z
      .string()
      .regex(CUSTOM_KEY_PATTERN, { error: "Lower case letters, digits and _, starting with a letter." })
      .refine((key) => !isModuleKey(key), { error: "This is a module key; pick another key for a custom module." }),
    title: z.string().trim().min(1),
    /** The module this section follows on screen and in the export. */
    after: ModuleKeySchema,
    layout: z.enum(CUSTOM_LAYOUTS),
    fields: z.array(FieldSchema).min(1),
    grid: CustomGridSchema.optional(),
  })
  .superRefine((custom, ctx) => {
    reportDuplicates(
      ctx,
      custom.fields.map((field) => field.key),
      (index) => ["fields", index, "key"],
      "Field key",
    );
    if (custom.layout === "grid" && !custom.grid) {
      ctx.addIssue({ code: "custom", path: ["grid"], message: "A grid needs its columns: grid.columns." });
    }
    if (custom.layout !== "grid" && custom.grid) {
      ctx.addIssue({ code: "custom", path: ["grid"], message: "grid applies to the grid layout only." });
    }
    if (custom.layout !== "fields") {
      custom.fields.forEach((field, index) => {
        if (field.mapsTo !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["fields", index, "mapsTo"],
            message: "Only fields in a fields layout can map to a module: tables and grids hold many values.",
          });
        }
      });
    }
  });
export type CustomModule = z.infer<typeof CustomModuleSchema>;

export const TemplateReportSchema = z.strictObject({
  /** Title of the AI report, e.g. "Preshipment Inspection: Nitrile Disposable Examination Gloves". */
  title: z.string().trim().min(1),
  showClientLogo: z.boolean(),
});
export type TemplateReport = z.infer<typeof TemplateReportSchema>;

export const TemplateDefinitionSchema = z
  .strictObject({
    code: TemplateCodeSchema,
    name: z.string().trim().min(1),
    /** Code of the base template. This template then lists only what differs (4.2 rule 9). */
    extends: TemplateCodeSchema.optional(),
    scope: TemplateScopeSchema,
    unit: TemplateUnitSchema,
    sizes: z.array(TemplateSizeSchema).min(1),
    /** In report order. A child's list also orders: see docs/MODULES.md, "Templates". */
    modules: z.array(ModuleConfigSchema),
    customModules: z.array(CustomModuleSchema).optional(),
    report: TemplateReportSchema.optional(),
    /** Object name of the original form or report in the template-sources bucket. */
    sourceFile: z.string().trim().min(1).optional(),
  })
  .superRefine((definition, ctx) => {
    if (definition.extends === definition.code) {
      ctx.addIssue({ code: "custom", path: ["extends"], message: "A template cannot extend itself." });
    }
    reportDuplicates(
      ctx,
      definition.modules.map((module) => module.key),
      (index) => ["modules", index, "key"],
      "Module",
    );
    definition.modules.forEach((module, index) => {
      if (!module.include && isAlwaysOn(module.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["modules", index, "include"],
          message: `${module.key} is always on (BUILD_SPEC 4.1): switch its fields off in its config instead.`,
        });
      }
    });
    reportDuplicates(
      ctx,
      definition.sizes.map((size) => normaliseSize(size.value) ?? size.value),
      (index) => ["sizes", index, "value"],
      "Size",
    );
    const custom = definition.customModules ?? [];
    reportDuplicates(
      ctx,
      custom.map((module) => module.key),
      (index) => ["customModules", index, "key"],
      "Custom module",
    );
  });

export type TemplateDefinition = z.infer<typeof TemplateDefinitionSchema>;
/** Same shape before parsing: no field has a default or a transform. */
export type TemplateDefinitionInput = z.input<typeof TemplateDefinitionSchema>;

/* ------------------------------------------------------------------ *
 * Module switched off for one inspection (BUILD_SPEC 4.4)
 *
 * `inspections.module_overrides` holds `{ <module key>: ModuleOverride }`.
 * Only admins write it; the reason is logged and exported.
 * ------------------------------------------------------------------ */

export const ModuleOverrideSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  /** The admin who switched it off. */
  by: z.uuid(),
  at: IsoDateTimeSchema,
});
export type ModuleOverride = z.infer<typeof ModuleOverrideSchema>;

export const ModuleOverridesSchema = z.partialRecord(ModuleKeySchema, ModuleOverrideSchema);
export type ModuleOverrides = z.infer<typeof ModuleOverridesSchema>;

/* ------------------------------------------------------------------ *
 * Resolved template (`templates.resolved`)
 *
 * The extends chain applied: every module in final order with its
 * effective title, labels and config (module defaults, then each template
 * from the root down, validated by the module's config schema). Frozen
 * with the template version, so an inspection keeps the wording and
 * config it started with. Bump RESOLVED_TEMPLATE_FORMAT on breaking changes.
 * ------------------------------------------------------------------ */

export const RESOLVED_TEMPLATE_FORMAT = 1;

export const ResolvedModuleSchema = z.strictObject({
  key: ModuleKeySchema,
  /** False when the template switches it off, or an admin did for this inspection (`override`). */
  include: z.boolean(),
  title: z.string().min(1),
  /** The module's default labels with the template's wording on top. */
  labels: z.record(z.string(), z.string()),
  config: JsonObjectSchema,
  /** Set only on an inspection's copy: why an admin switched the module off. */
  override: ModuleOverrideSchema.optional(),
});
export type ResolvedModule = z.infer<typeof ResolvedModuleSchema>;

export const ResolvedSizeSchema = z.strictObject({
  value: CanonicalSizeSchema,
  label: z.string().min(1),
});
export type ResolvedSize = z.infer<typeof ResolvedSizeSchema>;

export const ResolvedTemplateSchema = z.strictObject({
  format: z.literal(RESOLVED_TEMPLATE_FORMAT),
  code: TemplateCodeSchema,
  name: z.string().min(1),
  /** This template's code, then each base up to the root: ["SAFEDON_EG", "STD_EG"]. */
  chain: z.array(TemplateCodeSchema).min(1),
  scope: TemplateScopeSchema,
  unit: TemplateUnitSchema,
  sizes: z.array(ResolvedSizeSchema).min(1),
  /** Every module the chain mentions, in final order; `header` first and `conclusion` last. */
  modules: z.array(ResolvedModuleSchema).min(2),
  customModules: z.array(CustomModuleSchema),
  report: TemplateReportSchema,
  sourceFile: z.string().min(1).nullable(),
});
export type ResolvedTemplate = z.infer<typeof ResolvedTemplateSchema>;

function isAlwaysOn(key: ModuleKey): boolean {
  return (ALWAYS_ON_MODULE_KEYS as readonly ModuleKey[]).includes(key);
}

function reportDuplicates(
  ctx: z.RefinementCtx,
  values: readonly string[],
  pathOf: (index: number) => PropertyKey[],
  noun: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: "custom", path: pathOf(index), message: `${noun} "${value}" appears more than once.` });
    }
    seen.add(value);
  });
}

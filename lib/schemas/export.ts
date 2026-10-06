import { z } from "zod";
import {
  EntityRefSchema,
  FieldTypeSchema,
  HttpUrlSchema,
  InspectionResultSchema,
  InspectionStatusSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  ProductTypeSchema,
  SizeSchema,
  StandardSchema,
  UnitSchema,
} from "./common";
import { ModuleKeySchema, ModuleResultSchema } from "./module-result";

/* ------------------------------------------------------------------ *
 * Inspection export (BUILD_SPEC 9.1)
 *
 * One JSON document per inspection: the input of the AI report and of
 * the AI second opinion. It holds everything needed to write the report
 * without opening the app. Bump EXPORT_SCHEMA_VERSION on breaking changes.
 * ------------------------------------------------------------------ */

export const EXPORT_SCHEMA_VERSION = "1";

/** A validation warning or error, as listed on the capture screen. */
export const ExportIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  size: SizeSchema.optional(),
});
export type ExportIssue = z.infer<typeof ExportIssueSchema>;

export const ExportTemplateSchema = z.object({
  code: z.string().min(1),
  version: z.number().int().positive(),
  standard: StandardSchema,
  productType: ProductTypeSchema,
  /** The inspection's client and manufacturer: the report header and logo come from these. */
  client: EntityRefSchema.nullable(),
  manufacturer: EntityRefSchema.nullable(),
  reportTitle: z.string().min(1),
  clientLogoUrl: HttpUrlSchema.nullable(),
  /** Signed URL of the original form or report the template was built from. */
  sourceFile: HttpUrlSchema.nullable(),
});
export type ExportTemplate = z.infer<typeof ExportTemplateSchema>;

export const ExportModuleSchema = z.object({
  key: ModuleKeySchema,
  /** Heading as on the source form. */
  title: z.string().min(1),
  /** Field labels as on the source form, keyed by canonical field key. */
  labels: z.record(z.string(), z.string()),
  /** What the inspector entered. Phase 2 narrows this per module. */
  data: z.record(z.string(), JsonValueSchema),
  /** What the app computed: totals, averages, medians, code letters, accept/reject limits. */
  computed: z.record(z.string(), JsonValueSchema),
  result: ModuleResultSchema,
  warnings: z.array(ExportIssueSchema),
  /** Validation errors. Submit is blocked while any exist, so submitted exports have none. */
  errors: z.array(ExportIssueSchema).optional(),
  comment: z.string().nullable(),
});
export type ExportModule = z.infer<typeof ExportModuleSchema>;

export const ExportExcludedModuleSchema = z.object({
  key: ModuleKeySchema,
  title: z.string().min(1),
  reason: z.string().min(1),
});
export type ExportExcludedModule = z.infer<typeof ExportExcludedModuleSchema>;

export const ExportCustomFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: FieldTypeSchema,
  unit: UnitSchema.optional(),
});
export type ExportCustomField = z.infer<typeof ExportCustomFieldSchema>;

export const ExportCustomModuleSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  /** The report module this section follows. */
  after: ModuleKeySchema.optional(),
  layout: z.enum(["fields", "table", "grid"]),
  fields: z.array(ExportCustomFieldSchema),
  /** Keyed by field key; grid layouts nest per size. */
  values: z.record(z.string(), JsonValueSchema),
});
export type ExportCustomModule = z.infer<typeof ExportCustomModuleSchema>;

/**
 * Module key or custom module key a photo or file is tagged with; null when
 * untagged (a desktop upload not yet retagged). inspection_photos.module_key
 * and inspection_files.module_key are nullable, so the export allows it.
 */
export const ExportModuleTagSchema = z.string().min(1).nullable();

export const ExportPhotoSchema = z.object({
  id: z.uuid(),
  /** Signed URL, valid for 24 hours. */
  url: HttpUrlSchema,
  moduleKey: ExportModuleTagSchema,
  /** What the photo shows, e.g. `size:M/hand:R/defect:thin_spot/box:253`. */
  target: z.string().nullable(),
  caption: z.string().nullable(),
  takenAt: IsoDateTimeSchema.nullable(),
  includeInReport: z.boolean(),
  /** The browser could not convert the file (for example some HEIC), so it is the original upload. */
  flagged: z.boolean(),
});
export type ExportPhoto = z.infer<typeof ExportPhotoSchema>;

export const ExportFileSchema = z.object({
  id: z.uuid(),
  /** Signed URL, valid for 24 hours. */
  url: HttpUrlSchema,
  moduleKey: ExportModuleTagSchema,
  kind: z.enum(["lab_report", "certificate", "other"]),
  name: z.string().min(1),
});
export type ExportFile = z.infer<typeof ExportFileSchema>;

export const ExportConclusionSchema = z.object({
  /** Computed by the app from the module results. */
  suggestedResult: InspectionResultSchema.nullable(),
  /** The inspector's decision; null until chosen. */
  finalResult: InspectionResultSchema.nullable(),
  remark: z.string().nullable(),
  inspector: EntityRefSchema.nullable(),
  date: IsoDateSchema.nullable(),
});
export type ExportConclusion = z.infer<typeof ExportConclusionSchema>;

export const ExportSchema = z
  .object({
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    refNo: z.string().min(1),
    status: InspectionStatusSchema,
    timestamps: z.object({
      createdAt: IsoDateTimeSchema,
      /** Identifies the inspection version an AI review belongs to. */
      updatedAt: IsoDateTimeSchema,
      submittedAt: IsoDateTimeSchema.nullable(),
      approvedAt: IsoDateTimeSchema.nullable(),
      exportedAt: IsoDateTimeSchema,
    }),
    inspector: z.object({
      id: z.uuid(),
      name: z.string().min(1),
      email: z.email().optional(),
    }),
    template: ExportTemplateSchema,
    /** Included modules in template order. */
    modules: z.array(ExportModuleSchema),
    excludedModules: z.array(ExportExcludedModuleSchema),
    custom: z.array(ExportCustomModuleSchema),
    photos: z.array(ExportPhotoSchema),
    files: z.array(ExportFileSchema),
    conclusion: ExportConclusionSchema,
  })
  .superRefine((doc, ctx) => {
    const moduleKeys = [...doc.modules, ...doc.excludedModules].map((module) => module.key);
    reportDuplicates(ctx, moduleKeys, ["modules"], "Module");
    reportDuplicates(
      ctx,
      doc.custom.map((module) => module.key),
      ["custom"],
      "Custom module",
    );
    reportDuplicates(
      ctx,
      doc.photos.map((photo) => photo.id),
      ["photos"],
      "Photo",
    );
    reportDuplicates(
      ctx,
      doc.files.map((file) => file.id),
      ["files"],
      "File",
    );
  });

export type InspectionExport = z.infer<typeof ExportSchema>;

function reportDuplicates(
  ctx: z.RefinementCtx,
  values: readonly string[],
  path: PropertyKey[],
  noun: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      ctx.addIssue({ code: "custom", path, message: `${noun} "${value}" appears more than once.` });
    }
    seen.add(value);
  }
}

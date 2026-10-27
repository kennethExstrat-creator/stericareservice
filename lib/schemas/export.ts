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
import { isModuleKey, ModuleKeySchema, ModuleResultSchema } from "./module-result";
import {
  DEFAULT_REPORT_OPTIONS,
  DEFAULT_REPORT_TITLE,
  ReportPageSizeSchema,
  ReportPhotoOptionsSchema,
  ReportSectionsOptionsSchema,
  ReportSummaryOptionsSchema,
  ReportTemplateSchema,
} from "./report-options";
import { TemplateUnitSchema } from "./template";

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
  /**
   * Every size the template lists, in its order, whatever was ordered: the
   * report's fixed size rows. `label` is the size's "Shown As", else the size.
   * This and the two below are optional, so documents written before they
   * existed still validate.
   */
  sizes: z.array(z.object({ value: SizeSchema, label: z.string().min(1) })).optional(),
  /** Gloves counted in pieces or in pairs. */
  unit: TemplateUnitSchema.optional(),
  /** The header on the report's pages after the first; null when the template sets none. */
  pageHeader: z.string().min(1).nullable().optional(),
});
export type ExportTemplate = z.infer<typeof ExportTemplateSchema>;

export const ExportModuleSchema = z.object({
  key: ModuleKeySchema,
  /** Heading as on the source form, as this inspection words it (shownTitle: weight's names no count of gloves). */
  title: z.string().min(1),
  /** Field labels as on the source form, keyed by canonical field key. */
  labels: z.record(z.string(), z.string()),
  /**
   * The module's settings for this inspection: the template version's config
   * over the module's defaults, as the module worked with it. Specs and
   * limits, decimals, AQLs, the inner unit, date precision, columns and
   * fields switched on or off. Optional, so documents written before it
   * existed still validate.
   */
  config: z.record(z.string(), JsonValueSchema).optional(),
  /** What the inspector entered, in the module's own data shape (modules/<key>/schema.ts). */
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
  /**
   * Never a library module key, even one this template leaves out: findings,
   * questions and photo tags name a module or a custom module by key alone.
   */
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
 * and inspection_files.module_key are nullable text with no non-empty check,
 * so an empty or blank tag is read as untagged instead of failing the export.
 */
export const ExportModuleTagSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().min(1).nullable(),
);

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

/**
 * Formatted text written in the app (the conclusion's inspection summary),
 * as the report prints it and as plain text. The document itself, lossless,
 * stays in the module's data (`modules[].data`).
 */
export const ExportRichTextSchema = z.object({
  /**
   * An HTML fragment with only p, br, ul, ol, li, span, mark, strong, em, u
   * and s; its only attributes are `style` (font-size, color,
   * background-color and text-align, from the app's fixed palette) and
   * `start` on a numbered list. Text is escaped.
   */
  html: z.string().min(1),
  /** Paragraphs split by a blank line, list items as "• text" or "1. text", no formatting. */
  text: z.string(),
});
export type ExportRichText = z.infer<typeof ExportRichTextSchema>;

export const ExportConclusionSchema = z.object({
  /** Computed by the app from the module results. */
  suggestedResult: InspectionResultSchema.nullable(),
  /** The inspector's decision; null until chosen. */
  finalResult: InspectionResultSchema.nullable(),
  remark: z.string().nullable(),
  inspector: EntityRefSchema.nullable(),
  date: IsoDateSchema.nullable(),
  /**
   * The inspector's summary with formatting; null when none is written.
   * Optional, so documents written before it existed still validate.
   */
  inspectionSummary: ExportRichTextSchema.nullable().optional(),
  /**
   * To Sign After Exported (Kenneth, 13 October 2026): true when the report
   * is to be signed by hand once printed. The conclusion module's `data`
   * then carries `signature: null`, so the report leaves the signature line
   * blank for the pen. Optional, so documents written before it existed
   * still validate.
   */
  signAfterExport: z.boolean().optional(),
});
export type ExportConclusion = z.infer<typeof ExportConclusionSchema>;

/**
 * How the report is to be made: the capture screen's Report page options
 * (Kenneth, 27 October 2026; lib/schemas/report-options.ts), as saved with
 * the inspection, each with its default where none is saved, in the
 * report's own structure: the Summary's blocks, each section's switch and
 * its blocks', the photo records. A section's `include` is false when it is
 * switched off or when the inspection includes none of its modules, so it
 * says what the report shows. Every option has its default, and so does the
 * block, so documents written before it existed read as the defaults: the
 * standard template on A4, everything shown.
 */
export const ExportReportSchema = z.object({
  template: ReportTemplateSchema.default(DEFAULT_REPORT_OPTIONS.template),
  pageSize: ReportPageSizeSchema.default(DEFAULT_REPORT_OPTIONS.pageSize),
  /** The report's title, trimmed: the default title when none was typed. */
  title: z.string().min(1).default(DEFAULT_REPORT_TITLE),
  /** Show the client's name in the Summary's details and the footer (`template.client`). */
  showClient: z.boolean().default(DEFAULT_REPORT_OPTIONS.showClient),
  /** On every page's footer, trimmed; null for none. */
  footerNote: z.string().min(1).nullable().default(null),
  /** Page 1's blocks: Order Mix by Size, Inspection Summary (`conclusion.inspectionSummary`), Results by Check. */
  summary: ReportSummaryOptionsSchema,
  /** Sections 02 to 08 by key (REPORT_SECTIONS): `include`, and a switch per block. */
  sections: ReportSectionsOptionsSchema,
  /** The photo records by key (REPORT_PHOTO_GROUPS) and the photos each prints at most (`perGroup`). */
  photos: ReportPhotoOptionsSchema,
});
export type ExportReport = z.infer<typeof ExportReportSchema>;

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
    /** The Report page's options; a document written before they existed reads with their defaults. */
    report: ExportReportSchema.prefault({}),
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
    // Library keys are reserved, so a key in a finding, a question or a photo tag names one section.
    doc.custom.forEach((module, index) => {
      if (isModuleKey(module.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["custom", index, "key"],
          message: `Custom module key "${module.key}" is a library module key; give the custom module its own key.`,
        });
      }
    });
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

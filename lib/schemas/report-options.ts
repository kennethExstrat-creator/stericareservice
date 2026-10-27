// The capture screen's Report page (Kenneth, 27 October 2026: "After
// conclusion page, give another page "Report", thats the page where report
// generation is done, inclusing customizing report"): the options a report
// is made with. Saved per inspection with its data (`data.report`, autosaved
// like any field), sent with the export for the report service to apply
// (`report`, lib/schemas/export.ts). The report's design comes later
// (Kenneth: "for the report template design, i will give u later, build the
// visual framework first"), so there is one template for now and the page
// shows a layout preview, never the report itself.
//
// Client-safe leaf: zod only, so the Report page, the save action and the
// export share one source. Imported by its path, not through the lib/schemas
// index.
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * The choices: what is stored and its name on screen (Title Case,
 * docs/DESIGN.md)
 * ------------------------------------------------------------------ */

function valuesOf<T extends readonly { readonly value: string }[]>(choices: T) {
  return choices.map((choice) => choice.value) as unknown as [T[number]["value"], ...T[number]["value"][]];
}

/** One template until Kenneth's design arrives. */
export const REPORT_TEMPLATES = [{ value: "standard_preshipment", label: "Standard Preshipment Report" }] as const;

/** The paper, in millimetres: what the preview's pages are drawn at. */
export const REPORT_PAGE_SIZES = [
  { value: "a4", label: "A4", width: 210, height: 297 },
  { value: "letter", label: "Letter", width: 215.9, height: 279.4 },
] as const;

export const REPORT_PHOTOS_PER_STEP = [2, 4, 6] as const;

export const REPORT_PHOTO_SIZES = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
] as const;

/** The longest texts: the title and the footer note. */
export const REPORT_LIMITS = { title: 120, footerNote: 300 } as const;

/** The title a report gets while none is typed. */
export const DEFAULT_REPORT_TITLE = "Pre-Shipment Inspection Report";

/** The Report page's labels and lines, by option. */
export const REPORT_FIELDS = {
  template: { label: "Report Template", hint: "Template design coming soon." },
  pageSize: { label: "Page Size" },
  sections: { label: "Sections" },
  photos: { label: "Photos" },
  includePhotos: { label: "Include Photos" },
  photosPerStep: { label: "Photos per Step" },
  photoSize: { label: "Photo Size" },
  cover: { label: "Cover and Header" },
  title: { label: "Report Title" },
  showClientName: { label: "Show Client Name" },
  content: { label: "Content" },
  includeSummary: { label: "Include Inspection Summary" },
  includeSignature: { label: "Include Inspector Signature" },
  footerNote: { label: "Footer Note (Optional)" },
} as const;

/* ------------------------------------------------------------------ *
 * Field schemas
 * ------------------------------------------------------------------ */

export const ReportTemplateSchema = z.enum(valuesOf(REPORT_TEMPLATES), { error: "Choose a report template." });
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

export const ReportPageSizeSchema = z.enum(valuesOf(REPORT_PAGE_SIZES), { error: "Choose A4 or Letter." });
export type ReportPageSize = z.infer<typeof ReportPageSizeSchema>;

export const ReportPhotosPerStepSchema = z.literal(REPORT_PHOTOS_PER_STEP, { error: "Choose 2, 4 or 6 photos per step." });
export type ReportPhotosPerStep = z.infer<typeof ReportPhotosPerStepSchema>;

export const ReportPhotoSizeSchema = z.enum(valuesOf(REPORT_PHOTO_SIZES), { error: "Choose Small, Medium or Large." });
export type ReportPhotoSize = z.infer<typeof ReportPhotoSizeSchema>;

/** A step's key: a module's or a custom module's, or Source Documents' (lib/inspections/capture/sections.ts). */
const StepKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, { error: "Not a step of an inspection." });

/**
 * No NUL and no lone surrogate (half an emoji): Postgres refuses both in
 * jsonb. Kept as typed, untrimmed, so a space typed between two words
 * stays while the field is saved on every change; what reads the text
 * trims it (lib/inspections/capture/report.ts).
 */
function textSchema(max: number, error: string) {
  return z
    .string({ error: "Enter text." })
    .max(max, { error })
    .refine((text) => !/\u0000|[\ud800-\udfff]/u.test(text), { error: "This text holds a character that cannot be saved." });
}

/* ------------------------------------------------------------------ *
 * The options
 * ------------------------------------------------------------------ */

/**
 * The report options as saved in `data.report`. Every option has its
 * default, so data from before the Report page, or saved before an option
 * existed, reads as the page shows it; a plain object, so options a newer
 * build added are dropped rather than refused.
 */
export const ReportOptionsSchema = z.object({
  template: ReportTemplateSchema.default("standard_preshipment"),
  pageSize: ReportPageSizeSchema.default("a4"),
  /**
   * The steps switched off on the Report page, by step key. Every other step
   * the inspection includes goes in, so a step switched back on for the
   * inspection, or added later, is in the report unless it is switched off
   * here too.
   */
  omittedSteps: z.array(StepKeySchema).max(64, { error: "Too many steps." }).default(() => []),
  includePhotos: z.boolean().default(true),
  photosPerStep: ReportPhotosPerStepSchema.default(4),
  photoSize: ReportPhotoSizeSchema.default("medium"),
  /** Blank: DEFAULT_REPORT_TITLE. */
  title: textSchema(REPORT_LIMITS.title, `Keep the title to ${REPORT_LIMITS.title} characters.`).default(DEFAULT_REPORT_TITLE),
  showClientName: z.boolean().default(true),
  includeSummary: z.boolean().default(true),
  includeSignature: z.boolean().default(true),
  /** Blank: none. */
  footerNote: textSchema(REPORT_LIMITS.footerNote, `Keep the footer note to ${REPORT_LIMITS.footerNote} characters.`).default(""),
});
export type ReportOptions = z.output<typeof ReportOptionsSchema>;

export const DEFAULT_REPORT_OPTIONS: ReportOptions = ReportOptionsSchema.parse({});

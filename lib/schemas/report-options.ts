// The capture screen's Report page (Kenneth, 27 October 2026: "After
// conclusion page, give another page "Report", thats the page where report
// generation is done, inclusing customizing report"): the options a report
// is made with. Saved per inspection with its data (`data.report`, autosaved
// like any field), carried by the export (`report`, lib/schemas/export.ts)
// and applied by the app's own report (lib/report, docs/REPORT.md).
//
// They follow the report's design, not the capture steps (Kenneth: "also
// adjust the setting for report generation to make the setting of report
// match the the report design"): the general options, the Summary's blocks
// (page 1, always in), one switch per section with a switch per block of
// it, and the three photo records with the photos per group. Every switch
// is on by default. A section none of whose modules the inspection includes
// is left out whatever its switch says (lib/inspections/capture/report.ts).
//
// Client-safe leaf: zod only, so the Report page, the save action, the
// export and the report share one source. Imported by its path, not through
// the lib/schemas index.
import { z } from "zod";
import type { ModuleKey } from "./module-result";

/* ------------------------------------------------------------------ *
 * The choices: what is stored and its name on screen (Title Case,
 * docs/DESIGN.md)
 * ------------------------------------------------------------------ */

function valuesOf<T extends readonly { readonly value: string }[]>(choices: T) {
  return choices.map((choice) => choice.value) as unknown as [T[number]["value"], ...T[number]["value"][]];
}

/** The SteriCare pre-shipment design (Kenneth, 27 October 2026). */
export const REPORT_TEMPLATES = [{ value: "standard_preshipment", label: "Standard Preshipment Report" }] as const;

/** The paper, in millimetres: what the report's pages are drawn at. */
export const REPORT_PAGE_SIZES = [
  { value: "a4", label: "A4", width: 210, height: 297 },
  { value: "letter", label: "Letter", width: 215.9, height: 279.4 },
] as const;

/** Photos printed in each photo record, at most. */
export const REPORT_PHOTOS_PER_GROUP = [4, 8, 12] as const;

/** The longest texts: the title and the footer note. */
export const REPORT_LIMITS = { title: 120, footerNote: 300 } as const;

/** The title a report gets while none is typed. */
export const DEFAULT_REPORT_TITLE = "Pre-Shipment Inspection Report";

/** The Report page's labels for the general options and the groups. */
export const REPORT_FIELDS = {
  general: { label: "General" },
  template: { label: "Report Template" },
  pageSize: { label: "Page Size" },
  title: { label: "Report Title" },
  showClient: { label: "Show Client" },
  footerNote: { label: "Footer Note (Optional)" },
  content: { label: "Report Content" },
  photos: { label: "Photo Records" },
  perGroup: { label: "Photos per Group" },
} as const;

/* ------------------------------------------------------------------ *
 * The report's parts, in print order
 * ------------------------------------------------------------------ */

/** A part of a page that can be left out, by its key and its name on the Report page. */
export type ReportBlockDefinition = { readonly key: string; readonly label: string };

/** Page 1: always in the report; its blocks can be left out. */
export const REPORT_SUMMARY = {
  title: "Summary",
  blocks: [
    { key: "orderMix", label: "Order Mix by Size" },
    { key: "inspectionSummary", label: "Inspection Summary" },
    { key: "resultsByCheck", label: "Results by Check" },
  ],
} as const satisfies { title: string; blocks: readonly ReportBlockDefinition[] };

export type ReportSectionDefinition = {
  readonly key: string;
  /** As the report heads it, and the Report page names it. */
  readonly title: string;
  /**
   * The modules it shows, in report order. The section is in the report only
   * when the inspection includes one of them (a step switched off for the
   * inspection is no module of it).
   */
  readonly modules: readonly ModuleKey[];
  readonly blocks: readonly ReportBlockDefinition[];
};

/** Sections 02 to 08 of the design, after the Summary, each with the blocks it is made of. */
export const REPORT_SECTIONS = [
  {
    key: "orderSampling",
    title: "Order, Product & Sampling",
    modules: ["order_lots", "glove_info", "packing_config", "sampling_plan", "carton_sampling"],
    blocks: [
      { key: "gloveInformation", label: "Glove Information" },
      { key: "packingConfiguration", label: "Packing Configuration" },
      { key: "orderLotsSampling", label: "Order Lots & Sampling Plan" },
      { key: "finishedGoodsSampling", label: "Finished Goods Sampling (Box/Carton #)" },
    ],
  },
  {
    key: "dimensions",
    title: "Dimensions & Weight",
    modules: ["dimensions", "weight"],
    blocks: [
      { key: "gloveLength", label: "Glove Length Chart" },
      { key: "palmWidth", label: "Palm Width Chart" },
      { key: "medianResults", label: "Median Results by Size" },
      { key: "weightPerGlove", label: "Weight per Glove" },
    ],
  },
  { key: "measurements", title: "Measurements by Glove", modules: ["dimensions"], blocks: [] },
  {
    key: "forceAtBreak",
    title: "Force at Break",
    modules: ["force_at_break", "tensile"],
    blocks: [
      { key: "laboratoryDetails", label: "Laboratory Details" },
      { key: "maximumLoad", label: "Maximum Load Chart" },
      { key: "specimenReadings", label: "Specimen Readings" },
      { key: "laboratorySummary", label: "Laboratory Summary" },
    ],
  },
  {
    key: "holesVisual",
    title: "Freedom from Holes & Visual Inspection",
    modules: ["watertight", "visual"],
    blocks: [
      { key: "defectsAgainstLimit", label: "Defects Against Acceptance Limit" },
      { key: "pinholesByLocation", label: "Pinholes by Location" },
      { key: "visualCritical", label: "Visual Critical Defects" },
      { key: "defectPhotos", label: "Defect Photos" },
      { key: "visualMajorMinor", label: "Visual Major & Minor Defects" },
    ],
  },
  {
    key: "packing",
    title: "Glove Packing & Dispensing",
    modules: ["dispensing_packing", "dispensing_safedon"],
    blocks: [
      { key: "averageLayeringDispensing", label: "Average Layering & Dispensing Chart" },
      { key: "perBoxResults", label: "Per-Box Results" },
      { key: "agedGloves", label: "Aged Gloves" },
      { key: "stickinessGrades", label: "Stickiness Grades" },
    ],
  },
  {
    key: "labellingConclusion",
    title: "Packaging Labelling & Conclusion",
    // The conclusion is in every inspection, and its card in every report that shows the section.
    modules: ["labeling", "conclusion"],
    blocks: [
      { key: "dispenserCartonBox", label: "Dispenser and Carton Box" },
      { key: "resultsMatrix", label: "Results Matrix" },
      { key: "inspectorSignature", label: "Inspector Signature" },
      { key: "remark", label: "Remark" },
    ],
  },
] as const satisfies readonly ReportSectionDefinition[];

export type ReportSection = (typeof REPORT_SECTIONS)[number];
export type ReportSectionKey = ReportSection["key"];
export type ReportSummaryBlockKey = (typeof REPORT_SUMMARY.blocks)[number]["key"];
/** The block keys of one section: `ReportBlockKey<"dimensions">` is "gloveLength" | "palmWidth" | … */
export type ReportBlockKey<K extends ReportSectionKey> = Extract<ReportSection, { key: K }>["blocks"][number]["key"];

export const REPORT_SECTION_KEYS = REPORT_SECTIONS.map((section) => section.key) as ReportSectionKey[];

export function reportSection<K extends ReportSectionKey>(key: K): Extract<ReportSection, { key: K }> {
  return REPORT_SECTIONS.find((section) => section.key === key) as Extract<ReportSection, { key: K }>;
}

/**
 * The photo records after the sections, each a page of the photos its
 * modules are tagged with (lib/report/model.ts chooses them). A custom
 * module's photos go with the module it follows.
 */
export const REPORT_PHOTO_GROUPS = [
  {
    key: "samplingPackaging",
    title: "Sampling & Packaging",
    modules: ["header", "order_lots", "glove_info", "packing_config", "sampling_plan", "carton_sampling", "labeling", "documents", "loading"],
  },
  {
    key: "packingVisualAgeing",
    title: "Packing, Visual & Ageing",
    modules: ["dispensing_packing", "dispensing_safedon", "visual", "weight"],
  },
  {
    key: "watertightLaboratory",
    title: "Watertight & Laboratory Testing",
    modules: ["watertight", "force_at_break", "tensile", "dimensions", "dye_leak"],
  },
] as const satisfies readonly { key: string; title: string; modules: readonly ModuleKey[] }[];

export type ReportPhotoGroup = (typeof REPORT_PHOTO_GROUPS)[number];
export type ReportPhotoGroupKey = ReportPhotoGroup["key"];

/* ------------------------------------------------------------------ *
 * Field schemas
 * ------------------------------------------------------------------ */

export const ReportTemplateSchema = z.enum(valuesOf(REPORT_TEMPLATES), { error: "Choose a report template." });
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

export const ReportPageSizeSchema = z.enum(valuesOf(REPORT_PAGE_SIZES), { error: "Choose A4 or Letter." });
export type ReportPageSize = z.infer<typeof ReportPageSizeSchema>;

export const ReportPhotosPerGroupSchema = z.literal(REPORT_PHOTOS_PER_GROUP, { error: "Choose 4, 8 or 12 photos per group." });
export type ReportPhotosPerGroup = z.infer<typeof ReportPhotosPerGroupSchema>;

/** A switch, on until it is switched off. */
const on = () => z.boolean({ error: "Switch it on or off." }).default(true);

/** Switches by key, each on by default; a whole group saved before it existed reads as all on. */
function switches<const K extends string>(keys: readonly K[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, on()])) as { [P in K]: ReturnType<typeof on> };
  // Every switch has its default, so an empty object reads as all on (TypeScript cannot see that through K).
  return z.object(shape).prefault({} as never);
}

function sectionSchema<const S extends ReportSection>(section: S) {
  return z
    .object({
      /** The section's own switch: off leaves the whole section out. */
      include: on(),
      blocks: switches(section.blocks.map((block) => block.key) as S["blocks"][number]["key"][]),
    })
    .prefault({});
}

type SectionSchemas = { [S in ReportSection as S["key"]]: ReturnType<typeof sectionSchema<S>> };

const sectionSchemas = Object.fromEntries(REPORT_SECTIONS.map((section) => [section.key, sectionSchema(section)])) as unknown as SectionSchemas;

/** The Summary's blocks. Page 1 itself is always in. */
export const ReportSummaryOptionsSchema = switches(REPORT_SUMMARY.blocks.map((block) => block.key));

/** Each section's switch and its blocks'. */
export const ReportSectionsOptionsSchema = z.object(sectionSchemas).prefault({});

export const ReportPhotoOptionsSchema = z
  .object({
    groups: switches(REPORT_PHOTO_GROUPS.map((group) => group.key)),
    perGroup: ReportPhotosPerGroupSchema.default(8),
  })
  .prefault({});

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
 * existed, reads as the page shows it; plain objects, so options a newer
 * build added are dropped rather than refused. Options saved in the first
 * shape (27 October 2026 morning: a switch per capture step) are read into
 * this one by readReportOptions (lib/inspections/capture/report.ts).
 */
export const ReportOptionsSchema = z.object({
  template: ReportTemplateSchema.default("standard_preshipment"),
  pageSize: ReportPageSizeSchema.default("a4"),
  /** Blank: DEFAULT_REPORT_TITLE. */
  title: textSchema(REPORT_LIMITS.title, `Keep the title to ${REPORT_LIMITS.title} characters.`).default(DEFAULT_REPORT_TITLE),
  /** The client's name in the Summary's details and the footer. */
  showClient: z.boolean({ error: "Switch it on or off." }).default(true),
  /** Blank: none. */
  footerNote: textSchema(REPORT_LIMITS.footerNote, `Keep the footer note to ${REPORT_LIMITS.footerNote} characters.`).default(""),
  summary: ReportSummaryOptionsSchema,
  sections: ReportSectionsOptionsSchema,
  photos: ReportPhotoOptionsSchema,
});
export type ReportOptions = z.output<typeof ReportOptionsSchema>;
export type ReportSectionOptions<K extends ReportSectionKey> = ReportOptions["sections"][K];

export const DEFAULT_REPORT_OPTIONS: ReportOptions = ReportOptionsSchema.parse({});

/** Whether a section's block is switched on, by keys the type system checks. */
export function blockOn<K extends ReportSectionKey>(options: Pick<ReportOptions, "sections">, section: K, block: ReportBlockKey<K>): boolean {
  const blocks = options.sections[section].blocks as Record<string, boolean>;
  return blocks[block] ?? true;
}

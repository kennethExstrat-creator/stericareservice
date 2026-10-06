// Defaults a template can override: the heading, the labels (STD_EG's
// wording; SAFEDON_EG renames the levels and the limit caption) and the
// config (BUILD_SPEC 6.1: levels on/off, checks on/off, n per level). The
// checks carry their own wording, per level, as the dictionary keeps them.
import { z } from "zod";

export const LABELING_TITLE = "Packaging Labeling Inspection";

/** The inner unit (dispenser box, plastic pack) and the carton. */
export const LABELING_LEVELS = ["inner", "carton"] as const;
export const LabelingLevelSchema = z.enum(LABELING_LEVELS);
export type LabelingLevel = z.infer<typeof LabelingLevelSchema>;

/** Labelling checks (BUILD_SPEC 11): codes, like defect codes. */
export const LABELING_CHECKS = ["lot_no", "mfg_date", "expiry_date", "artwork", "carton_no"] as const;
export const LabelingCheckSchema = z.enum(LABELING_CHECKS);
export type LabelingCheck = z.infer<typeof LabelingCheckSchema>;

/** Most boxes a template may plan per level and size. */
export const MAX_PLANNED_BOXES = 50;

/**
 * STD_EG's wording (docs/DATA_DICTIONARY.md, labeling): data field keys,
 * the per-level result keys (`innerResult`, `cartonResult`) and captions.
 */
export const LABELING_LABELS = {
  inspected: "No. of sampled boxes inspected",
  boxNos: "Box #",
  defects: "Defects",
  accept: "Accept",
  reject: "Reject",
  total: "Total number of defects found",
  result: "Disposition (Passed / Failed)",
  // STD_EG prints the carton line as "Inner Box" [sic]; fixed here.
  innerResult: "Disposition - Inner Box (Passed / Failed)",
  cartonResult: "Disposition - Carton Box (Passed / Failed)",
  innerLevel: "Dispenser Box",
  cartonLevel: "Carton Box",
  defectLimit: "Defect Limit",
} as const satisfies Readonly<Record<string, string>>;

const CheckSchema = z.strictObject({
  code: LabelingCheckSchema.describe("Check code: lot_no, mfg_date, expiry_date, artwork or carton_no."),
  label: z.string().trim().min(1).max(200).describe("The check in the template's wording, e.g. Wrong / No lot number."),
});
export type LabelingCheckItem = z.infer<typeof CheckSchema>;

const LevelSchema = z
  .strictObject({
    include: z.boolean().describe("Inspect the labels at this level."),
    n: z
      .number()
      .int()
      .min(1)
      .max(MAX_PLANNED_BOXES)
      .describe("Boxes to inspect per size at this level (planned); the inspector records how many were."),
    checks: z
      .array(CheckSchema)
      .max(LABELING_CHECKS.length)
      .refine((checks) => new Set(checks.map((check) => check.code)).size === checks.length, {
        message: "List each check once per level.",
      })
      .describe("The checks at this level, in the template's order and wording."),
  })
  .refine((level) => !level.include || level.checks.length > 0, {
    message: "A level that is inspected needs at least one check.",
    path: ["checks"],
  });
export type LabelingLevelConfig = z.infer<typeof LevelSchema>;

export const LabelingConfigSchema = z.strictObject({
  levels: z
    .strictObject({
      inner: LevelSchema.describe("Inner unit: dispenser box, inner box or plastic pack."),
      carton: LevelSchema.describe("Carton (case)."),
    })
    .describe("Levels on or off, boxes planned per level and each level's checks."),
});
export type LabelingConfig = z.infer<typeof LabelingConfigSchema>;

const check = (code: LabelingCheck, label: string): LabelingCheckItem => ({ code, label });

/** STD_EG: 3 dispenser boxes (lot, mfg, artwork) and 1 carton (plus the carton number). */
export const LABELING_DEFAULT_CONFIG: LabelingConfig = {
  levels: {
    inner: {
      include: true,
      n: 3,
      checks: [
        check("lot_no", "Wrong / No lot number"),
        check("mfg_date", "Wrong / No mfg. date"),
        check("artwork", "Wrong artwork print"),
      ],
    },
    carton: {
      include: true,
      n: 1,
      checks: [
        check("lot_no", "Wrong / No lot number"),
        check("mfg_date", "Wrong / No mfg. date"),
        check("artwork", "Wrong artwork print"),
        check("carton_no", "No carton number printed"),
      ],
    },
  },
};

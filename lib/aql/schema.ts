import { z } from "zod";
import { CODE_LETTERS, INSPECTION_LEVELS, SAMPLE_SIZES, TABLE_2A_AQLS } from "./tables";

/* ------------------------------------------------------------------ *
 * AQL engine schemas (BUILD_SPEC 7)
 *
 * A template sets the inspection level and the AQLs; modules keep the
 * engine's plans in their computed values, which go into the export.
 * ------------------------------------------------------------------ */

export const CodeLetterSchema = z.enum(CODE_LETTERS);
export const InspectionLevelSchema = z.enum(INSPECTION_LEVELS);

/** An AQL a template can set: 0 for critical defects (Accept 0 / Reject 1 whatever n), or a Table 2-A column. */
export const AqlSchema = z.literal([0, ...TABLE_2A_AQLS]);
export type Aql = z.infer<typeof AqlSchema>;

/** A Table 2-A sample size, 2 to 2000. */
export const StandardSampleSizeSchema = z.literal(CODE_LETTERS.map((letter) => SAMPLE_SIZES[letter]));

export const AQL_WARNING_CODES = [
  // The sample size is not in Table 2-A: the largest standard size below it set the code letter.
  "nonstandard_sample",
  // The cell held an arrow down: this AQL needs a larger sample than was inspected.
  "sample_too_small",
  // From a lot size: the sample taken is smaller than the inspection level's plan.
  "sample_below_plan",
  // The plan's sample is not smaller than the lot: every item is inspected.
  "sample_exceeds_lot",
] as const;
export const AqlWarningCodeSchema = z.enum(AQL_WARNING_CODES);
export type AqlWarningCode = z.infer<typeof AqlWarningCodeSchema>;

/** Same code and message fields as an export issue (ExportIssueSchema), so modules can pass it on. */
export const AqlWarningSchema = z.object({
  code: AqlWarningCodeSchema,
  message: z.string().min(1),
});
export type AqlWarning = z.infer<typeof AqlWarningSchema>;

export const AQL_ERROR_CODES = ["invalid_sample_size", "invalid_lot_size", "invalid_level", "invalid_aql"] as const;
export type AqlErrorCode = (typeof AQL_ERROR_CODES)[number];

/** Input the engine cannot use, e.g. a sample size of 1. */
export interface AqlError {
  code: AqlErrorCode;
  message: string;
}

const singleSampling = (limits: { ac: number; re: number }) => limits.re === limits.ac + 1;
const RE_IS_AC_PLUS_ONE = { message: "Re must be Ac + 1 in a single sampling plan.", path: ["re"] };

/** Accept with at most Ac defects; reject at Re = Ac + 1 or more. */
export const AcceptanceLimitsSchema = z
  .object({ ac: z.int().min(0), re: z.int().min(1) })
  .refine(singleSampling, RE_IS_AC_PLUS_ONE);
export type AcceptanceLimits = z.infer<typeof AcceptanceLimitsSchema>;

const planFields = {
  /** The code letter the table was entered at: from the sample size, or from the lot size (Table 1). */
  codeLetter: CodeLetterSchema,
  /** The code letter whose plan applies: codeLetter, or where its cell's arrow led. */
  usedLetter: CodeLetterSchema,
  /** Sample size of usedLetter: the sample this plan needs. */
  n: StandardSampleSizeSchema,
  aql: AqlSchema,
  ac: z.int().min(0),
  re: z.int().min(1),
  /** The arrow in codeLetter's cell; null when it holds a plan. */
  arrow: z.enum(["up", "down"]).nullable(),
};

/** The plan for a sample already inspected (watertight, visual). */
export const SampleSizePlanSchema = z
  .object({
    ...planFields,
    /** Items inspected, as entered. */
    sampleSize: z.int().min(2),
    warnings: z.array(AqlWarningSchema),
  })
  .refine(singleSampling, RE_IS_AC_PLUS_ONE);
export type SampleSizePlan = z.infer<typeof SampleSizePlanSchema>;

const lotFields = {
  /** Items in the lot, e.g. cases x gloves per case. */
  lotSize: z.int().min(2),
  level: InspectionLevelSchema,
  /** Items sampled, when known; compared with n. */
  sampleSize: z.int().min(0).nullable(),
};

/** The plan for a lot at an inspection level and AQL: Table 1, then Table 2-A. */
export const LotSizePlanSchema = z
  .object({ ...planFields, ...lotFields, warnings: z.array(AqlWarningSchema) })
  .refine(singleSampling, RE_IS_AC_PLUS_ONE);
export type LotSizePlan = z.infer<typeof LotSizePlanSchema>;

/** Table 1 alone: the code letter and sample size an inspection level asks for. */
export const LotSampleSchema = z.object({
  codeLetter: CodeLetterSchema,
  n: StandardSampleSizeSchema,
  ...lotFields,
  warnings: z.array(AqlWarningSchema),
});
export type LotSample = z.infer<typeof LotSampleSchema>;

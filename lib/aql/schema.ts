import { z } from "zod";
import {
  CODE_LETTERS,
  GENERAL_INSPECTION_LEVELS,
  INSPECTION_LEVELS,
  SAMPLE_SIZES,
  SPECIAL_INSPECTION_LEVELS,
  TABLE_2A_AQLS,
} from "./tables";

/* ------------------------------------------------------------------ *
 * AQL engine schemas (BUILD_SPEC 7)
 *
 * A template sets the inspection level and the AQLs; modules keep the
 * engine's plans in their computed values, which go into the export.
 * ------------------------------------------------------------------ */

export const CodeLetterSchema = z.enum(CODE_LETTERS);
export const InspectionLevelSchema = z.enum(INSPECTION_LEVELS);
export const GeneralInspectionLevelSchema = z.enum(GENERAL_INSPECTION_LEVELS);
export const SpecialInspectionLevelSchema = z.enum(SPECIAL_INSPECTION_LEVELS);

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

/**
 * Re = Ac + 1, the single sampling rule. zod 4 refuses .pick() and .omit() on
 * a schema that has it, so a module composes from a plan shape and adds this
 * check back: `z.object({ ...SampleSizePlanShape, holes }).check(singleSamplingCheck)`.
 */
export const singleSamplingCheck = z.refine<{ ac: number; re: number }>((limits) => limits.re === limits.ac + 1, {
  message: "Re must be Ac + 1 in a single sampling plan.",
  path: ["re"],
});

/** Accept with at most Ac defects; reject at Re = Ac + 1 or more. */
export const AcceptanceLimitsSchema = z.object({ ac: z.int().min(0), re: z.int().min(1) }).check(singleSamplingCheck);
export type AcceptanceLimits = z.infer<typeof AcceptanceLimitsSchema>;

/** What decide returns for the defects found against a plan. */
export const DecisionSchema = z.enum([
  "accept",
  "reject",
  // Fewer items inspected than the plan's n and fewer than Re defects found: never a pass.
  "incomplete",
]);
export type Decision = z.infer<typeof DecisionSchema>;

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

/** SampleSizePlanSchema's fields without the Re = Ac + 1 check, for modules to compose from. */
export const SampleSizePlanShape = {
  ...planFields,
  /** Items inspected, as entered. */
  sampleSize: z.int().min(2),
  warnings: z.array(AqlWarningSchema),
};

/**
 * The plan for a sample already inspected (watertight, visual). It checks the
 * shape and Re = Ac + 1; planMatchesSample checks the plan against the tables.
 */
export const SampleSizePlanSchema = z.object(SampleSizePlanShape).check(singleSamplingCheck);
export type SampleSizePlan = z.infer<typeof SampleSizePlanSchema>;

const lotFields = {
  /** Items in the lot, e.g. cases x gloves per case. */
  lotSize: z.int().min(2),
  level: InspectionLevelSchema,
  /** Items sampled, when known; compared with n. */
  sampleSize: z.int().min(0).nullable(),
};

/** LotSizePlanSchema's fields without the Re = Ac + 1 check, for modules to compose from. */
export const LotSizePlanShape = { ...planFields, ...lotFields, warnings: z.array(AqlWarningSchema) };

/**
 * The plan for a lot at an inspection level and AQL: Table 1, then Table 2-A.
 * It checks the shape and Re = Ac + 1; planMatchesLot checks it against the tables.
 */
export const LotSizePlanSchema = z.object(LotSizePlanShape).check(singleSamplingCheck);
export type LotSizePlan = z.infer<typeof LotSizePlanSchema>;

/** Table 1 alone: the code letter and sample size an inspection level asks for. */
export const LotSampleSchema = z.object({
  codeLetter: CodeLetterSchema,
  n: StandardSampleSizeSchema,
  ...lotFields,
  warnings: z.array(AqlWarningSchema),
});
export type LotSample = z.infer<typeof LotSampleSchema>;

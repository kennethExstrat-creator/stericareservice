// The AQL engine (BUILD_SPEC 7): the plan for a sample an inspector took, or
// for a lot at the template's inspection level. Results are plain data with
// warning codes and messages for modules and the UI. Input the tables cannot
// take, such as a sample size still being typed, comes back as an error
// instead of a throw.
import { formatAql, formatCount } from "./format";
import {
  codeLetterForLotSize,
  codeLetterForSampleSize,
  isStandardSampleSize,
  lookupPlan,
  type TablePlan,
} from "./lookup";
import {
  AqlSchema,
  InspectionLevelSchema,
  type Aql,
  type AqlError,
  type AqlErrorCode,
  type AqlWarning,
  type LotSample,
  type LotSizePlan,
  type SampleSizePlan,
} from "./schema";
import { INSPECTION_LEVELS, SAMPLE_SIZES, type CodeLetter, type InspectionLevel } from "./tables";

export type AqlResult<T> = { ok: true; plan: T } | { ok: false; error: AqlError };

export interface SampleSizeInput {
  /** Items inspected. */
  sampleSize: number;
  aql: Aql;
}

export interface LotSizeInput {
  /** Items in the lot, e.g. cases x gloves per case. */
  lotSize: number;
  level: InspectionLevel;
  /** Items sampled, when known, to flag a sample below the plan. */
  sampleSize?: number | null;
}

/**
 * The plan for a sample already inspected (the example reports set n
 * directly): the sample size gives the code letter, then Table 2-A the plan.
 */
export function planFromSampleSize({ sampleSize, aql }: SampleSizeInput): AqlResult<SampleSizePlan> {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 2) {
    return failure("invalid_sample_size", "Sample size must be a whole number of at least 2.");
  }
  if (!isAql(aql)) return failure("invalid_aql", invalidAql(aql));

  const codeLetter = codeLetterForSampleSize(sampleSize);
  const plan = planAt(codeLetter, aql);
  const warnings: AqlWarning[] = [];
  if (!isStandardSampleSize(sampleSize)) {
    warnings.push({
      code: "nonstandard_sample",
      message: `${formatCount(sampleSize)} is not a standard sample size, so it is read as code letter ${codeLetter} (n ${formatCount(SAMPLE_SIZES[codeLetter])}), the largest standard sample size below it.`,
    });
  }
  if (plan.arrow === "down") {
    warnings.push({
      code: "sample_too_small",
      message: `A sample of ${formatCount(sampleSize)} is too small for AQL ${formatAql(aql)}: the arrow at code letter ${codeLetter} points down to code letter ${plan.usedLetter}, which needs ${formatCount(plan.n)} (Accept ${plan.ac}, Reject ${plan.re}).`,
    });
  }
  return { ok: true, plan: { codeLetter, ...plan, aql, sampleSize, warnings } };
}

/** Table 1 alone: the code letter and sample size an inspection level asks of a lot. */
export function sampleSizeFromLotSize(input: LotSizeInput): AqlResult<LotSample> {
  const sampleSize = input.sampleSize ?? null;
  const invalid = checkLot(input.lotSize, input.level, sampleSize);
  if (invalid) return { ok: false, error: invalid };

  const { lotSize, level } = input;
  const codeLetter = codeLetterForLotSize(lotSize, level);
  const n = SAMPLE_SIZES[codeLetter];
  const warnings = lotWarnings({ lotSize, level, aql: null, letter: codeLetter, n, sampleSize });
  return { ok: true, plan: { codeLetter, n, lotSize, level, sampleSize, warnings } };
}

/**
 * The plan for a lot at an inspection level and AQL: Table 1 gives the code
 * letter, Table 2-A the plan after arrows. `n` is the sample to take.
 */
export function planFromLotSize(input: LotSizeInput & { aql: Aql }): AqlResult<LotSizePlan> {
  const sampleSize = input.sampleSize ?? null;
  const invalid =
    checkLot(input.lotSize, input.level, sampleSize) ??
    (isAql(input.aql) ? null : error("invalid_aql", invalidAql(input.aql)));
  if (invalid) return { ok: false, error: invalid };

  const { lotSize, level, aql } = input;
  const codeLetter = codeLetterForLotSize(lotSize, level);
  const plan = planAt(codeLetter, aql);
  const warnings = lotWarnings({ lotSize, level, aql, letter: plan.usedLetter, n: plan.n, sampleSize });
  return { ok: true, plan: { codeLetter, ...plan, aql, lotSize, level, sampleSize, warnings } };
}

// What the tables decide in a plan, and what it was made for. Warnings are
// messages, so they are not compared.
const SAMPLE_PLAN_KEYS = ["codeLetter", "usedLetter", "n", "aql", "ac", "re", "arrow", "sampleSize"] as const;
const LOT_PLAN_KEYS = [...SAMPLE_PLAN_KEYS, "lotSize", "level"] as const;

/**
 * BUILD_SPEC 6.2 rule 8: true when a stored or posted plan is the one the
 * tables give for the sample size and AQL (the plan's own unless given), so a
 * stale or edited plan cannot be saved.
 */
export function planMatchesSample(plan: SampleSizePlan, input: SampleSizeInput = plan): boolean {
  const expected = planFromSampleSize(input);
  return expected.ok && SAMPLE_PLAN_KEYS.every((key) => plan[key] === expected.plan[key]);
}

/** planMatchesSample for a lot plan, which also holds the lot size, level and sample taken. */
export function planMatchesLot(plan: LotSizePlan, input: LotSizeInput & { aql: Aql } = plan): boolean {
  const expected = planFromLotSize(input);
  return expected.ok && LOT_PLAN_KEYS.every((key) => plan[key] === expected.plan[key]);
}

/** AQL 0 (critical defects) is Accept 0 / Reject 1 at any code letter; other AQLs come from Table 2-A. */
function planAt(codeLetter: CodeLetter, aql: Aql): TablePlan {
  if (aql === 0) return { usedLetter: codeLetter, n: SAMPLE_SIZES[codeLetter], ac: 0, re: 1, arrow: null };
  return lookupPlan(codeLetter, aql);
}

interface LotCheck {
  lotSize: number;
  level: InspectionLevel;
  aql: Aql | null;
  /** The code letter of the plan that applies, and its sample size. */
  letter: CodeLetter;
  n: number;
  sampleSize: number | null;
}

function lotWarnings({ lotSize, level, aql, letter, n, sampleSize }: LotCheck): AqlWarning[] {
  const warnings: AqlWarning[] = [];
  // A plan's sample at least as large as the lot means inspecting every item.
  const required = Math.min(n, lotSize);
  if (sampleSize !== null && sampleSize < required) {
    const who = aql === null ? `Inspection level ${level}` : `Inspection level ${level} at AQL ${formatAql(aql)}`;
    const what = required < n ? "every item" : `a sample of ${formatCount(n)} (code letter ${letter})`;
    warnings.push({
      code: "sample_below_plan",
      message: `${who} needs ${what} for a lot of ${formatCount(lotSize)}, but the sample is ${formatCount(sampleSize)}.`,
    });
  }
  if (n >= lotSize) {
    warnings.push({
      code: "sample_exceeds_lot",
      message: `The plan's sample of ${formatCount(n)} (code letter ${letter}) is not smaller than the lot of ${formatCount(lotSize)}: inspect every item.`,
    });
  }
  return warnings;
}

function checkLot(lotSize: number, level: InspectionLevel, sampleSize: number | null): AqlError | null {
  if (!Number.isSafeInteger(lotSize) || lotSize < 2) {
    return error("invalid_lot_size", "Lot size must be a whole number of at least 2.");
  }
  if (!InspectionLevelSchema.safeParse(level).success) {
    const levels = `${INSPECTION_LEVELS.slice(0, -1).join(", ")} or ${INSPECTION_LEVELS.at(-1)}`;
    return error("invalid_level", `Inspection level must be ${levels}.`);
  }
  if (sampleSize !== null && (!Number.isSafeInteger(sampleSize) || sampleSize < 0)) {
    return error("invalid_sample_size", "Sample size must be a whole number.");
  }
  return null;
}

function isAql(value: unknown): value is Aql {
  return AqlSchema.safeParse(value).success;
}

function invalidAql(value: unknown): string {
  return `AQL ${String(value)} is not in ISO 2859-1 Table 2-A. Use 0 for critical defects or a Table 2-A AQL from 0.010 to 1000.`;
}

function error(code: AqlErrorCode, message: string): AqlError {
  return { code, message };
}

function failure(code: AqlErrorCode, message: string): { ok: false; error: AqlError } {
  return { ok: false, error: error(code, message) };
}

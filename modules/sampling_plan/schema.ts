// Sampling Plan (BUILD_SPEC 6.1 sampling_plan): per ordered size, what was
// sampled and how many gloves or inner units each test takes. Every value may
// be missing while the inspection is a draft. The lot's code letter and the
// plan's n are computed (6.2 rule 2), never stored here, and so are the
// gloves taken per inner box and those put back (calc.ts). The inner units
// sampled in all are worked out from the cases while the inner units per case
// are entered (withCount; Kenneth, 27 October 2026). Sampling Settings
// (Kenneth, 27 October 2026) keep three choices for the inspection beside the
// sizes: its general inspection level, its special inspection level and how
// Auto Calculate Sampling rounds the cases. Each size keeps the code letter
// its # of Gloves Sample is taken from, at the general level, which the
// inspector may lower with a reason (Kenneth, 27 October 2026), and its
// Watertight & Visual follows its # of Gloves Sample.
import { z } from "zod";
import {
  CodeLetterSchema,
  GeneralInspectionLevelSchema,
  InspectionLevelSchema,
  SpecialInspectionLevelSchema,
  type CodeLetter,
  type GeneralInspectionLevel,
  type SpecialInspectionLevel,
} from "@/lib/aql";
import { CountCellSchema, perSizeData } from "@/modules/_framework";
import type { SamplingPlanConfig } from "./config";
import { innerUnitsFromCases } from "./inner-boxes";
import { letterSample, letterSteps } from "./letter-steps";

/** The longest reason a code letter lowered on screen keeps. */
export const CODE_LETTER_REASON_MAX = 500;

export const SamplingSizeSchema = z.strictObject({
  /** Cases sampled. carton_sampling lists exactly this many box/carton numbers (6.2 rule 6). */
  cases: CountCellSchema,
  /**
   * Inner units taken from each sampled case, from 1 (Kenneth, 27 October
   * 2026). Optional: entered, innerUnits is cases × this; empty (data saved
   * before, a document that gives only the total), innerUnits is typed.
   */
  innerUnitsPerCase: z
    .number()
    .int()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "Inner units taken from each sampled case, only where a document states the count per case. Never derived from a total: a total goes into innerUnits.",
    ),
  /**
   * Inner units sampled in all: inner boxes, plastic packs, dispenser boxes
   * or pouches (packing_config's inner unit). Cases × innerUnitsPerCase
   * while that is entered.
   */
  innerUnits: CountCellSchema.describe(
    "Inner units sampled for the size in all: the total a document gives, as the paper form's Sampling Plan does (Inner Box). The app works it out from cases and innerUnitsPerCase when both are entered.",
  ),
  /** Gloves sampled. */
  gloves: CountCellSchema,
  /**
   * The ISO 2859-1 sample size code letter the gloves are taken from
   * (Kenneth, 27 October 2026): Auto Calculate Sampling writes the lot's at
   * the inspection level, and the inspector may lower it a letter at a time
   * for a factory whose performance is consistent, and raise it back; the
   * gloves follow. Never typed. Optional: data saved before has none.
   */
  codeLetter: CodeLetterSchema.nullable()
    .default(null)
    .describe(
      'The size\'s ISO 2859-1 sample size code letter (A to R, no I or O), only where a document states it for the size, such as "Code Letter M". Never work it out from the lot size, the sample size or the inspection level.',
    ),
  /** Why the letter was lowered, as given on Reduce; gone once it is back at the lot's letter. */
  codeLetterReason: z
    .string()
    .trim()
    .min(1)
    .max(CODE_LETTER_REASON_MAX)
    .nullable()
    .default(null)
    .describe("Why the inspector lowered the code letter on screen. Never set from a document."),
  /** n of watertight and visual (BUILD_SPEC 8), checked against the inspection level's plan (6.2 rule 8). */
  glovesWatertightVisual: CountCellSchema,
  /** The dimension rows. */
  glovesDimensions: CountCellSchema,
  /** Gloves for the physical test: force at break (EN 455) or tensile (ASTM D6319). */
  glovesPhysical: CountCellSchema,
  /**
   * The gloves weighed, a row from 12 to 26 October 2026: no template shows
   * it any more (shownColumns), and weight records one value per size. Kept
   * so the inspections that saved it still load; unused.
   */
  glovesWeight: CountCellSchema.describe("Not used: never fill"),
  /** Inner units for the packaging and dispensing check: its box rows. */
  innerUnitsDispensing: CountCellSchema,
  /** Surgical: pouches sampled. */
  pouches: CountCellSchema,
  /** Surgical: pouches for the dye leak test. */
  pouchesDyeLeak: CountCellSchema,
});
export type SamplingSize = z.infer<typeof SamplingSizeSchema>;

/** A count of a size's row: every value but its code letter and the reason it was lowered. */
export type SamplingCount = Exclude<keyof SamplingSize, "codeLetter" | "codeLetterReason">;

/**
 * The test rows the inspector may switch off on screen when the inspection
 * does not run that test (Kenneth, 26 October 2026): greyed, never hidden,
 * and no longer asked for. Data saved before the switches existed has none
 * off. glovesWeight has no row to switch any more; data that switched it
 * off still loads.
 */
export const ROW_SWITCHES = [
  "glovesWatertightVisual",
  "glovesDimensions",
  "glovesPhysical",
  "glovesWeight",
  "innerUnitsDispensing",
] as const satisfies readonly SamplingCount[];
export type RowSwitch = (typeof ROW_SWITCHES)[number];

/**
 * The test rows Auto Calculate Sampling fills at the special inspection
 * level (Kenneth, 27 October 2026: "for dimension and FAB, use Special
 * Inspection Level S2 ... for packaging and inspection, number of inner box
 * sampled is also Level S2"): Dimension, FAB and Packaging & Dispensing, in
 * table order (auto-special.ts).
 */
export const SPECIAL_ROWS = ["glovesDimensions", "glovesPhysical", "innerUnitsDispensing"] as const satisfies readonly RowSwitch[];
export type SpecialRow = (typeof SPECIAL_ROWS)[number];

/**
 * What Auto Calculate Sampling rounds each size's cases up to while Sampling
 * Settings say so (Kenneth, 27 October 2026: "round up to nearest 5 or 10,
 * which means 72 round to 75, 78 round to 80, not either 5 or 10"): the next
 * multiple of 5, the nearest 5 or 10 above.
 */
export const CASE_ROUNDING = 5;

/**
 * What `roundCasesTo` holds while the rounding is on: 5, as the switch saves
 * it, or 10, which the choice of 5 or 10 it replaced may have saved. Either
 * reads as on, and rounds to the nearest 5 or 10.
 */
const SAVED_ROUNDINGS = [CASE_ROUNDING, 10] as const;

export const SamplingPlanDataSchema = perSizeData(SamplingSizeSchema).extend({
  rowsOff: z
    .array(z.enum(ROW_SWITCHES))
    .optional()
    .describe("Test rows the inspector switched off on screen. Never set from a document."),
  // Saved before Sampling Settings (27 October 2026), the data has none of these: the default levels, no rounding.
  // A special level saved here while Sampling Settings had one level for everything still loads, as no general
  // level of the inspection's own (calc's generalLevel).
  inspectionLevel: InspectionLevelSchema.optional().describe(
    'The ISO 2859-1 general inspection level (I, II or III) set for this inspection, in place of the template\'s or the client\'s. Fill it only from a document that states the level in words, such as "General Inspection Level II" (II); never work it out from code letters, sample sizes or lot sizes. A special level goes in specialInspectionLevel.',
  ),
  specialInspectionLevel: SpecialInspectionLevelSchema.optional().describe(
    'The ISO 2859-1 special inspection level (S-1 to S-4) set for this inspection, for Dimension, FAB and Packaging & Dispensing, in place of the template\'s. Fill it only from a document that states the level in words, such as "Special Inspection Level S-3" (S-3); never work it out from code letters, sample sizes or lot sizes.',
  ),
  roundCasesTo: z
    .literal(SAVED_ROUNDINGS)
    .optional()
    .describe(
      "Set while Auto Calculate Sampling rounds each size's cases up to the nearest 5 or 10, as the inspector switched on screen. Never set from a document.",
    ),
});
export type SamplingPlanData = z.infer<typeof SamplingPlanDataSchema>;

/**
 * A general level (I, II or III), else null. A special level is no general
 * level: one saved as the inspection's level while Sampling Settings had one
 * level for everything (27 October 2026, before the special level had its
 * own), or written in a template's `inspectionLevel`, leaves the general
 * level to its default.
 */
export function generalLevel(level: string | null | undefined): GeneralInspectionLevel | null {
  const parsed = GeneralInspectionLevelSchema.safeParse(level);
  return parsed.success ? parsed.data : null;
}

/** The inspection's Sampling Settings (Kenneth, 27 October 2026). */
export type SamplingSettings = {
  /** The general level set for this inspection; null for the default (calc's resolveInspectionLevel). */
  inspectionLevel: GeneralInspectionLevel | null;
  /** The special level set for this inspection; null for the default (calc's resolveSpecialInspectionLevel). */
  specialInspectionLevel: SpecialInspectionLevel | null;
  /** Auto Calculate Sampling rounds each size's cases up to the nearest 5 or 10 (CASE_ROUNDING). */
  roundCases: boolean;
};

/** The settings saved: a special level in `inspectionLevel` reads as no general level set (generalLevel). */
export function samplingSettings(data: SamplingPlanData): SamplingSettings {
  return {
    inspectionLevel: generalLevel(data.inspectionLevel),
    specialInspectionLevel: data.specialInspectionLevel ?? null,
    roundCases: data.roundCasesTo !== undefined,
  };
}

/**
 * `data` with the settings saved: a level that is null leaves the data, so
 * the inspection is back on that default level; the rounding switched on is
 * saved as `roundCasesTo` 5, switched off it leaves the data. A special
 * level an earlier save holds in `inspectionLevel` goes with any change.
 * The counts stay as they are. The same `data` when nothing changes.
 */
export function withSamplingSettings(data: SamplingPlanData, settings: SamplingSettings): SamplingPlanData {
  const current = samplingSettings(data);
  if (
    current.inspectionLevel === settings.inspectionLevel &&
    current.specialInspectionLevel === settings.specialInspectionLevel &&
    current.roundCases === settings.roundCases
  ) {
    return data;
  }
  const next: SamplingPlanData = { ...data };
  delete next.inspectionLevel;
  delete next.specialInspectionLevel;
  delete next.roundCasesTo;
  if (settings.inspectionLevel !== null) next.inspectionLevel = settings.inspectionLevel;
  if (settings.specialInspectionLevel !== null) next.specialInspectionLevel = settings.specialInspectionLevel;
  if (settings.roundCases) next.roundCasesTo = CASE_ROUNDING;
  return next;
}

export function isRowSwitch(column: string): column is RowSwitch {
  return (ROW_SWITCHES as readonly string[]).includes(column);
}

/** The test rows switched off. */
export function rowsOff(data: Pick<SamplingPlanData, "rowsOff">): ReadonlySet<RowSwitch> {
  return new Set(data.rowsOff ?? []);
}

/**
 * Whether a size's Watertight & Visual follows its # of Gloves Sample
 * (Kenneth, 27 October 2026: "the Watertight and Visual follow # of gloves
 * sample"): where the template shows both rows and the inspector has not
 * switched Watertight & Visual off. A count typed there holds until # of
 * Gloves Sample next changes.
 */
export function watertightVisualFollows(
  data: Pick<SamplingPlanData, "rowsOff">,
  config: Pick<SamplingPlanConfig, "columns">,
): boolean {
  return config.columns.gloves && config.columns.glovesWatertightVisual && !rowsOff(data).has("glovesWatertightVisual");
}

/** `data` with one test row switched off or on; the same `data` when nothing changes. */
export function withRowOff(data: SamplingPlanData, column: RowSwitch, off: boolean): SamplingPlanData {
  const current = rowsOff(data);
  if (current.has(column) === off) return data;
  const next = ROW_SWITCHES.filter((entry) => (entry === column ? off : current.has(entry)));
  return { ...data, rowsOff: next };
}

export function emptySamplingPlan(): SamplingPlanData {
  return SamplingPlanDataSchema.parse({});
}

/** One size's row with nothing entered. */
export function emptySamplingSize(): SamplingSize {
  return SamplingSizeSchema.parse({});
}

/**
 * `data` with one count of one size set. Every other size is kept, also one
 * no longer ordered, so its data returns if the size is ordered again (6.2
 * rule 4). While the size's inner units per case are entered, setting them
 * or its cases (by hand or by Auto Calculate Sampling) writes cases × per
 * case into innerUnits, null while the cases are empty; emptying them keeps
 * the total as it is, to be typed again (Kenneth, 27 October 2026). Given
 * the template's `config`, a change of # of Gloves Sample is written into
 * Watertight & Visual too where it follows (watertightVisualFollows). The
 * same `data` when nothing changes.
 */
export function withCount(
  data: SamplingPlanData,
  size: string,
  column: SamplingCount,
  value: number | null,
  config: Pick<SamplingPlanConfig, "columns"> | null = null,
): SamplingPlanData {
  const row = data.sizes[size] ?? emptySamplingSize();
  if (row[column] === value) return data;
  const next: SamplingSize = { ...row, [column]: value };
  if ((column === "cases" || column === "innerUnitsPerCase") && next.innerUnitsPerCase !== null) {
    next.innerUnits = innerUnitsFromCases(next.cases, next.innerUnitsPerCase);
  }
  if (column === "gloves" && config !== null && watertightVisualFollows(data, config)) next.glovesWatertightVisual = value;
  return { ...data, sizes: { ...data.sizes, [size]: next } };
}

/**
 * `data` with a size's # of Gloves Sample worked out (Auto Calculate
 * Sampling, a code letter's step), and its Watertight & Visual set to the
 * same where it follows, also where the gloves were already that many: a
 * count typed there gives way to the sample worked out.
 */
function withSample(
  data: SamplingPlanData,
  size: string,
  gloves: number,
  config: Pick<SamplingPlanConfig, "columns"> | null,
): SamplingPlanData {
  const next = withCount(data, size, "gloves", gloves, config);
  return config !== null && watertightVisualFollows(next, config) ? withCount(next, size, "glovesWatertightVisual", gloves) : next;
}

/** `data` with a size's code letter and the reason it is below its lot's; the same `data` when both are as they are. */
function withLetter(data: SamplingPlanData, size: string, letter: CodeLetter, reason: string | null): SamplingPlanData {
  const row = data.sizes[size] ?? emptySamplingSize();
  if (row.codeLetter === letter && row.codeLetterReason === reason) return data;
  return { ...data, sizes: { ...data.sizes, [size]: { ...row, codeLetter: letter, codeLetterReason: reason } } };
}

/** What Auto Calculate Sampling works out for the sizes (Capture.tsx). */
export type AutoSampling = {
  /** Each size's cases to sample (auto-cases.ts). */
  cases: Readonly<Record<string, number>>;
  /** The gloves to sample of each size whose lot is known (auto-gloves.ts); a size left out keeps its own. */
  gloves: Readonly<Record<string, number>>;
  /** The code letter of each of those sizes' lots, which their gloves come from. */
  letters: Readonly<Record<string, CodeLetter>>;
  /** The inner units per case where a size has none (AUTO_INNER_UNITS_PER_CASE); null where the template shows no such row. */
  perCase: number | null;
  /**
   * The counts of the test rows filled at the special level (auto-special.ts),
   * per row, for each size whose lot is known; a row or a size left out keeps
   * its own. None without it.
   */
  tests?: Readonly<Partial<Record<SpecialRow, Readonly<Record<string, number>>>>>;
};

/**
 * `data` with Auto Calculate Sampling's counts in (Capture.tsx): each size's
 * cases, its inner units per case where it has none and `auto.perCase` is
 * given, then its code letter and gloves where its lot is known (a size whose
 * lot is not known keeps both). The letter is the lot's own, so a reason
 * kept for a lower one goes (Kenneth, 27 October 2026). Then the counts of
 * the tests filled at the special level (`auto.tests`). Through withCount,
 * so a total of inner units worked out from the cases follows them, and
 * Watertight & Visual takes the gloves where it follows.
 */
export function withAutoSampling(
  data: SamplingPlanData,
  sizes: readonly string[],
  auto: AutoSampling,
  config: Pick<SamplingPlanConfig, "columns"> | null = null,
): SamplingPlanData {
  return sizes.reduce((next, size) => {
    const withCases = withCount(next, size, "cases", auto.cases[size] ?? null);
    const withPerCase =
      auto.perCase !== null && (withCases.sizes[size]?.innerUnitsPerCase ?? null) === null
        ? withCount(withCases, size, "innerUnitsPerCase", auto.perCase)
        : withCases;
    const letter = auto.letters[size];
    const withLot = letter === undefined ? withPerCase : withLetter(withPerCase, size, letter, null);
    const gloves = auto.gloves[size];
    const withGloves = gloves === undefined ? withLot : withSample(withLot, size, gloves, config);
    return SPECIAL_ROWS.reduce((row, column) => {
      const count = auto.tests?.[column]?.[size];
      return count === undefined ? row : withCount(row, size, column, count);
    }, withGloves);
  }, data);
}

/**
 * Auto Calculate Sampling would change something already entered, so the
 * capture screen asks first ("Replace the Counts Entered?"): a size's cases,
 * gloves or code letter, its total of inner units where it puts in the
 * inner units per case, its Watertight & Visual where that follows the
 * gloves, or a test's count it fills at the special level; each only where
 * it holds a value and the new one differs.
 */
export function autoSamplingReplaces(
  data: SamplingPlanData,
  sizes: readonly string[],
  auto: AutoSampling,
  config: Pick<SamplingPlanConfig, "columns"> | null = null,
): boolean {
  const follows = config !== null && watertightVisualFollows(data, config);
  return sizes.some((size) => {
    const row = data.sizes[size] ?? emptySamplingSize();
    const total =
      auto.perCase !== null && row.innerUnitsPerCase === null
        ? (innerUnitsFromCases(auto.cases[size] ?? null, auto.perCase) ?? undefined)
        : undefined;
    const gloves = auto.gloves[size];
    return (
      replaces(row.cases, auto.cases[size]) ||
      replaces(row.gloves, gloves) ||
      replaces(row.innerUnits, total) ||
      replaces(row.codeLetter, auto.letters[size]) ||
      (follows && replaces(row.glovesWatertightVisual, gloves)) ||
      SPECIAL_ROWS.some((column) => replaces(row[column], auto.tests?.[column]?.[size]))
    );
  });
}

/** A value entered would change: one is worked out for it, and not the same. */
function replaces<T>(entered: T | null, next: T | undefined): boolean {
  return entered !== null && next !== undefined && entered !== next;
}

/** The reason Reduce keeps: trimmed, 1 to 500 characters; null for none, and Reduce waits for one. */
export function codeLetterReason(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" || trimmed.length > CODE_LETTER_REASON_MAX ? null : trimmed;
}

/** A step of a size's code letter on the capture screen: Reduce, or Raise. */
export type CodeLetterStep = {
  /** Down a letter (Reduce, with the reason), or up a letter (Raise), never past the lot's. */
  direction: "down" | "up";
  /** The size's lot in gloves; null while it is not known. */
  lot: number | null;
  /** The lot's code letter at the inspection level (calc's codeLetter); null while the lot is not known. */
  lotLetter: CodeLetter | null;
  /** Why the letter goes down: Reduce takes none without one. */
  reason?: string | null;
};

/**
 * `data` with one size's code letter a step down or up, and that size alone
 * worked out again for it (Kenneth, 27 October 2026: "When code letter is
 * reduced, the auto calculate trigger for that size to meet the new code
 * letter"): # of Gloves Sample becomes the letter's sample, never more than
 * the lot (letterSample), and Watertight & Visual follows where it does.
 * Reduce keeps the reason given (codeLetterReason); Raise keeps the one
 * there while the letter is still below the lot's, and back at the lot's
 * letter the reason goes. The same `data` when the step cannot be taken: no
 * letter, A, Reduce without a reason, Raise with the letter not below the
 * lot's, or with no lot letter. Every other size stays as it is.
 */
export function withCodeLetterStep(
  data: SamplingPlanData,
  size: string,
  step: CodeLetterStep,
  config: Pick<SamplingPlanConfig, "columns"> | null = null,
): SamplingPlanData {
  const row = data.sizes[size] ?? emptySamplingSize();
  const steps = letterSteps(row.codeLetter, step.lotLetter);
  const letter = step.direction === "down" ? steps.reduceTo : steps.raiseTo;
  if (letter === null) return data;
  const given = codeLetterReason(step.reason ?? "");
  if (step.direction === "down" && given === null) return data;
  const reason = step.direction === "down" ? given : letter === step.lotLetter ? null : row.codeLetterReason;
  return withSample(withLetter(data, size, letter, reason), size, letterSample(letter, step.lot), config);
}

/**
 * `data` with each empty total of inner units worked out where the size's
 * cases and inner units per case are entered, as withCount would: for a
 * reading that gives the count per case (Steri-AI never works a total out
 * itself; lib/inspections/source-documents.ts). A total that holds a number
 * stays (calc warns when it is not cases × per case). The same `data` when
 * nothing changes.
 */
export function withWorkedInnerUnits(data: SamplingPlanData): SamplingPlanData {
  let sizes: Record<string, SamplingSize> | null = null;
  for (const [size, row] of Object.entries(data.sizes)) {
    const worked = innerUnitsFromCases(row.cases, row.innerUnitsPerCase);
    if (worked === null || row.innerUnits !== null) continue;
    sizes ??= { ...data.sizes };
    sizes[size] = { ...row, innerUnits: worked };
  }
  return sizes === null ? data : { ...data, sizes };
}

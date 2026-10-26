// The ISO 2859-1 tables of Sampling Settings (Kenneth, 27 October 2026:
// "give a button to view code letter sampling table", "but also table II A
// simple sampling plan for normal inspection too"): Table 1 and Table 2-A as
// lib/aql holds them, never typed out again. Table 1's rows carry the ordered
// sizes whose lot falls in them; Table 2-A's the sizes whose lot takes their
// code letter at a level, with the AQL columns the inspection applies and
// the plans its arrows lead to.
import {
  CODE_LETTERS,
  formatCount,
  INSPECTION_LEVELS,
  lookupPlan,
  SAMPLE_SIZES,
  sampleSizeFromLotSize,
  TABLE_1,
  TABLE_2A,
  TABLE_2A_AQLS,
  type CodeLetter,
  type InspectionLevel,
  type Table2ACell,
  type TableAql,
  type TablePlan,
} from "@/lib/aql";
import { AQL_CHECKS, type AqlCheck, type AqlSettings } from "@/modules/_framework";

/** An ordered size and its lot in gloves; null until the order quantity and the gloves per case are known. */
export type SizeLot = { size: string; lot: number | null };

/** One row of Table 1. */
export type CodeLetterRow = {
  /** The row's lot sizes, both ends included; `to` is Infinity in the last row. */
  from: number;
  to: number;
  /** The code letter at each level. */
  letters: Readonly<Record<InspectionLevel, CodeLetter>>;
  /** The ordered sizes whose lot falls in the row, in order. */
  sizes: string[];
};

/** Table 1, row by row, with the sizes whose lot falls in each. A size whose lot is not known falls in none. */
export function codeLetterRows(lots: readonly SizeLot[]): CodeLetterRow[] {
  return TABLE_1.map(([from, to, ...letters]) => ({
    from,
    to,
    letters: Object.fromEntries(INSPECTION_LEVELS.map((level, index) => [level, letters[index]])) as Record<
      InspectionLevel,
      CodeLetter
    >,
    sizes: lots.filter(({ lot }) => lot !== null && lot >= from && lot <= to).map(({ size }) => size),
  }));
}

/** One size at a level: its lot, the lot's code letter and that letter's sample size; null where the lot is not known. */
export type SizeCodeLetter = { size: string; lot: number | null; codeLetter: CodeLetter | null; sampleSize: number | null };

/** Each size's code letter and sample size at the level: Table 1, then the letter's n (lib/aql sampleSizeFromLotSize). */
export function sizeCodeLetters(lots: readonly SizeLot[], level: InspectionLevel): SizeCodeLetter[] {
  return lots.map(({ size, lot }) => {
    const plan = lot === null ? null : sampleSizeFromLotSize({ lotSize: lot, level });
    return plan?.ok
      ? { size, lot, codeLetter: plan.plan.codeLetter, sampleSize: plan.plan.n }
      : { size, lot, codeLetter: null, sampleSize: null };
  });
}

/** "2 to 8", "500,001 and over": a row's lot sizes as ISO 2859-1 words them. */
export function lotRange(from: number, to: number): string {
  return Number.isFinite(to) ? `${formatCount(from)} to ${formatCount(to)}` : `${formatCount(from)} and over`;
}

/** The checks that apply an AQL, as Table 2-A's columns name them. */
export const AQL_CHECK_NAMES: Readonly<Record<AqlCheck, string>> = {
  watertight: "Watertight",
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

/** A Table 2-A column the inspection applies, with the checks that apply it. */
export type AqlColumn = { aql: TableAql; checks: AqlCheck[] };

/**
 * The Table 2-A columns of the AQLs the inspection's checks apply, in table
 * order: the context's, each from its module's template, else the client's,
 * else BUILD_SPEC 7's, none for a check the inspection does not run.
 * Critical's AQL 0 has no column: it is Accept 0 / Reject 1 at any code letter.
 */
export function aqlColumnsInUse(aql: Pick<AqlSettings, AqlCheck>): AqlColumn[] {
  return TABLE_2A_AQLS.flatMap((column) => {
    const checks = AQL_CHECKS.filter((check) => aql[check] === column);
    return checks.length === 0 ? [] : [{ aql: column, checks }];
  });
}

/** One row of Table 2-A. */
export type MasterTableRow = {
  letter: CodeLetter;
  /** The letter's sample size. */
  sampleSize: number;
  /** A cell per AQL, in TABLE_2A_AQLS order: Accept and Reject, or the arrow the standard prints. */
  cells: readonly Table2ACell[];
  /** The ordered sizes whose lot takes this letter at the level. */
  sizes: string[];
};

/** Table 2-A, letter by letter, with the sizes whose lot takes each letter. */
export function masterTableRows(letters: readonly SizeCodeLetter[]): MasterTableRow[] {
  return CODE_LETTERS.map((letter) => ({
    letter,
    sampleSize: SAMPLE_SIZES[letter],
    cells: TABLE_2A[letter],
    sizes: letters.filter((entry) => entry.codeLetter === letter).map((entry) => entry.size),
  }));
}

/** The plan at a code letter in use and an AQL in use, an arrow followed (lib/aql lookupPlan). */
export type PlanInUse = { letter: CodeLetter; aql: TableAql; plan: TablePlan };

/** Every plan the sizes' code letters and the AQLs in use meet at, in table order. */
export function plansInUse(letters: readonly SizeCodeLetter[], columns: readonly AqlColumn[]): PlanInUse[] {
  const used = CODE_LETTERS.filter((letter) => letters.some((entry) => entry.codeLetter === letter));
  return used.flatMap((letter) => columns.map(({ aql }) => ({ letter, aql, plan: lookupPlan(letter, aql) })));
}

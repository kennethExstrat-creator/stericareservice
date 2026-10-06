// Table 1 and Table 2-A lookups. Callers pass checked values and get a
// RangeError otherwise; plan.ts validates what inspectors and templates enter.
import {
  CODE_LETTERS,
  INSPECTION_LEVELS,
  SAMPLE_SIZES,
  TABLE_1,
  TABLE_2A,
  TABLE_2A_AQLS,
  type CodeLetter,
  type InspectionLevel,
  type SampleSize,
  type TableAql,
} from "./tables";

export type Arrow = "up" | "down";

/** A Table 2-A plan with arrows followed. */
export interface TablePlan {
  /** The code letter whose plan applies: the one looked up, or the one an arrow led to. */
  usedLetter: CodeLetter;
  /** Sample size of usedLetter: the sample this plan needs. */
  n: SampleSize;
  ac: number;
  re: number;
  /** The arrow in the cell looked up; null when that cell holds a plan. */
  arrow: Arrow | null;
}

/** Table 1: the code letter for a lot of at least 2 items at an inspection level. */
export function codeLetterForLotSize(lotSize: number, level: InspectionLevel): CodeLetter {
  if (!Number.isSafeInteger(lotSize) || lotSize < 2) {
    throw new RangeError(`Lot size must be a whole number of at least 2, got ${lotSize}`);
  }
  const column = INSPECTION_LEVELS.indexOf(level);
  if (column === -1) throw new RangeError(`Unknown inspection level: ${level}`);

  for (const [, to, ...letters] of TABLE_1) {
    if (lotSize <= to) return letters[column];
  }
  throw new RangeError(`Table 1 has no row for a lot of ${lotSize}`);
}

/** True for the Table 2-A sample sizes: 2, 3, 5, 8, 13 ... 2000. */
export function isStandardSampleSize(sampleSize: number): boolean {
  return CODE_LETTERS.some((letter) => SAMPLE_SIZES[letter] === sampleSize);
}

/** The code letter of a sample size. A non-standard size takes the largest standard size below it. */
export function codeLetterForSampleSize(sampleSize: number): CodeLetter {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 2) {
    throw new RangeError(`Sample size must be a whole number of at least 2, got ${sampleSize}`);
  }
  const letter = CODE_LETTERS.findLast((candidate) => SAMPLE_SIZES[candidate] <= sampleSize);
  if (!letter) throw new RangeError(`No code letter for a sample of ${sampleSize}`);
  return letter;
}

/**
 * Table 2-A at a code letter and AQL. An arrow leads to the first plan above
 * (↑) or below (↓) it in the same column, and that plan's sample size, Ac
 * and Re apply.
 */
export function lookupPlan(letter: CodeLetter, aql: TableAql): TablePlan {
  const column = TABLE_2A_AQLS.indexOf(aql);
  if (column === -1) throw new RangeError(`AQL ${aql} is not a Table 2-A column`);
  const start = CODE_LETTERS.indexOf(letter);
  if (start === -1) throw new RangeError(`Unknown code letter: ${letter}`);

  const first = TABLE_2A[letter][column];
  if (typeof first !== "string") return tablePlan(letter, first, null);

  const arrow: Arrow = first === "↑" ? "up" : "down";
  const step = arrow === "up" ? -1 : 1;
  for (let row = start + step; row >= 0 && row < CODE_LETTERS.length; row += step) {
    const usedLetter = CODE_LETTERS[row];
    const cell = TABLE_2A[usedLetter][column];
    if (typeof cell !== "string") return tablePlan(usedLetter, cell, arrow);
    // An arrow never runs into one pointing the other way (tables.test.ts).
    if (cell !== first) break;
  }
  throw new Error(`Table 2-A: the arrow at code letter ${letter}, AQL ${aql} does not reach a plan`);
}

function tablePlan(usedLetter: CodeLetter, [ac, re]: readonly [number, number], arrow: Arrow | null): TablePlan {
  return { usedLetter, n: SAMPLE_SIZES[usedLetter], ac, re, arrow };
}

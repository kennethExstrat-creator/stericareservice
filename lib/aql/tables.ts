// ISO 2859-1 single sampling plans for normal inspection (BUILD_SPEC 7):
// Table 1 and Table 2-A, entered cell by cell as printed. They are identical
// to ANSI/ASQ Z1.4 Tables I and II-A and to MIL-STD-105E. docs/AQL.md lists
// the reproductions every cell was checked against; before go-live the QC
// team checks them again against SteriCare's licensed copy of ISO 2859-1.

/** Fixed-length tuple, so a table row missing or gaining a cell fails to compile. */
type Tuple<T, N extends number, Acc extends readonly T[] = readonly []> = Acc["length"] extends N
  ? Acc
  : Tuple<T, N, readonly [...Acc, T]>;

/** Sample size code letters. The standard skips I and O. */
export const CODE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"] as const;
export type CodeLetter = (typeof CODE_LETTERS)[number];

/** Table 2-A: the sample size of each code letter. */
export const SAMPLE_SIZES = {
  A: 2,
  B: 3,
  C: 5,
  D: 8,
  E: 13,
  F: 20,
  G: 32,
  H: 50,
  J: 80,
  K: 125,
  L: 200,
  M: 315,
  N: 500,
  P: 800,
  Q: 1250,
  R: 2000,
} as const satisfies Readonly<Record<CodeLetter, number>>;
export type SampleSize = (typeof SAMPLE_SIZES)[CodeLetter];

/** Special levels S-1 to S-4, then general levels I, II and III: the column order of Table 1. */
export const INSPECTION_LEVELS = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];

/** Table 1's special levels, S-1 to S-4: small samples, where larger sampling risks can be tolerated (ISO 2859-1 10.1). */
export const SPECIAL_INSPECTION_LEVELS = ["S-1", "S-2", "S-3", "S-4"] as const satisfies readonly InspectionLevel[];
export type SpecialInspectionLevel = (typeof SPECIAL_INSPECTION_LEVELS)[number];

/** Table 1's general levels, I, II and III. */
export const GENERAL_INSPECTION_LEVELS = ["I", "II", "III"] as const satisfies readonly InspectionLevel[];
export type GeneralInspectionLevel = (typeof GENERAL_INSPECTION_LEVELS)[number];

/** Table 1 row: lot sizes `from` to `to` (inclusive), then one code letter per level in INSPECTION_LEVELS order. */
export type Table1Row = readonly [from: number, to: number, ...letters: Tuple<CodeLetter, 7>];

/** Table 1: sample size code letters. */
// prettier-ignore
export const TABLE_1 = [
  //  lot size          S-1  S-2  S-3  S-4  I    II   III
  [2,       8,          "A", "A", "A", "A", "A", "A", "B"],
  [9,       15,         "A", "A", "A", "A", "A", "B", "C"],
  [16,      25,         "A", "A", "B", "B", "B", "C", "D"],
  [26,      50,         "A", "B", "B", "C", "C", "D", "E"],
  [51,      90,         "B", "B", "C", "C", "C", "E", "F"],
  [91,      150,        "B", "B", "C", "D", "D", "F", "G"],
  [151,     280,        "B", "C", "D", "E", "E", "G", "H"],
  [281,     500,        "B", "C", "D", "E", "F", "H", "J"],
  [501,     1_200,      "C", "C", "E", "F", "G", "J", "K"],
  [1_201,   3_200,      "C", "D", "E", "G", "H", "K", "L"],
  [3_201,   10_000,     "C", "D", "F", "G", "J", "L", "M"],
  [10_001,  35_000,     "C", "D", "F", "H", "K", "M", "N"],
  [35_001,  150_000,    "D", "E", "G", "J", "L", "N", "P"],
  [150_001, 500_000,    "D", "E", "G", "J", "M", "P", "Q"],
  [500_001, Infinity,   "D", "E", "H", "K", "N", "Q", "R"],
] as const satisfies readonly Table1Row[];

/**
 * Table 2-A columns: AQL in percent nonconforming items, or nonconformities
 * per 100 items, as printed. AQLs above 10 apply to nonconformities only.
 */
// prettier-ignore
export const TABLE_2A_AQLS = [
  0.010, 0.015, 0.025, 0.040, 0.065, 0.10, 0.15, 0.25, 0.40, 0.65, 1.0, 1.5, 2.5, 4.0, 6.5,
  10, 15, 25, 40, 65, 100, 150, 250, 400, 650, 1000,
] as const;
export type TableAql = (typeof TABLE_2A_AQLS)[number];

/**
 * One Table 2-A cell: a plan [Ac, Re], or an arrow. "↓" means use the first
 * plan below it in the same column, "↑" the first plan above it.
 */
export type Table2ACell = readonly [ac: number, re: number] | "↑" | "↓";
export type Table2ARow = Tuple<Table2ACell, 26>;

/** Table 2-A: single sampling plans for normal inspection (master table), one row per code letter. */
// prettier-ignore
export const TABLE_2A = {
  //  0.010   0.015   0.025   0.040   0.065   0.10    0.15    0.25      0.40      0.65      1.0       1.5       2.5       4.0       6.5       10        15        25        40        65        100       150       250       400       650       1000
  A: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      "↓",      "↓",      "↓",      "↓",      "↓",      "↓",      [0, 1],   "↓",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], [30, 31]],
  B: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      "↓",      "↓",      "↓",      "↓",      "↓",      [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], [30, 31], [44, 45]],
  C: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      "↓",      "↓",      "↓",      "↓",      [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], [30, 31], [44, 45], "↑"],
  D: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      "↓",      "↓",      "↓",      [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], [30, 31], [44, 45], "↑",      "↑"],
  E: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      "↓",      "↓",      [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], [30, 31], [44, 45], "↑",      "↑",      "↑"],
  F: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      "↓",      [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  G: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",      [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  H: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    "↓",    [0, 1],   "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  J: ["↓",    "↓",    "↓",    "↓",    "↓",    "↓",    [0, 1], "↑",      "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  K: ["↓",    "↓",    "↓",    "↓",    "↓",    [0, 1], "↑",    "↓",      [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  L: ["↓",    "↓",    "↓",    "↓",    [0, 1], "↑",    "↓",    [1, 2],   [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  M: ["↓",    "↓",    "↓",    [0, 1], "↑",    "↓",    [1, 2], [2, 3],   [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  N: ["↓",    "↓",    [0, 1], "↑",    "↓",    [1, 2], [2, 3], [3, 4],   [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  P: ["↓",    [0, 1], "↑",    "↓",    [1, 2], [2, 3], [3, 4], [5, 6],   [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  Q: [[0, 1], "↑",    "↓",    [1, 2], [2, 3], [3, 4], [5, 6], [7, 8],   [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
  R: ["↑",    "↑",    [1, 2], [2, 3], [3, 4], [5, 6], [7, 8], [10, 11], [14, 15], [21, 22], "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑",      "↑"],
} as const satisfies Readonly<Record<CodeLetter, Table2ARow>>;

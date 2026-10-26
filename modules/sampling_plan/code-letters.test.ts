import { describe, expect, it } from "vitest";
import { CODE_LETTERS, INSPECTION_LEVELS, SAMPLE_SIZES, TABLE_1, TABLE_2A, TABLE_2A_AQLS, type TableAql } from "@/lib/aql";
import { makeTestContext } from "@/modules/_framework/testing";
import {
  aqlColumnsInUse,
  codeLetterRows,
  lotRange,
  masterTableRows,
  plansInUse,
  sizeCodeLetters,
  type SizeLot,
} from "./code-letters";
import { defaultLevelText, GENERAL_LEVELS, levelSourceText, SPECIAL_LEVELS } from "./settings";

/** SAFEDON_EG's lots: XS and L 120,000 gloves, S 1,700,000, M 1,120,000. */
const LOTS: readonly SizeLot[] = [
  { size: "XS", lot: 120_000 },
  { size: "S", lot: 1_700_000 },
  { size: "M", lot: 1_120_000 },
  { size: "L", lot: 120_000 },
];

describe("Sampling Settings' Table 1 (Kenneth, 27 October 2026: \"give a button to view code letter sampling table\")", () => {
  it("is lib/aql's Table 1, row for row and level for level", () => {
    const rows = codeLetterRows([]);
    expect(rows).toHaveLength(TABLE_1.length);
    rows.forEach((row, index) => {
      const [from, to, ...letters] = TABLE_1[index];
      expect([row.from, row.to]).toEqual([from, to]);
      expect(INSPECTION_LEVELS.map((level) => row.letters[level])).toEqual(letters);
      expect(row.sizes).toEqual([]);
    });
    // As ISO 2859-1 prints them: 3,201 to 10,000 at II is L; 500,001 and over at S-4 is K.
    expect(rows.find((row) => row.from === 3_201)?.letters.II).toBe("L");
    expect(rows.at(-1)?.letters["S-4"]).toBe("K");
  });

  it("names each size in the row its lot falls in, both ends included; a lot not known falls in none", () => {
    const rows = codeLetterRows([...LOTS, { size: "XL", lot: null }]);
    expect(rows.filter((row) => row.sizes.length > 0).map((row) => [lotRange(row.from, row.to), row.sizes])).toEqual([
      ["35,001 to 150,000", ["XS", "L"]],
      ["500,001 and over", ["S", "M"]],
    ]);
    const ends = codeLetterRows([
      { size: "S", lot: 150_000 },
      { size: "M", lot: 150_001 },
    ]);
    expect(ends.find((row) => row.to === 150_000)?.sizes).toEqual(["S"]);
    expect(ends.find((row) => row.from === 150_001)?.sizes).toEqual(["M"]);
  });

  it("gives each size's code letter and its sample size at a level", () => {
    expect(sizeCodeLetters(LOTS, "I")).toEqual([
      { size: "XS", lot: 120_000, codeLetter: "L", sampleSize: 200 },
      { size: "S", lot: 1_700_000, codeLetter: "N", sampleSize: 500 },
      { size: "M", lot: 1_120_000, codeLetter: "N", sampleSize: 500 },
      { size: "L", lot: 120_000, codeLetter: "L", sampleSize: 200 },
    ]);
    // BUILD_SPEC 7: lot 20,000 at level II is M, n 315.
    expect(sizeCodeLetters([{ size: "M", lot: 20_000 }], "II")).toEqual([{ size: "M", lot: 20_000, codeLetter: "M", sampleSize: 315 }]);
    // No lot yet, or one the table does not take: no letter.
    const unknown = sizeCodeLetters(
      [
        { size: "M", lot: null },
        { size: "L", lot: 1 },
      ],
      "I",
    );
    expect(unknown.map((entry) => [entry.codeLetter, entry.sampleSize])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("words the lot sizes as the standard does", () => {
    expect(lotRange(2, 8)).toBe("2 to 8");
    expect(lotRange(1_201, 3_200)).toBe("1,201 to 3,200");
    expect(lotRange(500_001, Infinity)).toBe("500,001 and over");
  });
});

describe("Sampling Settings' Table 2-A (Kenneth, 27 October 2026: \"table II A simple sampling plan for normal inspection\")", () => {
  const AQL = makeTestContext().aql;

  it("is lib/aql's master table, arrows included: a row per code letter with its sample size, a cell per AQL", () => {
    const rows = masterTableRows([]);
    expect(rows.map((row) => row.letter)).toEqual([...CODE_LETTERS]);
    for (const row of rows) {
      expect(row.sampleSize).toBe(SAMPLE_SIZES[row.letter]);
      expect(row.cells).toBe(TABLE_2A[row.letter]);
      expect(row.cells).toHaveLength(TABLE_2A_AQLS.length);
      expect(row.sizes).toEqual([]);
    }
    const at = (letter: string, aql: TableAql) => rows.find((row) => row.letter === letter)?.cells[TABLE_2A_AQLS.indexOf(aql)];
    // As ISO 2859-1 prints them.
    expect(at("M", 2.5)).toEqual([14, 15]);
    expect(at("L", 4.0)).toEqual([14, 15]);
    expect(at("K", 1.5)).toEqual([5, 6]);
    expect(at("N", 4.0)).toBe("↑");
    expect(at("A", 0.65)).toBe("↓");
  });

  it("names the sizes beside the code letter their lot takes at the level", () => {
    const rows = masterTableRows(sizeCodeLetters(LOTS, "I"));
    expect(rows.filter((row) => row.sizes.length > 0).map((row) => [row.letter, row.sizes])).toEqual([
      ["L", ["XS", "L"]],
      ["N", ["S", "M"]],
    ]);
  });

  it("takes the AQLs the inspection's checks apply, in table order with their checks; critical's 0 has no column", () => {
    // BUILD_SPEC 7's: watertight 1.5, major 2.5, minor 4.0, critical 0.
    expect(aqlColumnsInUse(AQL)).toEqual([
      { aql: 1.5, checks: ["watertight"] },
      { aql: 2.5, checks: ["major"] },
      { aql: 4.0, checks: ["minor"] },
    ]);
    expect(aqlColumnsInUse({ ...AQL, watertight: 2.5, minor: null })).toEqual([{ aql: 2.5, checks: ["watertight", "major"] }]);
    expect(aqlColumnsInUse({ watertight: null, critical: null, major: null, minor: null })).toEqual([]);
  });

  it("follows the arrow where a size's code letter meets an AQL in use (lib/aql lookupPlan)", () => {
    const plans = plansInUse(sizeCodeLetters(LOTS, "I"), aqlColumnsInUse(AQL));
    expect(plans.map(({ letter, aql, plan }) => [letter, aql, plan.usedLetter, plan.ac, plan.re])).toEqual([
      ["L", 1.5, "L", 7, 8],
      ["L", 2.5, "L", 10, 11],
      ["L", 4.0, "L", 14, 15],
      ["N", 1.5, "N", 14, 15],
      ["N", 2.5, "N", 21, 22],
      // N at 4.0 is an arrow up: M's plan, n 315.
      ["N", 4.0, "M", 21, 22],
    ]);
  });
});

describe("Sampling Settings' words (Kenneth, 27 October 2026)", () => {
  it("offers the general levels first and the special ones under Special, every level once", () => {
    expect(GENERAL_LEVELS).toEqual(["I", "II", "III"]);
    expect(SPECIAL_LEVELS).toEqual(["S-1", "S-2", "S-3", "S-4"]);
    expect([...SPECIAL_LEVELS, ...GENERAL_LEVELS]).toEqual([...INSPECTION_LEVELS]);
  });

  it("says where the level comes from, naming the default even while the inspection sets its own", () => {
    expect(defaultLevelText({ level: "II", source: "template" })).toBe("Template default: II.");
    expect(levelSourceText(null, { level: "II", source: "client" })).toBe("Client default: II.");
    expect(levelSourceText(null, { level: "I", source: "default" })).toBe("Default: I.");
    expect(levelSourceText("III", { level: "I", source: "template" })).toBe("Set for this inspection. Template default: I.");
  });
});

import { describe, expect, it } from "vitest";
import { lookupPlan } from "./lookup";
import {
  CODE_LETTERS,
  GENERAL_INSPECTION_LEVELS,
  INSPECTION_LEVELS,
  SAMPLE_SIZES,
  SPECIAL_INSPECTION_LEVELS,
  TABLE_1,
  TABLE_2A,
  TABLE_2A_AQLS,
  type CodeLetter,
  type Table2ACell,
} from "./tables";

type PlanCell = readonly [ac: number, re: number];
const isPlan = (cell: Table2ACell): cell is PlanCell => typeof cell !== "string";
const rank = (letter: CodeLetter) => CODE_LETTERS.indexOf(letter);
const cellAt = (row: number, column: number): Table2ACell => TABLE_2A[CODE_LETTERS[row]][column];
const lastRow = CODE_LETTERS.length - 1;
/** Ac of the cells in a row that hold a plan, left to right. */
const printedAcs = (letter: CodeLetter) => (TABLE_2A[letter] as readonly Table2ACell[]).filter(isPlan).map(([ac]) => ac);

/** ISO 2859-1 acceptance numbers for single sampling, smallest first. */
const ACCEPTANCE_NUMBERS = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 44];

/**
 * Table 1 code letters per lot size row, S-1 to III, from the matrix in
 * AQLSchemes 1.7-2 (CRAN, R/AAZ14Single.R): its author's own transcription of
 * MIL-STD-105E. TABLE_1 was entered from the scans in docs/AQL.md, not from it.
 */
const TABLE_1_BY_AQLSCHEMES = [
  "AAAAAAB", "AAAAABC", "AABBBCD", "ABBCCDE", "BBCCCEF", "BBCDDFG", "BCDEEGH", "BCDEFHJ",
  "CCEFGJK", "CDEGHKL", "CDFGJLM", "CDFHKMN", "DEGJLNP", "DEGJMPQ", "DEHKNQR",
];

/**
 * Every Table 2-A cell after following arrows: the plan's code letter and Ac
 * (Re is Ac + 1), one token per AQL column. Derived from the normal
 * inspection matrices (n, Ac, Re) in the same AQLSchemes file, which stores
 * each plan with its arrows already followed.
 */
const RESOLVED_BY_AQLSCHEMES: Record<CodeLetter, string> = {
  A: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 E0 D0 C0 B0 A0 C1 B1 A1 A2 A3 A5 A7 A10 A14 A21 A30",
  B: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 E0 D0 C0 B0 A0 C1 B1 B2 B3 B5 B7 B10 B14 B21 B30 B44",
  C: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 E0 D0 C0 B0 D1 C1 C2 C3 C5 C7 C10 C14 C21 C30 C44 B44",
  D: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 E0 D0 C0 E1 D1 D2 D3 D5 D7 D10 D14 D21 D30 D44 C44 B44",
  E: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 E0 D0 F1 E1 E2 E3 E5 E7 E10 E14 E21 E30 E44 D44 C44 B44",
  F: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 E0 G1 F1 F2 F3 F5 F7 F10 F14 F21 E21 E30 E44 D44 C44 B44",
  G: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 F0 H1 G1 G2 G3 G5 G7 G10 G14 G21 F21 E21 E30 E44 D44 C44 B44",
  H: "Q0 P0 N0 M0 L0 K0 J0 H0 G0 J1 H1 H2 H3 H5 H7 H10 H14 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  J: "Q0 P0 N0 M0 L0 K0 J0 H0 K1 J1 J2 J3 J5 J7 J10 J14 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  K: "Q0 P0 N0 M0 L0 K0 J0 L1 K1 K2 K3 K5 K7 K10 K14 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  L: "Q0 P0 N0 M0 L0 K0 M1 L1 L2 L3 L5 L7 L10 L14 L21 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  M: "Q0 P0 N0 M0 L0 N1 M1 M2 M3 M5 M7 M10 M14 M21 L21 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  N: "Q0 P0 N0 M0 P1 N1 N2 N3 N5 N7 N10 N14 N21 M21 L21 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  P: "Q0 P0 N0 Q1 P1 P2 P3 P5 P7 P10 P14 P21 N21 M21 L21 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  Q: "Q0 P0 R1 Q1 Q2 Q3 Q5 Q7 Q10 Q14 Q21 P21 N21 M21 L21 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
  R: "Q0 P0 R1 R2 R3 R5 R7 R10 R14 R21 Q21 P21 N21 M21 L21 K21 J21 H21 G21 F21 E21 E30 E44 D44 C44 B44",
};

describe("sample size code letters", () => {
  it("have the sample sizes listed in BUILD_SPEC 7", () => {
    const listed = CODE_LETTERS.map((letter) => `${SAMPLE_SIZES[letter]} ${letter}`).join(", ");
    expect(listed).toBe(
      "2 A, 3 B, 5 C, 8 D, 13 E, 20 F, 32 G, 50 H, 80 J, 125 K, 200 L, 315 M, 500 N, 800 P, 1250 Q, 2000 R",
    );
  });
});

describe("Table 1", () => {
  it("has contiguous lot size ranges from 2 up, with no gaps or overlaps", () => {
    expect(TABLE_1[0][0]).toBe(2);
    TABLE_1.forEach(([from, to], row) => {
      expect(to).toBeGreaterThanOrEqual(from);
      if (row > 0) expect(from).toBe(TABLE_1[row - 1][1] + 1);
    });
    expect(TABLE_1[TABLE_1.length - 1][1]).toBe(Infinity);
  });

  it("splits lots where ISO 2859-1 does", () => {
    expect(TABLE_1.map(([, to]) => to)).toEqual([
      8, 15, 25, 50, 90, 150, 280, 500, 1_200, 3_200, 10_000, 35_000, 150_000, 500_000, Infinity,
    ]);
  });

  it("never gives a smaller code letter to a larger lot or a higher inspection level", () => {
    TABLE_1.forEach(([, , ...letters], row) => {
      letters.forEach((letter, level) => {
        if (level > 0) expect(rank(letter)).toBeGreaterThanOrEqual(rank(letters[level - 1]));
        if (row > 0) {
          const [, , ...above] = TABLE_1[row - 1];
          expect(rank(letter)).toBeGreaterThanOrEqual(rank(above[level]));
        }
      });
    });
    expect(INSPECTION_LEVELS).toEqual(["S-1", "S-2", "S-3", "S-4", "I", "II", "III"]);
  });

  it("matches the AQLSchemes reproduction cell for cell", () => {
    expect(TABLE_1.map(([, , ...letters]) => letters.join(""))).toEqual(TABLE_1_BY_AQLSCHEMES);
  });

  it("groups its levels as it prints them: the special levels' columns, then the general levels'", () => {
    expect(SPECIAL_INSPECTION_LEVELS).toEqual(["S-1", "S-2", "S-3", "S-4"]);
    expect(GENERAL_INSPECTION_LEVELS).toEqual(["I", "II", "III"]);
    expect([...SPECIAL_INSPECTION_LEVELS, ...GENERAL_INSPECTION_LEVELS]).toEqual([...INSPECTION_LEVELS]);
  });
});

describe("Table 2-A", () => {
  it("has a row per code letter and a cell per AQL column", () => {
    expect(Object.keys(TABLE_2A)).toEqual([...CODE_LETTERS]);
    expect(TABLE_2A_AQLS).toEqual([
      0.01, 0.015, 0.025, 0.04, 0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1, 1.5, 2.5, 4, 6.5, 10, 15, 25, 40, 65, 100, 150,
      250, 400, 650, 1000,
    ]);
    for (const letter of CODE_LETTERS) expect(TABLE_2A[letter]).toHaveLength(TABLE_2A_AQLS.length);
  });

  it("has Re = Ac + 1 in every plan", () => {
    for (const letter of CODE_LETTERS) {
      for (const cell of TABLE_2A[letter]) {
        if (isPlan(cell)) expect(cell[1]).toBe(cell[0] + 1);
      }
    }
  });

  it("leads every arrow to a real plan in its column, never through an arrow the other way", () => {
    CODE_LETTERS.forEach((letter, start) => {
      TABLE_2A[letter].forEach((cell, column) => {
        if (isPlan(cell)) return;
        const step = cell === "↑" ? -1 : 1;
        let row = start + step;
        while (row >= 0 && row <= lastRow && cellAt(row, column) === cell) row += step;
        const where = `${cell} at ${letter}, AQL ${TABLE_2A_AQLS[column]}`;
        expect(row >= 0 && row <= lastRow, `${where} leaves the table`).toBe(true);
        expect(isPlan(cellAt(row, column)), `${where} meets the opposite arrow`).toBe(true);
      });
    });
  });

  it("never lowers Ac along a row", () => {
    for (const letter of CODE_LETTERS) {
      const printed = printedAcs(letter);
      printed.slice(1).forEach((ac, i) => expect(ac).toBeGreaterThan(printed[i]));

      const followed = TABLE_2A_AQLS.map((aql) => lookupPlan(letter, aql).ac);
      followed.slice(1).forEach((ac, i) => expect(ac).toBeGreaterThanOrEqual(followed[i]));
    }
  });

  it("never lowers Ac down a column, once arrows are followed", () => {
    for (const aql of TABLE_2A_AQLS) {
      const followed = CODE_LETTERS.map((letter) => lookupPlan(letter, aql).ac);
      followed.slice(1).forEach((ac, i) => expect(ac).toBeGreaterThanOrEqual(followed[i]));
    }
  });

  it("uses the ISO acceptance numbers in order along each row", () => {
    for (const letter of CODE_LETTERS) {
      const printed = printedAcs(letter);
      const first = ACCEPTANCE_NUMBERS.indexOf(printed[0]);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(printed).toEqual(ACCEPTANCE_NUMBERS.slice(first, first + printed.length));
    }
  });

  it("repeats each plan up to Ac 21 one row down and one column left", () => {
    // One step larger sample and one step smaller AQL cancel out: the table's diagonals.
    CODE_LETTERS.forEach((letter, row) => {
      TABLE_2A[letter].forEach((cell, column) => {
        if (!isPlan(cell) || cell[0] > 21 || row === lastRow || column === 0) return;
        expect(cellAt(row + 1, column - 1), `below-left of ${letter}, AQL ${TABLE_2A_AQLS[column]}`).toEqual(cell);
      });
    });
  });

  it("keeps Ac 30 and 44 to code letters A to E", () => {
    const largest = CODE_LETTERS.map((letter) => Math.max(...printedAcs(letter)));
    expect(largest).toEqual([30, 44, 44, 44, 44, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21]);
  });

  it("points down from code letter A and up from R where no plan lies beyond the table", () => {
    const at = (letter: CodeLetter, aql: (typeof TABLE_2A_AQLS)[number]) =>
      TABLE_2A[letter][TABLE_2A_AQLS.indexOf(aql)];
    expect([at("A", 10), at("A", 15)]).toEqual(["↓", "↓"]);
    expect([at("R", 0.01), at("R", 0.015)]).toEqual(["↑", "↑"]);
  });

  it("resolves every cell as the AQLSchemes reproduction does", () => {
    for (const letter of CODE_LETTERS) {
      const ours = TABLE_2A_AQLS.map((aql) => {
        const plan = lookupPlan(letter, aql);
        return `${plan.usedLetter}${plan.ac}`;
      });
      expect(ours.join(" "), `code letter ${letter}`).toBe(RESOLVED_BY_AQLSCHEMES[letter]);
    }
  });
});

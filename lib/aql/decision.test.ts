import { describe, expect, it } from "vitest";
import { DEFAULT_AQL, decide, labelingPlan, resolveAqls } from "./decision";
import { planFromLotSize, planFromSampleSize, type AqlResult } from "./plan";
import { CODE_LETTERS, SAMPLE_SIZES, TABLE_2A_AQLS } from "./tables";

function planOf<T>(result: AqlResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.plan;
}

describe("decide", () => {
  it("decides limits alone, as for labelling, on Ac and Re", () => {
    const plan = { ac: 3, re: 4 };
    expect([0, 3, 4, 10].map((defects) => decide(defects, plan))).toEqual(["accept", "accept", "reject", "reject"]);
  });

  it("rejects a single defect against Accept 0 / Reject 1", () => {
    expect(decide(0, { ac: 0, re: 1 })).toBe("accept");
    expect(decide(1, { ac: 0, re: 1 })).toBe("reject");
  });

  it("refuses a defect count that is not a whole number of 0 or more", () => {
    for (const defects of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => decide(defects, { ac: 3, re: 4 })).toThrow(RangeError);
    }
  });

  it("refuses limits that are not a single sampling plan", () => {
    expect(() => decide(0, { ac: 3, re: 5 })).toThrow(RangeError);
    expect(() => decide(0, { ac: -1, re: 0 })).toThrow(RangeError);
    expect(() => decide(0, { ac: 0.5, re: 1.5 })).toThrow(RangeError);
  });

  it("refuses a sample size, n or lot size that is not a whole number", () => {
    const limits = { ac: 3, re: 4 };
    for (const n of [0, -80, 80.5, Number.NaN]) expect(() => decide(0, { ...limits, n, sampleSize: 80 })).toThrow(RangeError);
    for (const sampleSize of [-1, 80.5, Number.NaN]) expect(() => decide(0, { ...limits, n: 80, sampleSize })).toThrow(RangeError);
    for (const lotSize of [0, 2.5]) expect(() => decide(0, { ...limits, n: 80, sampleSize: 80, lotSize })).toThrow(RangeError);
  });
});

describe("decide on a sample short of its plan", () => {
  it("n 50 at AQL 0.65 needs code J (n 80, 1 / 2): 0 or 1 defects are incomplete, 2 reject", () => {
    const plan = planOf(planFromSampleSize({ sampleSize: 50, aql: 0.65 }));
    expect(plan).toMatchObject({ codeLetter: "H", usedLetter: "J", n: 80, ac: 1, re: 2, arrow: "down" });
    expect([0, 1, 2, 3].map((defects) => decide(defects, plan))).toEqual(["incomplete", "incomplete", "reject", "reject"]);
  });

  it("code D at AQL 4.0 with a sample of 8 needs code E (n 13, 1 / 2)", () => {
    const plan = planOf(planFromSampleSize({ sampleSize: 8, aql: 4.0 }));
    expect(plan).toMatchObject({ codeLetter: "D", usedLetter: "E", n: 13, ac: 1, re: 2, arrow: "down" });
    expect([0, 1, 2].map((defects) => decide(defects, plan))).toEqual(["incomplete", "incomplete", "reject"]);
    expect(decide(1, planOf(planFromSampleSize({ sampleSize: 13, aql: 2.5 })))).toBe("incomplete");
  });

  it("decides an arrow up on the smaller plan's limits: n 500 at AQL 4.0 on code M's 21 / 22", () => {
    const plan = planOf(planFromSampleSize({ sampleSize: 500, aql: 4.0 }));
    expect(plan).toMatchObject({ usedLetter: "M", n: 315, arrow: "up" });
    expect([0, 21, 22].map((defects) => decide(defects, plan))).toEqual(["accept", "accept", "reject"]);
  });

  it("never accepts an arrow down in Table 2-A, and decides every other plan on its limits", () => {
    for (const letter of CODE_LETTERS) {
      for (const aql of [0, ...TABLE_2A_AQLS] as const) {
        const plan = planOf(planFromSampleSize({ sampleSize: SAMPLE_SIZES[letter], aql }));
        const below = plan.arrow === "down" ? "incomplete" : "accept";
        const cell = `${letter} at AQL ${aql}`;
        expect([decide(0, plan), decide(plan.ac, plan)], cell).toEqual([below, below]);
        expect(decide(plan.re, plan), cell).toBe("reject");
      }
    }
  });

  it("never accepts against an n with no sample size", () => {
    expect(decide(0, { ac: 3, re: 4, n: 80 })).toBe("incomplete");
    expect(decide(0, { ac: 3, re: 4, n: 80, sampleSize: null })).toBe("incomplete");
    expect(decide(4, { ac: 3, re: 4, n: 80 })).toBe("reject");
  });
});

describe("decide on a lot plan", () => {
  it("is incomplete on a sample below the plan or not yet known, and rejects at Re", () => {
    // Lot 100 at level I is code D; AQL 4.0 points down to E (n 13, 1 / 2).
    const lot = { lotSize: 100, level: "I", aql: 4.0 } as const;
    const short = planOf(planFromLotSize({ ...lot, sampleSize: 8 }));
    expect([0, 1, 2].map((defects) => decide(defects, short))).toEqual(["incomplete", "incomplete", "reject"]);
    const full = planOf(planFromLotSize({ ...lot, sampleSize: 13 }));
    expect([1, 2].map((defects) => decide(defects, full))).toEqual(["accept", "reject"]);
    expect(decide(0, planOf(planFromLotSize(lot)))).toBe("incomplete");
  });

  it("accepts a lot no larger than n once every item is inspected", () => {
    // Lot 8 at level III is code B; AQL 0.65 points down to F (n 20, 0 / 1).
    const lot = { lotSize: 8, level: "III", aql: 0.65 } as const;
    const every = planOf(planFromLotSize({ ...lot, sampleSize: 8 }));
    expect([0, 1].map((defects) => decide(defects, every))).toEqual(["accept", "reject"]);
    const fewer = planOf(planFromLotSize({ ...lot, sampleSize: 5 }));
    expect([0, 1].map((defects) => decide(defects, fewer))).toEqual(["incomplete", "reject"]);
  });
});

describe("labelingPlan", () => {
  it("is Accept 0 / Reject 1, a fresh copy each time", () => {
    const plan = labelingPlan();
    expect(plan).toEqual({ ac: 0, re: 1 });
    plan.ac = 5;
    expect(labelingPlan()).toEqual({ ac: 0, re: 1 });
  });

  it("rejects the first labelling defect at any number inspected", () => {
    expect(decide(0, labelingPlan())).toBe("accept");
    expect(decide(1, labelingPlan())).toBe("reject");
  });
});

describe("AQL defaults", () => {
  it("are watertight 1.5, critical 0, major 2.5 and minor 4.0", () => {
    expect(DEFAULT_AQL).toEqual({ watertight: 1.5, critical: 0, major: 2.5, minor: 4.0 });
  });

  it("give way to a template's or client's AQLs", () => {
    expect(resolveAqls()).toEqual(DEFAULT_AQL);
    expect(resolveAqls({ major: 1.5, minor: undefined, critical: 0.065 })).toEqual({
      watertight: 1.5,
      critical: 0.065,
      major: 1.5,
      minor: 4.0,
    });
    expect(DEFAULT_AQL.major).toBe(2.5);
  });
});

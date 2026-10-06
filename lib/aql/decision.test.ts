import { describe, expect, it } from "vitest";
import { DEFAULT_AQL, decide, labelingPlan, resolveAqls } from "./decision";

describe("decide", () => {
  it("accepts up to Ac defects and rejects from Re", () => {
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

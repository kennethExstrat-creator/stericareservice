// The pure rules behind the capture kit: keys, swipes, totals and
// decisions, box lists, paste splitting and issue paths. Markup is covered by
// kit.test.tsx; real pointer, key and paste handling by the Playwright run.
import { describe, expect, it } from "vitest";
import { bestOption, boxOptions, isUnlisted, moveInGrid, pickedElsewhere, readBoxNumber } from "./box-options";
import { columnStatus, columnTotal, countOf, decide, type CounterCell } from "./counter-model";
import { neighbour, splitPastedValues } from "./field-navigation";
import { handsOf } from "./hand-toggle";
import { findIssue, issuePathCandidates, issuePathKey, issuePathProps } from "./issue-path";
import { specOutcome } from "./requirement-list";
import { rovingIndex } from "./roving";
import { stepValue, swipeStep } from "./swipe";

describe("rovingIndex", () => {
  it("moves with the arrows and wraps at the ends", () => {
    expect(rovingIndex("ArrowRight", 0, 5)).toBe(1);
    expect(rovingIndex("ArrowLeft", 1, 5)).toBe(0);
    expect(rovingIndex("ArrowRight", 4, 5)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 5)).toBe(4);
  });

  it("jumps with Home and End", () => {
    expect(rovingIndex("Home", 3, 5)).toBe(0);
    expect(rovingIndex("End", 1, 5)).toBe(4);
  });

  it("can stop at the ends instead of wrapping", () => {
    expect(rovingIndex("ArrowRight", 4, 5, { wrap: false })).toBe(4);
    expect(rovingIndex("ArrowLeft", 0, 5, { wrap: false })).toBe(0);
  });

  it("uses up and down only for vertical groups (radios)", () => {
    expect(rovingIndex("ArrowDown", 0, 2)).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 2, { vertical: true })).toBe(1);
    expect(rovingIndex("ArrowUp", 0, 2, { vertical: true })).toBe(1);
  });

  it("ignores other keys and empty groups", () => {
    expect(rovingIndex("Enter", 0, 5)).toBeNull();
    expect(rovingIndex("a", 0, 5)).toBeNull();
    expect(rovingIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("swipeStep", () => {
  const start = { x: 400, y: 300, time: 0 };

  it("turns to the next size when the finger moves left, back when it moves right", () => {
    expect(swipeStep(start, { x: 300, y: 310, time: 200 })).toBe(1);
    expect(swipeStep(start, { x: 500, y: 290, time: 200 })).toBe(-1);
  });

  it("ignores short moves, so taps on steppers never turn the page", () => {
    expect(swipeStep(start, { x: 360, y: 300, time: 120 })).toBe(0);
    expect(swipeStep(start, { x: 400, y: 300, time: 80 })).toBe(0);
  });

  it("ignores mostly vertical moves (scrolling)", () => {
    expect(swipeStep(start, { x: 320, y: 380, time: 200 })).toBe(0);
    expect(swipeStep(start, { x: 300, y: 360, time: 200 })).toBe(1);
  });

  it("ignores slow drags", () => {
    expect(swipeStep(start, { x: 200, y: 300, time: 1200 })).toBe(0);
  });

  it("takes custom thresholds", () => {
    expect(swipeStep(start, { x: 370, y: 300, time: 100 }, { distance: 20 })).toBe(1);
  });
});

describe("stepValue", () => {
  const sizes = ["XS", "S", "M", "L", "XL"];

  it("finds the neighbouring size and never wraps", () => {
    expect(stepValue(sizes, "M", 1)).toBe("L");
    expect(stepValue(sizes, "M", -1)).toBe("S");
    expect(stepValue(sizes, "XL", 1)).toBeNull();
    expect(stepValue(sizes, "XS", -1)).toBeNull();
    expect(stepValue(sizes, "M", 0)).toBeNull();
    expect(stepValue(sizes, "XXL", 1)).toBeNull();
  });
});

describe("counter model", () => {
  const rows = [{ key: "hole_crotch" }, { key: "hole_palm" }, { key: "hole_finger" }];
  const counts: Record<string, number | null> = {
    "hole_crotch|M": 1,
    "hole_palm|M": null,
    "hole_finger|M": 2,
    "hole_crotch|L|R": 1,
    "hole_crotch|L|L": 2,
    "hole_palm|L|L": 1,
  };
  const read = ({ row, column, hand }: CounterCell) => counts[[row, column, hand].filter(Boolean).join("|")];

  it("reads missing, negative and broken counts as zero", () => {
    expect(countOf(null)).toBe(0);
    expect(countOf(undefined)).toBe(0);
    expect(countOf(-2)).toBe(0);
    expect(countOf(Number.NaN)).toBe(0);
    expect(countOf(3)).toBe(3);
  });

  it("totals a column over every row", () => {
    expect(columnTotal(rows, "M", undefined, read)).toBe(3);
    expect(columnTotal(rows, "XL", undefined, read)).toBe(0);
  });

  it("totals both hands, whichever is on screen", () => {
    expect(columnTotal(rows, "L", ["R", "L"], read)).toBe(4);
    expect(columnTotal(rows, "L", [], read)).toBe(0);
  });

  it("accepts up to Ac and rejects from Re", () => {
    expect(decide(3, { ac: 3, re: 4 })).toBe("accept");
    expect(decide(4, { ac: 3, re: 4 })).toBe("reject");
    expect(decide(0, { ac: 0, re: 1 })).toBe("accept");
    expect(decide(1, { ac: 0, re: 1 })).toBe("reject");
  });

  it("shows calc's status first, then the live decision, else not done", () => {
    expect(columnStatus(5, { limits: { ac: 3, re: 4 }, status: "not_done" })).toBe("not_done");
    expect(columnStatus(2, { limits: { ac: 3, re: 4 } })).toBe("pass");
    expect(columnStatus(4, { limits: { ac: 3, re: 4 } })).toBe("fail");
    expect(columnStatus(0, { limits: null })).toBe("not_done");
    expect(columnStatus(0, {})).toBe("not_done");
  });
});

describe("box options", () => {
  const cartons = [2834, 686, 299, 13, 1324, 1913, 2236, 686];

  it("offers each carton once, ascending", () => {
    expect(boxOptions(cartons)).toEqual([13, 299, 686, 1324, 1913, 2236, 2834]);
  });

  it("drops numbers that cannot be cartons", () => {
    expect(boxOptions([0, -3, 2.5, 12])).toEqual([12]);
  });

  it("filters by the digits typed", () => {
    expect(boxOptions(cartons, "13")).toEqual([13, 1324, 1913]);
    expect(boxOptions(cartons, " 2 2")).toEqual([2236]);
    expect(boxOptions(cartons, "999")).toEqual([]);
  });

  it("picks the exact box first, else the first match", () => {
    expect(bestOption(boxOptions(cartons, "13"), "13")).toBe(13);
    expect(bestOption(boxOptions(cartons, "132"), "132")).toBe(1324);
    expect(bestOption([], "5")).toBeNull();
  });

  it("counts picks in other rows, leaving this row's own out", () => {
    const used = [13, 299, 299, null, 13, 686];
    const elsewhere = pickedElsewhere(used, 13);
    expect(elsewhere.get(13)).toBe(1);
    expect(elsewhere.get(299)).toBe(2);
    expect(pickedElsewhere([686], 686).has(686)).toBe(false);
    expect(pickedElsewhere(used, null).get(13)).toBe(2);
  });

  it("flags a stored box that is not in the carton list", () => {
    expect(isUnlisted(2336, cartons)).toBe(true);
    expect(isUnlisted(2236, cartons)).toBe(false);
    expect(isUnlisted(null, cartons)).toBe(false);
  });

  it("checks nothing while there is no carton list", () => {
    expect(isUnlisted(2336, [])).toBe(false);
  });

  it("reads a typed box number as a whole number from 1", () => {
    expect(readBoxNumber(" 253 ")).toBe(253);
    expect(readBoxNumber("0")).toBeNull();
    expect(readBoxNumber("25.3")).toBeNull();
    expect(readBoxNumber("2 53")).toBeNull();
    expect(readBoxNumber("")).toBeNull();
    expect(readBoxNumber("abc")).toBeNull();
  });

  it("moves through the grid by one or by a row", () => {
    expect(moveInGrid("ArrowRight", 0, 12, 5)).toBe(1);
    expect(moveInGrid("ArrowDown", 1, 12, 5)).toBe(6);
    expect(moveInGrid("ArrowDown", 9, 12, 5)).toBe(11);
    expect(moveInGrid("ArrowUp", 2, 12, 5)).toBe(0);
    expect(moveInGrid("ArrowDown", -1, 12, 5)).toBe(0);
    expect(moveInGrid("PageDown", 0, 12, 5)).toBe(11);
    expect(moveInGrid("Enter", 0, 12, 5)).toBeNull();
    expect(moveInGrid("ArrowRight", 0, 0, 5)).toBeNull();
  });
});

describe("splitPastedValues", () => {
  it("splits a pasted column into values", () => {
    expect(splitPastedValues("88\n90\r\n 87 \n")).toEqual(["88", "90", "87"]);
  });

  it("reads a spreadsheet row in order", () => {
    expect(splitPastedValues("88\t90\n87\t91")).toEqual(["88", "90", "87", "91"]);
  });

  it("keeps blank and invalid entries in place for the fields to judge", () => {
    expect(splitPastedValues("88\n\n2 42")).toEqual(["88", "", "2 42"]);
  });

  it("leaves a single value as one", () => {
    expect(splitPastedValues("88")).toEqual(["88"]);
    expect(splitPastedValues("88\n")).toEqual(["88"]);
  });
});

describe("neighbour", () => {
  it("finds the next and previous item, or null past the ends", () => {
    expect(neighbour(["a", "b", "c"], "b", 1)).toBe("c");
    expect(neighbour(["a", "b", "c"], "b", -1)).toBe("a");
    expect(neighbour(["a", "b", "c"], "c", 1)).toBeNull();
    expect(neighbour(["a", "b", "c"], "z", 1)).toBeNull();
  });
});

describe("handsOf", () => {
  it("lists the hands a view shows", () => {
    expect(handsOf("R")).toEqual(["R"]);
    expect(handsOf("L")).toEqual(["L"]);
    expect(handsOf("both")).toEqual(["R", "L"]);
  });
});

describe("issue paths", () => {
  it("keys paths as JSON, so sizes with dots stay whole", () => {
    expect(issuePathKey(["sizes", "7.0", "holes", "palm"])).toBe('["sizes","7.0","holes","palm"]');
    expect(issuePathProps(["sizes", "M", 3])).toEqual({ "data-issue-path": '["sizes","M",3]' });
    expect(issuePathProps(null)).toEqual({});
  });

  it("finds the issue at a field, errors first", () => {
    const issues = [
      { level: "warning", path: ["sizes", "M", "weight"], message: "More than 10% from the indicative weight." },
      { level: "error", path: ["sizes", "M", "boxes", 11, "box"], message: "Box 2336 is not in the carton list." },
      { level: "warning", path: ["sizes", "M", "boxes", 11, "box"], message: "Box used twice." },
    ];
    expect(findIssue(issues, ["sizes", "M", "boxes", 11, "box"])?.message).toBe("Box 2336 is not in the carton list.");
    expect(findIssue(issues, ["sizes", "M", "weight"])?.level).toBe("warning");
    expect(findIssue(issues, ["sizes", "S", "weight"])).toBeUndefined();
    expect(findIssue(null, ["sizes"])).toBeUndefined();
  });

  it("falls back from the exact path to its parents", () => {
    expect(issuePathCandidates(["sizes", "M", "boxes", 3])).toEqual([
      '["sizes","M","boxes",3]',
      '["sizes","M","boxes"]',
      '["sizes","M"]',
      '["sizes"]',
    ]);
    expect(issuePathCandidates([])).toEqual([]);
  });
});

describe("specOutcome", () => {
  it("is not done without a value, NA without a limit", () => {
    expect(specOutcome(null, { kind: "min", min: 14 })).toBe("not_done");
    expect(specOutcome(Number.NaN, { kind: "min", min: 14 })).toBe("not_done");
    expect(specOutcome(2.9, { kind: "na" })).toBe("na");
    expect(specOutcome(2.9, undefined)).toBe("na");
  });

  it("judges the value against the spec", () => {
    expect(specOutcome(15.2, { kind: "min", min: 14 })).toBe("pass");
    expect(specOutcome(13.9, { kind: "min", min: 14 })).toBe("fail");
    expect(specOutcome(0.48, { kind: "max", max: 5 })).toBe("pass");
  });

  it("judges at the shown precision", () => {
    // 13.996 shows as 14.00 at two decimals, so it meets ≥ 14.00.
    expect(specOutcome(13.996, { kind: "min", min: 14 }, 2)).toBe("pass");
    expect(specOutcome(13.996, { kind: "min", min: 14 })).toBe("fail");
  });
});

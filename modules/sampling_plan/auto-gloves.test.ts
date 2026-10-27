import { describe, expect, it } from "vitest";
import type { CodeLetter } from "@/lib/aql";
import { makeTestContext } from "@/modules/_framework/testing";
import { AUTO_CALCULATED_TITLE, autoCalculateNotice, autoSampleGloves } from "./auto-gloves";
import { resolveInspectionLevel } from "./calc";
import { SAMPLING_PLAN_DEFAULT_CONFIG } from "./config";
import { AUTO_INNER_UNITS_PER_CASE } from "./inner-boxes";
import { emptySamplingPlan, withAutoSampling, withCount, withRowOff, type AutoSampling } from "./schema";

const lotsOf = (lots: Record<string, number | null>) => Object.entries(lots).map(([size, lot]) => ({ size, lot }));

/** What Auto Calculate Sampling hands withAutoSampling: no letters and no inner boxes per case unless given. */
const autoOf = (
  cases: Record<string, number>,
  gloves: Record<string, number>,
  more: { letters?: Record<string, CodeLetter>; perCase?: number | null } = {},
): AutoSampling => ({ cases, gloves, letters: more.letters ?? {}, perCase: more.perCase ?? null });

describe("autoSampleGloves (Auto Calculate Sampling's # of Gloves, Kenneth, 27 October 2026)", () => {
  it("takes each size's sample from its lot's code letter: 150,001 to 500,000 gloves at level I is code M, 315", () => {
    // 120, 2,900 and 60 cases of 2,000 gloves.
    expect(autoSampleGloves(lotsOf({ S: 240_000, M: 5_800_000, L: 120_000 }), "I")).toEqual({
      gloves: { S: 315, M: 500, L: 200 },
      letters: { S: "M", M: "N", L: "L" },
      unknownLot: [],
    });
  });

  it("works at the inspection level in force: Sampling Settings' own, else the template's or the client's, else I", () => {
    const lots = lotsOf({ S: 240_000 });
    const aql = makeTestContext().aql;
    // Nothing sets a level: I.
    const none = resolveInspectionLevel({}, SAMPLING_PLAN_DEFAULT_CONFIG, { aql });
    expect(none).toEqual({ level: "I", source: "default" });
    expect(autoSampleGloves(lots, none.level).gloves).toEqual({ S: 315 });
    // Set to II for the inspection: code P, 800.
    const own = resolveInspectionLevel({ inspectionLevel: "II" }, SAMPLING_PLAN_DEFAULT_CONFIG, { aql });
    expect(autoSampleGloves(lots, own.level).gloves).toEqual({ S: 800 });
    expect(autoSampleGloves(lots, "S-4").gloves).toEqual({ S: 80 });
  });

  it("takes every glove of a lot no larger than the plan's sample (docs/AQL.md rule 8)", () => {
    // Level III: a lot of 2 is code B, whose 3 is more than the lot holds; a lot of 3 is exactly B's 3.
    expect(autoSampleGloves(lotsOf({ XS: 2, S: 3 }), "III")).toMatchObject({ gloves: { XS: 2, S: 3 }, letters: { XS: "B", S: "B" } });
  });

  it("leaves a size whose lot is not known, or holds no Table 1 lot, and names it: no gloves and no letter for it", () => {
    expect(autoSampleGloves(lotsOf({ S: 240_000, M: null, XL: 1 }), "I")).toEqual({
      gloves: { S: 315 },
      letters: { S: "M" },
      unknownLot: ["M", "XL"],
    });
  });
});

describe("autoCalculateNotice (Kenneth, 27 October 2026)", () => {
  const notice = (unknownLot: string[]) =>
    autoCalculateNotice({ unknownLot, sizeName: (size) => size, glovesLabel: "# of Gloves", orderPage: "Order" });

  it("says Sampling Plan Calculation Completed, and nothing more when every count was worked out", () => {
    expect(AUTO_CALCULATED_TITLE).toBe("Sampling Plan Calculation Completed");
    expect(notice([])).toEqual({ title: "Sampling Plan Calculation Completed", description: null });
  });

  it("keeps the title and adds one line naming the sizes whose # of Gloves waits on the lot size", () => {
    expect(notice(["S", "XL"])).toEqual({
      title: "Sampling Plan Calculation Completed",
      description: "# of Gloves needs the lot size for S, XL: enter the packing configuration on the Order page.",
    });
  });
});

describe("withAutoSampling: what Auto Calculate Sampling writes", () => {
  it("fills each size's cases and its gloves, and leaves the gloves of a size whose lot is not known", () => {
    const typed = withCount(emptySamplingPlan(), "XL", "gloves", 50);
    const next = withAutoSampling(typed, ["S", "XL"], autoOf({ S: 16, XL: 7 }, { S: 315 }));
    expect(next.sizes.S).toMatchObject({ cases: 16, gloves: 315 });
    expect(next.sizes.XL).toMatchObject({ cases: 7, gloves: 50 });
  });

  it("recomputes a total worked out from the cases: the inner boxes per case stay, the total follows the new cases", () => {
    const worked = withCount(withCount(emptySamplingPlan(), "M", "cases", 10), "M", "innerUnitsPerCase", 2);
    expect(worked.sizes.M.innerUnits).toBe(20);
    expect(withAutoSampling(worked, ["M"], autoOf({ M: 35 }, { M: 315 })).sizes.M).toMatchObject({
      cases: 35,
      innerUnitsPerCase: 2,
      innerUnits: 70,
      gloves: 315,
    });
  });

  it("takes 1 inner box per case where a size has none, so the total inner boxes follow the cases (Kenneth, 27 October 2026)", () => {
    const auto = autoOf({ S: 15, XL: 10 }, { S: 500, XL: 315 }, { perCase: AUTO_INNER_UNITS_PER_CASE });
    const next = withAutoSampling(emptySamplingPlan(), ["S", "XL"], auto);
    expect(next.sizes.S).toMatchObject({ cases: 15, innerUnitsPerCase: 1, innerUnits: 15, gloves: 500 });
    expect(next.sizes.XL).toMatchObject({ cases: 10, innerUnitsPerCase: 1, innerUnits: 10, gloves: 315 });
  });

  it("keeps an inner boxes per case already entered, and fills none where the template shows no such row", () => {
    const worked = withCount(withCount(emptySamplingPlan(), "M", "cases", 10), "M", "innerUnitsPerCase", 2);
    expect(withAutoSampling(worked, ["M"], autoOf({ M: 35 }, { M: 315 }, { perCase: AUTO_INNER_UNITS_PER_CASE })).sizes.M).toMatchObject({
      innerUnitsPerCase: 2,
      innerUnits: 70,
    });
    expect(withAutoSampling(emptySamplingPlan(), ["M"], autoOf({ M: 35 }, { M: 315 })).sizes.M).toMatchObject({
      innerUnitsPerCase: null,
      innerUnits: null,
    });
  });

  it("keeps the inspection's Sampling Settings as they are", () => {
    const settings = { ...emptySamplingPlan(), inspectionLevel: "II" as const, roundCasesTo: 5 as const };
    expect(withAutoSampling(settings, ["M"], autoOf({ M: 35 }, { M: 800 }))).toMatchObject({ inspectionLevel: "II", roundCasesTo: 5 });
  });
});

describe("withAutoSampling's code letter (Kenneth, 27 October 2026)", () => {
  it("writes each size's code letter with its gloves: the lot's letter, the one its # of Gloves Sample is taken from", () => {
    const { gloves, letters } = autoSampleGloves(lotsOf({ S: 240_000, M: 5_800_000 }), "I");
    const next = withAutoSampling(emptySamplingPlan(), ["S", "M"], autoOf({ S: 16, M: 54 }, gloves, { letters }));
    expect(next.sizes.S).toMatchObject({ codeLetter: "M", gloves: 315, codeLetterReason: null });
    expect(next.sizes.M).toMatchObject({ codeLetter: "N", gloves: 500, codeLetterReason: null });
  });

  it("leaves both the letter and the gloves of a size whose lot is not known as they are", () => {
    const typed = { sizes: { XL: { ...withCount(emptySamplingPlan(), "XL", "gloves", 50).sizes.XL, codeLetter: "K" as const } } };
    const { gloves, letters, unknownLot } = autoSampleGloves(lotsOf({ XL: null }), "I");
    expect(unknownLot).toEqual(["XL"]);
    expect(withAutoSampling(typed, ["XL"], autoOf({ XL: 7 }, gloves, { letters })).sizes.XL).toMatchObject({
      cases: 7,
      gloves: 50,
      codeLetter: "K",
    });
  });

  it("puts a lowered letter back at the lot's and lets its reason go: the plan's letter needs none", () => {
    const lowered = { sizes: { M: { ...withCount(emptySamplingPlan(), "M", "gloves", 315).sizes.M, codeLetter: "M" as const, codeLetterReason: "Consistent high-quality factory" } } };
    expect(withAutoSampling(lowered, ["M"], autoOf({ M: 54 }, { M: 500 }, { letters: { M: "N" } })).sizes.M).toMatchObject({
      codeLetter: "N",
      codeLetterReason: null,
      gloves: 500,
    });
  });
});

describe("Watertight & Visual follows # of Gloves Sample (Kenneth, 27 October 2026)", () => {
  it("takes Auto Calculate's gloves, over a count typed there, where the template shows the row", () => {
    const typed = withCount(emptySamplingPlan(), "M", "glovesWatertightVisual", 200);
    const next = withAutoSampling(typed, ["M"], autoOf({ M: 54 }, { M: 500 }, { letters: { M: "N" } }), SAMPLING_PLAN_DEFAULT_CONFIG);
    expect(next.sizes.M).toMatchObject({ gloves: 500, glovesWatertightVisual: 500 });
    // Also where the gloves were already that many.
    const same = withCount(withCount(emptySamplingPlan(), "M", "gloves", 500), "M", "glovesWatertightVisual", 200);
    expect(withAutoSampling(same, ["M"], autoOf({ M: 54 }, { M: 500 }), SAMPLING_PLAN_DEFAULT_CONFIG).sizes.M.glovesWatertightVisual).toBe(500);
  });

  it("leaves it alone where it is switched off, where the template has no such row, and without the template's config", () => {
    const typed = withCount(emptySamplingPlan(), "M", "glovesWatertightVisual", 200);
    const auto = autoOf({ M: 54 }, { M: 500 });
    const off = withRowOff(typed, "glovesWatertightVisual", true);
    expect(withAutoSampling(off, ["M"], auto, SAMPLING_PLAN_DEFAULT_CONFIG).sizes.M.glovesWatertightVisual).toBe(200);
    const noRow = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, glovesWatertightVisual: false } };
    expect(withAutoSampling(typed, ["M"], auto, noRow).sizes.M.glovesWatertightVisual).toBe(200);
    expect(withAutoSampling(typed, ["M"], auto).sizes.M.glovesWatertightVisual).toBe(200);
  });
});

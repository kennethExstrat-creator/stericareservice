import { describe, expect, it } from "vitest";
import { makeTestContext } from "@/modules/_framework/testing";
import { AUTO_CALCULATED_TITLE, autoCalculateNotice, autoSampleGloves } from "./auto-gloves";
import { resolveInspectionLevel } from "./calc";
import { SAMPLING_PLAN_DEFAULT_CONFIG } from "./config";
import { emptySamplingPlan, withAutoSampling, withCount } from "./schema";

const lotsOf = (lots: Record<string, number | null>) => Object.entries(lots).map(([size, lot]) => ({ size, lot }));

describe("autoSampleGloves (Auto Calculate Sampling's # of Gloves, Kenneth, 27 October 2026)", () => {
  it("takes each size's sample from its lot's code letter: 150,001 to 500,000 gloves at level I is code M, 315", () => {
    // 120, 2,900 and 60 cases of 2,000 gloves.
    expect(autoSampleGloves(lotsOf({ S: 240_000, M: 5_800_000, L: 120_000 }), "I")).toEqual({
      gloves: { S: 315, M: 500, L: 200 },
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
    expect(autoSampleGloves(lotsOf({ XS: 2, S: 3 }), "III").gloves).toEqual({ XS: 2, S: 3 });
  });

  it("leaves a size whose lot is not known, or holds no Table 1 lot, and names it", () => {
    expect(autoSampleGloves(lotsOf({ S: 240_000, M: null, XL: 1 }), "I")).toEqual({
      gloves: { S: 315 },
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
    const next = withAutoSampling(typed, ["S", "XL"], { S: 16, XL: 7 }, { S: 315 });
    expect(next.sizes.S).toMatchObject({ cases: 16, gloves: 315 });
    expect(next.sizes.XL).toMatchObject({ cases: 7, gloves: 50 });
  });

  it("recomputes a total worked out from the cases: the inner boxes per case stay, the total follows the new cases", () => {
    const worked = withCount(withCount(emptySamplingPlan(), "M", "cases", 10), "M", "innerUnitsPerCase", 2);
    expect(worked.sizes.M.innerUnits).toBe(20);
    expect(withAutoSampling(worked, ["M"], { M: 35 }, { M: 315 }).sizes.M).toMatchObject({
      cases: 35,
      innerUnitsPerCase: 2,
      innerUnits: 70,
      gloves: 315,
    });
  });

  it("keeps the inspection's Sampling Settings as they are", () => {
    const settings = { ...emptySamplingPlan(), inspectionLevel: "II" as const, roundCasesTo: 5 as const };
    expect(withAutoSampling(settings, ["M"], { M: 35 }, { M: 800 })).toMatchObject({ inspectionLevel: "II", roundCasesTo: 5 });
  });
});

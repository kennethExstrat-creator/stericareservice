import { describe, expect, it } from "vitest";
import { codeLetterForLotSize, SAMPLE_SIZES, SPECIAL_INSPECTION_LEVELS } from "@/lib/aql";
import { makeTestContext } from "@/modules/_framework/testing";
import { autoCalculateNotice } from "./auto-gloves";
import {
  autoSampleSpecial,
  leftSpecialRows,
  LOT_NEEDS,
  lotSizeInnerBoxes,
  SPECIAL_ROW_LOTS,
  specialRowsToFill,
  type SizeLots,
} from "./auto-special";
import { resolveSpecialInspectionLevel } from "./calc";
import { samplesAtLevel } from "./code-letters";
import { SAMPLING_PLAN_DEFAULT_CONFIG, type SamplingPlanConfig } from "./config";
import { autoSamplingReplaces, emptySamplingPlan, SPECIAL_ROWS, withAutoSampling, withCount, withRowOff, type AutoSampling } from "./schema";

/** lib/aql's sample size for a lot at a level: Table 1's code letter, then its n, never retyped here. */
const tableSample = (lot: number, level: (typeof SPECIAL_INSPECTION_LEVELS)[number]) => SAMPLE_SIZES[codeLetterForLotSize(lot, level)];

/**
 * Kenneth's sizes (27 October 2026): M, 1,180 cases of 10 inner boxes of 200
 * gloves, 236,000 gloves and 11,800 inner boxes; S, 2,900 cases of 2,000,
 * 5,800,000 gloves and 29,000 inner boxes.
 */
const LOTS: readonly SizeLots[] = [
  { size: "S", gloves: 5_800_000, innerBoxes: 29_000 },
  { size: "M", gloves: 236_000, innerBoxes: 11_800 },
];

describe("Auto Calculate Sampling at the special level (Kenneth, 27 October 2026)", () => {
  it("takes Dimension and FAB from a lot over 35,000 gloves at S-2: code E, 13 gloves", () => {
    expect(codeLetterForLotSize(236_000, "S-2")).toBe("E");
    expect(tableSample(236_000, "S-2")).toBe(13);
    expect(samplesAtLevel([{ size: "M", lot: 236_000 }], "S-2")).toEqual({ counts: { M: 13 }, unknownLot: [] });
    // Every lot over 35,000 is E at S-2, however large.
    for (const lot of [35_001, 150_000, 500_000, 5_800_000]) {
      expect(samplesAtLevel([{ size: "S", lot }], "S-2").counts.S, String(lot)).toBe(13);
    }
  });

  it("takes Packaging & Dispensing from the lot in inner boxes: 1,180 cases × 10 is 11,800, code D, 8", () => {
    const context = makeTestContext({
      order: { M: { qtyCases: 1_180, lotNumbers: [] } },
      packing: { innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2_000 },
    });
    expect(lotSizeInnerBoxes(context, "M")).toBe(11_800);
    expect(codeLetterForLotSize(11_800, "S-2")).toBe("D");
    expect(tableSample(11_800, "S-2")).toBe(8);
    expect(samplesAtLevel([{ size: "M", lot: 11_800 }], "S-2")).toEqual({ counts: { M: 8 }, unknownLot: [] });
  });

  it("never takes more than the lot: a small lot's sample is capped at it", () => {
    // S-2's smallest sample is code A's 2: a lot of 2 inner boxes gives both, every one.
    expect(samplesAtLevel([{ size: "XS", lot: 2 }], "S-2").counts).toEqual({ XS: 2 });
    // Where the letter's sample is larger than the lot, the lot: at III a lot of 2 is code B, 3, so 2.
    expect(SAMPLE_SIZES[codeLetterForLotSize(2, "III")]).toBe(3);
    expect(samplesAtLevel([{ size: "XS", lot: 2 }], "III").counts).toEqual({ XS: 2 });
  });

  it("fills Dimension and FAB from the lot in gloves and Packaging & Dispensing from the lot in inner boxes, size by size", () => {
    expect(autoSampleSpecial(LOTS, "S-2", SPECIAL_ROWS)).toEqual({
      counts: {
        glovesDimensions: { S: 13, M: 13 },
        glovesPhysical: { S: 13, M: 13 },
        // 29,000 and 11,800 inner boxes are both 10,001 to 35,000: code D at S-2.
        innerUnitsDispensing: { S: 8, M: 8 },
      },
      unknownLot: {},
    });
    for (const row of SPECIAL_ROWS) {
      const lot = (size: SizeLots) => (SPECIAL_ROW_LOTS[row] === "gloves" ? size.gloves : size.innerBoxes) ?? 0;
      for (const size of LOTS) expect(autoSampleSpecial(LOTS, "S-2", [row]).counts[row]?.[size.size]).toBe(tableSample(lot(size), "S-2"));
    }
  });

  it("works at the special level in force: the inspection's, else the template's, else S-2", () => {
    const template: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, specialInspectionLevel: "S-4" };
    const level = (data: { specialInspectionLevel?: "S-1" | "S-3" }, config = SAMPLING_PLAN_DEFAULT_CONFIG) =>
      resolveSpecialInspectionLevel(data, config).level;
    expect(autoSampleSpecial(LOTS, level({}), ["glovesDimensions"]).counts.glovesDimensions).toEqual({ S: 13, M: 13 });
    // S-4: 5,800,000 gloves is code K, 125; 236,000 is J, 80.
    expect(autoSampleSpecial(LOTS, level({}, template), ["glovesDimensions"]).counts.glovesDimensions).toEqual({ S: 125, M: 80 });
    // S-1: both lots are code D, 8.
    expect(autoSampleSpecial(LOTS, level({ specialInspectionLevel: "S-1" }, template), ["glovesDimensions"]).counts.glovesDimensions).toEqual({
      S: 8,
      M: 8,
    });
  });

  it("fills only the rows it is given: the template's, switched on", () => {
    const filled = autoSampleSpecial(LOTS, "S-2", ["glovesDimensions", "innerUnitsDispensing"]);
    expect(Object.keys(filled.counts)).toEqual(["glovesDimensions", "innerUnitsDispensing"]);
    expect(autoSampleSpecial(LOTS, "S-2", [])).toEqual({ counts: {}, unknownLot: {} });
  });

  it("leaves a size whose lot is not known and names it per row, by what the row's lot needs", () => {
    const lots: SizeLots[] = [
      { size: "S", gloves: 5_800_000, innerBoxes: null },
      { size: "M", gloves: null, innerBoxes: null },
      { size: "L", gloves: 1, innerBoxes: 1 },
    ];
    expect(autoSampleSpecial(lots, "S-2", SPECIAL_ROWS)).toEqual({
      counts: { glovesDimensions: { S: 13 }, glovesPhysical: { S: 13 }, innerUnitsDispensing: {} },
      // A lot of 1 has no Table 1 row: no lot to work from either.
      unknownLot: { glovesDimensions: ["M", "L"], glovesPhysical: ["M", "L"], innerUnitsDispensing: ["S", "M", "L"] },
    });
    expect(lotSizeInnerBoxes(makeTestContext({ order: { M: { qtyCases: 1_180, lotNumbers: [] } } }), "M")).toBeNull();
    expect(lotSizeInnerBoxes(makeTestContext(), "M")).toBeNull();
  });
});

describe("the special rows Auto Calculate Sampling fills", () => {
  it("are Dimension, FAB and Packaging & Dispensing where the template shows them", () => {
    expect(SPECIAL_ROWS).toEqual(["glovesDimensions", "glovesPhysical", "innerUnitsDispensing"]);
    expect(specialRowsToFill(SAMPLING_PLAN_DEFAULT_CONFIG, emptySamplingPlan())).toEqual([...SPECIAL_ROWS]);
    // STD_SG's sampling plan has no Packaging & Dispensing row.
    const sg = { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, innerUnitsDispensing: false } };
    expect(specialRowsToFill(sg, emptySamplingPlan())).toEqual(["glovesDimensions", "glovesPhysical"]);
  });

  it("leave a row switched off alone, whatever it holds, and ask nothing about it", () => {
    const typed = withRowOff(withCount(emptySamplingPlan(), "M", "glovesPhysical", 20), "glovesPhysical", true);
    const rows = specialRowsToFill(SAMPLING_PLAN_DEFAULT_CONFIG, typed);
    expect(rows).toEqual(["glovesDimensions", "innerUnitsDispensing"]);
    const tests = autoSampleSpecial([{ size: "M", gloves: 236_000, innerBoxes: 11_800 }], "S-2", rows).counts;
    const auto: AutoSampling = { cases: { M: 33 }, gloves: {}, letters: {}, perCase: null, tests };
    expect(autoSamplingReplaces(typed, ["M"], auto, SAMPLING_PLAN_DEFAULT_CONFIG)).toBe(false);
    expect(withAutoSampling(typed, ["M"], auto, SAMPLING_PLAN_DEFAULT_CONFIG).sizes.M).toMatchObject({
      glovesDimensions: 13,
      glovesPhysical: 20,
      innerUnitsDispensing: 8,
    });
  });
});

describe("Auto Calculate's notice for the special rows (Kenneth, 27 October 2026)", () => {
  const shown = { glovesDimensions: "Dimension", glovesPhysical: "FAB", innerUnitsDispensing: "Packaging & Dispensing Inspection" } as const;
  const notice = (unknownLot: string[], rows: ReturnType<typeof leftSpecialRows>) =>
    autoCalculateNotice({ unknownLot, sizeName: (size) => size, glovesLabel: "# of Gloves Sample", orderPage: "Order", rows });

  it("names a row left for want of its lot, the same way as # of Gloves Sample's line, keeping the title", () => {
    const left = leftSpecialRows({ innerUnitsDispensing: ["S"] }, (row) => shown[row]);
    expect(left).toEqual([{ label: "Packaging & Dispensing Inspection", needs: LOT_NEEDS.innerBoxes, sizes: ["S"] }]);
    expect(notice([], left)).toEqual({
      title: "Sampling Plan Calculation Completed",
      description: "Packaging & Dispensing Inspection needs the inner boxes per case for S: enter the packing configuration on the Order page.",
    });
  });

  it("puts the rows that lack the same for the same sizes in one sentence, # of Gloves Sample's first", () => {
    const left = leftSpecialRows(
      { glovesDimensions: ["S", "XL"], glovesPhysical: ["S", "XL"], innerUnitsDispensing: ["S", "XL"] },
      (row) => shown[row],
    );
    expect(notice(["S", "XL"], left).description).toBe(
      "# of Gloves Sample, Dimension and FAB need the lot size for S, XL: enter the packing configuration on the Order page. " +
        "Packaging & Dispensing Inspection needs the inner boxes per case for S, XL: enter the packing configuration on the Order page.",
    );
    // Nothing left: the title alone.
    expect(notice([], leftSpecialRows({}, (row) => shown[row]))).toEqual({ title: "Sampling Plan Calculation Completed", description: null });
  });
});

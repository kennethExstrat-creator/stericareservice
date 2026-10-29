import { describe, expect, it } from "vitest";
import { dataKeys } from "@/lib/coverage";
import { roundTo } from "@/lib/stats";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { cartonList, STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { packingCheckData, passingAgedSample } from "./__fixtures__/examples";
import { boxesLineOf, calcDispensingPacking, formatAverage, packingHeading, plannedBoxes, SUMMARY_LINE_BREAK } from "./calc";
import { DISPENSING_PACKING_DEFAULT_CONFIG, DISPENSING_PACKING_LABELS, type DispensingPackingConfig } from "./config";
import { definition } from "./index";
import {
  emptyAgedSample,
  emptyPackingBox,
  type DispensingPackingData,
  type PackingAgedSample,
  type PackingBox,
  type PackingSize,
} from "./schema";

/**
 * The STD_EG example's packing check in this module's shape: placeholder box
 * numbers, values as printed, and the placeholder aged sample that passes
 * (the report predates the aged sample).
 */
function stdEgData(): DispensingPackingData {
  return packingCheckData(STD_EG_EXAMPLE.dispensingPacking);
}

/** The STD_EG example's context: size M ordered, its carton list (525 twice) and 13 dispensing boxes planned. */
function stdEgContext(overrides: Partial<InspectionContext> = {}): InspectionContext {
  return makeTestContext({
    sizes: STD_EG_EXAMPLE.sizesOrdered,
    cartons: { M: cartonList(STD_EG_EXAMPLE.cartons.M!) },
    sampling: { M: makeSampling({ packagingDispensing: STD_EG_EXAMPLE.sampling.M!.dispensingInners }) },
    ...overrides,
  });
}

function input(
  data: DispensingPackingData,
  context: InspectionContext,
  config: DispensingPackingConfig = DISPENSING_PACKING_DEFAULT_CONFIG,
  labels: Readonly<Record<string, string>> = DISPENSING_PACKING_LABELS,
): CalcInput<DispensingPackingData, DispensingPackingConfig> {
  return { data, config, title: "Glove Packing Check", labels, context, results: {}, hasData: true };
}

function box(values: Partial<PackingBox>): PackingBox {
  return { ...emptyPackingBox(), ...values };
}

/** `count` complete boxes for one size, numbered from `first`, every value the same. */
function boxes(count: number, values: Partial<PackingBox> = {}, first = 1): PackingBox[] {
  return Array.from({ length: count }, (_, index) =>
    box({ boxNo: first + index, layeringPct: 88, dispensingPct: 90, stickiness: "A", ...values }),
  );
}

/** A size's box rows with the placeholder aged sample that passes: every size has one (Kenneth, 27 October 2026). */
function withAged(rows: PackingBox[]): PackingSize {
  return { boxes: rows, agedSample: passingAgedSample() };
}

/** The placeholder aged sample's line in a size's summary, after the boxes'. */
const AGED_PASSED = "Aged Sample: Layering 85.0% (min. 70%), Dispensing 88.0% (min. 80%), Stickiness A: Passed.";
/** An empty aged sample's line. */
const AGED_NOT_ENTERED = "Aged Sample is not entered yet.";

const M_ONLY = makeTestContext({ sizes: ["M"] });

describe("dispensing_packing", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("computes every value the dictionary lists as computed, per size (6.2 rule 2)", () => {
    const size = calcDispensingPacking(input({ sizes: {} }, M_ONLY)).computed.sizes.M;
    for (const key of dataKeys("dispensing_packing", "computed")) expect(Object.keys(size), key).toContain(key);
  });

  describe("the STD_EG example (expected results B)", () => {
    const expected = STD_EG_EXPECTED.dispensing.M!;
    const stray = STD_EG_EXPECTED.dispensingBox;

    it("computes layering 88.3% and dispensing 90.3% on average, stickiness A on all 13 boxes: pass", () => {
      const output = calcDispensingPacking(input(stdEgData(), stdEgContext()));
      const size = output.computed.sizes.M;
      expect(roundTo(size.layeringAverage!, 1)).toBe(expected.layeringAvgPct);
      expect(roundTo(size.dispensingAverage!, 1)).toBe(expected.dispensingAvgPct);
      expect(size.stickinessCounts).toEqual(expected.stickiness);
      expect(size).toMatchObject({
        boxesExpected: 13,
        boxesTested: 13,
        boxesComplete: 13,
        codeLetter: "E",
        stickinessSummary: "A",
        layeringResult: "pass",
        dispensingResult: "pass",
        stickinessResult: "pass",
        agedSample: { result: "pass" },
      });
      expect([expected.minLayeringPct, expected.minDispensingPct]).toEqual([
        DISPENSING_PACKING_DEFAULT_CONFIG.minLayeringPct,
        DISPENSING_PACKING_DEFAULT_CONFIG.minDispensingPct,
      ]);
      const boxesLine = "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.";
      expect(output.result).toEqual({
        status: expected.status,
        summary: `Size M: ${boxesLine}\n${AGED_PASSED}`,
        perSize: { M: { status: "pass", summary: `${boxesLine}\n${AGED_PASSED}` } },
      });
    });

    it("leaves size M not done on the report's boxes alone, which pass: the report predates the aged sample (Kenneth, 27 October 2026)", () => {
      const data = stdEgData();
      delete data.sizes.M.agedSample;
      const output = calcDispensingPacking(input(data, stdEgContext()));
      expect(output.result.perSize?.M).toEqual({
        status: "not_done",
        summary: `Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.\n${AGED_NOT_ENTERED}`,
      });
      expect(output.computed.sizes.M).toMatchObject({ layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass", agedSample: null });
      // Box 2336's warning, then the aged sample's.
      expect(output.issues.map(({ code, size, path }) => [code, size, path])).toEqual([
        ["box_not_in_carton_list", "M", ["sizes", "M", "boxes", STD_EG_EXPECTED.dispensingBox.item - 1, "boxNo"]],
        ["aged_sample_missing", "M", ["sizes", "M", "agedSample", "layeringPct"]],
      ]);
    });

    it("stores box 2336 as typed and warns, since size M's carton list does not hold it; the size still passes (6.2 rule 7)", () => {
      const data = stdEgData();
      expect(data.sizes.M.boxes[stray.item - 1].boxNo).toBe(stray.box);
      expect(stdEgContext().cartons.M).not.toContain(stray.box);
      const output = calcDispensingPacking(input(data, stdEgContext()));
      expect(stray.validation).toBe("warning");
      expect(STD_EG_EXPECTED.errors.filter((issue) => issue.module === "dispensing_packing")).toEqual([]);
      const [warning] = STD_EG_EXPECTED.warnings.filter((issue) => issue.module === "dispensing_packing");
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: warning.code,
          message: warning.message,
          size: "M",
          path: ["sizes", "M", "boxes", stray.item - 1, "boxNo"],
        },
      ]);
      expect(output.result.status).toBe("pass");
    });

    it("prints the heading with the code letter of the boxes tested and the template's minimums", () => {
      const output = calcDispensingPacking(input(stdEgData(), stdEgContext()));
      expect(output.computed.codeLetters).toEqual(["E"]);
      expect(packingHeading(DISPENSING_PACKING_LABELS, DISPENSING_PACKING_DEFAULT_CONFIG, output.computed.codeLetters)).toBe(
        "Glove Packing Check (Sampling Code Letter E) : Min. 70% Layering & 80% Dispensing",
      );
    });

    it("shows no result for the sizes not ordered (XS, S, L, XL), whatever data they hold (6.2 rule 4)", () => {
      const data = stdEgData();
      for (const size of STD_EG_EXPECTED.unorderedSizes.sizes) data.sizes[size] = { boxes: boxes(13) };
      const output = calcDispensingPacking(input(data, stdEgContext()));
      expect(Object.keys(output.result.perSize ?? {})).toEqual(["M"]);
      expect(Object.keys(output.computed.sizes)).toEqual(["M"]);
    });
  });

  describe("box rows (BUILD_SPEC 6.1 boxes per size)", () => {
    const config: DispensingPackingConfig = {
      ...DISPENSING_PACKING_DEFAULT_CONFIG,
      boxesPerSize: { default: 13, bySize: { XL: 5 } },
    };

    it("takes the sampling plan's inner units for dispensing, else the template's rows for the size, else its default", () => {
      const context = makeTestContext({
        sizes: ["S", "M", "XL"],
        sampling: { M: makeSampling({ packagingDispensing: 8 }), S: makeSampling({ cases: 20 }) },
      });
      expect(plannedBoxes(context, config, "M")).toBe(8);
      expect(plannedBoxes(context, config, "S")).toBe(13);
      expect(plannedBoxes(context, config, "XL")).toBe(5);
      expect(plannedBoxes(context, DISPENSING_PACKING_DEFAULT_CONFIG, "XL")).toBe(13);
    });

    it("is not done until every planned box is complete, never passed on part of them (6.2 rule 5)", () => {
      const context = makeTestContext({ sizes: ["M", "XL"] });
      const output = calcDispensingPacking(
        input({ sizes: { M: withAged(boxes(12)), XL: withAged(boxes(5)) } }, context, config),
      );
      expect(output.result.perSize).toEqual({
        // Its aged sample passed: the boxes still to come keep the size not done.
        M: { status: "not_done", summary: `12 of 13 boxes complete.\n${AGED_PASSED}` },
        XL: { status: "pass", summary: `Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Passed.\n${AGED_PASSED}` },
      });
      expect(output.result.status).toBe("not_done");
      expect(output.computed.sizes.M).toMatchObject({ layeringResult: "not_done", layeringAverage: 88, codeLetter: "D" });
    });

    it("names the first incomplete row; a row needs its box number, both percentages and a code", () => {
      const missing: Partial<PackingBox>[] = [{ boxNo: null }, { layeringPct: null }, { dispensingPct: null }, { stickiness: null }];
      for (const gap of missing) {
        const rows = boxes(5);
        rows[2] = { ...rows[2], ...gap };
        const output = calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, M_ONLY, config));
        expect(output.result.perSize?.M, JSON.stringify(gap)).toEqual({
          status: "not_done",
          summary: `4 of 13 boxes complete (item 3 is incomplete).\n${AGED_PASSED}`,
        });
      }
    });

    it("ignores blank rows wherever they are, and counts boxes beyond the plan", () => {
      const rows = [...boxes(6), emptyPackingBox(), ...boxes(7, {}, 7), emptyPackingBox()];
      expect(calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, M_ONLY)).result.perSize?.M.status).toBe("pass");
      const extra = calcDispensingPacking(input({ sizes: { M: withAged(boxes(14)) } }, M_ONLY));
      expect(extra.computed.sizes.M).toMatchObject({ boxesExpected: 13, boxesTested: 14, codeLetter: "E" });
      expect(extra.result.perSize?.M.status).toBe("pass");
    });

    it("is not done with no boxes entered or none planned, the aged sample's line after theirs", () => {
      const empty = calcDispensingPacking(input({ sizes: {} }, M_ONLY));
      expect(empty.result).toEqual({
        status: "not_done",
        summary: `Size M: 0 of 13 boxes complete.\n${AGED_NOT_ENTERED}`,
        perSize: { M: { status: "not_done", summary: `0 of 13 boxes complete.\n${AGED_NOT_ENTERED}` } },
      });
      // The boxes' count says what is left: no warning about the aged sample while boxes are to come.
      expect(empty.issues).toEqual([]);
      const none = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ packagingDispensing: 0 }) } });
      expect(calcDispensingPacking(input({ sizes: { M: withAged(boxes(13)) } }, none)).result.perSize?.M).toEqual({
        status: "not_done",
        summary: `No boxes are planned for this size.\n${AGED_PASSED}`,
      });
    });
  });

  describe("results (BUILD_SPEC 6.1: averages against the minimums, any failing code fails)", () => {
    const five = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ packagingDispensing: 5 }) } });

    it("fails a size whose layering or dispensing average is below the minimum; the minimum itself passes", () => {
      const low = calcDispensingPacking(input({ sizes: { M: withAged(boxes(5, { layeringPct: 69 })) } }, five));
      expect(low.result.perSize?.M).toEqual({
        status: "fail",
        summary: `Layering 69.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Failed (Layering).\n${AGED_PASSED}`,
      });
      expect(low.computed.sizes.M).toMatchObject({ layeringResult: "fail", dispensingResult: "pass", stickinessResult: "pass" });
      const dispensing = calcDispensingPacking(input({ sizes: { M: withAged(boxes(5, { dispensingPct: 79.9 })) } }, five));
      expect(dispensing.computed.sizes.M).toMatchObject({ dispensingResult: "fail" });
      const atMinimum = calcDispensingPacking(input({ sizes: { M: withAged(boxes(5, { layeringPct: 70, dispensingPct: 80 })) } }, five));
      expect(atMinimum.result.perSize?.M.status).toBe("pass");
    });

    it("judges the average as shown, at one decimal", () => {
      const rows = boxes(5, { layeringPct: 70 });
      rows[0] = { ...rows[0], layeringPct: 69.8 };
      // (69.8 + 4 x 70) / 5 = 69.96, shown as 70.0%.
      const output = calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, five));
      expect(output.computed.sizes.M.layeringAverage).toBeCloseTo(69.96, 10);
      expect(formatAverage(output.computed.sizes.M.layeringAverage)).toBe("70.0");
      expect(output.computed.sizes.M.layeringResult).toBe("pass");
    });

    it("fails a size with any box whose stickiness code fails, whatever the averages", () => {
      const rows = boxes(5);
      rows[3] = { ...rows[3], stickiness: "D" };
      rows[1] = { ...rows[1], stickiness: "B1" };
      const output = calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, five));
      expect(output.computed.sizes.M).toMatchObject({
        stickinessSummary: "D",
        stickinessCounts: { A: 3, B1: 1, D: 1 },
        stickinessResult: "fail",
        layeringResult: "pass",
      });
      expect(output.result.perSize?.M).toEqual({
        status: "fail",
        summary: `Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness D: Failed (Stickiness).\n${AGED_PASSED}`,
      });
    });

    it("takes pass or fail per code from the template, and the latest code entered as the summary", () => {
      const strict: DispensingPackingConfig = {
        ...DISPENSING_PACKING_DEFAULT_CONFIG,
        stickinessCodes: DISPENSING_PACKING_DEFAULT_CONFIG.stickinessCodes.map((entry) =>
          entry.code === "C" ? { ...entry, pass: false } : entry,
        ),
      };
      const rows = boxes(5, { stickiness: "B" });
      rows[4] = { ...rows[4], stickiness: "C" };
      expect(calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, five)).computed.sizes.M).toMatchObject({
        stickinessSummary: "C",
        stickinessResult: "pass",
      });
      expect(calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, five)).result.perSize?.M.status).toBe("pass");
      expect(calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, five, strict)).result.perSize?.M.status).toBe("fail");
    });

    it("gives the module the worst size: a failed size fails it, a size not done keeps a pass from showing", () => {
      const context = makeTestContext({
        sizes: ["S", "M"],
        sampling: { S: makeSampling({ packagingDispensing: 5 }), M: makeSampling({ packagingDispensing: 5 }) },
      });
      const failed = calcDispensingPacking(
        input({ sizes: { S: withAged(boxes(5, { stickiness: "D" })), M: withAged(boxes(5)) } }, context),
      );
      expect(failed.result.status).toBe("fail");
      expect(failed.result.summary).toBe(
        `Size S: Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness D: Failed (Stickiness).\n${AGED_PASSED} ` +
          `Size M: Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Passed.\n${AGED_PASSED}`,
      );
      const partly = calcDispensingPacking(input({ sizes: { M: withAged(boxes(5)) } }, context));
      expect(partly.result.status).toBe("not_done");
    });
  });

  describe("wrong data", () => {
    it("rejects a percentage outside 0 to 100: an error with a link, the row incomplete, left out of the average", () => {
      const rows = boxes(13);
      rows[4] = { ...rows[4], layeringPct: 880 };
      rows[6] = { ...rows[6], dispensingPct: -2 };
      const output = calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, M_ONLY));
      expect(output.issues).toEqual([
        {
          level: "error",
          code: "layering_out_of_range",
          message: "Layering 880% (item 5) for size M is not between 0 and 100%.",
          size: "M",
          path: ["sizes", "M", "boxes", 4, "layeringPct"],
        },
        {
          level: "error",
          code: "dispensing_out_of_range",
          message: "Dispensing -2% (item 7) for size M is not between 0 and 100%.",
          size: "M",
          path: ["sizes", "M", "boxes", 6, "dispensingPct"],
        },
      ]);
      expect(output.computed.sizes.M.layeringAverage).toBe(88);
      expect(output.result.perSize?.M).toEqual({
        status: "not_done",
        summary: `11 of 13 boxes complete (item 5 is incomplete).\n${AGED_PASSED}`,
      });
    });

    it("rejects a stickiness code the template does not have", () => {
      const rows = boxes(13);
      rows[0] = { ...rows[0], stickiness: "E" };
      const output = calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, M_ONLY));
      expect(output.issues).toEqual([
        {
          level: "error",
          code: "stickiness_code_unknown",
          message: 'Stickiness "E" (item 1) for size M is not one of this template\'s codes (A, B, B1, C, D).',
          size: "M",
          path: ["sizes", "M", "boxes", 0, "stickiness"],
        },
      ]);
      expect(output.result.perSize?.M.status).toBe("not_done");
    });

    it("warns about a box/carton number the size's sampled list does not hold, and never blocks or fails (6.2 rule 7)", () => {
      // Boxes 900 to 912; the size sampled 900 to 911 (Kenneth, 13 October 2026: box # and carton # are one number).
      const rows = boxes(13, {}, 900);
      const listed = makeTestContext({ sizes: ["M"], cartons: { M: [900, 901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911] } });
      const output = calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, listed));
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "box_not_in_carton_list",
          message: "Box/Carton #912 is not in M's sampled box/carton numbers.",
          size: "M",
          path: ["sizes", "M", "boxes", 12, "boxNo"],
        },
      ]);
      expect(output.result.perSize?.M.status).toBe("pass");
    });

    it("checks nothing while the size has no sampled list (carton sampling off or not filled in)", () => {
      const output = calcDispensingPacking(input({ sizes: { M: withAged(boxes(13, {}, 900)) } }, M_ONLY));
      expect(output.issues).toEqual([]);
      expect(output.result.perSize?.M.status).toBe("pass");
      // Another size's list is not this size's (size S, not entered, is not done and its boxes are still to come: no word).
      const other = makeTestContext({ sizes: ["S", "M"], cartons: { S: [900] } });
      expect(calcDispensingPacking(input({ sizes: { M: withAged(boxes(13, {}, 900)) } }, other)).issues).toEqual([]);
    });

    it("takes the same box/carton number in several rows without a word: one carton supplies several inner boxes", () => {
      const rows = boxes(13, { boxNo: 5 });
      expect(calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, M_ONLY)).issues).toEqual([]);
      const listed = makeTestContext({ sizes: ["M"], cartons: { M: [5, 6] } });
      const output = calcDispensingPacking(input({ sizes: { M: withAged(rows) } }, listed));
      expect(output.issues).toEqual([]);
      expect(output.result.perSize?.M.status).toBe("pass");
    });
  });

  describe("the aged sample (Kenneth, 26 October 2026: \"aged sample has not box/carton number\")", () => {
    // A size of 8 planned boxes, as on Kenneth's screen, with placeholder box/carton numbers.
    const eight = makeTestContext({ sizes: ["S"], sampling: { S: makeSampling({ packagingDispensing: 8 }) } });
    const LAYERING = [90, 90, 90, 90, 93, 90, 90, 90];
    const DISPENSING = [92, 92, 92, 92, 95, 92, 92, 92];
    const ROWS = LAYERING.map((layeringPct, index) =>
      box({ boxNo: 101 + index, layeringPct, dispensingPct: DISPENSING[index], stickiness: "A" }),
    );
    const AGED: PackingAgedSample = { layeringPct: 88, dispensingPct: 86, stickiness: "B", note: "Aged sample" };
    const BOXES_LINE = "Layering 90.4% (min. 70%), Dispensing 92.4% (min. 80%), Stickiness A: Passed.";
    const AGED_LINE = "Aged Sample: Layering 88.0% (min. 70%), Dispensing 86.0% (min. 80%), Stickiness B: Passed.";
    const sizeS = (agedSample: Partial<PackingAgedSample> | undefined, rows: PackingBox[] = ROWS, context = eight) =>
      calcDispensingPacking(
        input({ sizes: { S: agedSample === undefined ? { boxes: rows } : { boxes: rows, agedSample: { ...emptyAgedSample(), ...agedSample } } } }, context),
      );

    it("was a ninth box with no box/carton number when read into the box list, leaving the size not done", () => {
      const ninth = sizeS(undefined, [...ROWS, box({ layeringPct: 88, dispensingPct: 86, stickiness: "B", note: "Aged sample" })]);
      expect(ninth.result.perSize?.S).toEqual({
        status: "not_done",
        summary: "8 of 8 boxes complete (item 9 is incomplete).\nAged Sample is not entered yet.",
      });
      // Its values were in the averages: 90.1% and 91.7%.
      expect(formatAverage(ninth.computed.sizes.S.layeringAverage)).toBe("90.1");
      expect(formatAverage(ninth.computed.sizes.S.dispensingAverage)).toBe("91.7");
    });

    it("completes a size of 8 complete boxes, kept out of their count, code letter, averages and stickiness", () => {
      const output = sizeS(AGED);
      expect(output.result.perSize?.S).toEqual({ status: "pass", summary: `${BOXES_LINE}${SUMMARY_LINE_BREAK}${AGED_LINE}` });
      expect(output.result.summary).toBe(`Size S: ${BOXES_LINE}\n${AGED_LINE}`);
      expect(output.computed.sizes.S).toMatchObject({
        boxesExpected: 8,
        boxesTested: 8,
        boxesComplete: 8,
        codeLetter: "D",
        stickinessSummary: "A",
        stickinessCounts: { A: 8 },
        layeringResult: "pass",
        dispensingResult: "pass",
        stickinessResult: "pass",
        agedSample: { layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass", result: "pass" },
      });
      expect(output.computed.sizes.S.layeringAverage).toBeCloseTo(90.375, 10);
      expect(output.computed.sizes.S.dispensingAverage).toBeCloseTo(92.375, 10);
      expect(output.issues).toEqual([]);
      expect(boxesLineOf(output.result.perSize!.S.summary!)).toBe(BOXES_LINE);
    });

    it("fails the size when it fails a minimum or its code fails, whatever the boxes say; the boxes' checks stay theirs", () => {
      const dispensing = sizeS({ ...AGED, dispensingPct: 76 });
      expect(dispensing.result.perSize?.S).toEqual({
        status: "fail",
        summary: `${BOXES_LINE}\nAged Sample: Layering 88.0% (min. 70%), Dispensing 76.0% (min. 80%), Stickiness B: Failed (Dispensing).`,
      });
      expect(dispensing.result.status).toBe("fail");
      expect(dispensing.computed.sizes.S).toMatchObject({
        layeringResult: "pass",
        dispensingResult: "pass",
        stickinessResult: "pass",
        agedSample: { layeringResult: "pass", dispensingResult: "fail", stickinessResult: "pass", result: "fail" },
      });
      const sticky = sizeS({ ...AGED, stickiness: "D" });
      expect(sticky.result.perSize?.S.status).toBe("fail");
      expect(sticky.result.perSize?.S.summary).toContain("Aged Sample: Layering 88.0% (min. 70%), Dispensing 86.0% (min. 80%), Stickiness D: Failed (Stickiness).");
      // Its failing code is not the boxes': their stickiness passes, and their summary stays A.
      expect(sticky.computed.sizes.S).toMatchObject({ stickinessResult: "pass", stickinessSummary: "A", stickinessCounts: { A: 8 } });
      expect(sizeS({ ...AGED, layeringPct: 60 }).result.perSize?.S.summary).toContain("Stickiness B: Failed (Layering).");
      // Boxes that fail stay failed with an aged sample that passes.
      const lowBoxes = ROWS.map((row) => ({ ...row, layeringPct: 60 }));
      expect(sizeS(AGED, lowBoxes).result.perSize?.S).toEqual({
        status: "fail",
        summary: `Layering 60.0% (min. 70%), Dispensing 92.4% (min. 80%), Stickiness A: Failed (Layering).\n${AGED_LINE}`,
      });
    });

    it("judges each value as shown, at one decimal, as the averages are", () => {
      expect(sizeS({ ...AGED, layeringPct: 69.96 }).computed.sizes.S.agedSample?.layeringResult).toBe("pass");
      expect(sizeS({ ...AGED, layeringPct: 69.94 }).computed.sizes.S.agedSample?.layeringResult).toBe("fail");
      expect(sizeS({ ...AGED, dispensingPct: 80 }).result.perSize?.S.status).toBe("pass");
    });

    it("keeps the size not done while it is entered in part, with a warning at the first value missing", () => {
      const output = sizeS({ layeringPct: 88 });
      expect(output.result.perSize?.S).toEqual({ status: "not_done", summary: `${BOXES_LINE}\nAged Sample is incomplete.` });
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "aged_sample_incomplete",
          message: "Aged Sample for size S: Dispensing and Stickiness are not entered yet.",
          size: "S",
          path: ["sizes", "S", "agedSample", "dispensingPct"],
        },
      ]);
      // The boxes are done: their checks are judged; the aged sample's wait for its values.
      expect(output.computed.sizes.S).toMatchObject({
        layeringResult: "pass",
        agedSample: { layeringResult: "not_done", dispensingResult: "not_done", stickinessResult: "not_done", result: "not_done" },
      });
      // Boxes that fail stay failed while it is entered in part: a failure is never hidden.
      const lowBoxes = ROWS.map((row) => ({ ...row, layeringPct: 60 }));
      expect(sizeS({ layeringPct: 88 }, lowBoxes).result.perSize?.S.status).toBe("fail");
      // A remark alone starts it, as it starts a box row.
      expect(sizeS({ note: "Aged sample" }).issues).toEqual([
        expect.objectContaining({
          code: "aged_sample_incomplete",
          message: "Aged Sample for size S: Layering, Dispensing and Stickiness are not entered yet.",
          path: ["sizes", "S", "agedSample", "layeringPct"],
        }),
      ]);
      expect(sizeS({ layeringPct: 88, dispensingPct: 86 }).issues[0].message).toBe("Aged Sample for size S: Stickiness is not entered yet.");
    });

    it("keeps the size not done while nothing is entered in it, with a warning at its first value once the boxes are complete (Kenneth, 27 October 2026)", () => {
      // "Aged Sample?" unanswered: the warning offers No too (30 October 2026).
      for (const agedSample of [undefined, {}, { note: "  " }]) {
        const output = sizeS(agedSample);
        const where = JSON.stringify(agedSample);
        expect(output.result.perSize?.S, where).toEqual({ status: "not_done", summary: `${BOXES_LINE}\nAged Sample is not entered yet.` });
        expect(output.result.status, where).toBe("not_done");
        expect(output.computed.sizes.S.agedSample, where).toBeNull();
        // The boxes are done: their checks stand, and the size lacks its aged sample alone.
        expect(output.computed.sizes.S, where).toMatchObject({ layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass" });
        expect(output.issues, where).toEqual([
          {
            level: "warning",
            code: "aged_sample_missing",
            message: "Aged Sample for size S is not entered yet, or answer No to Aged Sample?",
            size: "S",
            path: ["sizes", "S", "agedSample", "layeringPct"],
          },
        ]);
      }
    });

    it("says so on its line while the boxes are still to come, the boxes' count saying what is left, with no warning yet", () => {
      const output = sizeS(undefined, ROWS.slice(0, 5));
      expect(output.result.perSize?.S).toEqual({ status: "not_done", summary: "5 of 8 boxes complete.\nAged Sample is not entered yet." });
      expect(output.issues).toEqual([]);
      expect(sizeS(undefined, []).result.perSize?.S).toEqual({
        status: "not_done",
        summary: "0 of 8 boxes complete.\nAged Sample is not entered yet.",
      });
    });

    it("never hides boxes that fail: an empty one, still to come, leaves the size failed, and warns", () => {
      const lowBoxes = ROWS.map((row) => ({ ...row, layeringPct: 60 }));
      const output = sizeS(undefined, lowBoxes);
      expect(output.result.perSize?.S).toEqual({
        status: "fail",
        summary: "Layering 60.0% (min. 70%), Dispensing 92.4% (min. 80%), Stickiness A: Failed (Layering).\nAged Sample is not entered yet.",
      });
      expect(output.issues.map((issue) => issue.code)).toEqual(["aged_sample_missing"]);
    });

    it("rejects a percentage out of range or a code the template lacks, as in a box row: an error at its cell, the size not done", () => {
      const output = sizeS({ ...AGED, layeringPct: 880, stickiness: "E" });
      expect(output.issues).toEqual([
        {
          level: "error",
          code: "layering_out_of_range",
          message: "Layering 880% (Aged Sample) for size S is not between 0 and 100%.",
          size: "S",
          path: ["sizes", "S", "agedSample", "layeringPct"],
        },
        {
          level: "error",
          code: "stickiness_code_unknown",
          message: 'Stickiness "E" (Aged Sample) for size S is not one of this template\'s codes (A, B, B1, C, D).',
          size: "S",
          path: ["sizes", "S", "agedSample", "stickiness"],
        },
      ]);
      expect(output.result.perSize?.S).toEqual({ status: "not_done", summary: `${BOXES_LINE}\nAged Sample is incomplete.` });
    });

    it("is judged on its own while the boxes are not done, and its line follows theirs", () => {
      const output = sizeS(AGED, ROWS.slice(0, 5));
      expect(output.result.perSize?.S).toEqual({ status: "not_done", summary: `5 of 8 boxes complete.\n${AGED_LINE}` });
      expect(output.computed.sizes.S).toMatchObject({ layeringResult: "not_done", agedSample: { result: "pass" } });
      // A failed one fails the size at once: no box still to come can undo it.
      const failed = sizeS({ ...AGED, dispensingPct: 76 }, ROWS.slice(0, 5));
      expect(failed.result.perSize?.S).toEqual({
        status: "fail",
        summary: "5 of 8 boxes complete.\nAged Sample: Layering 88.0% (min. 70%), Dispensing 76.0% (min. 80%), Stickiness B: Failed (Dispensing).",
      });
      expect(failed.computed.sizes.S).toMatchObject({ layeringResult: "not_done", agedSample: { result: "fail" } });
      // One entered in part is not done, whatever its values so far.
      expect(sizeS({ layeringPct: 60 }, ROWS.slice(0, 5)).result.perSize?.S.status).toBe("not_done");
      // Its issues follow the boxes'.
      const both = sizeS({ ...AGED, dispensingPct: -1 }, ROWS.map((row, index) => (index === 2 ? { ...row, dispensingPct: 920 } : row)));
      expect(both.issues.map((issue) => issue.path)).toEqual([
        ["sizes", "S", "boxes", 2, "dispensingPct"],
        ["sizes", "S", "agedSample", "dispensingPct"],
      ]);
    });

    it("speaks the template's wording for it", () => {
      const labels = { ...DISPENSING_PACKING_LABELS, agedSample: "Retained Sample", layeringPct: "Layering (%)" };
      const passed = calcDispensingPacking(input({ sizes: { S: { boxes: ROWS, agedSample: AGED } } }, eight, DISPENSING_PACKING_DEFAULT_CONFIG, labels));
      expect(passed.result.perSize?.S.summary).toContain(
        "\nRetained Sample: Layering (%) 88.0% (min. 70%), Dispensing 86.0% (min. 80%), Stickiness B: Passed.",
      );
      const partly = calcDispensingPacking(
        input({ sizes: { S: { boxes: ROWS, agedSample: { ...emptyAgedSample(), dispensingPct: 86 } } } }, eight, DISPENSING_PACKING_DEFAULT_CONFIG, labels),
      );
      expect(partly.issues[0].message).toBe("Retained Sample for size S: Layering (%) and Stickiness are not entered yet.");
      expect(partly.result.perSize?.S.summary).toContain("\nRetained Sample is incomplete.");
      const empty = calcDispensingPacking(input({ sizes: { S: { boxes: ROWS } } }, eight, DISPENSING_PACKING_DEFAULT_CONFIG, labels));
      expect(empty.issues[0].message).toBe("Retained Sample for size S is not entered yet, or answer No to Retained Sample?");
      const yes = calcDispensingPacking(input({ hasAgedSample: "yes", sizes: { S: { boxes: ROWS } } }, eight, DISPENSING_PACKING_DEFAULT_CONFIG, labels));
      expect(yes.issues[0].message).toBe("Retained Sample for size S is not entered yet.");
      const no = calcDispensingPacking(input({ hasAgedSample: "no", sizes: { S: { boxes: ROWS } } }, eight, DISPENSING_PACKING_DEFAULT_CONFIG, labels));
      expect(no.result.perSize?.S).toEqual({
        status: "pass",
        summary: "Layering (%) 90.4% (min. 70%), Dispensing 92.4% (min. 80%), Stickiness A: Passed.\nNo Retained Sample.",
      });
      expect(empty.result.perSize?.S.summary).toContain("\nRetained Sample is not entered yet.");
    });

    it("goes through the engine with the rest of the module, its issues stamped", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "dispensing_packing"]);
      const evaluate = (data: unknown) =>
        evaluateInspection({ template, data: { modules: { dispensing_packing: data }, custom: {} }, context: eight }, MODULE_REGISTRY);
      const passed = evaluate({ sizes: { S: { boxes: ROWS, agedSample: AGED } } }).modules.find((entry) => entry.key === "dispensing_packing")!;
      expect(passed.result).toMatchObject({ status: "pass", perSize: { S: { status: "pass" } } });
      expect(passed.issues).toEqual([]);
      const partly = evaluate({ sizes: { S: { boxes: ROWS, agedSample: { layeringPct: 88 } } } });
      expect(partly.issues.filter((issue) => issue.moduleKey === "dispensing_packing").map(({ level, code }) => [level, code])).toEqual([
        ["warning", "aged_sample_incomplete"],
        ["warning", "module_not_done"],
      ]);
      // None entered: the module is not done, its own warning first (where Pending's link goes), then the framework's.
      const empty = evaluate({ sizes: { S: { boxes: ROWS } } });
      const own = empty.modules.find((entry) => entry.key === "dispensing_packing")!;
      expect(own.result).toMatchObject({ status: "not_done", perSize: { S: { status: "not_done" } } });
      expect(own.issues.map(({ level, code, path }) => [level, code, path])).toEqual([
        ["warning", "aged_sample_missing", ["sizes", "S", "agedSample", "layeringPct"]],
        ["warning", "module_not_done", []],
      ]);
      expect(own.issues[1].message).toBe(`Glove Packing Check is not done: Size S: ${BOXES_LINE}\nAged Sample is not entered yet.`);
    });
  });

  describe('"Aged Sample?" (Kenneth, 30 October 2026: "no aged sample then turn it off and let the page complete")', () => {
    // Two sizes of 8 planned boxes, placeholder box/carton numbers.
    const two = makeTestContext({
      sizes: ["S", "M"],
      sampling: { S: makeSampling({ packagingDispensing: 8 }), M: makeSampling({ packagingDispensing: 8 }) },
    });
    const ROWS = boxes(8, { layeringPct: 90, dispensingPct: 92 }, 101);
    const BOXES_LINE = "Layering 90.0% (min. 70%), Dispensing 92.0% (min. 80%), Stickiness A: Passed.";
    const AGED: PackingAgedSample = { layeringPct: 88, dispensingPct: 86, stickiness: "B", note: "Aged sample" };
    const AGED_LINE = "Aged Sample: Layering 88.0% (min. 70%), Dispensing 86.0% (min. 80%), Stickiness B: Passed.";
    const run = (hasAgedSample: DispensingPackingData["hasAgedSample"], sizes: Record<string, PackingSize>) =>
      calcDispensingPacking(input(hasAgedSample === undefined ? { sizes } : { hasAgedSample, sizes }, two));
    /** Size S's boxes complete with no aged sample, size M's with one that passes. */
    const MIXED: Record<string, PackingSize> = { S: { boxes: ROWS }, M: { boxes: ROWS, agedSample: AGED } };

    it("unanswered, expects every size's aged sample: an empty one keeps its size not done, the warning asking for it or for No", () => {
      const output = run(undefined, MIXED);
      expect(output.result.status).toBe("not_done");
      expect(output.result.perSize).toEqual({
        S: { status: "not_done", summary: `${BOXES_LINE}\n${AGED_NOT_ENTERED}` },
        M: { status: "pass", summary: `${BOXES_LINE}\n${AGED_LINE}` },
      });
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "aged_sample_missing",
          message: "Aged Sample for size S is not entered yet, or answer No to Aged Sample?",
          size: "S",
          path: ["sizes", "S", "agedSample", "layeringPct"],
        },
      ]);
      // Null reads as unanswered, as absent does (data saved before the question).
      expect(run(null, MIXED)).toEqual(output);
      // A value entered counts as Yes: judged as ever, a failed one failing its size.
      const failed = run(undefined, { M: { boxes: ROWS, agedSample: { ...AGED, dispensingPct: 76 } } });
      expect(failed.result.perSize?.M.status).toBe("fail");
      expect(failed.computed.sizes.M.agedSample).toMatchObject({ dispensingResult: "fail", result: "fail" });
    });

    it("Yes is as before: an empty one keeps its size not done, the warning asking for it alone", () => {
      const output = run("yes", MIXED);
      expect(output.result.status).toBe("not_done");
      expect(output.result.perSize?.S).toEqual({ status: "not_done", summary: `${BOXES_LINE}\n${AGED_NOT_ENTERED}` });
      expect(output.result.perSize?.M).toEqual({ status: "pass", summary: `${BOXES_LINE}\n${AGED_LINE}` });
      expect(output.issues.map(({ code, message }) => [code, message])).toEqual([
        ["aged_sample_missing", "Aged Sample for size S is not entered yet."],
      ]);
      expect(run("yes", { S: { boxes: ROWS, agedSample: AGED }, M: { boxes: ROWS, agedSample: AGED } }).result.status).toBe("pass");
    });

    it("No with nothing entered: each size completes on its boxes alone, with no warning", () => {
      const output = run("no", { S: { boxes: ROWS }, M: { boxes: ROWS } });
      expect(output.result.status).toBe("pass");
      expect(output.result.perSize).toEqual({
        S: { status: "pass", summary: `${BOXES_LINE}\nNo Aged Sample.` },
        M: { status: "pass", summary: `${BOXES_LINE}\nNo Aged Sample.` },
      });
      expect(output.issues).toEqual([]);
      expect(output.computed.sizes.S).toMatchObject({ layeringResult: "pass", dispensingResult: "pass", stickinessResult: "pass", agedSample: null });
      expect(boxesLineOf(output.result.perSize!.S.summary!)).toBe(BOXES_LINE);
      // The boxes still decide: still to come, the size is not done; failing, it fails.
      expect(run("no", { S: { boxes: ROWS.slice(0, 5) }, M: { boxes: ROWS } }).result.perSize?.S).toEqual({
        status: "not_done",
        summary: "5 of 8 boxes complete.\nNo Aged Sample.",
      });
      const low = run("no", { S: { boxes: ROWS.map((row) => ({ ...row, dispensingPct: 70 })) }, M: { boxes: ROWS } });
      expect(low.result.perSize?.S).toEqual({
        status: "fail",
        summary: "Layering 90.0% (min. 70%), Dispensing 70.0% (min. 80%), Stickiness A: Failed (Dispensing).\nNo Aged Sample.",
      });
      expect(low.issues).toEqual([]);
    });

    it("No with values saved: they are kept and never counted, a failed, partial or wrong one changing nothing", () => {
      const sizes: Record<string, PackingSize> = {
        S: { boxes: ROWS, agedSample: { ...AGED, layeringPct: 60, stickiness: "D" } },
        M: { boxes: ROWS, agedSample: { ...emptyAgedSample(), layeringPct: 880, stickiness: "E" } },
      };
      const output = run("no", sizes);
      expect(output.result.status).toBe("pass");
      expect(output.result.perSize?.S).toEqual({ status: "pass", summary: `${BOXES_LINE}\nNo Aged Sample.` });
      expect(output.issues).toEqual([]);
      expect(output.computed.sizes.S.agedSample).toBeNull();
      expect(output.computed.sizes.M.agedSample).toBeNull();
      // Answered Yes again, they count as before.
      const yes = run("yes", sizes);
      expect(yes.result.perSize?.S.status).toBe("fail");
      expect(yes.issues.map((issue) => issue.code)).toEqual(["layering_out_of_range", "stickiness_code_unknown", "aged_sample_incomplete"]);
    });

    it("goes through the engine: No completes the module on its boxes, and the answer is Yes, No or none", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "dispensing_packing"]);
      const evaluate = (data: unknown) =>
        evaluateInspection({ template, data: { modules: { dispensing_packing: data }, custom: {} }, context: two }, MODULE_REGISTRY).modules.find(
          (entry) => entry.key === "dispensing_packing",
        )!;
      const off = evaluate({ hasAgedSample: "no", sizes: { S: { boxes: ROWS }, M: { boxes: ROWS, agedSample: { layeringPct: 60 } } } });
      expect(off.result).toMatchObject({ status: "pass", perSize: { S: { status: "pass" }, M: { status: "pass" } } });
      expect(off.issues).toEqual([]);
      // The export carries the answer with the values kept.
      expect(off.data).toMatchObject({ hasAgedSample: "no", sizes: { M: { agedSample: { layeringPct: 60 } } } });
      expect(evaluate({ hasAgedSample: "maybe", sizes: {} }).issues.map((issue) => issue.code)).toContain("invalid_data");
    });
  });

  it("speaks the template's wording in summaries, messages and the heading", () => {
    const labels = {
      ...DISPENSING_PACKING_LABELS,
      boxNo: "Box Number",
      itemColumn: "No.",
      layeringPct: "Layering (%)",
      stickiness: "Stickiness",
      heading: "Dispensing Result ({codeLetters})",
    };
    const output = calcDispensingPacking(input({ sizes: { M: withAged(boxes(13)) } }, M_ONLY, DISPENSING_PACKING_DEFAULT_CONFIG, labels));
    const wrong = boxes(13);
    wrong[1] = { ...wrong[1], layeringPct: 880 };
    expect(calcDispensingPacking(input({ sizes: { M: withAged(wrong) } }, M_ONLY, DISPENSING_PACKING_DEFAULT_CONFIG, labels)).issues[0].message).toBe(
      "Layering (%) 880% (no. 2) for size M is not between 0 and 100%.",
    );
    expect(output.result.perSize?.M.summary).toBe(
      "Layering (%) 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Passed.\n" +
        "Aged Sample: Layering (%) 85.0% (min. 70%), Dispensing 88.0% (min. 80%), Stickiness A: Passed.",
    );
    expect(packingHeading(labels, DISPENSING_PACKING_DEFAULT_CONFIG, ["C", "E"])).toBe("Dispensing Result (C & E)");
    expect(packingHeading(labels, DISPENSING_PACKING_DEFAULT_CONFIG, [])).toBe("Dispensing Result (—)");
  });

  describe("through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "carton_sampling", "dispensing_packing"]);
    const evaluate = (data: Record<string, unknown>, context: InspectionContext) =>
      evaluateInspection({ template, data: { modules: { dispensing_packing: data }, custom: {} }, context }, MODULE_REGISTRY);

    it("drops sizes not in the order with a warning, keeps their data, and warns about box 2336, never an error", () => {
      const data = { ...stdEgData(), comment: "Item 12 is box 2336." } as Record<string, unknown>;
      (data.sizes as Record<string, unknown>).XL = { boxes: boxes(5) };
      const evaluation = evaluate(data, stdEgContext());
      const own = evaluation.modules.find((entry) => entry.key === "dispensing_packing")!;
      expect(own.result).toMatchObject({ status: "pass", perSize: { M: { status: "pass" } } });
      expect(Object.keys(own.result.perSize ?? {})).toEqual(["M"]);
      expect(own.comment).toBe("Item 12 is box 2336.");
      expect(own.issues.map(({ level, code, size }) => [level, code, size])).toEqual([
        ["warning", "size_not_ordered", "XL"],
        ["warning", "box_not_in_carton_list", "M"],
      ]);
      expect(evaluation.issues.filter((issue) => issue.moduleKey === "dispensing_packing" && issue.level === "error")).toEqual([]);
    });

    it("rejects text in a numeric cell as invalid data (6.2 rule 1)", () => {
      const evaluation = evaluate({ sizes: { M: { boxes: [{ boxNo: 13, layeringPct: "2 42" }] } } }, stdEgContext());
      const own = evaluation.modules.find((entry) => entry.key === "dispensing_packing")!;
      expect(own.result.status).toBe("not_done");
      expect(own.issues).toContainEqual(
        expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "boxes", 0, "layeringPct"] }),
      );
    });

    it("is not done with nothing saved, with a warning that does not block submit", () => {
      const evaluation = evaluateInspection(
        { template, data: { modules: {}, custom: {} }, context: stdEgContext() },
        MODULE_REGISTRY,
      );
      const own = evaluation.modules.find((entry) => entry.key === "dispensing_packing")!;
      expect(own.result.status).toBe("not_done");
      expect(own.issues).toEqual([expect.objectContaining({ level: "warning", code: "module_not_done" })]);
    });
  });
});

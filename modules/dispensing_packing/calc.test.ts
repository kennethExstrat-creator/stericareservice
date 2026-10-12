import { describe, expect, it } from "vitest";
import { dataKeys } from "@/lib/coverage";
import { roundTo } from "@/lib/stats";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { cartonList, STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { calcDispensingPacking, formatAverage, packingHeading, plannedBoxes } from "./calc";
import { DISPENSING_PACKING_DEFAULT_CONFIG, DISPENSING_PACKING_LABELS, type DispensingPackingConfig } from "./config";
import { definition } from "./index";
import { DispensingPackingDataSchema, emptyPackingBox, type DispensingPackingData, type PackingBox } from "./schema";

/** The STD_EG example's packing check in this module's shape: placeholder box numbers, values as printed. */
function stdEgData(): DispensingPackingData {
  const sizes = Object.fromEntries(
    Object.entries(STD_EG_EXAMPLE.dispensingPacking.perSize).map(([size, entry]) => [
      size,
      {
        boxes: (entry?.boxes ?? []).map((box) => ({
          boxNo: box.box,
          layeringPct: box.layeringPct,
          dispensingPct: box.dispensingPct,
          stickiness: box.stickiness,
        })),
      },
    ]),
  );
  return DispensingPackingDataSchema.parse({ sizes });
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
      });
      expect([expected.minLayeringPct, expected.minDispensingPct]).toEqual([
        DISPENSING_PACKING_DEFAULT_CONFIG.minLayeringPct,
        DISPENSING_PACKING_DEFAULT_CONFIG.minDispensingPct,
      ]);
      expect(output.result).toEqual({
        status: expected.status,
        summary: "Size M: Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed.",
        perSize: {
          M: { status: "pass", summary: "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed." },
        },
      });
    });

    it("takes box 2336 as typed, though no carton has that number: no error, the size passes (6.2 rule 7)", () => {
      const data = stdEgData();
      expect(data.sizes.M.boxes[stray.item - 1].boxNo).toBe(stray.box);
      expect(stdEgContext().cartons.M).not.toContain(stray.box);
      const output = calcDispensingPacking(input(data, stdEgContext()));
      expect(stray.validation).toBe("none");
      expect(STD_EG_EXPECTED.errors.filter((issue) => issue.module === "dispensing_packing")).toEqual([]);
      expect(output.issues).toEqual([]);
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
        input({ sizes: { M: { boxes: boxes(12) }, XL: { boxes: boxes(5) } } }, context, config),
      );
      expect(output.result.perSize).toEqual({
        M: { status: "not_done", summary: "12 of 13 boxes complete." },
        XL: { status: "pass", summary: "Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Passed." },
      });
      expect(output.result.status).toBe("not_done");
      expect(output.computed.sizes.M).toMatchObject({ layeringResult: "not_done", layeringAverage: 88, codeLetter: "D" });
    });

    it("names the first incomplete row; a row needs its box number, both percentages and a code", () => {
      const missing: Partial<PackingBox>[] = [{ boxNo: null }, { layeringPct: null }, { dispensingPct: null }, { stickiness: null }];
      for (const gap of missing) {
        const rows = boxes(5);
        rows[2] = { ...rows[2], ...gap };
        const output = calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, M_ONLY, config));
        expect(output.result.perSize?.M, JSON.stringify(gap)).toEqual({
          status: "not_done",
          summary: "4 of 13 boxes complete (item 3 is incomplete).",
        });
      }
    });

    it("ignores blank rows wherever they are, and counts boxes beyond the plan", () => {
      const rows = [...boxes(6), emptyPackingBox(), ...boxes(7, {}, 7), emptyPackingBox()];
      expect(calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, M_ONLY)).result.perSize?.M.status).toBe("pass");
      const extra = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(14) } } }, M_ONLY));
      expect(extra.computed.sizes.M).toMatchObject({ boxesExpected: 13, boxesTested: 14, codeLetter: "E" });
      expect(extra.result.perSize?.M.status).toBe("pass");
    });

    it("is not done with no boxes entered or none planned", () => {
      expect(calcDispensingPacking(input({ sizes: {} }, M_ONLY)).result).toEqual({
        status: "not_done",
        summary: "Size M: 0 of 13 boxes complete.",
        perSize: { M: { status: "not_done", summary: "0 of 13 boxes complete." } },
      });
      const none = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ packagingDispensing: 0 }) } });
      expect(calcDispensingPacking(input({ sizes: { M: { boxes: boxes(13) } } }, none)).result.perSize?.M).toEqual({
        status: "not_done",
        summary: "No boxes are planned for this size.",
      });
    });
  });

  describe("results (BUILD_SPEC 6.1: averages against the minimums, any failing code fails)", () => {
    const five = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ packagingDispensing: 5 }) } });

    it("fails a size whose layering or dispensing average is below the minimum; the minimum itself passes", () => {
      const low = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(5, { layeringPct: 69 }) } } }, five));
      expect(low.result.perSize?.M).toEqual({
        status: "fail",
        summary: "Layering 69.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Failed (Layering).",
      });
      expect(low.computed.sizes.M).toMatchObject({ layeringResult: "fail", dispensingResult: "pass", stickinessResult: "pass" });
      const dispensing = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(5, { dispensingPct: 79.9 }) } } }, five));
      expect(dispensing.computed.sizes.M).toMatchObject({ dispensingResult: "fail" });
      const atMinimum = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(5, { layeringPct: 70, dispensingPct: 80 }) } } }, five));
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
      const output = calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, five));
      expect(output.computed.sizes.M).toMatchObject({
        stickinessSummary: "D",
        stickinessCounts: { A: 3, B1: 1, D: 1 },
        stickinessResult: "fail",
        layeringResult: "pass",
      });
      expect(output.result.perSize?.M).toEqual({
        status: "fail",
        summary: "Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness D: Failed (Stickiness).",
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
      expect(calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, five)).computed.sizes.M).toMatchObject({
        stickinessSummary: "C",
        stickinessResult: "pass",
      });
      expect(calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, five, strict)).result.perSize?.M.status).toBe("fail");
    });

    it("gives the module the worst size: a failed size fails it, a size not done keeps a pass from showing", () => {
      const context = makeTestContext({
        sizes: ["S", "M"],
        sampling: { S: makeSampling({ packagingDispensing: 5 }), M: makeSampling({ packagingDispensing: 5 }) },
      });
      const failed = calcDispensingPacking(
        input({ sizes: { S: { boxes: boxes(5, { stickiness: "D" }) }, M: { boxes: boxes(5) } } }, context),
      );
      expect(failed.result.status).toBe("fail");
      expect(failed.result.summary).toBe(
        "Size S: Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness D: Failed (Stickiness). " +
          "Size M: Layering 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Passed.",
      );
      const partly = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(5) } } }, context));
      expect(partly.result.status).toBe("not_done");
    });
  });

  describe("wrong data", () => {
    it("rejects a percentage outside 0 to 100: an error with a link, the row incomplete, left out of the average", () => {
      const rows = boxes(13);
      rows[4] = { ...rows[4], layeringPct: 880 };
      rows[6] = { ...rows[6], dispensingPct: -2 };
      const output = calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, M_ONLY));
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
      expect(output.result.perSize?.M).toEqual({ status: "not_done", summary: "11 of 13 boxes complete (item 5 is incomplete)." });
    });

    it("rejects a stickiness code the template does not have", () => {
      const rows = boxes(13);
      rows[0] = { ...rows[0], stickiness: "E" };
      const output = calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, M_ONLY));
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

    it("never checks a box number against the carton list, with or without one", () => {
      const rows = boxes(13, {}, 900);
      expect(calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, M_ONLY)).issues).toEqual([]);
      const listed = makeTestContext({ sizes: ["M"], cartons: { M: [900, 901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911] } });
      const output = calcDispensingPacking(input({ sizes: { M: { boxes: rows } } }, listed));
      expect(output.issues).toEqual([]);
      expect(output.result.perSize?.M.status).toBe("pass");
    });

    it("takes the same box number in two rows as typed", () => {
      const output = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(13, { boxNo: 5 }) } } }, M_ONLY));
      expect(output.issues).toEqual([]);
      expect(output.result.perSize?.M.status).toBe("pass");
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
    const output = calcDispensingPacking(input({ sizes: { M: { boxes: boxes(13) } } }, M_ONLY, DISPENSING_PACKING_DEFAULT_CONFIG, labels));
    const wrong = boxes(13);
    wrong[1] = { ...wrong[1], layeringPct: 880 };
    expect(calcDispensingPacking(input({ sizes: { M: { boxes: wrong } } }, M_ONLY, DISPENSING_PACKING_DEFAULT_CONFIG, labels)).issues[0].message).toBe(
      "Layering (%) 880% (no. 2) for size M is not between 0 and 100%.",
    );
    expect(output.result.perSize?.M.summary).toBe(
      "Layering (%) 88.0% (min. 70%), Dispensing 90.0% (min. 80%), Stickiness A: Passed.",
    );
    expect(packingHeading(labels, DISPENSING_PACKING_DEFAULT_CONFIG, ["C", "E"])).toBe("Dispensing Result (C & E)");
    expect(packingHeading(labels, DISPENSING_PACKING_DEFAULT_CONFIG, [])).toBe("Dispensing Result (—)");
  });

  describe("through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "carton_sampling", "dispensing_packing"]);
    const evaluate = (data: Record<string, unknown>, context: InspectionContext) =>
      evaluateInspection({ template, data: { modules: { dispensing_packing: data }, custom: {} }, context }, MODULE_REGISTRY);

    it("drops sizes not in the order with a warning, keeps their data, and takes box 2336 as typed", () => {
      const data = { ...stdEgData(), comment: "Item 12 is box 2336." } as Record<string, unknown>;
      (data.sizes as Record<string, unknown>).XL = { boxes: boxes(5) };
      const evaluation = evaluate(data, stdEgContext());
      const own = evaluation.modules.find((entry) => entry.key === "dispensing_packing")!;
      expect(own.result).toMatchObject({ status: "pass", perSize: { M: { status: "pass" } } });
      expect(Object.keys(own.result.perSize ?? {})).toEqual(["M"]);
      expect(own.comment).toBe("Item 12 is box 2336.");
      expect(own.issues.map(({ level, code, size }) => [level, code, size])).toEqual([["warning", "size_not_ordered", "XL"]]);
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

import { describe, expect, it } from "vitest";
import { dataField, dataKeys, sameWording } from "@/lib/coverage";
import { roundTo } from "@/lib/stats";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import {
  cartonList,
  SAFEDON_DEFECTS,
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  safedonDefectsPerBox,
  type ReportSize,
} from "@/tests/fixtures/examples";
import { calcDispensingSafedon, plannedBoxes, safedonHeading } from "./calc";
import { DISPENSING_SAFEDON_DEFAULT_CONFIG, DISPENSING_SAFEDON_LABELS, type DispensingSafedonConfig } from "./config";
import { definition } from "./index";
import { DispensingSafedonDataSchema, emptySafedonBox, type DispensingSafedonData, type SafedonBox } from "./schema";
import { formatSizeRate } from "./text";

const EXAMPLE = SAFEDON_EG_EXAMPLE.dispensingSafedon;
const ORDERED = SAFEDON_EG_EXAMPLE.sizesOrdered;

/** The SAFEDON_EG example's dispensing sheet in this module's shape: placeholder box numbers, counts as printed. */
function safedonData(): DispensingSafedonData {
  const sizes = Object.fromEntries(
    Object.entries(EXAMPLE.perSize).map(([size, entry]) => [
      size,
      {
        boxes: (entry?.boxes ?? []).map((boxNo, index) => ({
          boxNo,
          counts: Object.fromEntries(SAFEDON_DEFECTS.map((code) => [code, entry!.counts[code][index]])),
        })),
      },
    ]),
  );
  return DispensingSafedonDataSchema.parse({ sizes });
}

/** The SAFEDON_EG example's context: XS to L ordered, their carton lists, 5 / 8 / 8 / 5 packs, 125 gloves per pack. */
function safedonContext(overrides: Partial<InspectionContext> = {}): InspectionContext {
  return makeTestContext({
    sizes: ORDERED,
    cartons: Object.fromEntries(ORDERED.map((size) => [size, cartonList(SAFEDON_EG_EXAMPLE.cartons[size]!)])),
    sampling: Object.fromEntries(
      ORDERED.map((size) => [size, makeSampling({ packagingDispensing: SAFEDON_EG_EXAMPLE.sampling[size]!.dispensingInners })]),
    ),
    packing: { innerUnit: "plastic pack", glovesPerInner: 125, innersPerCase: 16, glovesPerCase: 2000 },
    ...overrides,
  });
}

function input(
  data: DispensingSafedonData,
  context: InspectionContext,
  config: DispensingSafedonConfig = DISPENSING_SAFEDON_DEFAULT_CONFIG,
  labels: Readonly<Record<string, string>> = DISPENSING_SAFEDON_LABELS,
  hasData = true,
): CalcInput<DispensingSafedonData, DispensingSafedonConfig> {
  return { data, config, title: "Glove Dispensing Inspection", labels, context, results: {}, hasData };
}

/** `count` boxes numbered from `first`, each with these counts. */
function boxes(count: number, counts: Record<string, number> = {}, first = 1): SafedonBox[] {
  return Array.from({ length: count }, (_, index) => ({ boxNo: first + index, counts: { ...counts } }));
}

const FIVE = makeTestContext({ sizes: ["XS"], sampling: { XS: makeSampling({ packagingDispensing: 5 }) } });

describe("dispensing_safedon", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("computes every value the dictionary lists as computed, per size or per box (6.2 rule 2)", () => {
    const size = calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(1) } } }, FIVE)).computed.sizes.XS;
    for (const key of dataKeys("dispensing_safedon", "computed")) {
      const perBox = dataField("dispensing_safedon", key)?.per.includes("box");
      expect(Object.keys(perBox ? size.boxes[0] : size), key).toContain(key);
    }
  });

  describe("the SAFEDON_EG example (expected results A)", () => {
    const output = calcDispensingSafedon(input(safedonData(), safedonContext()));

    it.each(ORDERED)("size %s: defects and rate per box, the size total and rate, the result", (size: ReportSize) => {
      const expected = SAFEDON_EG_EXPECTED.dispensing[size]!;
      const computed = output.computed.sizes[size];
      expect(computed.boxes.map((entry) => entry.boxNo)).toEqual(expected.boxes.map((entry) => entry.box));
      expect(computed.boxes.map((entry) => entry.boxDefects)).toEqual(expected.boxes.map((entry) => entry.defects));
      computed.boxes.forEach((entry, index) => expect(entry.boxRatePct / 100).toBeCloseTo(expected.boxes[index].rate, 12));
      expect(computed).toMatchObject({
        boxesTested: expected.boxes.length,
        totalDefects: expected.defects,
        glovesInspected: expected.gloves,
        result: expected.status,
      });
      expect(roundTo(computed.ratePct!, 2)).toBe(expected.ratePct);
      expect(DISPENSING_SAFEDON_DEFAULT_CONFIG.maxRatePct).toBe(expected.maxRatePct);
      expect(output.result.perSize?.[size]).toEqual({
        status: expected.status,
        summary: `${formatSizeRate(expected.defects, expected.gloves)}, max. 5%: Passed.`,
      });
    });

    it("prints the size totals as the report's third Total line", () => {
      expect(output.result.summary).toBe(
        "Size XS: 3 / 625 (0.48%), max. 5%: Passed. Size S: 0 / 1,000 (0%), max. 5%: Passed. " +
          "Size M: 11 / 1,000 (1.1%), max. 5%: Passed. Size L: 0 / 625 (0%), max. 5%: Passed.",
      );
      expect(output.result.status).toBe("pass");
    });

    it("corrects the original report: XS box rates from their own counts, L 0 / 625 instead of 7 / 625", () => {
      const xs = output.computed.sizes.XS;
      expect(xs.boxes.map((entry) => `${entry.boxRatePct.toFixed(1)}%`)).toEqual(["0.8%", "0.0%", "0.0%", "0.0%", "1.6%"]);
      expect(xs.boxes.map((entry) => `${entry.boxRatePct.toFixed(1)}%`)).not.toEqual(EXAMPLE.perSize.XS!.printedRatePerBox);
      expect(xs.boxes.map((entry) => entry.boxDefects)).toEqual(safedonDefectsPerBox(EXAMPLE.perSize.XS!));
      expect(EXAMPLE.perSize.L!.printedSizeTotal).toBe("7 / 625 (1.12%)");
      expect(output.computed.sizes.L).toMatchObject({ totalDefects: 0, glovesInspected: 625, ratePct: 0 });
    });

    it("counts the boxes that failed and the defects per code", () => {
      expect(ORDERED.map((size) => output.computed.sizes[size].boxesFailed)).toEqual([2, 0, 5, 0]);
      expect(output.computed.sizes.XS.defectCounts).toEqual({
        no_cuff: 2,
        finger_out: 0,
        multiple_out: 0,
        stuck: 0,
        sticky: 1,
        faulty_cuff: 0,
      });
      expect(output.computed.sizes.M.defectCounts.sticky).toBe(11);
    });

    it("raises no error and no warning: every box is in its size's carton list", () => {
      expect(SAFEDON_EG_EXPECTED.errors).toEqual([]);
      expect(output.issues).toEqual([]);
    });

    it("prints the heading with the code letters of the boxes tested: C & D, as the report does", () => {
      expect(ORDERED.map((size) => output.computed.sizes[size].codeLetter)).toEqual(["C", "D", "D", "C"]);
      expect(output.computed.codeLetters).toEqual(["C", "D"]);
      // The report's heading, its words in Title Case (docs/DESIGN.md).
      const heading = safedonHeading(DISPENSING_SAFEDON_LABELS, output.computed.codeLetters);
      expect(heading).toBe("Glove Dispensing Inspection (Sampling Code Letter C & D)");
      expect(sameWording(EXAMPLE.printedTitle, heading)).toBe(true);
    });
  });

  describe("box columns (BUILD_SPEC 6.1 boxes per size)", () => {
    it("takes the sampling plan's inner units for dispensing, else the template's columns for the size, else its default", () => {
      const config = { ...DISPENSING_SAFEDON_DEFAULT_CONFIG, boxesPerSize: { default: 13, bySize: { XS: 5 } } };
      const context = makeTestContext({ sizes: ["XS", "S", "M"], sampling: { M: makeSampling({ packagingDispensing: 8 }) } });
      expect(plannedBoxes(context, config, "M")).toBe(8);
      expect(plannedBoxes(context, config, "XS")).toBe(5);
      expect(plannedBoxes(context, config, "S")).toBe(13);
    });

    it("is not done until the planned boxes are tested, never passed on part of them (6.2 rule 5)", () => {
      const context = makeTestContext({ sizes: ["XS"] });
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(5) } } }, context));
      expect(output.result).toEqual({
        status: "not_done",
        summary: "Size XS: 5 of 13 boxes tested.",
        perSize: { XS: { status: "not_done", summary: "5 of 13 boxes tested." } },
      });
      expect(output.computed.sizes.XS).toMatchObject({ boxesTested: 5, glovesInspected: 625, ratePct: 0, result: "not_done" });
    });

    it("is not done while a column has defects counted but no box number, and leaves them out of the total", () => {
      const rows = boxes(5);
      rows[1] = { boxNo: null, counts: { sticky: 2 } };
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: [...rows, ...boxes(1, {}, 9)] } } }, FIVE));
      expect(output.result.perSize?.XS).toEqual({
        status: "not_done",
        summary: "5 of 5 boxes tested; Box # missing in column 2, which has defects counted.",
      });
      expect(output.computed.sizes.XS).toMatchObject({ boxesTested: 5, totalDefects: 0 });
      expect(output.computed.sizes.XS.boxes[1]).toEqual({ boxNo: null, boxDefects: 2, boxRatePct: 1.6 });
    });

    it("ignores blank columns and counts boxes beyond the plan", () => {
      const rows = [...boxes(2), emptySafedonBox(), ...boxes(4, { stuck: 1 }, 3)];
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: rows } } }, FIVE));
      expect(output.computed.sizes.XS).toMatchObject({
        boxesTested: 6,
        boxesFailed: 4,
        totalDefects: 4,
        glovesInspected: 750,
        codeLetter: "C",
      });
      expect(output.result.perSize?.XS).toEqual({ status: "pass", summary: "4 / 750 (0.53%), max. 5%: Passed." });
    });

    it("is not done with no boxes entered or none planned", () => {
      expect(calcDispensingSafedon(input({ sizes: {} }, FIVE)).result.perSize?.XS).toEqual({
        status: "not_done",
        summary: "0 of 5 boxes tested.",
      });
      expect(calcDispensingSafedon(input({ sizes: {} }, FIVE)).computed.sizes.XS.ratePct).toBeNull();
      const none = makeTestContext({ sizes: ["XS"], sampling: { XS: makeSampling({ packagingDispensing: 0 }) } });
      expect(calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(5) } } }, none)).result.perSize?.XS).toEqual({
        status: "not_done",
        summary: "No boxes are planned for this size.",
      });
    });
  });

  describe("result: the size rate against the maximum", () => {
    const hundred = { ...DISPENSING_SAFEDON_DEFAULT_CONFIG, glovesPerPack: 100 };

    it("passes a rate equal to the maximum and fails one above it", () => {
      const at = boxes(5, { sticky: 5 });
      expect(calcDispensingSafedon(input({ sizes: { XS: { boxes: at } } }, FIVE, hundred)).result.perSize?.XS).toEqual({
        status: "pass",
        summary: "25 / 500 (5%), max. 5%: Passed.",
      });
      const above = boxes(5, { sticky: 5 });
      above[0] = { boxNo: 1, counts: { sticky: 5, stuck: 1 } };
      expect(calcDispensingSafedon(input({ sizes: { XS: { boxes: above } } }, FIVE, hundred)).result.perSize?.XS).toEqual({
        status: "fail",
        summary: "26 / 500 (5.2%), max. 5%: Failed.",
      });
    });

    it("adds every defect of the template, whichever defect it is", () => {
      const counts = Object.fromEntries(DISPENSING_SAFEDON_DEFAULT_CONFIG.defects.map((defect) => [defect.code, 1]));
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(5, counts) } } }, FIVE));
      expect(output.computed.sizes.XS).toMatchObject({ totalDefects: 30, ratePct: 4.8, boxesFailed: 5, result: "pass" });
      expect(output.computed.sizes.XS.boxes[0]).toEqual({ boxNo: 1, boxDefects: 6, boxRatePct: 4.8 });
    });

    it("judges the rate as shown, at two decimals", () => {
      const big = { ...DISPENSING_SAFEDON_DEFAULT_CONFIG, glovesPerPack: 10_000 };
      const three = makeTestContext({ sizes: ["XS"], sampling: { XS: makeSampling({ packagingDispensing: 3 }) } });
      const rows = boxes(3, { sticky: 500 });
      rows[0] = { boxNo: 1, counts: { sticky: 501 } };
      // 1,501 of 30,000 is 5.0033%, shown as 5%.
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: rows } } }, three, big));
      expect(output.computed.sizes.XS.ratePct).toBeCloseTo(5.00333, 4);
      expect(output.result.perSize?.XS).toEqual({ status: "pass", summary: "1,501 / 30,000 (5%), max. 5%: Passed." });
    });

    it("uses the template's maximum and gloves per pack", () => {
      const strict = { ...DISPENSING_SAFEDON_DEFAULT_CONFIG, maxRatePct: 0.5 };
      const rows = boxes(5);
      rows[0] = { boxNo: 1, counts: { no_cuff: 4 } };
      expect(calcDispensingSafedon(input({ sizes: { XS: { boxes: rows } } }, FIVE, strict)).result.perSize?.XS).toEqual({
        status: "fail",
        summary: "4 / 625 (0.64%), max. 0.5%: Failed.",
      });
    });

    it("gives the module the worst size", () => {
      const context = makeTestContext({
        sizes: ["XS", "S"],
        sampling: { XS: makeSampling({ packagingDispensing: 5 }), S: makeSampling({ packagingDispensing: 5 }) },
      });
      const output = calcDispensingSafedon(
        input({ sizes: { XS: { boxes: boxes(5, { stuck: 10 }) }, S: { boxes: boxes(5) } } }, context),
      );
      expect(output.result.status).toBe("fail");
      expect(output.result.summary).toBe(
        "Size XS: 50 / 625 (8%), max. 5%: Failed. Size S: 0 / 625 (0%), max. 5%: Passed.",
      );
    });
  });

  describe("wrong data", () => {
    it("rejects a box that is not in the size's carton list: an error with a link; the rate stands (6.2 rule 7)", () => {
      const listed = makeTestContext({
        sizes: ["XS"],
        sampling: { XS: makeSampling({ packagingDispensing: 5 }) },
        cartons: { XS: [1, 2, 3, 4, 6] },
      });
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(5) } } }, listed));
      expect(output.issues).toEqual([
        {
          level: "error",
          code: "box_not_in_carton_list",
          message: "Box 5 (column 5) is not in the size XS carton list.",
          size: "XS",
          path: ["sizes", "XS", "boxes", 4, "boxNo"],
        },
      ]);
      expect(output.result.perSize?.XS.status).toBe("pass");
    });

    it("takes any box number while the size has no carton list yet", () => {
      expect(calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(5, {}, 700) } } }, FIVE)).issues).toEqual([]);
    });

    it("warns about a count under a defect the template does not list, and leaves it out", () => {
      const rows = boxes(5);
      rows[2] = { boxNo: 3, counts: { torn_pack: 2, sticky: 1 } };
      const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: rows } } }, FIVE));
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "defect_not_in_template",
          message: '2 "torn_pack" counted in column 3 for size XS is not a defect of this template and is left out of the total.',
          size: "XS",
          path: ["sizes", "XS", "boxes", 2, "counts", "torn_pack"],
        },
      ]);
      expect(output.computed.sizes.XS.totalDefects).toBe(1);
    });

    it("warns when gloves per pack differs from the packing configuration's gloves per inner unit", () => {
      const packing = { innerUnit: "inner box", glovesPerInner: 100, innersPerCase: 20, glovesPerCase: 2000 };
      const context = makeTestContext({ ...FIVE, packing });
      const data = { sizes: { XS: { boxes: boxes(5) } } };
      expect(calcDispensingSafedon(input(data, context)).issues).toEqual([
        {
          level: "warning",
          code: "gloves_per_pack_mismatch",
          message:
            "Glove Dispensing Inspection: the rates use 125 gloves per pack, but the packing configuration has 100 gloves per inner unit.",
          path: [],
        },
      ]);
      expect(calcDispensingSafedon(input(data, context, DISPENSING_SAFEDON_DEFAULT_CONFIG, DISPENSING_SAFEDON_LABELS, false)).issues).toEqual([]);
      expect(calcDispensingSafedon(input(data, FIVE)).issues).toEqual([]);
    });
  });

  it("speaks the template's wording in messages and the heading", () => {
    const labels = { ...DISPENSING_SAFEDON_LABELS, boxNo: "Pack No.", heading: "Dispensing ({codeLetters})" };
    const rows = boxes(5);
    rows[0] = { boxNo: null, counts: { sticky: 1 } };
    const output = calcDispensingSafedon(input({ sizes: { XS: { boxes: rows } } }, FIVE, DISPENSING_SAFEDON_DEFAULT_CONFIG, labels));
    expect(output.result.perSize?.XS.summary).toBe("4 of 5 boxes tested; Pack No. missing in column 1, which has defects counted.");
    const listed = makeTestContext({ ...FIVE, cartons: { XS: [1] } });
    expect(calcDispensingSafedon(input({ sizes: { XS: { boxes: boxes(2) } } }, listed, DISPENSING_SAFEDON_DEFAULT_CONFIG, labels)).issues[0].message).toBe(
      "Pack No. 2 (column 2) is not in the size XS carton list.",
    );
    expect(safedonHeading(labels, ["C", "D", "E"])).toBe("Dispensing (C, D & E)");
  });

  describe("through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", "carton_sampling", "dispensing_safedon"]);
    const evaluate = (data: unknown, context: InspectionContext) =>
      evaluateInspection({ template, data: { modules: { dispensing_safedon: data }, custom: {} }, context }, MODULE_REGISTRY);

    it("shows only the ordered sizes, warns about the data of a size not ordered, and keeps it (6.2 rule 4)", () => {
      const data = safedonData();
      const saved = { sizes: { ...data.sizes, XL: { boxes: boxes(5, { sticky: 9 }) } } };
      const own = evaluate(saved, safedonContext()).modules.find((entry) => entry.key === "dispensing_safedon")!;
      expect(own.result.status).toBe("pass");
      expect(Object.keys(own.result.perSize ?? {})).toEqual([...ORDERED]);
      expect(own.issues.map(({ level, code, size }) => [level, code, size])).toEqual([["warning", "size_not_ordered", "XL"]]);
    });

    it("rejects a count saved as text, such as 1/80 (6.2 rule 1)", () => {
      const own = evaluate({ sizes: { XS: { boxes: [{ boxNo: 1, counts: { sticky: "1/80" } }] } } }, safedonContext()).modules.find(
        (entry) => entry.key === "dispensing_safedon",
      )!;
      expect(own.result.status).toBe("not_done");
      expect(own.issues).toContainEqual(
        expect.objectContaining({ code: "invalid_data", path: ["sizes", "XS", "boxes", 0, "counts", "sticky"] }),
      );
    });

    it("is not done, with a warning, until every ordered size is tested", () => {
      const data = safedonData();
      delete (data.sizes as Partial<typeof data.sizes>).M;
      const own = evaluate(data, safedonContext()).modules.find((entry) => entry.key === "dispensing_safedon")!;
      expect(own.result).toMatchObject({ status: "not_done", perSize: { M: { status: "not_done", summary: "0 of 8 boxes tested." } } });
      expect(own.issues).toEqual([expect.objectContaining({ level: "warning", code: "module_not_done" })]);
    });
  });
});

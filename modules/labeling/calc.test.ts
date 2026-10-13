import { describe, expect, it } from "vitest";
import { labelOverrides, moduleConfig, sameWording } from "@/lib/coverage";
import { STATUS_LABEL } from "@/lib/design/status";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type CalcInput, type InspectionContext } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import {
  SAFEDON_EG_EXAMPLE,
  SAFEDON_EG_EXPECTED,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type LabelingEntry,
  type LabelingSection,
  type ReportSize,
} from "@/tests/fixtures/examples";
import { calcLabeling, checkLabel, levelFieldLabel, levelLabel, levelTotal } from "./calc";
import { LABELING_DEFAULT_CONFIG, LABELING_LABELS, LabelingConfigSchema, type LabelingConfig } from "./config";
import { definition } from "./index";
import { emptyLabeling, emptyLabelingSize, type LabelingData, type LabelingLevelData, type LabelingSizeData } from "./schema";

const SAFEDON_CONFIG = LabelingConfigSchema.parse(moduleConfig("SAFEDON_EG", "labeling"));
const SAFEDON_LABELS = { ...LABELING_LABELS, ...labelOverrides("SAFEDON_EG", "labeling") };

/** The report's labelling section in the module's data shape: one entry per size it filled in. */
function fromFixture(section: LabelingSection, sizes: readonly ReportSize[]): LabelingData {
  const level = (entry: LabelingEntry | undefined): LabelingLevelData =>
    entry ? { inspected: entry.inspected, boxNos: [], defects: { ...entry.defects } } : emptyLabelingSize().inner;
  return {
    sizes: Object.fromEntries(
      sizes.map((size) => [size, { inner: level(section.inner.perSize[size]), carton: level(section.carton.perSize[size]) }]),
    ),
  };
}

function level(patch: Partial<LabelingLevelData>): LabelingLevelData {
  return { ...emptyLabelingSize().inner, ...patch };
}

/** Size M with both levels at the plan and no defects, as the STD_EG example. */
function sizeM(patch: Partial<LabelingSizeData> = {}): LabelingData {
  return { sizes: { M: { inner: level({ inspected: 3 }), carton: level({ inspected: 1 }), ...patch } } };
}

function input(
  data: LabelingData,
  {
    config = LABELING_DEFAULT_CONFIG,
    labels = LABELING_LABELS,
    context = makeTestContext({ sizes: ["M"] }),
  }: { config?: LabelingConfig; labels?: Readonly<Record<string, string>>; context?: InspectionContext } = {},
): CalcInput<LabelingData, LabelingConfig> {
  return { data, config, title: "Packaging Labeling Inspection", labels, context, results: {}, hasData: true };
}

function withCarton(patch: Partial<LabelingConfig["levels"]["carton"]>): LabelingConfig {
  const { levels } = LABELING_DEFAULT_CONFIG;
  return { levels: { ...levels, carton: { ...levels.carton, ...patch } } };
}

describe("labeling", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  describe("example reports (docs/examples/expected-results.md)", () => {
    it("B. STD_EG, labelling M: 3 dispenser boxes and 1 carton, 0 defects, pass", () => {
      const expected = STD_EG_EXPECTED.labeling.M!;
      const data = fromFixture(STD_EG_EXAMPLE.labeling, STD_EG_EXAMPLE.sizesOrdered);
      expect(data.sizes.M.inner.inspected).toBe(expected.inner.n);
      expect(data.sizes.M.carton.inspected).toBe(expected.carton.n);

      const output = calcLabeling(input(data));
      expect(output.result).toEqual({
        status: expected.status,
        summary: "No defects in size M.",
        perSize: { M: { status: "pass", summary: "Dispenser Box: 0 defects in 3; Carton Box: 0 defects in 1." } },
      });
      expect(output.computed).toEqual({
        sizes: {
          M: {
            inner: { accept: 0, reject: 1, total: expected.inner.defects, result: "pass" },
            carton: { accept: 0, reject: 1, total: expected.carton.defects, result: "pass" },
          },
        },
      });
      expect(output.issues).toEqual([]);
    });

    it("A. SAFEDON_EG, labelling: inner 3 and carton 1 per size, 0 defects, pass, in the client's wording", () => {
      const data = fromFixture(SAFEDON_EG_EXAMPLE.labeling, SAFEDON_EG_EXAMPLE.sizesOrdered);
      const context = makeTestContext({ sizes: SAFEDON_EG_EXAMPLE.sizesOrdered });
      const output = calcLabeling(input(data, { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS, context }));

      expect(output.result.status).toBe("pass");
      expect(output.result.summary).toBe("No defects in sizes XS, S, M, L.");
      for (const size of SAFEDON_EG_EXAMPLE.sizesOrdered) {
        const expected = SAFEDON_EG_EXPECTED.labeling[size]!;
        expect(output.result.perSize?.[size]).toEqual({
          status: expected.status,
          summary: "Inner Boxes/Packs: 0 defects in 3; Carton Boxes: 0 defects in 1.",
        });
        expect(output.computed.sizes[size]).toEqual({
          inner: { accept: 0, reject: 1, total: expected.inner.defects, result: "pass" },
          carton: { accept: 0, reject: 1, total: expected.carton.defects, result: "pass" },
        });
      }
      expect(output.issues).toEqual([]);
    });

    it("prints the reports' check rows from each template's config, in Title Case, expiry date on SAFEDON_EG only", () => {
      const printsRows = (config: LabelingConfig, level: "inner" | "carton", printed: readonly { code: string; label: string }[]) => {
        const rows = config.levels[level].checks.map((check) => ({ code: check.code, label: checkLabel({}, level, check) }));
        expect(rows.map((row) => row.code)).toEqual(printed.map((row) => row.code));
        // The report's words, their first letters in capitals (docs/DESIGN.md).
        rows.forEach((row, index) => expect(sameWording(printed[index].label, row.label), row.label).toBe(true));
      };
      printsRows(LABELING_DEFAULT_CONFIG, "inner", STD_EG_EXAMPLE.labeling.inner.rows);
      printsRows(LABELING_DEFAULT_CONFIG, "carton", STD_EG_EXAMPLE.labeling.carton.rows);
      printsRows(SAFEDON_CONFIG, "inner", SAFEDON_EG_EXAMPLE.labeling.inner.rows);
      printsRows(SAFEDON_CONFIG, "carton", SAFEDON_EG_EXAMPLE.labeling.carton.rows);
    });

    it("computes what both reports print per level and size: heading, limit, total and disposition", () => {
      const reports = [
        { example: STD_EG_EXAMPLE, config: LABELING_DEFAULT_CONFIG, labels: LABELING_LABELS },
        { example: SAFEDON_EG_EXAMPLE, config: SAFEDON_CONFIG, labels: SAFEDON_LABELS },
      ];
      for (const { example, config, labels } of reports) {
        const context = makeTestContext({ sizes: example.sizesOrdered });
        const data = fromFixture(example.labeling, example.sizesOrdered);
        const output = calcLabeling(input(data, { config, labels, context }));
        for (const level of ["inner", "carton"] as const) {
          const printed = example.labeling[level];
          expect(levelLabel(labels, level)).toBe(printed.printedTitle);
          for (const size of example.sizesOrdered) {
            const entry = printed.perSize[size]!;
            const computed = output.computed.sizes[size][level];
            expect({ accept: computed.accept, reject: computed.reject }).toEqual(entry.printedLimit);
            expect(String(computed.total)).toBe(entry.printedTotal);
            // The chip in the disposition row says what the report prints.
            expect(STATUS_LABEL[computed.result]).toBe(entry.printedResult);
          }
        }
      }
    });

    it("words the disposition lines as printed, with STD_EG's carton line [sic] fixed", () => {
      expect(levelFieldLabel(LABELING_LABELS, "inner", "result")).toBe(STD_EG_EXAMPLE.labeling.inner.printedResultLabel);
      expect(STD_EG_EXAMPLE.labeling.carton.printedResultLabel).toBe("Disposition - Inner Box (Passed / Failed)");
      expect(levelFieldLabel(LABELING_LABELS, "carton", "result")).toBe("Disposition - Carton Box (Passed / Failed)");
      for (const level of ["inner", "carton"] as const) {
        expect(levelFieldLabel(SAFEDON_LABELS, level, "result")).toBe(SAFEDON_EG_EXAMPLE.labeling[level].printedResultLabel);
      }
    });

    it("B. sizes not ordered (XS, S, L, XL): no tables, no results, although the report printed Passed for them", () => {
      // The report's pre-filled columns for S, L and XL, as if they had been entered.
      const printed = STD_EG_EXAMPLE.unorderedSizes.filter((cells) => cells.section.startsWith("labeling."));
      const unordered = [...new Set(printed.map((cells) => cells.size))];
      expect(unordered).toEqual(["S", "L", "XL"]);
      const ghost = { inner: level({ inspected: 3 }), carton: level({ inspected: 1 }) };
      const data = { sizes: { ...sizeM().sizes, ...Object.fromEntries(unordered.map((size) => [size, ghost])) } };

      const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "header", include: false }, "labeling"]);
      const evaluation = evaluateInspection(
        { template, data: { modules: { labeling: data }, custom: {} }, context: makeTestContext({ sizes: ["M"] }) },
        MODULE_REGISTRY,
      );
      const labeling = evaluation.modules.find((entry) => entry.key === "labeling")!;
      expect(Object.keys(labeling.result.perSize ?? {})).toEqual(["M"]);
      expect(labeling.result.status).toBe("pass");
      expect(Object.keys((labeling.computed as { sizes: object }).sizes)).toEqual(["M"]);
      expect(labeling.issues.map((issue) => [issue.code, issue.size])).toEqual([
        ["size_not_ordered", "S"],
        ["size_not_ordered", "L"],
        ["size_not_ordered", "XL"],
      ]);
      for (const size of STD_EG_EXPECTED.unorderedSizes.sizes) expect(labeling.result.perSize).not.toHaveProperty(size);
    });
  });

  describe("not done until the boxes inspected are recorded (6.2 rule 5)", () => {
    it("is not done with nothing recorded for an ordered size, never passed", () => {
      const output = calcLabeling(input(emptyLabeling()));
      expect(output.result).toEqual({
        status: "not_done",
        summary: "Not recorded: size M (Dispenser Box, Carton Box).",
        perSize: { M: { status: "not_done", summary: "Dispenser Box: not recorded; Carton Box: not recorded." } },
      });
      expect(output.computed.sizes.M).toEqual({
        inner: { accept: 0, reject: 1, total: 0, result: "not_done" },
        carton: { accept: 0, reject: 1, total: 0, result: "not_done" },
      });
    });

    it("is not done while one level or one size is missing", () => {
      const carton = calcLabeling(input(sizeM({ carton: level({}) })));
      expect(carton.result.status).toBe("not_done");
      expect(carton.result.summary).toBe("Not recorded: size M (Carton Box).");

      const context = makeTestContext({ sizes: ["S", "M"] });
      const missingSize = calcLabeling(input(sizeM(), { context }));
      expect(missingSize.result.status).toBe("not_done");
      expect(missingSize.result.perSize).toEqual({
        S: { status: "not_done", summary: "Dispenser Box: not recorded; Carton Box: not recorded." },
        M: { status: "pass", summary: "Dispenser Box: 0 defects in 3; Carton Box: 0 defects in 1." },
      });
    });

    it("counts 0 boxes inspected as not done: nothing was inspected", () => {
      const output = calcLabeling(input(sizeM({ inner: level({ inspected: 0 }) })));
      expect(output.result).toEqual({
        status: "not_done",
        summary: "No boxes inspected: size M (Dispenser Box).",
        perSize: { M: { status: "not_done", summary: "Dispenser Box: no boxes inspected; Carton Box: 0 defects in 1." } },
      });
      expect(output.computed.sizes.M.inner.result).toBe("not_done");
    });

    it("is not done with no size ordered", () => {
      const output = calcLabeling(input(sizeM(), { context: makeTestContext() }));
      expect(output.result).toEqual({ status: "not_done", summary: "No sizes ordered yet.", perSize: {} });
    });
  });

  describe("any defect fails (Accept 0 / Reject 1)", () => {
    it("fails a level with one defect, naming the check in the template's wording", () => {
      const output = calcLabeling(input(sizeM({ carton: level({ inspected: 1, defects: { carton_no: 1 } }) })));
      expect(output.result).toEqual({
        status: "fail",
        summary: "Failed: size M Carton Box 1 defect (No Box/Carton # Printed 1).",
        perSize: { M: { status: "fail", summary: "Dispenser Box: 0 defects in 3; Carton Box: 1 defect in 1." } },
      });
      expect(output.computed.sizes.M.carton).toEqual({ accept: 0, reject: 1, total: 1, result: "fail" });
      expect(output.computed.sizes.M.inner.result).toBe("pass");
    });

    it("adds the defects of every check into the level's total", () => {
      const defects = { lot_no: 1, mfg_date: 2, artwork: 1 };
      const output = calcLabeling(input(sizeM({ inner: level({ inspected: 3, defects }) })));
      expect(output.computed.sizes.M.inner.total).toBe(4);
      expect(output.result.summary).toBe(
        "Failed: size M Dispenser Box 4 defects (Wrong / No Lot Number 1, Wrong / No Mfg. Date 2, Wrong Artwork Print 1).",
      );
    });

    it("fails on a defect even before the boxes inspected are recorded, and asks for the count", () => {
      const output = calcLabeling(input(sizeM({ inner: level({ defects: { lot_no: 1 } }) })));
      expect(output.result.perSize?.M).toEqual({
        status: "fail",
        summary: "Dispenser Box: 1 defect, boxes inspected not recorded; Carton Box: 0 defects in 1.",
      });
      // Failed, so not "not done": without this the empty count would reach the report unflagged.
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "labeling_inspected_missing",
          message: "Dispenser Box, size M: 1 defect found but the boxes inspected are not recorded.",
          size: "M",
          path: ["sizes", "M", "inner", "inspected"],
        },
      ]);
      // Once recorded, the warning goes; a level with nothing found and no count is simply not done.
      expect(calcLabeling(input(sizeM({ inner: level({ inspected: 3, defects: { lot_no: 1 } }) }))).issues).toEqual([]);
      expect(calcLabeling(input(sizeM({ inner: level({}) }))).issues).toEqual([]);
    });

    it("flags the missing count through the engine too, on every failed level without one", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "header", include: false }, "labeling"]);
      const data = {
        modules: { labeling: { sizes: { M: { inner: { defects: { lot_no: 1 } }, carton: { defects: { carton_no: 2 } } } } } },
        custom: {},
      };
      const evaluation = evaluateInspection({ template, data, context: makeTestContext({ sizes: ["M"] }) }, MODULE_REGISTRY);
      const labeling = evaluation.modules.find((entry) => entry.key === "labeling")!;
      expect(labeling.result.status).toBe("fail");
      expect(labeling.issues.map((issue) => [issue.level, issue.code, issue.path])).toEqual([
        ["warning", "labeling_inspected_missing", ["sizes", "M", "inner", "inspected"]],
        ["warning", "labeling_inspected_missing", ["sizes", "M", "carton", "inspected"]],
      ]);
    });

    it("reports failures before what is not recorded, and fails the module for the worst size", () => {
      const context = makeTestContext({ sizes: ["S", "M"] });
      const output = calcLabeling(
        input(sizeM({ inner: level({ inspected: 3, defects: { artwork: 1 } }) }), { context }),
      );
      expect(output.result.status).toBe("fail");
      expect(output.result.summary).toBe(
        "Failed: size M Dispenser Box 1 defect (Wrong Artwork Print 1). Not recorded: size S (Dispenser Box, Carton Box).",
      );
    });

    it("judges only the checks the template lists for the level", () => {
      // STD_EG checks no expiry date: a count saved against it is not a defect there.
      const data = sizeM({ inner: level({ inspected: 3, defects: { expiry_date: 2 } }) });
      expect(calcLabeling(input(data)).result.status).toBe("pass");
      expect(levelTotal(LABELING_DEFAULT_CONFIG.levels.inner, data.sizes.M.inner)).toBe(0);
      // SAFEDON_EG checks it at both levels.
      const safedon = calcLabeling(input(data, { config: SAFEDON_CONFIG, labels: SAFEDON_LABELS }));
      expect(safedon.result.summary).toBe("Failed: size M Inner Boxes/Packs 2 defects (Wrong / No Expiry Date 2).");
    });
  });

  describe("the plan: n per level from the template", () => {
    it("warns when fewer boxes were inspected than planned, and passes the level's disposition", () => {
      const output = calcLabeling(input(sizeM({ inner: level({ inspected: 2 }) })));
      expect(output.result).toEqual({
        status: "warn",
        summary: "No defects in size M. Fewer boxes inspected than planned: size M Dispenser Box 2 of 3.",
        perSize: { M: { status: "warn", summary: "Dispenser Box: 0 defects in 2 (plan 3); Carton Box: 0 defects in 1." } },
      });
      expect(output.computed.sizes.M.inner.result).toBe("pass");
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "labeling_below_plan",
          message: "Dispenser Box, size M: 2 boxes inspected; the plan is 3.",
          size: "M",
          path: ["sizes", "M", "inner", "inspected"],
        },
      ]);
    });

    it("keeps a failure a failure when fewer were inspected", () => {
      const output = calcLabeling(input(sizeM({ inner: level({ inspected: 1, defects: { lot_no: 1 } }) })));
      expect(output.result.status).toBe("fail");
      expect(output.issues.map((issue) => issue.code)).toEqual(["labeling_below_plan"]);
    });

    it("passes when more boxes were inspected than planned", () => {
      const output = calcLabeling(input(sizeM({ inner: level({ inspected: 5 }), carton: level({ inspected: 2 }) })));
      expect(output.result.status).toBe("pass");
      expect(output.issues).toEqual([]);
    });

    it("follows the template's n", () => {
      const config = withCarton({ n: 2 });
      expect(calcLabeling(input(sizeM(), { config })).result.status).toBe("warn");
    });
  });

  describe("levels and checks on and off", () => {
    it("judges only the levels the template inspects; data kept for a level switched off is ignored", () => {
      const config = withCarton({ include: false });
      const output = calcLabeling(input(sizeM({ carton: level({ defects: { carton_no: 3 } }) }), { config }));
      expect(output.result).toEqual({
        status: "pass",
        summary: "No defects in size M.",
        perSize: { M: { status: "pass", summary: "Dispenser Box: 0 defects in 3." } },
      });
      expect(output.computed.sizes.M).toEqual({ inner: { accept: 0, reject: 1, total: 0, result: "pass" } });
    });

    it("is info when the template switches both levels off", () => {
      const { levels } = LABELING_DEFAULT_CONFIG;
      const config = { levels: { inner: { ...levels.inner, include: false }, carton: { ...levels.carton, include: false } } };
      const output = calcLabeling(input(sizeM(), { config }));
      expect(output.result).toEqual({
        status: "info",
        summary: "No labelling levels are switched on.",
        perSize: { M: { status: "info", summary: "No levels are inspected." } },
      });
      expect(output.computed).toEqual({ sizes: { M: {} } });
    });
  });

  describe("box/carton numbers: the size's sampled ones, an unlisted one a warning (6.2 rule 7; Kenneth, 13 October 2026)", () => {
    const context = makeTestContext({ sizes: ["M"], cartons: { M: [13, 299, 337, 2236] } });

    it("warns about a number the size's sampled list does not hold, at either level, and still passes", () => {
      const data = sizeM({ inner: level({ inspected: 3, boxNos: [13, 13, 2336] }), carton: level({ inspected: 1, boxNos: [9001] }) });
      const output = calcLabeling(input(data, { context }));
      expect(output.result.status).toBe("pass");
      // Inner boxes may share a number (13 twice): one carton supplies several.
      expect(output.issues).toEqual([
        {
          level: "warning",
          code: "box_not_in_carton_list",
          message: "Box/Carton #2336 is not in M's sampled box/carton numbers.",
          size: "M",
          path: ["sizes", "M", "inner", "boxNos", 2],
        },
        {
          level: "warning",
          code: "box_not_in_carton_list",
          message: "Box/Carton #9001 is not in M's sampled box/carton numbers.",
          size: "M",
          path: ["sizes", "M", "carton", "boxNos", 0],
        },
      ]);
    });

    it("checks nothing while the size has no sampled list (carton sampling off or not filled in)", () => {
      const data = sizeM({ inner: level({ inspected: 3, boxNos: [13, 13, 2336] }), carton: level({ inspected: 1, boxNos: [9001] }) });
      expect(calcLabeling(input(data)).issues).toEqual([]);
    });

    it("needs no box numbers: the reports print only how many were inspected", () => {
      expect(calcLabeling(input(sizeM(), { context })).issues).toEqual([]);
    });

    it("rejects a box entered twice at the carton level", () => {
      const data = sizeM({ carton: level({ inspected: 2, boxNos: [337, 337] }) });
      expect(calcLabeling(input(data, { context, config: withCarton({ n: 2 }) })).issues).toEqual([
        {
          level: "error",
          code: "box_duplicate",
          message: "Carton Box, size M: Box/Carton #337 is entered twice.",
          size: "M",
          path: ["sizes", "M", "carton", "boxNos", 1],
        },
      ]);
    });

    it("rejects more boxes than were inspected", () => {
      const data = sizeM({ carton: level({ inspected: 1, boxNos: [13, 299] }) });
      expect(calcLabeling(input(data, { context })).issues).toEqual([
        {
          level: "error",
          code: "boxes_exceed_inspected",
          message: "Carton Box, size M: 2 box/carton numbers are entered but 1 box inspected.",
          size: "M",
          path: ["sizes", "M", "carton", "boxNos"],
        },
      ]);
    });
  });

  it("warns when one check finds more defects than boxes were inspected", () => {
    const output = calcLabeling(input(sizeM({ carton: level({ inspected: 1, defects: { lot_no: 2 } }) })));
    expect(output.result.status).toBe("fail");
    expect(output.issues).toEqual([
      {
        level: "warning",
        code: "defects_exceed_inspected",
        message: "Carton Box, size M: 2 × Wrong / No Lot Number found in 1 box inspected.",
        size: "M",
        path: ["sizes", "M", "carton", "defects", "lot_no"],
      },
    ]);
  });

  describe("wording from the template (6.2 rule 11)", () => {
    it("uses the template's level names and size labels in summaries and messages", () => {
      const context = makeTestContext({
        sizes: ["M"],
        templateSizes: [{ value: "M", label: "Medium" }],
        cartons: { M: [13] },
      });
      const data = sizeM({ inner: level({ inspected: 2, boxNos: [14] }) });
      const output = calcLabeling(input(data, { labels: SAFEDON_LABELS, context }));
      expect(output.result.summary).toBe(
        "No defects in size Medium. Fewer boxes inspected than planned: size Medium Inner Boxes/Packs 2 of 3.",
      );
      // Box 14 is not in size Medium's sampled list: a warning in the size's own label.
      expect(output.issues.map((issue) => issue.message)).toEqual([
        "Inner Boxes/Packs, size Medium: 2 boxes inspected; the plan is 3.",
        "Box/Carton #14 is not in Medium's sampled box/carton numbers.",
      ]);
    });

    it("lets a template reword a check by its code, per level or for both", () => {
      const check = LABELING_DEFAULT_CONFIG.levels.carton.checks[0];
      expect(checkLabel({}, "carton", check)).toBe("Wrong / No Lot Number");
      expect(checkLabel({ lot_no: "Lot no. wrong" }, "carton", check)).toBe("Lot no. wrong");
      expect(checkLabel({ lot_no: "Lot no. wrong", "carton.lot_no": "Carton lot no. wrong" }, "carton", check)).toBe(
        "Carton lot no. wrong",
      );
      expect(checkLabel({ "carton.lot_no": " " }, "carton", check)).toBe("Wrong / No Lot Number");
    });

    it("words each level's disposition line its own way, else as the field", () => {
      expect(levelFieldLabel(LABELING_LABELS, "inner", "result")).toBe("Disposition - Inner Box (Passed / Failed)");
      expect(levelFieldLabel(LABELING_LABELS, "carton", "result")).toBe("Disposition - Carton Box (Passed / Failed)");
      expect(levelFieldLabel({ ...LABELING_LABELS, cartonResult: " " }, "carton", "result")).toBe(
        "Disposition (Passed / Failed)",
      );
      expect(levelFieldLabel({}, "inner", "result")).toBe("result");
    });
  });

  it("works through the engine: a size's result, computed values and the issue links", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [
      { key: "header", include: false },
      { key: "labeling", config: SAFEDON_CONFIG, labels: SAFEDON_LABELS },
    ]);
    const data = {
      modules: {
        labeling: {
          // Box 99 is not in size M's sampled list: a warning; box 7 twice at the carton level is an error.
          sizes: { M: { inner: { inspected: 3, boxNos: [99] }, carton: { inspected: 2, boxNos: [7, 7], defects: { expiry_date: 1 } } } },
          comment: "Expiry date smudged on one carton.",
        },
      },
      custom: {},
    };
    const context = makeTestContext({ sizes: ["M"], cartons: { M: [1, 2, 3, 7] } });
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    const labeling = evaluation.modules.find((entry) => entry.key === "labeling")!;
    expect(labeling).toMatchObject({
      title: "Packaging Labeling Inspection",
      comment: "Expiry date smudged on one carton.",
      result: { status: "fail", summary: "Failed: size M Carton Boxes 1 defect (Wrong / No Expiry Date 1)." },
      computed: { sizes: { M: { carton: { accept: 0, reject: 1, total: 1, result: "fail" } } } },
    });
    expect(labeling.issues).toEqual([
      expect.objectContaining({
        moduleKey: "labeling",
        level: "warning",
        code: "box_not_in_carton_list",
        path: ["sizes", "M", "inner", "boxNos", 0],
      }),
      expect.objectContaining({
        moduleKey: "labeling",
        level: "error",
        code: "box_duplicate",
        path: ["sizes", "M", "carton", "boxNos", 1],
      }),
    ]);
    expect(evaluation.suggested.result).toBe("fail");
  });

  it("refuses text and dates saved in a count through the engine, never a pass (6.2 rules 1, 3 and 5)", () => {
    // A count that a spreadsheet turned into a date, as the SAFEDON_EG report's watertight total.
    const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "header", include: false }, "labeling"]);
    const data = {
      modules: {
        labeling: { sizes: { M: { inner: { inspected: "3", defects: { lot_no: "1980-01-01" } }, carton: { inspected: 1 } } } },
      },
      custom: {},
    };
    const evaluation = evaluateInspection({ template, data, context: makeTestContext({ sizes: ["M"] }) }, MODULE_REGISTRY);
    const labeling = evaluation.modules.find((entry) => entry.key === "labeling")!;
    expect(labeling.result.status).toBe("not_done");
    expect(labeling.issues.filter((issue) => issue.code === "invalid_data").map((issue) => issue.path)).toEqual([
      ["sizes", "M", "inner", "inspected"],
      ["sizes", "M", "inner", "defects", "lot_no"],
    ]);
    expect(labeling.issues.every((issue) => issue.level === "error" || issue.code === "module_not_done")).toBe(true);
  });
});

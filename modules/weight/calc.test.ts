import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  buildInspectionContext,
  evaluateInspection,
  type CalcInput,
  type InspectionContext,
} from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { SAMPLING_PLAN_DEFAULT_CONFIG } from "@/modules/sampling_plan/config";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { exampleContext, gloveByGloveData, templateConfig, templateLabels, weightData } from "./__fixtures__/examples";
import { calcWeight, deviationPct } from "./calc";
import { WEIGHT_DEFAULT_CONFIG, WEIGHT_LABELS, WEIGHT_TITLE, type WeightConfig } from "./config";
import { definition } from "./index";
import { emptyWeight, type WeightData } from "./schema";

const STD_EG = templateConfig("STD_EG");
const SAFEDON_EG = templateConfig("SAFEDON_EG");
const INDICATIVE_M = { grams: 3.5, size: "M" };

function sizeM(values: (number | null)[]): WeightData {
  return { sizes: { M: { values } } };
}

function input(
  data: WeightData,
  config: WeightConfig = STD_EG,
  context: InspectionContext = makeTestContext({ sizes: ["M"], indicativeWeight: INDICATIVE_M }),
  labels: Record<string, string> = WEIGHT_LABELS,
): CalcInput<WeightData, WeightConfig> {
  return { data, config, title: WEIGHT_TITLE, labels, context, results: {}, hasData: true };
}

describe("weight", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  describe("the STD_EG example (expected results B)", () => {
    const expected = STD_EG_EXPECTED.weight.M!;
    const output = calcWeight(input(weightData(STD_EG_EXAMPLE.weight), STD_EG, exampleContext(STD_EG_EXAMPLE)));

    it("records size M's average weight as the report prints it, 2.90 g: one value, whatever the template's n", () => {
      expect(STD_EG.n).toBe(13);
      expect(output.computed.count).toEqual({ M: 1 });
      expect(output.computed.average).toEqual({ M: expected.averageG });
      expect(output.computed.shown).toEqual({ M: expected.averageG });
      expect(output.computed.indicative).toEqual({ grams: expected.indicativeG, size: "M" });
    });

    it("warns that it is 17.1% below the indicative 3.5 g (threshold 10%), which the report did not flag", () => {
      expect(STD_EG_EXAMPLE.weight.M?.printedRemark).toBe("Info");
      expect(output.computed.deviationPct).toEqual({ M: expected.deviationPct });
      expect(output.computed.warnThresholdPct).toBe(expected.thresholdPct);
      expect(output.result.status).toBe(expected.status);
      expect(output.computed.result).toEqual({ M: "warn" });
      const warning = STD_EG_EXPECTED.warnings.find((issue) => issue.module === "weight")!;
      expect(output.issues).toEqual([
        { level: warning.level, code: warning.code, message: warning.message, size: warning.size, path: ["sizes", "M", "values"] },
      ]);
      expect(output.result).toEqual({
        status: "warn",
        summary: "Average: M 2.90 g (17.1% below the indicative 3.5 g, beyond the 10% threshold).",
        perSize: { M: { status: "warn", summary: "Average 2.90 g; 17.1% below the indicative 3.5 g." } },
      });
    });

    it("shows nothing for the sizes not ordered, where the report printed 'Info'", () => {
      expect(Object.keys(output.result.perSize ?? {})).toEqual(["M"]);
      expect(Object.keys(output.computed.average)).toEqual(["M"]);
    });
  });

  describe("the SAFEDON_EG example: one value per size, spec NA", () => {
    const output = calcWeight(
      input(weightData(SAFEDON_EG_EXAMPLE.weight), SAFEDON_EG, exampleContext(SAFEDON_EG_EXAMPLE), templateLabels("SAFEDON_EG")),
    );

    it("records each size's weight without a verdict", () => {
      expect(output.computed.shown).toEqual({ XS: 2.56, S: 2.94, M: 3.18, L: 3.55 });
      expect(output.computed.spec.M).toEqual({ kind: "na" });
      expect(output.computed.result).toEqual({ XS: "info", S: "info", M: "info", L: "info" });
      expect(output.result.status).toBe("info");
    });

    it("compares only size M with the indicative 3.2 g: 0.6% below, no warning", () => {
      expect(output.computed.deviationPct).toEqual({ M: -0.6 });
      expect(output.issues).toEqual([]);
      expect(output.result.perSize?.M?.summary).toBe("Average 3.18 g (Spec. NA); 0.6% below the indicative 3.2 g.");
      expect(output.result.perSize?.XS?.summary).toBe("Average 2.56 g (Spec. NA).");
      expect(output.result.summary).toBe(
        "Average: XS 2.56 g, S 2.94 g, M 3.18 g (0.6% below the indicative 3.2 g), L 3.55 g.",
      );
    });
  });

  describe("the indicative weight (6.2 rule 9)", () => {
    it("warns only beyond the threshold, judged at the deviation as printed (1 decimal)", () => {
      const at = (grams: number) => calcWeight(input(sizeM([grams]), STD_EG));
      expect(at(3.15).computed.deviationPct.M).toBe(-10);
      expect(at(3.15).result.status).toBe("info");
      expect(at(3.15).issues).toEqual([]);
      expect(at(3.14).computed.deviationPct.M).toBe(-10.3);
      expect(at(3.14).result.status).toBe("warn");
      expect(at(3.86).issues.map((issue) => issue.message)).toEqual([
        "Average weight 3.86 g is 10.3% above the indicative 3.5 g (threshold 10%).",
      ]);
      expect(at(3.5).result.perSize?.M?.summary).toBe("Average 3.50 g; the same as the indicative 3.5 g.");
    });

    it("compares the printed average: 2.894 g prints as 2.89", () => {
      expect(deviationPct(2.89, 3.5)).toBe(-17.4);
      const output = calcWeight(input(sizeM([2.894]), STD_EG));
      expect(output.computed.average.M).toBe(2.894);
      expect(output.computed.deviationPct.M).toBe(-17.4);
    });

    it("takes the template's threshold", () => {
      const strict = calcWeight(input(sizeM([3.3]), { ...STD_EG, warnThresholdPct: 5 }));
      expect(strict.result.status).toBe("warn");
      expect(strict.issues[0]?.message).toBe("Average weight 3.3 g is 5.7% below the indicative 3.5 g (threshold 5%).");
    });

    it("has nothing to compare without an indicative weight, or for other sizes", () => {
      const none = calcWeight(input(sizeM([2.9]), STD_EG, makeTestContext({ sizes: ["M"] })));
      expect(none.result.status).toBe("info");
      expect(none.computed.deviationPct).toEqual({});
      expect(none.computed.indicative).toBeNull();
      const context = makeTestContext({ sizes: ["S", "M"], indicativeWeight: INDICATIVE_M });
      const other = calcWeight(input({ sizes: { S: { values: [2.0] }, M: { values: [3.4] } } }, STD_EG, context));
      expect(other.computed.deviationPct).toEqual({ M: -2.9 });
      expect(other.result.perSize).toMatchObject({ S: { status: "info" }, M: { status: "info" } });
    });

    it("compares a surgical size given as 7.0", () => {
      const context = makeTestContext({ sizes: ["7.0"], indicativeWeight: { grams: 10, size: "7.0" } });
      const output = calcWeight(input({ sizes: { "7.0": { values: [12] } } }, STD_EG, context));
      expect(output.computed.deviationPct).toEqual({ "7.0": 20 });
      expect(output.issues[0]).toMatchObject({ code: "weight_deviation", size: "7.0", path: ["sizes", "7.0", "values"] });
    });
  });

  describe("an optional spec", () => {
    const spec = (min: number, max: number): WeightConfig => ({
      ...STD_EG,
      specs: [{ size: "M", spec: { kind: "range", min, max } }],
    });

    it("passes or fails the printed average when the template sets one", () => {
      const pass = calcWeight(input(sizeM([3.4]), spec(3, 4)));
      expect(pass.result.status).toBe("pass");
      expect(pass.result.perSize?.M?.summary).toBe("Average 3.40 g Passed (3 – 4); 2.9% below the indicative 3.5 g.");
      const fail = calcWeight(input(sizeM([4.1]), spec(3, 4)));
      expect(fail.result.status).toBe("fail");
      expect(fail.result.summary).toBe("Average: M 4.10 g Failed (3 – 4) (17.1% above the indicative 3.5 g, beyond the 10% threshold).");
    });

    it("warns on a passing size beyond the threshold, and keeps a failing one failed", () => {
      expect(calcWeight(input(sizeM([2.9]), spec(2.5, 3.5))).result.status).toBe("warn");
      const failed = calcWeight(input(sizeM([2.4]), spec(2.5, 3.5)));
      expect(failed.result.status).toBe("fail");
      expect(failed.issues.map((issue) => issue.code)).toEqual(["weight_deviation"]);
    });

    it("judges the average as printed: 2.996 g is 3.00 and meets a minimum of 3, 2.994 g is 2.99", () => {
      const min = { ...STD_EG, specs: [{ size: "M", spec: { kind: "min" as const, min: 3 } }] };
      const context = makeTestContext({ sizes: ["M"] });
      expect(calcWeight(input(sizeM([2.996]), min, context)).result.status).toBe("pass");
      expect(calcWeight(input(sizeM([2.994]), min, context)).result.status).toBe("fail");
    });
  });

  describe("an inspection saved before 26 October 2026, its gloves weighed one by one", () => {
    it("takes the average of the 13 gloves of the STD_EG example as the size's weight, as its report printed it", () => {
      const output = calcWeight(input(gloveByGloveData(STD_EG_EXAMPLE.weight), STD_EG, exampleContext(STD_EG_EXAMPLE)));
      expect(output.computed.count).toEqual({ M: 13 });
      expect(output.computed.average.M).toBeCloseTo(2.9, 10);
      expect(output.computed.shown).toEqual({ M: 2.9 });
      expect(output.result.perSize?.M).toEqual({ status: "warn", summary: "Average 2.90 g; 17.1% below the indicative 3.5 g." });
      expect(output.issues.map((issue) => issue.code)).toEqual(["weight_deviation"]);
    });

    it("averages the values entered, a gap left out, printed at the template's decimals", () => {
      const output = calcWeight(input(sizeM([2.8, null, 3.0, 3.05]), STD_EG, makeTestContext({ sizes: ["M"] })));
      expect(output.computed.count).toEqual({ M: 3 });
      expect(output.computed.average.M).toBeCloseTo(2.95, 10);
      expect(output.computed.shown).toEqual({ M: 2.95 });
      expect(output.result.status).toBe("info");
      expect(output.issues).toEqual([]);
    });

    it("asks nothing of the sampling plan: a count of gloves for weight saved there changes nothing", () => {
      const template = makeTestTemplate(MODULE_REGISTRY, [
        "order_lots",
        { key: "sampling_plan", config: { ...SAMPLING_PLAN_DEFAULT_CONFIG, columns: { ...SAMPLING_PLAN_DEFAULT_CONFIG.columns, glovesWeight: true } } },
        { key: "weight", config: STD_EG },
      ]);
      const data = {
        modules: {
          order_lots: { sizes: { M: { qtyCases: 100, lotNumbers: ["LOT-A01"] } } },
          sampling_plan: { sizes: { M: { glovesDimensions: 13, glovesWeight: 12 } } },
        },
        custom: {},
      };
      const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
      expect(context.sampling.M).not.toHaveProperty("weight");
      const output = calcWeight(input(sizeM([3.4]), STD_EG, context));
      expect(output.computed.count).toEqual({ M: 1 });
      expect(output.result.status).toBe("info");
      expect(output.issues).toEqual([]);
    });
  });

  describe("missing data is not done, never passed (6.2 rule 5)", () => {
    it("is not done until the size has its weight", () => {
      expect(calcWeight(input(emptyWeight())).result).toEqual({
        status: "not_done",
        summary: "Not done for size M.",
        perSize: { M: { status: "not_done", summary: "Weight (g): not entered." } },
      });
      const cleared = calcWeight(input(sizeM([null])));
      expect(cleared.result.status).toBe("not_done");
      expect(cleared.computed).toMatchObject({ count: { M: 0 }, average: { M: null }, shown: { M: null }, deviationPct: {} });
      expect(cleared.issues).toEqual([]);
    });

    it("lists the sizes weighed and the sizes not done", () => {
      const context = makeTestContext({ sizes: ["S", "M"], indicativeWeight: INDICATIVE_M });
      const output = calcWeight(input(sizeM([3.4]), STD_EG, context));
      expect(output.result.status).toBe("not_done");
      expect(output.result.summary).toBe("Average: M 3.40 g (2.9% below the indicative 3.5 g). Not done for size S.");
    });

    it("is not done without ordered sizes", () => {
      expect(calcWeight(input(sizeM([2.9]), STD_EG, makeTestContext())).result).toEqual({
        status: "not_done",
        summary: "No sizes ordered yet.",
        perSize: {},
      });
    });
  });

  describe("wrong data", () => {
    it("rejects a weight of 0 or less with an error that blocks submit, with a link to the cell", () => {
      for (const grams of [0, -2.9]) {
        const output = calcWeight(input(sizeM([grams])));
        expect(output.issues[0]).toEqual({
          level: "error",
          code: "weight_not_positive",
          message: "Size M, Weight (g): must be more than 0 g.",
          size: "M",
          path: ["sizes", "M", "values", 0],
        });
      }
    });

    it("still records the value, so the screen gives one answer: 0 g is 100% below the indicative 3.5 g", () => {
      const output = calcWeight(input(sizeM([0])));
      expect(output.computed.shown.M).toBe(0);
      expect(output.result.status).toBe("warn");
      expect(output.issues.map((issue) => issue.code)).toEqual(["weight_not_positive", "weight_deviation"]);
    });
  });

  it("returns plain JSON", () => {
    const output = calcWeight(input(weightData(STD_EG_EXAMPLE.weight), STD_EG, exampleContext(STD_EG_EXAMPLE)));
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  describe("through the engine, with the indicative weight from glove_info", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, ["glove_info", { key: "weight", config: STD_EG }]);
    const gloveInfo = {
      surfaceTexture: STD_EG_EXAMPLE.gloveInfo.surfaceTexture,
      indicativeWeight: STD_EG_EXAMPLE.gloveInfo.indicativeWeightG,
      colour: STD_EG_EXAMPLE.gloveInfo.colour,
      length: STD_EG_EXAMPLE.gloveInfo.length,
    };
    const evaluate = (weight: unknown) => {
      const data = { modules: { glove_info: gloveInfo, weight }, custom: {} };
      // order_lots may still be a stub: the example's ordered size is set here.
      const context = { ...buildInspectionContext({ template, data }, MODULE_REGISTRY), sizes: ["M"] };
      expect(context.indicativeWeight).toEqual({ grams: 3.5, size: "M" });
      return evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    };

    it("warns about the STD_EG weight and puts the warning in the issue list", () => {
      const evaluation = evaluate(weightData(STD_EG_EXAMPLE.weight));
      const weight = evaluation.modules.find((module) => module.key === "weight")!;
      expect(weight.result.status).toBe("warn");
      expect(evaluation.issues).toContainEqual(
        expect.objectContaining({ moduleKey: "weight", level: "warning", code: "weight_deviation", size: "M" }),
      );
    });

    it("leaves out sizes that are not ordered (6.2 rule 4)", () => {
      const data = weightData(STD_EG_EXAMPLE.weight);
      const evaluation = evaluate({ sizes: { ...data.sizes, XL: { values: [9] } } });
      const weight = evaluation.modules.find((module) => module.key === "weight")!;
      expect(Object.keys(weight.result.perSize ?? {})).toEqual(["M"]);
      expect(weight.issues).toContainEqual(expect.objectContaining({ code: "size_not_ordered", size: "XL" }));
    });

    it("refuses a weight saved as text (6.2 rule 1)", () => {
      const evaluation = evaluate({ sizes: { M: { values: ["2 90"] } } });
      const weight = evaluation.modules.find((module) => module.key === "weight")!;
      expect(weight.result.status).toBe("not_done");
      expect(weight.issues).toContainEqual(
        expect.objectContaining({ level: "error", code: "invalid_data", path: ["sizes", "M", "values", 0] }),
      );
    });
  });

  it("starts from the module defaults when a template says nothing", () => {
    expect(definition.defaultConfig).toBe(WEIGHT_DEFAULT_CONFIG);
  });
});

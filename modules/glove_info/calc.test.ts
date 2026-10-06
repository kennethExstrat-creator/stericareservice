import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import { buildInspectionContext, evaluateInspection, type CalcInput } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { calcGloveInfo, contributeGloveInfo } from "./calc";
import { GLOVE_INFO_DEFAULT_CONFIG, GLOVE_INFO_LABELS, type GloveInfoConfig } from "./config";
import { definition } from "./index";
import { emptyGloveInfo, type GloveInfoData } from "./schema";

const FILLED: GloveInfoData = {
  surfaceTexture: "Finger-textured",
  indicativeWeight: 3.5,
  colour: "Blue",
  length: "240 mm minimum",
};

function input(data: Partial<GloveInfoData>, config: GloveInfoConfig = GLOVE_INFO_DEFAULT_CONFIG): CalcInput<GloveInfoData, GloveInfoConfig> {
  return {
    data: { ...emptyGloveInfo(), ...data },
    config,
    title: "Glove Information",
    labels: GLOVE_INFO_LABELS,
    context: makeTestContext(),
    results: {},
    hasData: true,
  };
}

function withFields(fields: Partial<GloveInfoConfig["fields"]>): GloveInfoConfig {
  return { ...GLOVE_INFO_DEFAULT_CONFIG, fields: { ...GLOVE_INFO_DEFAULT_CONFIG.fields, ...fields } };
}

describe("glove_info", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("is info once every field the template shows is filled in", () => {
    expect(calcGloveInfo(input(FILLED))).toEqual({
      result: { status: "info", summary: "Finger-textured, Blue, 240 mm minimum; indicative weight 3.5 g (size M)." },
      computed: {},
      issues: [],
    });
  });

  it("is not done while a shown field is empty, naming it in the template's wording (6.2 rule 5)", () => {
    const labels = { ...GLOVE_INFO_LABELS, colour: "Colour of glove" };
    expect(calcGloveInfo({ ...input({ ...FILLED, colour: " ", length: null }), labels }).result).toEqual({
      status: "not_done",
      summary: "Missing: Colour of glove, Glove length.",
    });
    expect(calcGloveInfo(input({})).result.status).toBe("not_done");
  });

  it("asks only for the fields the template switches on", () => {
    const config = withFields({ colour: false, length: false });
    expect(calcGloveInfo(input({ surfaceTexture: "Smooth", indicativeWeight: 3.2 }, config)).result).toEqual({
      status: "info",
      summary: "Smooth; indicative weight 3.2 g (size M).",
    });
    const weightOnly = withFields({ surfaceTexture: false, colour: false, length: false });
    expect(calcGloveInfo(input({ indicativeWeight: 3.5 }, weightOnly)).result.summary).toBe(
      "Indicative weight 3.5 g (size M).",
    );
    const none = withFields({ surfaceTexture: false, indicativeWeight: false, colour: false, length: false });
    expect(calcGloveInfo(input({}, none)).result).toEqual({ status: "info", summary: "No fields are switched on." });
  });

  it("rejects an indicative weight of zero or less, with a link to the field", () => {
    const output = calcGloveInfo(input({ ...FILLED, indicativeWeight: 0 }));
    expect(output.result.status).toBe("not_done");
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "indicative_weight_not_positive",
        message: "Indicative weight (size M): must be more than 0 g.",
        path: ["indicativeWeight"],
      },
    ]);
  });

  it("passes the indicative weight forward for the weight module (6.2 rule 9)", () => {
    expect(contributeGloveInfo({ data: FILLED, config: GLOVE_INFO_DEFAULT_CONFIG })).toEqual({
      indicativeWeight: { grams: 3.5, size: "M" },
    });
    const surgical = { ...GLOVE_INFO_DEFAULT_CONFIG, indicativeWeightSize: "7.0" };
    expect(contributeGloveInfo({ data: FILLED, config: surgical })).toEqual({ indicativeWeight: { grams: 3.5, size: "7.0" } });
    expect(contributeGloveInfo({ data: emptyGloveInfo(), config: GLOVE_INFO_DEFAULT_CONFIG })).toEqual({});
    expect(contributeGloveInfo({ data: FILLED, config: withFields({ indicativeWeight: false }) })).toEqual({});
  });

  it("works through the engine with the template's wording", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [
      { key: "glove_info", labels: { ...GLOVE_INFO_LABELS, length: "Length of glove" } },
    ]);
    const data = { modules: { glove_info: { ...FILLED, length: null, comment: "From the spec sheet." } }, custom: {} };
    const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
    expect(context.indicativeWeight).toEqual({ grams: 3.5, size: "M" });
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    const gloveInfo = evaluation.modules.find((module) => module.key === "glove_info");
    expect(gloveInfo).toMatchObject({
      result: { status: "not_done", summary: "Missing: Length of glove." },
      comment: "From the spec sheet.",
      issues: [expect.objectContaining({ code: "module_not_done", message: "Glove Information is not done: Missing: Length of glove." })],
    });
  });
});

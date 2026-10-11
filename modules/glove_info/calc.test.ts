import { describe, expect, it } from "vitest";
import { MODULE_REGISTRY } from "@/modules/registry";
import { buildInspectionContext, type CalcInput } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { calcGloveInfo, contributeGloveInfo, weightSizeOf } from "./calc";
import { GLOVE_INFO_DEFAULT_CONFIG, GLOVE_INFO_LABELS, type GloveInfoConfig } from "./config";
import { definition } from "./index";
import { emptyVariant, type GloveInfoData, type GloveVariant } from "./schema";

const BLUE: GloveVariant = { sizes: [], surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: "240 mm minimum" };

function input(data: GloveInfoData, config: GloveInfoConfig = GLOVE_INFO_DEFAULT_CONFIG): CalcInput<GloveInfoData, GloveInfoConfig> {
  return {
    data,
    config,
    title: "Glove Information",
    labels: GLOVE_INFO_LABELS,
    context: makeTestContext(),
    results: {},
    hasData: true,
  } as CalcInput<GloveInfoData, GloveInfoConfig>;
}

describe("glove_info calc", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("is info once every variant has every field the template shows", () => {
    const out = calcGloveInfo(input({ variants: [BLUE, { ...BLUE, sizes: ["L"], colour: "White", indicativeWeight: 4.2 }] }));
    expect(out.result.status).toBe("info");
    expect(out.result.summary).toBe(
      "Finger-textured, Blue, 240 mm minimum; indicative weight 3.5 g (size M). Finger-textured, White, 240 mm minimum (L); indicative weight 4.2 g (size L).",
    );
  });

  it("is not done without a variant, or while a field is empty, naming the variant when there are several (6.2 rule 5)", () => {
    expect(calcGloveInfo(input({ variants: [] })).result).toMatchObject({ status: "not_done" });
    expect(calcGloveInfo(input({ variants: [{ ...BLUE, colour: null }] })).result.summary).toBe("Missing: Glove Colour.");
    const two = calcGloveInfo(input({ variants: [BLUE, { ...emptyVariant(), colour: "White" }] }));
    expect(two.result.summary).toBe("Missing: Variant 2 Glove Surface Texture, Variant 2 Indicative Weight, Variant 2 Glove Length.");
  });

  it("refuses a weight of zero or less with a link to it, and warns of a size in two variants", () => {
    const out = calcGloveInfo(input({ variants: [{ ...BLUE, sizes: ["M"] }, { ...BLUE, sizes: ["M"], indicativeWeight: 0 }] }));
    expect(out.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["indicative_weight_not_positive", ["variants", 1, "indicativeWeight"]],
      ["size_in_two_variants", ["variants", 1, "sizes"]],
    ]);
  });

  it("compares a variant's weight with its one size, else with the reference size it covers (6.2 rule 9)", () => {
    expect(weightSizeOf({ sizes: ["S"] }, "M")).toBe("S");
    expect(weightSizeOf({ sizes: [] }, "M")).toBe("M");
    expect(weightSizeOf({ sizes: ["S", "M"] }, "M")).toBe("M");
    expect(weightSizeOf({ sizes: ["S", "L"] }, "M")).toBeNull();
    const contribution = contributeGloveInfo({
      data: { variants: [{ ...BLUE, sizes: ["S"], indicativeWeight: 3.1 }, BLUE, { ...BLUE, sizes: ["M"], indicativeWeight: 9 }] },
      config: GLOVE_INFO_DEFAULT_CONFIG,
    } as Parameters<typeof contributeGloveInfo>[0]);
    expect(contribution).toEqual({ indicativeWeights: { S: 3.1, M: 3.5 }, indicativeWeight: { grams: 3.5, size: "M" } });
  });

  it("hands each size's weight to the context for the weight module", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "glove_info" }]);
    const data = { modules: { glove_info: { variants: [{ ...BLUE, sizes: ["L"], indicativeWeight: 4.2 }] } }, custom: {} };
    const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
    expect(context.indicativeWeights).toEqual({ L: 4.2 });
  });
});

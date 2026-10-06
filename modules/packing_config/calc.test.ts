import { describe, expect, it } from "vitest";
import { labelOverrides } from "@/lib/coverage";
import { buildInspectionContext, evaluateInspection, type CalcInput } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { packingConfig, packingData } from "./__fixtures__/examples";
import { calcPackingConfig, contributePackingConfig } from "./calc";
import { PACKING_CONFIG_DEFAULT_CONFIG, PACKING_CONFIG_LABELS, type PackingConfigConfig } from "./config";
import { definition } from "./index";
import { emptyPackingConfig, type PackingConfigData } from "./schema";

const STD_EG = packingData(STD_EG_EXAMPLE.packing);
const SAFEDON = packingData(SAFEDON_EG_EXAMPLE.packing);
const SAFEDON_LABELS = { ...PACKING_CONFIG_LABELS, ...labelOverrides("SAFEDON_EG", "packing_config") };

function input(
  data: Partial<PackingConfigData>,
  { config = PACKING_CONFIG_DEFAULT_CONFIG, labels = PACKING_CONFIG_LABELS }: { config?: PackingConfigConfig; labels?: Record<string, string> } = {},
): CalcInput<PackingConfigData, PackingConfigConfig> {
  return {
    data: { ...emptyPackingConfig(), ...data },
    config,
    title: "Packing configuration",
    labels,
    context: makeTestContext(),
    results: {},
    hasData: true,
  };
}

describe("packing_config", () => {
  it("satisfies the module contract", () => {
    expect(checkModuleContract(definition)).toEqual([]);
  });

  it("is info for the STD_EG example: 200 per inner box x 10 = 2,000 per case", () => {
    expect(calcPackingConfig(input(STD_EG))).toEqual({
      result: { status: "info", summary: "# gloves per case 2,000 = # glove per inner box 200 × # inners per case 10." },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "inner box" },
      issues: [],
    });
  });

  it("is info for the SAFEDON_EG example in its wording: 125 per plastic pack x 16 = 2,000 per case", () => {
    const config = packingConfig(SAFEDON_EG_EXAMPLE.packing);
    expect(calcPackingConfig(input(SAFEDON, { config, labels: SAFEDON_LABELS }))).toEqual({
      result: { status: "info", summary: "# gloves per case 2,000 = # glove per plastic pack 125 × # packs per case 16." },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "plastic pack" },
      issues: [],
    });
  });

  it("warns when the gloves per case is not inner x per case, with a link to it (BUILD_SPEC 6.1)", () => {
    const config = packingConfig(SAFEDON_EG_EXAMPLE.packing);
    const output = calcPackingConfig(input({ ...SAFEDON, glovesPerCase: 2500 }, { config, labels: SAFEDON_LABELS }));
    const message = "# gloves per case 2,500 is not # glove per plastic pack × # packs per case: 125 × 16 = 2,000.";
    expect(output).toEqual({
      result: { status: "warn", summary: message },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "plastic pack" },
      issues: [{ level: "warning", code: "gloves_per_case_mismatch", message, path: ["glovesPerCase"] }],
    });
  });

  it("is not done until the three counts are entered, naming them in the template's wording (6.2 rule 5)", () => {
    expect(calcPackingConfig(input({ glovesPerInner: 125 }, { labels: SAFEDON_LABELS }))).toEqual({
      result: { status: "not_done", summary: "Missing: # packs per case, # gloves per case." },
      computed: { glovesPerCaseCheck: null, innerUnit: "inner box" },
      issues: [],
    });
    const noTotal = calcPackingConfig(input({ ...STD_EG, glovesPerCase: null }));
    expect(noTotal.result).toEqual({ status: "not_done", summary: "Missing: # gloves per case." });
    expect(noTotal.computed.glovesPerCaseCheck).toBe(2000);
  });

  it("does not wait for the packing mode, which only the onsite forms have", () => {
    const shown: PackingConfigConfig = { ...PACKING_CONFIG_DEFAULT_CONFIG, fields: { packingMode: true } };
    expect(calcPackingConfig(input(STD_EG, { config: shown })).result.status).toBe("info");
  });

  it("rejects a count of 0, which counts as not entered", () => {
    const output = calcPackingConfig(input({ ...STD_EG, innersPerCase: 0 }));
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "packing_count_not_positive",
        message: "# inners per case: must be more than 0.",
        path: ["innersPerCase"],
      },
    ]);
    expect(output.result).toEqual({ status: "not_done", summary: "Missing: # inners per case." });
    expect(output.computed.glovesPerCaseCheck).toBeNull();
  });

  it("passes the packing forward under the inner unit's name", () => {
    expect(contributePackingConfig({ data: SAFEDON, config: packingConfig(SAFEDON_EG_EXAMPLE.packing) })).toEqual({
      packing: { innerUnit: "plastic pack", glovesPerInner: 125, innersPerCase: 16, glovesPerCase: 2000 },
    });
    const pouch: PackingConfigConfig = { ...PACKING_CONFIG_DEFAULT_CONFIG, innerUnit: "pouch" };
    expect(contributePackingConfig({ data: emptyPackingConfig(), config: pouch })).toEqual({
      packing: { innerUnit: "pouch", glovesPerInner: null, innersPerCase: null, glovesPerCase: null },
    });
  });

  it("uses the gloves per case as printed, and inner x per case only until it is entered", () => {
    const config = PACKING_CONFIG_DEFAULT_CONFIG;
    expect(contributePackingConfig({ data: { ...STD_EG, glovesPerCase: null }, config }).packing?.glovesPerCase).toBe(2000);
    expect(contributePackingConfig({ data: { ...STD_EG, glovesPerCase: 2500 }, config }).packing?.glovesPerCase).toBe(2500);
    expect(contributePackingConfig({ data: { ...STD_EG, glovesPerInner: 0, glovesPerCase: null }, config }).packing).toEqual({
      innerUnit: "inner box",
      glovesPerInner: null,
      innersPerCase: 10,
      glovesPerCase: null,
    });
  });

  it("puts the packing in the context through the engine", () => {
    const template = makeTestTemplate(MODULE_REGISTRY, [
      { key: "packing_config", config: packingConfig(STD_EG_EXAMPLE.packing) },
    ]);
    const data = { modules: { packing_config: STD_EG }, custom: {} };
    const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
    expect(context.packing).toEqual({ innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 });
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    expect(evaluation.modules.find((entry) => entry.key === "packing_config")).toMatchObject({
      result: { status: "info" },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "inner box" },
      issues: [],
    });
  });
});

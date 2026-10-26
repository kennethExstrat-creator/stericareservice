import { describe, expect, it } from "vitest";
import { labelOverrides } from "@/lib/coverage";
import { buildInspectionContext, evaluateInspection, lotSizeGloves, type CalcInput } from "@/modules/_framework";
import { checkModuleContract, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { packingConfig, packingData } from "./__fixtures__/examples";
import { calcPackingConfig, contributePackingConfig, workedOutGlovesPerCase } from "./calc";
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
    title: "Packing Configuration",
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
      result: { status: "info", summary: "# Gloves per Case 2,000 = # Glove per Inner Box 200 × # Inners per Case 10." },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "inner box" },
      issues: [],
    });
  });

  it("is info for the SAFEDON_EG example in its wording: 125 per plastic pack x 16 = 2,000 per case", () => {
    const config = packingConfig(SAFEDON_EG_EXAMPLE.packing);
    expect(calcPackingConfig(input(SAFEDON, { config, labels: SAFEDON_LABELS }))).toEqual({
      result: { status: "info", summary: "# Gloves per Case 2,000 = # Glove per Plastic Pack 125 × # Packs per Case 16." },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "plastic pack" },
      issues: [],
    });
  });

  it("warns when a stored gloves per case is not inner x per case, as data saved before may hold, with a link to it (BUILD_SPEC 6.1)", () => {
    const config = packingConfig(SAFEDON_EG_EXAMPLE.packing);
    const output = calcPackingConfig(input({ ...SAFEDON, glovesPerCase: 2500 }, { config, labels: SAFEDON_LABELS }));
    const message = "# Gloves per Case 2,500 is not # Glove per Plastic Pack × # Packs per Case: 125 × 16 = 2,000.";
    expect(output).toEqual({
      result: { status: "warn", summary: message },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "plastic pack" },
      issues: [{ level: "warning", code: "gloves_per_case_mismatch", message, path: ["glovesPerCase"] }],
    });
  });

  it("is not done until the gloves per inner unit and the inner units per case are entered, naming them in the template's wording (6.2 rule 5)", () => {
    expect(calcPackingConfig(input({ glovesPerInner: 125 }, { labels: SAFEDON_LABELS }))).toEqual({
      result: { status: "not_done", summary: "Missing: # Packs per Case." },
      computed: { glovesPerCaseCheck: null, innerUnit: "inner box" },
      issues: [],
    });
    const missingBoth = { status: "not_done", summary: "Missing: # Glove per Inner Box, # Inners per Case." };
    expect(calcPackingConfig(input({})).result).toEqual(missingBoth);
    // A document that states only the gloves per case: the counts it comes from are still to enter.
    expect(calcPackingConfig(input({ glovesPerCase: 2000 })).result).toEqual(missingBoth);
  });

  it("counts a gloves per case worked out as entered: none stored beside both counts, as data saved before may have it, is info (Kenneth, 27 October 2026)", () => {
    expect(calcPackingConfig(input({ ...STD_EG, glovesPerCase: null }))).toEqual({
      result: { status: "info", summary: "# Gloves per Case 2,000 = # Glove per Inner Box 200 × # Inners per Case 10." },
      computed: { glovesPerCaseCheck: 2000, innerUnit: "inner box" },
      issues: [],
    });
    const config = packingConfig(SAFEDON_EG_EXAMPLE.packing);
    const output = calcPackingConfig(input({ ...SAFEDON, glovesPerCase: null }, { config, labels: SAFEDON_LABELS }));
    expect(output.result).toEqual({
      status: "info",
      summary: "# Gloves per Case 2,000 = # Glove per Plastic Pack 125 × # Packs per Case 16.",
    });
  });

  it("works the gloves per case out once both counts are entered, and not before", () => {
    expect(workedOutGlovesPerCase({ ...emptyPackingConfig(), glovesPerInner: 100, innersPerCase: 10 })).toBe(1000);
    expect(workedOutGlovesPerCase({ ...STD_EG, glovesPerCase: 2500 })).toBe(2000);
    expect(workedOutGlovesPerCase({ ...emptyPackingConfig(), glovesPerInner: 100, glovesPerCase: 1000 })).toBeNull();
    expect(workedOutGlovesPerCase({ ...STD_EG, innersPerCase: 0 })).toBeNull();
  });

  it("never waits for the onsite packing mode, even where the template shows it: the result rests on the counts (6.1)", () => {
    const shown: PackingConfigConfig = { ...PACKING_CONFIG_DEFAULT_CONFIG, fields: { packingMode: true } };
    expect(calcPackingConfig(input(STD_EG, { config: shown })).result.status).toBe("info");
  });

  it("rejects a count of 0, which counts as not entered", () => {
    const output = calcPackingConfig(input({ ...STD_EG, innersPerCase: 0 }));
    expect(output.issues).toEqual([
      {
        level: "error",
        code: "packing_count_not_positive",
        message: "# Inners per Case: must be more than 0.",
        path: ["innersPerCase"],
      },
    ]);
    expect(output.result).toEqual({ status: "not_done", summary: "Missing: # Inners per Case." });
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

  it("passes the gloves per case worked out where none is stored, as in data saved before, and a stored one as stored", () => {
    const config = PACKING_CONFIG_DEFAULT_CONFIG;
    expect(contributePackingConfig({ data: { ...STD_EG, glovesPerCase: null }, config }).packing?.glovesPerCase).toBe(2000);
    expect(contributePackingConfig({ data: { ...STD_EG, glovesPerCase: 2500 }, config }).packing?.glovesPerCase).toBe(2500);
    expect(contributePackingConfig({ data: { ...STD_EG, glovesPerInner: 0, glovesPerCase: null }, config }).packing).toEqual({
      innerUnit: "inner box",
      glovesPerInner: null,
      innersPerCase: 10,
      glovesPerCase: null,
    });
    // A document that stated only the gloves per case.
    expect(contributePackingConfig({ data: { ...emptyPackingConfig(), glovesPerCase: 2000 }, config }).packing?.glovesPerCase).toBe(2000);
  });

  it("gives the Sampling Plan its lot size from the gloves per case worked out of data saved before, through the context", () => {
    // Saved before 27 October 2026: both counts, no gloves per case.
    const template = makeTestTemplate(MODULE_REGISTRY, ["order_lots", { key: "packing_config", config: packingConfig(STD_EG_EXAMPLE.packing) }]);
    const data = {
      modules: {
        order_lots: { sizes: { M: { qtyCases: 50, lotNumbers: ["LOT-A01"] }, L: { qtyCases: 30, lotNumbers: [] } } },
        packing_config: { ...STD_EG, glovesPerCase: null },
      },
      custom: {},
    };
    const context = buildInspectionContext({ template, data }, MODULE_REGISTRY);
    expect(context.packing.glovesPerCase).toBe(2000);
    // What the Sampling Plan's "Lot Size (Gloves)" reads, in its calc and on its card.
    expect(lotSizeGloves(context, "M")).toBe(100_000);
    expect(lotSizeGloves(context, "L")).toBe(60_000);
    const evaluation = evaluateInspection({ template, data, context }, MODULE_REGISTRY);
    expect(evaluation.modules.find((entry) => entry.key === "order_lots")?.computed).toMatchObject({ totalGloves: 160_000 });
    expect(evaluation.modules.find((entry) => entry.key === "packing_config")?.result.status).toBe("info");
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

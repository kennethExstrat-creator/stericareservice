import { describe, expect, it } from "vitest";
import { buildInspectionContext, effectiveLabels, evaluateInspection } from "@/modules/_framework";
import { makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData, STD_EG_V6_LABELS } from "./__fixtures__/examples";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, SAMPLING_QUANTITY_LABELS } from "./config";
import { definition } from "./index";
import { samplingLabels } from "./labels";

describe("the Sampling Quantity in Kenneth's words, whatever the template says (27 October 2026)", () => {
  it("names the rows # of Case, Inner Box Taken per Case, Total # of Inner Box, Gloves Taken per Inner Box, Put Back, # of Gloves Sample and Code Letter", () => {
    expect(SAMPLING_QUANTITY_LABELS).toEqual({
      cases: "# of Case",
      innerUnitsPerCase: "Inner Box Taken per Case",
      innerUnits: "Total # of Inner Box",
      gloves: "# of Gloves Sample",
      glovesPerInnerBox: "Gloves Taken per Inner Box",
      putBack: "Put Back",
      codeLetter: "Code Letter",
    });
    // Total Gloves Taken is gone (Kenneth, 27 October 2026: "remove this row").
    expect(SAMPLING_PLAN_LABELS).not.toHaveProperty("totalGlovesTaken");
    expect(SAMPLING_PLAN_LABELS).toMatchObject(SAMPLING_QUANTITY_LABELS);
  });

  it("lays them over STD_EG version 6's stored Case, Inner Box and Gloves, and keeps its other labels", () => {
    const labels = effectiveLabels(definition, { labels: STD_EG_V6_LABELS });
    expect(labels).toMatchObject(SAMPLING_QUANTITY_LABELS);
    expect(labels).toMatchObject({
      glovesPhysical: "# Gloves for FAB",
      innerUnitsDispensing: "# Inner Box for Packaging & Dispensing Inspection",
      samplingQuantity: "Sampling Quantity",
      orderQty: "Order Qty (Case)",
    });
  });

  it("words SAFEDON_EG's inner pack the same way, and leaves its tensile wording as it is", () => {
    const labels = samplingLabels({ ...SAMPLING_PLAN_LABELS, innerUnits: "Inner Pack", glovesPhysical: "# Gloves for Tensile" });
    expect(labels).toMatchObject({ innerUnits: "Total # of Inner Box", glovesPhysical: "# Gloves for Tensile" });
  });

  it("reaches calc's messages, the summaries the review shows and the labels the export carries, through the engine", () => {
    const template = makeTestTemplate(ENGINE_REGISTRY, [
      "order_lots",
      "packing_config",
      { key: "sampling_plan", config: { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" }, labels: STD_EG_V6_LABELS },
    ]);
    const plan = samplingPlanData(STD_EG_EXAMPLE);
    const data = exampleData(STD_EG_EXAMPLE, { sampling_plan: { sizes: { M: { ...plan.sizes.M, cases: 3000 } } } });
    const context = buildInspectionContext({ template, data, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
    const found = evaluateInspection({ template, data, context }, ENGINE_REGISTRY).modules.find((entry) => entry.key === "sampling_plan");
    expect(found?.labels).toMatchObject(SAMPLING_QUANTITY_LABELS);
    expect(found?.issues.filter((issue) => issue.code === "cases_above_order").map((issue) => issue.message)).toEqual([
      "Size M, # of Case: 3,000 cases sampled, more than the 2,900 cases ordered.",
    ]);
    expect(found?.result.perSize?.M.summary).toBe("# of Case 3,000 is more than the 2,900 ordered.");
  });
});

import { describe, expect, it } from "vitest";
import { TEST_ADMIN_ID, TEST_REGISTRY, registryWith } from "./__fixtures__/test-registry";
import {
  AQL_DEFAULTS,
  buildInspectionContext,
  cartonsFor,
  includedModules,
  initialSize,
  inspectionRowValues,
  lotSizeGloves,
  moduleTitle,
  samplingFor,
  sizeLabel,
  type InspectionMeta,
} from "./context";
import { emptyInspectionData, type InspectionData } from "./data";
import { defineModule, stubModule } from "./define";
import { makeTestTemplate } from "./testing";

const ALL = ["glove_info", "order_lots", "packing_config", "sampling_plan", "carton_sampling", "weight"] as const;

const META: InspectionMeta = {
  refNo: "INS-2026-0001",
  inspectionDate: "2024-07-12",
  inspector: { id: "00000000-0000-4000-8000-000000000101", name: "Inspector A" },
  client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
  manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A" },
};

/** STD_EG example B, with placeholders: size M only, 2,900 cases of 2,000 gloves. */
function exampleData(): InspectionData {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Brand X nitrile", client: "  " },
      glove_info: { indicativeWeight: 3.5, colour: "Blue" },
      order_lots: {
        lots: [
          { size: "m", qtyCases: 2900, lotNumbers: ["LOT-M-0001", " "] },
          { size: "L", qtyCases: 0, lotNumbers: [] },
        ],
      },
      packing_config: { glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 },
      sampling_plan: { sizes: { M: { cases: 50, watertightVisual: 500, dimensions: 13 }, L: { cases: 5 } } },
      carton_sampling: { sizes: { M: [32, 578, 578, null, 1186], XL: [7] } },
    },
    custom: {},
  };
}

function build(data: InspectionData = exampleData(), template = makeTestTemplate(TEST_REGISTRY, [...ALL])) {
  return buildInspectionContext({ template, data, meta: META }, TEST_REGISTRY);
}

describe("buildInspectionContext: numbers flow forward", () => {
  it("takes the ordered sizes from order_lots, canonical and in template order (6.2 rule 4)", () => {
    const context = build();
    expect(context.sizes).toEqual(["M"]);
    expect(context.order).toEqual({ M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001"] } });
  });

  it("keeps per-size parts to ordered sizes", () => {
    const context = build();
    expect(Object.keys(context.sampling)).toEqual(["M"]);
    expect(Object.keys(context.cartons)).toEqual(["M"]);
    expect(samplingFor(context, "M")).toMatchObject({ cases: 50, watertightVisual: 500, dimensions: 13, physical: null });
    expect(samplingFor(context, "L")).toMatchObject({ cases: null });
  });

  it("offers each size's sampled cartons once, for box pickers (6.2 rule 7)", () => {
    expect(cartonsFor(build(), "M")).toEqual([32, 578, 1186]);
    expect(cartonsFor(build(), "L")).toEqual([]);
  });

  it("reads header values once, falling back to the inspection row for blanks (6.2 rule 10)", () => {
    expect(build().header).toEqual({
      client: "Client A",
      manufacturer: "Manufacturer A",
      poNo: "PO-0001",
      productName: "Brand X nitrile",
      productCode: null,
      inspectionDate: "2024-07-12",
      mfgDate: null,
      expiryDate: null,
    });
    expect(build().inspection).toEqual({
      refNo: "INS-2026-0001",
      inspector: META.inspector,
      client: META.client,
      manufacturer: META.manufacturer,
    });
  });

  it("carries packing, the indicative weight (canonical size) and the AQL defaults", () => {
    const context = build();
    expect(context.packing).toEqual({ innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 });
    expect(context.indicativeWeight).toEqual({ grams: 3.5, size: "M" });
    expect(context.aql).toEqual(AQL_DEFAULTS);
    expect(lotSizeGloves(context, "M")).toBe(5_800_000);
    expect(lotSizeGloves(context, "L")).toBeNull();
  });

  it("applies per-client AQL defaults, then the template's inspection level", () => {
    const template = makeTestTemplate(TEST_REGISTRY, [
      ...ALL.filter((key) => key !== "sampling_plan"),
      { key: "sampling_plan", config: { inspectionLevel: "II" } },
    ]);
    const context = buildInspectionContext(
      { template, data: exampleData(), meta: META, aqlDefaults: { major: 1.5, inspectionLevel: "I" } },
      TEST_REGISTRY,
    );
    expect(context.aql).toEqual({ ...AQL_DEFAULTS, major: 1.5, inspectionLevel: "II" });
  });

  it("does not depend on the template's module order", () => {
    const reversed = makeTestTemplate(TEST_REGISTRY, [...ALL].reverse());
    const { modules: reversedModules, ...fromReversed } = build(exampleData(), reversed);
    const { modules, ...context } = build();
    expect(fromReversed).toEqual(context);
    // Only the list of modules follows the template's order, as the screen shows them.
    expect(reversedModules?.map((entry) => entry.key)).toEqual(reversed.modules.map((entry) => entry.key));
    expect(modules?.map((entry) => entry.key)).toEqual(["header", ...ALL, "conclusion"]);
  });

  it("lists the included modules with their titles in the template's wording", () => {
    const template = makeTestTemplate(TEST_REGISTRY, [
      { key: "order_lots", title: "Order quantity" },
      { key: "weight", include: false },
      "carton_sampling",
    ]);
    const context = build(exampleData(), template);
    expect(includedModules(context)).toEqual([
      { key: "header", title: "Manufacturer Information" },
      { key: "order_lots", title: "Order quantity" },
      { key: "carton_sampling", title: "Finished Goods Sampling Information (carton number)" },
      { key: "conclusion", title: "Conclusion" },
    ]);
    expect(moduleTitle(context, "order_lots")).toBe("Order quantity");
    // Not included: its key in words, never a blank.
    expect(moduleTitle(context, "weight")).toBe("Weight");
    expect(moduleTitle(context, "dispensing_packing")).toBe("Dispensing packing");
    // A context built before the list existed has none.
    expect(includedModules({})).toEqual([]);
  });

  it("carries the inspection's files when the caller knows them, else null", () => {
    expect(build().files).toBeNull();
    const files = [{ id: "00000000-0000-4000-8000-000000000f01", moduleKey: "tensile", kind: "lab_report" as const }];
    const template = makeTestTemplate(TEST_REGISTRY, [...ALL]);
    const context = buildInspectionContext({ template, data: exampleData(), meta: { ...META, files } }, TEST_REGISTRY);
    expect(context.files).toEqual(files);
    expect(context.files).not.toBe(files);
  });

  it("opens a per-size Capture on the size in focus when it is ordered", () => {
    const context = { sizes: ["S", "M"] };
    expect(initialSize(context, { size: "M" })).toBe("M");
    expect(initialSize(context, { size: "XL" })).toBe("S");
    expect(initialSize(context, null)).toBe("S");
    expect(initialSize(context)).toBe("S");
    expect(initialSize({ sizes: [] }, { size: "M" })).toBe("");
  });

  it("leaves a part empty when its module is switched off, unfilled or unreadable", () => {
    const withoutCartons = makeTestTemplate(TEST_REGISTRY, [
      ...ALL.filter((key) => key !== "carton_sampling"),
      {
        key: "carton_sampling",
        include: false,
        override: { reason: "Cartons not accessible", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
      },
    ]);
    expect(build(exampleData(), withoutCartons).cartons).toEqual({});

    expect(build(emptyInspectionData())).toMatchObject({ sizes: [], order: {}, sampling: {}, indicativeWeight: null });

    const broken = exampleData();
    broken.modules = { ...broken.modules, packing_config: { glovesPerInner: "200" } };
    expect(build(broken).packing.glovesPerCase).toBeNull();
  });

  it("gives the inspection row the PO, product and lots entered once (6.2 rule 10)", () => {
    const data = exampleData();
    data.modules = {
      ...data.modules,
      order_lots: {
        lots: [
          { size: "M", qtyCases: 2900, lotNumbers: ["LOT-M-0001", "LOT-M-0002"] },
          { size: "L", qtyCases: 60, lotNumbers: ["LOT-M-0002", "LOT-L-0001"] },
        ],
      },
    };
    expect(inspectionRowValues(build(data))).toEqual({
      po_no: "PO-0001",
      product_name: "Brand X nitrile",
      lot_numbers: ["LOT-M-0001", "LOT-M-0002", "LOT-L-0001"],
    });
  });

  it("labels sizes as the template does", () => {
    const template = makeTestTemplate(TEST_REGISTRY, [...ALL], {
      sizes: [
        { value: "M", label: "Medium" },
        { value: "L", label: "L" },
      ],
    });
    expect(sizeLabel(build(exampleData(), template), "M")).toBe("Medium");
    expect(sizeLabel(build(exampleData(), template), "XL")).toBe("XL");
  });

  it("leaves out a part a module does not own, keeps the parts it owns, and records why", () => {
    const greedy = defineModule({
      ...stubModule({ key: "glove_info", title: "Glove Information" }),
      contribute: () => ({ indicativeWeight: { grams: 3.5, size: "M" }, cartons: { M: [1] } }),
    });
    const registry = registryWith({ glove_info: greedy });
    const context = buildInspectionContext(
      { template: makeTestTemplate(registry, [...ALL]), data: exampleData(), meta: META },
      registry,
    );
    expect(context.indicativeWeight).toEqual({ grams: 3.5, size: "M" });
    expect(context.cartons).toEqual({ M: [32, 578, 1186] });
    expect(context.contributionErrors).toEqual([
      { moduleKey: "glove_info", message: 'glove_info contributed "cartons", which only carton_sampling may provide.' },
    ]);
  });

  it("takes what the template's config gives before anything is saved (the inspection level)", () => {
    const template = makeTestTemplate(TEST_REGISTRY, [
      ...ALL.filter((key) => key !== "sampling_plan"),
      { key: "sampling_plan", config: { inspectionLevel: "I" } },
    ]);
    const saved = exampleData();
    const modules = Object.fromEntries(
      Object.entries(saved.modules).filter(([key]) => key !== "sampling_plan" && key !== "packing_config"),
    );
    const context = buildInspectionContext({ template, data: { ...saved, modules }, meta: META }, TEST_REGISTRY);
    expect(context.aql.inspectionLevel).toBe("I");
    expect(context.sampling).toEqual({});
    expect(context.packing).toEqual({ innerUnit: "inner box", glovesPerInner: null, innersPerCase: null, glovesPerCase: null });
    expect(context.contributionErrors).toEqual([]);
  });

  it("records a contribution that throws and builds the rest of the context", () => {
    const broken = defineModule({
      ...stubModule({ key: "packing_config", title: "Packing configuration" }),
      contribute: () => {
        throw new Error("bug in contribute");
      },
    });
    const registry = registryWith({ packing_config: broken });
    const context = buildInspectionContext(
      { template: makeTestTemplate(registry, [...ALL]), data: exampleData(), meta: META },
      registry,
    );
    expect(context.packing.glovesPerCase).toBeNull();
    expect(context.sizes).toEqual(["M"]);
    expect(context.contributionErrors).toEqual([
      { moduleKey: "packing_config", message: "contribute failed: bug in contribute" },
    ]);
    expect(build().contributionErrors).toEqual([]);
  });
});

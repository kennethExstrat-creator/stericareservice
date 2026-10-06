// Template definitions for tests, modelled on the two reports: BASE_EG lists
// the STD_EG modules in report order; CLIENT_EG extends it the way SAFEDON_EG
// differs from STD_EG (docs/forms/reports/SAFEDON_EG.md, "Differences").
// Placeholder codes, names and ids; configs fit the test registry
// (modules/_framework/__fixtures__/test-registry.ts).
import type { TemplateDefinition } from "@/lib/schemas/template";
import { TEST_CLIENT_ID, TEST_MANUFACTURER_ID } from "@/modules/_framework/__fixtures__/test-registry";

export function baseEg(): TemplateDefinition {
  return {
    code: "BASE_EG",
    name: "Standard examination gloves",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "XS" }, { value: "S" }, { value: "M" }, { value: "L" }, { value: "XL" }],
    modules: [
      { key: "header", include: true, labels: { client: "Client Name" } },
      { key: "glove_info", include: true },
      { key: "order_lots", include: true },
      { key: "packing_config", include: true },
      { key: "sampling_plan", include: true },
      { key: "carton_sampling", include: true },
      {
        key: "dimensions",
        include: true,
        config: {
          specs: {
            XS: { length: { kind: "min", min: 240 }, width: { kind: "max", max: 80 } },
            M: { length: { kind: "min", min: 240 }, width: { kind: "tolerance", nominal: 95, tolerance: 10 } },
          },
        },
      },
      { key: "force_at_break", include: true },
      { key: "weight", include: true, title: "Weight (g) - average of 13 gloves per size" },
      { key: "watertight", include: true },
      { key: "visual", include: true },
      { key: "dispensing_packing", include: true },
      { key: "labeling", include: true },
      { key: "conclusion", include: true },
    ],
    report: { title: "Preshipment Inspection: Nitrile Disposable Examination Gloves", showClientLogo: false },
    sourceFile: "BASE_EG/v1/report.xlsx",
  };
}

export function clientEg(): TemplateDefinition {
  return {
    code: "CLIENT_EG",
    name: "Client A examination gloves",
    extends: "BASE_EG",
    scope: { productType: "examination", standard: "ASTM_D6319", clientId: TEST_CLIENT_ID },
    unit: "pcs",
    sizes: [{ value: "xs" }, { value: "S" }, { value: "M", label: "Medium" }, { value: "L" }],
    modules: [
      { key: "header", include: true, labels: { poNo: "PO Number" } },
      { key: "packing_config", include: true, config: { innerUnit: "plastic pack" } },
      // Average instead of median; XS width 76 ± 4 where the base has ≤ 80.
      {
        key: "dimensions",
        include: true,
        config: { statistic: "average", specs: { XS: { width: { kind: "tolerance", nominal: 76, tolerance: 4 } } } },
      },
      { key: "weight", include: true, title: "Weight (g)", config: { n: 1 } },
      { key: "tensile", include: true },
      { key: "force_at_break", include: false },
      { key: "dispensing_safedon", include: true },
      { key: "watertight", include: true },
      { key: "visual", include: true, config: { classes: { major: { defects: ["thin_spot", "powder_mark"] } } } },
      { key: "dispensing_packing", include: false },
    ],
    customModules: [
      {
        key: "dispensing_spec",
        title: "Specification / Requirement",
        after: "dispensing_safedon",
        layout: "table",
        fields: [
          { key: "requirement", label: "Specification / Requirement", type: "text", required: true },
          { key: "conclusion", label: "Conclusion", type: "select", options: ["Passed", "Failed"] },
        ],
      },
    ],
    report: { title: "Preshipment Inspection: Client A Nitrile Gloves", showClientLogo: true },
  };
}

/** A third level: the client's template for one manufacturer. */
export function clientFactoryEg(): TemplateDefinition {
  return {
    code: "CLIENT_FACTORY_EG",
    name: "Client A gloves from Manufacturer A",
    extends: "CLIENT_EG",
    scope: {
      productType: "examination",
      standard: "ASTM_D6319",
      clientId: TEST_CLIENT_ID,
      manufacturerId: TEST_MANUFACTURER_ID,
    },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }],
    modules: [
      { key: "force_at_break", include: true },
      {
        key: "visual",
        include: true,
        labels: { thin_spot: "Thin spot", "major.bead_defective": "Bead defect" },
        config: { handSplit: true },
      },
    ],
  };
}

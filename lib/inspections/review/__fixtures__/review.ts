// Test data for the review: a resolved template and saved data run through
// the framework's test registry (modules/_framework/__fixtures__), whose
// small modules pass, fail and warn like the real ones will. Placeholder
// identifiers only (BUILD_SPEC 2, rule 7).
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { evaluateStoredInspection, type StoredInspection } from "../evaluate";
import type { ReviewData, ReviewInspection } from "../load";

export const INSPECTOR_ID = "00000000-0000-4000-8000-000000000101";
export const ADMIN_ID = "00000000-0000-4000-8000-000000000102";
export const INSPECTION_ID = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
export const VERSION = "2026-10-06T06:05:03.123456+00:00";

/** header, a custom section, glove info, order, packing, sampling, cartons, weight, visual, conclusion. */
export function reviewTemplate(overrides: Partial<ResolvedTemplate> = {}): ResolvedTemplate {
  return makeTestTemplate(
    TEST_REGISTRY,
    [
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "weight",
      { key: "visual", title: "Visual Inspection (AQL)" },
      "conclusion",
    ],
    {
      code: "TEST_EG",
      sizes: [
        { value: "S", label: "S" },
        { value: "M", label: "Medium" },
        { value: "L", label: "L" },
      ],
      customModules: [
        {
          key: "glove_type",
          title: "Glove Type",
          after: "header",
          layout: "fields",
          fields: [
            { key: "gloveType", label: "Glove type", type: "select", options: ["Powder-free", "Powdered"] },
            { key: "sterile", label: "Sterile", type: "yes_no" },
            { key: "length", label: "Length", type: "number", unit: "mm" },
          ],
        },
      ],
      ...overrides,
    },
  );
}

const thirteen = (value: number) => Array.from({ length: 13 }, () => value);

/** Saved data: M passes visual, L fails it; carton 2 twice for M; weight 20% off for M. */
export function savedData() {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Product A", client: "Client A" },
      glove_info: { indicativeWeight: 3.5, colour: "Blue", comment: "Weight from the spec sheet." },
      order_lots: {
        lots: [
          { size: "M", qtyCases: 100, lotNumbers: ["LOT-M-0001"] },
          { size: "L", qtyCases: 50, lotNumbers: ["LOT-L-0001"] },
        ],
      },
      packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000 },
      sampling_plan: { sizes: { M: { cases: 3, watertightVisual: 125, dimensions: 13 }, L: { cases: 2, watertightVisual: 80, dimensions: 13 } } },
      carton_sampling: { sizes: { M: [1, 2, 2], L: [7, 9] } },
      weight: { sizes: { M: { values: thirteen(2.8) }, L: { values: thirteen(3.1) } } },
      visual: { sizes: { M: { critical: 0, major: 1 }, L: { critical: 1, major: 0 } }, comment: "One embedded insect in size L." },
      conclusion: { finalResult: "fail", remark: "Critical defect in size L." },
    },
    custom: { glove_type: { gloveType: "Powder-free", sterile: false, length: 240 } },
  };
}

export function storedInspection(overrides: Partial<StoredInspection> = {}): StoredInspection {
  return {
    refNo: "INS-2026-0001",
    inspectionDate: "2026-10-05",
    data: savedData(),
    moduleOverrides: {},
    resolved: reviewTemplate(),
    inspector: { id: INSPECTOR_ID, name: "Inspector A" },
    client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
    manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A" },
    ...overrides,
  };
}

export function evaluated(overrides: Partial<StoredInspection> = {}) {
  return evaluateStoredInspection(storedInspection(overrides), TEST_REGISTRY);
}

export function reviewInspection(overrides: Partial<ReviewInspection> = {}): ReviewInspection {
  return {
    id: INSPECTION_ID,
    refNo: "INS-2026-0001",
    status: "submitted",
    version: VERSION,
    inspectionDate: "2026-10-05",
    poNo: "PO-0001",
    productName: "Product A",
    lotNumbers: ["LOT-M-0001", "LOT-L-0001"],
    client: "Client A",
    manufacturer: "Manufacturer A · Plant 1",
    inspector: { id: INSPECTOR_ID, name: "Inspector A", leadId: null },
    createdAt: "2026-10-05T01:00:00.000000+00:00",
    submittedAt: "2026-10-05T06:30:00.000000+00:00",
    approvedAt: null,
    approver: null,
    result: "fail",
    remarks: "Critical defect in size L.",
    savedSuggestion: "fail",
    ...overrides,
  };
}

export function reviewData(overrides: Partial<ReviewData> = {}): ReviewData {
  return {
    viewer: { id: ADMIN_ID, name: "Admin A", role: "admin" },
    inspection: reviewInspection(),
    template: { id: "40000000-0000-4000-8000-000000000001", code: "TEST_EG", version: 3, name: "Test examination gloves" },
    evaluation: evaluated(),
    overrides: [],
    photos: { items: [], total: 0, failed: false },
    history: { entries: [], failed: false },
    ...overrides,
  };
}

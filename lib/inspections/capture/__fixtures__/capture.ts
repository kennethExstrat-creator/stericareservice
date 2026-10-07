// A template and data for the capture tests, on the framework's test
// registry (modules/_framework/__fixtures__/test-registry.ts), so they keep
// testing the screen's rules whichever real modules are built.
import type { CustomModule, ResolvedTemplate } from "@/lib/schemas/template";
import { TEST_ADMIN_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import type { InspectionData } from "@/modules/_framework";
import type { CaptureMeta } from "../evaluate";

export { TEST_ADMIN_ID, TEST_REGISTRY };

export const SITE_NOTES: CustomModule = {
  key: "site_notes",
  title: "Site notes",
  after: "glove_info",
  layout: "fields",
  fields: [
    { key: "weather", label: "Weather", type: "text" },
    { key: "sealIntact", label: "Seal intact", type: "yes_no", required: true },
    { key: "colourAgain", label: "Colour on the form", type: "text", mapsTo: "modules.glove_info.colour" },
  ],
};

export const SIZE_TABLE: CustomModule = {
  key: "size_checks",
  title: "Size checks",
  after: "weight",
  layout: "table",
  fields: [{ key: "requirement", label: "Requirement", type: "text", required: true }],
};

/** header, glove_info, (site notes), order_lots, packing_config, weight, (size checks), conclusion. */
export function testTemplate(): ResolvedTemplate {
  return makeTestTemplate(TEST_REGISTRY, ["glove_info", "order_lots", "packing_config", "weight"], {
    customModules: [SITE_NOTES, SIZE_TABLE],
  });
}

export const TEST_META: CaptureMeta = {
  refNo: "INS-2026-0001",
  inspectionDate: "2026-10-06",
  inspector: { ...TEST_INSPECTOR },
  client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
  manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A" },
};

export function emptyData(): InspectionData {
  return { modules: {}, custom: {} };
}

/** Header and order filled in, two sizes ordered with their lots. */
export function filledData(): InspectionData {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Nitrile gloves", client: "Client A" },
      glove_info: { indicativeWeight: 3.5, colour: "Blue", comment: "Checked against the box." },
      order_lots: {
        lots: [
          { size: "M", qtyCases: 10, lotNumbers: ["LOT-M-0001", "LOT-M-0002"] },
          { size: "L", qtyCases: 5, lotNumbers: ["LOT-L-0001"] },
        ],
      },
    },
    custom: {},
  };
}

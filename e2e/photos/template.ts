// The temporary template of the photo specs: a resolved template (what
// templates.resolved holds) with modules that tag photos in different ways
// (size; size, hand and defect; size and box) and one that takes lab
// reports. Checked against ResolvedTemplateSchema in template.test.ts, so
// the gallery reads its titles and sizes as it would a real template.

export const PHOTOS_TEMPLATE_CODE = "E2E_PHOTOS";

/** Module titles as the template words them. */
export const TITLES = {
  header: "Preshipment Inspection",
  order_lots: "Order Quantity & Lot Numbers",
  dimensions: "Dimensions",
  force_at_break: "Force at Break",
  watertight: "Watertight Test",
  visual: "Visual Inspection",
  dispensing_packing: "Glove Dispensing & Packing",
  labeling: "Labelling",
  conclusion: "Conclusion",
} as const;

export const THIN_SPOT_LABEL = "Thin spot";

type ModuleKey = keyof typeof TITLES;

/**
 * The same modules by their short names, as the gallery, the tag picker and
 * the photo viewer name them (docs/DESIGN.md, Step Names; lib/templates/short-titles.ts).
 */
export const NAMES: Readonly<Record<ModuleKey, string>> = {
  header: "Manufacturer",
  order_lots: "Order",
  dimensions: "Dimension",
  force_at_break: "Force at Break",
  watertight: "Watertight Test",
  visual: "Visual Inspection",
  dispensing_packing: "Packing Check",
  labeling: "Labeling",
  conclusion: "Conclusion",
};

function entry(key: ModuleKey, labels: Record<string, string> = {}, include = true) {
  return { key, include, title: TITLES[key], labels, config: {} };
}

export function photosResolvedTemplate() {
  return {
    format: 2,
    code: PHOTOS_TEMPLATE_CODE,
    name: "Photos e2e fixture (temporary)",
    chain: [PHOTOS_TEMPLATE_CODE],
    bases: [],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [
      { value: "S", label: "S" },
      { value: "M", label: "M" },
      { value: "L", label: "L" },
    ],
    modules: [
      entry("header"),
      entry("order_lots"),
      entry("dimensions"),
      entry("force_at_break"),
      entry("watertight"),
      entry("visual", { thin_spot: THIN_SPOT_LABEL }),
      entry("dispensing_packing"),
      // Switched off in the template: photos cannot be tagged with it.
      entry("labeling", {}, false),
      entry("conclusion"),
    ],
    customModules: [],
    report: { title: "Preshipment Inspection (photos e2e fixture)", showClientLogo: false },
    sourceFile: null,
  };
}

/** templates.definition: only stored, never resolved, since the row is a draft only these specs use. */
export function photosTemplateDefinition() {
  return {
    code: PHOTOS_TEMPLATE_CODE,
    name: "Photos e2e fixture (temporary)",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "S" }, { value: "M" }, { value: "L" }],
    modules: [],
  };
}

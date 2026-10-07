// The data dictionary (BUILD_SPEC 4.2 rules 3 and 5, 6.1, 6.2): for every
// module, its canonical data fields, its config fields with their complete
// defaults, and its captions, with STD_EG's wording as the default label and
// the other templates' wording as overrides. Module schemas
// (modules/<key>/schema.ts, config.ts) are written from this.
// docs/DATA_DICTIONARY.md renders it.
import type { ModuleKey } from "@/lib/schemas/module-result";
import {
  LABELLING_CHECK_LISTS,
  listItems,
  safedonDefectItems,
  stickinessCodes,
  VISUAL_DEFECTS,
  WATERTIGHT_LOCATIONS,
} from "./defects";
import {
  CODE_LETTERS,
  DOCUMENT_ITEMS,
  GLOVE_INFO_FIELDS,
  HEADER_FIELDS,
  INSPECTION_LEVELS,
  LOADING_FIELDS,
  MEASURES,
  SAMPLING_COLUMNS,
} from "./keys";
import type { DataFieldSpec, Entry, LabelSpec, ModuleSpec, RuleNumber, TemplateCode } from "./types";

/** BUILD_SPEC 6.2, in short. Every module follows them; `rules` on a module or field cites them. */
export const VALIDATION_RULES: Readonly<Record<RuleNumber, string>> = {
  1: "Numeric cells accept numbers only: '2 42' is rejected, not stored as text.",
  2: "Totals, averages, medians, rates, code letters and accept/reject limits are computed, never typed.",
  3: "Counts never turn into dates; dates use date pickers.",
  4: "Sizes not in order_lots appear in no module.",
  5: "A module with missing data shows Not Done, never Passed.",
  6: "Carton numbers are unique per size, from 1 to the order quantity, as many as the sampled cases.",
  7: "Box numbers in dispensing_packing, dispensing_safedon and labeling are picked from the size's carton list.",
  8: "The sample size sets the code letter and limits; a plan that does not match the sample size cannot be saved.",
  9: "Measured weight more than the threshold away from the indicative weight raises a warning.",
  10: "Client, product code and PO are entered once in header and reused everywhere, the export included.",
  11: "The inspector is always recorded; section and result labels come from the template, not editable on capture.",
};

function defineModule<const T extends ModuleSpec>(spec: T): T {
  return spec;
}

const allOn = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, true])) as Record<K, true>;

const RESULT = ["pass", "fail", "not_done"] as const;

/** Decimals both reports print a dimension statistic with: length and width 0, thickness 2. */
export const DIMENSION_DECIMALS = { length: 0, width: 0, fingerThickness: 2, palmThickness: 2, cuffThickness: 2 } as const;

/* ------------------------------------------------------------------ *
 * Report modules, in BUILD_SPEC 6.1 order
 * ------------------------------------------------------------------ */

const header = defineModule({
  key: "header",
  kind: "report",
  alwaysOn: true,
  title: "Manufacturer Information",
  titles: { STD_SG: "Purchase Order / Shipment Information" },
  captures:
    "Manufacturer and factory address, PO, product, client, factory glove code, inspection, manufacturing and expiry dates, and the inspector.",
  result: "info; warn when the expiry date is not after the manufacturing date.",
  rules: [3, 10, 11],
  data: [
    {
      key: "manufacturer",
      label: "Manufacturer / Supplier",
      labels: { STD_SG: "Manufacturer Name" },
      type: "reference",
      per: [],
      entry: "entered",
      column: "inspections.manufacturer_id",
      notes:
        "Picked on /inspections/new, where it resolves the template (BUILD_SPEC 4.4). Shown as the manufacturer's name with the factory name in brackets, as the reports print it (manufacturers.name, factory_name).",
    },
    {
      key: "factoryAddress",
      label: "Supplier Factory Address / Location",
      type: "textarea",
      per: [],
      entry: "entered",
      prefill: "manufacturers.address of the picked manufacturer",
    },
    {
      key: "poNo",
      label: "PO / SO Number",
      labels: { SAFEDON_EG: "PO Number", STD_SG: "Purchase/Sales Order No." },
      type: "text",
      per: [],
      entry: "entered",
      column: "inspections.po_no",
      rules: [10],
      notes:
        "One text value as printed: the PO with the SO or the client's own reference in brackets. Entered once, reused everywhere (rule 10).",
    },
    {
      key: "productName",
      label: "Product Name (Brand, Code & Description)",
      labels: { SAFEDON_EG: "Product Name (Brand & Code)", STD_SG: "Product Name" },
      type: "textarea",
      per: [],
      entry: "entered",
      column: "inspections.product_name",
      rules: [10],
      notes:
        "Brand, product code and description in one value, as printed (up to two lines), so the report keeps the source's wording.",
    },
    {
      key: "productCode",
      label: "Product Code",
      type: "text",
      per: [],
      entry: "entered",
      rules: [10],
      notes:
        "The product code on its own, entered once and reused everywhere: export, report header, file names (rule 10). The STD_EG example printed HN91 in the report but GN91 in the file name; one field prevents that. Feeds HeaderValues.productCode in the inspection context.",
    },
    {
      key: "client",
      label: "Client Name",
      type: "reference",
      per: [],
      entry: "entered",
      column: "inspections.client_id",
      rules: [10],
      notes:
        "Picked on /inspections/new; may be empty. SAFEDON_EG prints the client as the report logo (clients.logo_path) instead of a row.",
    },
    {
      key: "factoryGloveCode",
      label: "Factory Glove Code",
      type: "text",
      per: [],
      entry: "entered",
      notes: "Printed 'Factrory glove code' [sic].",
    },
    {
      key: "inspectionDate",
      label: "Inspection Date",
      labels: { STD_SG: "Date" },
      type: "date",
      per: [],
      entry: "entered",
      prefill: "today in Malaysia (the column default)",
      column: "inspections.inspection_date",
      rules: [3],
    },
    {
      key: "mfgDate",
      label: "Manufacturing Date",
      labels: { STD_SG: "Mfg Date" },
      type: "date",
      per: [],
      entry: "entered",
      rules: [3],
      notes:
        "The onsite forms have one 'Mfg / Exp Date' box; the app splits it into mfgDate and expiryDate. Precision: config mfgExpiryPrecision.",
    },
    {
      key: "expiryDate",
      label: "Expiry Date",
      labels: { STD_SG: "Exp Date" },
      type: "date",
      per: [],
      entry: "entered",
      rules: [3],
      notes: "The module warns when it is not after mfgDate.",
    },
    {
      key: "inspector",
      label: "Inspected By",
      type: "reference",
      per: [],
      entry: "system",
      column: "inspections.inspector_id",
      rules: [11],
      notes:
        "The logged-in inspector, always recorded (rule 11). config fields.inspector only shows or hides the row: the STD_EG report prints none, the onsite forms and the SAFEDON_EG report do.",
    },
  ],
  config: [
    {
      key: "fields",
      type: "Record<HeaderField, boolean>",
      default: allOn(HEADER_FIELDS),
      meaning: "Which header fields show (BUILD_SPEC: fields on/off). The inspector is recorded even when its row is off.",
    },
    {
      key: "mfgExpiryPrecision",
      type: '"day" | "month"',
      default: "day",
      meaning:
        "Manufacturing and expiry dates as a full date or as month and year. SAFEDON_EG prints month and year; stored as the first of the month (open question).",
    },
  ],
  labels: [],
  notes: [
    "BUILD_SPEC 6.1 lists 'report date' here. Both reports print that date once, in the conclusion block: it is conclusion.date.",
    "The onsite forms' 'Lot Number' goes to order_lots, 'Packing Mode' to packing_config and 'Glove Type' to the custom module glove_type.",
  ],
});

const gloveInfo = defineModule({
  key: "glove_info",
  kind: "report",
  alwaysOn: false,
  title: "Glove Information",
  captures: "Surface texture, indicative weight (size M, g), colour and length, as the reports print them.",
  result: "info.",
  rules: [1, 9],
  data: [
    { key: "surfaceTexture", label: "Glove Surface Texture", type: "text", per: [], entry: "entered" },
    {
      key: "indicativeWeight",
      label: "Indicative Weight (Size M)",
      type: "decimal",
      unit: "g",
      per: [],
      entry: "entered",
      rules: [1, 9],
      notes:
        "Weight of one glove of the size in config indicativeWeightSize ('(Size M)' in the label). The weight module compares that size's average with it (rule 9).",
    },
    { key: "colour", label: "Glove Colour", type: "text", per: [], entry: "entered" },
    {
      key: "length",
      label: "Glove Length",
      type: "text",
      per: [],
      entry: "entered",
      notes: "Free text as printed (a minimum length in mm). The measured length and its spec are in dimensions.",
    },
  ],
  config: [
    {
      key: "fields",
      type: "Record<GloveInfoField, boolean>",
      default: allOn(GLOVE_INFO_FIELDS),
      meaning: "Which fields show (BUILD_SPEC: fields on/off).",
    },
    {
      key: "indicativeWeightSize",
      type: "size",
      default: "M",
      meaning: "The size the indicative weight is for. Only that size's weight is compared with it.",
    },
  ],
  labels: [],
});

const orderLots = defineModule({
  key: "order_lots",
  kind: "report",
  alwaysOn: false,
  title: "Order",
  titles: { STD_SG: "PO Info" },
  captures: "Per size: quantity in cases, lot numbers and packing site. Totals: cartons and gloves.",
  result: "info.",
  rules: [1, 2, 4],
  data: [
    {
      key: "qtyCases",
      label: "Qty (Cases)",
      labels: { STD_SG: "Qty (Case)" },
      type: "integer",
      countOf: "cases",
      per: ["size"],
      entry: "entered",
      rules: [1, 4],
      notes:
        "A size with a quantity is ordered: only ordered sizes appear in any module (rule 4). The sampling plan's 'Order Qty (Case)' column shows this value again.",
    },
    {
      key: "lotNumbers",
      label: "Lot Number",
      type: "text_list",
      per: ["size"],
      entry: "entered",
      column: "inspections.lot_numbers (copy, for search)",
      notes: "One or more lots per size. The onsite forms have one box for all lots of the order.",
    },
    {
      key: "packingSite",
      label: "Packing Site",
      type: "text",
      per: ["size"],
      entry: "entered",
      notes: "One per size row, as printed (SAFEDON_EG). config fields.packingSite switches it on.",
    },
    {
      key: "lotSizeGloves",
      label: "Lot Size (Gloves)",
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "computed",
      formula: "qtyCases × packing_config.glovesPerCase. The lot size the AQL plan starts from (BUILD_SPEC 7).",
      rules: [2],
    },
    {
      key: "totalCartons",
      label: "Total # Carton",
      type: "integer",
      countOf: "cases",
      per: [],
      entry: "computed",
      formula: "Sum of qtyCases.",
      rules: [2],
    },
    {
      key: "totalGloves",
      label: "Total # Gloves",
      type: "integer",
      unit: "pcs",
      per: [],
      entry: "computed",
      formula: "totalCartons × packing_config.glovesPerCase.",
      rules: [2],
    },
  ],
  config: [
    {
      key: "fields",
      type: "{ packingSite: boolean }",
      default: { packingSite: false },
      meaning: "Packing site on or off. The size list is the template's `sizes`.",
    },
  ],
  labels: [{ key: "size", label: "Size", meaning: "Caption of the size column." }],
  notes: ["The reports print no heading over the order table: 'Order' is the app's title for it."],
});

const packingConfig = defineModule({
  key: "packing_config",
  kind: "report",
  alwaysOn: false,
  title: "Packing Configuration",
  titles: { STD_SG: "Packing Mode" },
  captures: "Gloves per inner unit, inner units per case, gloves per case; the inner unit's name; the onsite packing mode text.",
  result: "warn when glovesPerCase is not glovesPerInner × innersPerCase; info otherwise.",
  rules: [1, 2],
  data: [
    {
      key: "glovesPerInner",
      label: "# Glove per Inner Box",
      // STD_SG's inner unit is the pouch (BUILD_SPEC 11); the SG form has no packing counts to word it.
      labels: { SAFEDON_EG: "# Glove per Plastic Pack", STD_SG: "# Gloves per Pouch" },
      type: "integer",
      unit: "pcs",
      per: [],
      entry: "entered",
      rules: [1],
    },
    {
      key: "innersPerCase",
      label: "# Inners per Case",
      labels: { SAFEDON_EG: "# Packs per Case", STD_SG: "# Pouches per Case" },
      type: "integer",
      countOf: "inner units",
      per: [],
      entry: "entered",
      rules: [1],
    },
    {
      key: "glovesPerCase",
      label: "# Gloves per Case",
      type: "integer",
      unit: "pcs",
      per: [],
      entry: "entered",
      rules: [1],
      notes: "Entered as printed, then checked against glovesPerCaseCheck (BUILD_SPEC 6.1).",
    },
    {
      key: "packingMode",
      label: "Packing Mode",
      type: "text",
      per: [],
      entry: "entered",
      addition: "All three onsite forms have a 'Packing Mode' text box (forms/README.md: packing mode text).",
      notes: "Free text as written on site. config fields.packingMode switches it on.",
    },
    {
      key: "glovesPerCaseCheck",
      label: "Gloves per Case (Inner × per Case)",
      type: "integer",
      unit: "pcs",
      per: [],
      entry: "computed",
      formula: "glovesPerInner × innersPerCase.",
      rules: [2],
    },
  ],
  config: [
    {
      key: "innerUnit",
      type: '"inner_box" | "plastic_pack" | "dispenser_box" | "pouch"',
      default: "inner_box",
      meaning: "What one inner unit is. The wording of every label that names it is set per template.",
    },
    {
      key: "fields",
      type: "{ packingMode: boolean }",
      default: { packingMode: false },
      meaning: "The onsite forms' Packing Mode text on or off.",
    },
  ],
  labels: [],
});

const samplingPlan = defineModule({
  key: "sampling_plan",
  kind: "report",
  alwaysOn: false,
  title: "Sampling Plan",
  captures:
    "Per size: sampled cases, inner units and gloves; gloves for watertight and visual, for dimensions and for the physical test; inner units for packaging and dispensing; pouches and dye leak pouches (surgical).",
  result: "warn when a size's watertight and visual sample is below the AQL plan of config inspectionLevel; info otherwise.",
  rules: [1, 2, 4, 6, 8],
  data: [
    {
      key: "cases",
      label: "Case",
      type: "integer",
      countOf: "cases",
      per: ["size"],
      entry: "entered",
      rules: [1, 6],
      notes: "carton_sampling must list exactly this many carton numbers (rule 6).",
    },
    {
      key: "innerUnits",
      label: "Inner Box",
      labels: { SAFEDON_EG: "Inner Pack" },
      type: "integer",
      countOf: "inner units",
      per: ["size"],
      entry: "entered",
      rules: [1],
    },
    { key: "gloves", label: "Gloves", type: "integer", unit: "pcs", per: ["size"], entry: "entered", rules: [1] },
    {
      key: "glovesWatertightVisual",
      label: "# Gloves for Watertight & Visual",
      labels: { STD_SG: "# Gloves" },
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "entered",
      rules: [1, 8],
      notes: "Flows forward as n in watertight and visual (BUILD_SPEC 8). SG prints it under 'Sampling Quantity (WTT & Visual)'.",
    },
    {
      key: "glovesDimensions",
      label: "# Gloves for Dimension",
      labels: { STD_SG: "# Gloves Dimension" },
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "Flows forward as the dimension rows.",
    },
    {
      key: "glovesPhysical",
      label: "# Gloves for FAB",
      labels: { SAFEDON_EG: "# Gloves for Tensile", STD_SG: "# Gloves (FAB)" },
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "Gloves for the physical test: force at break (EN 455) or tensile (ASTM D6319).",
    },
    {
      key: "innerUnitsDispensing",
      label: "# Inner Box for Packaging & Dispensing Inspection",
      labels: { SAFEDON_EG: "# Inner Packs for Packaging & Dispensing Inspection" },
      type: "integer",
      countOf: "inner units",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "Printed 'packaing' [sic]. Flows forward as the box rows of dispensing_packing or dispensing_safedon.",
    },
    {
      key: "pouches",
      label: "Pouches",
      type: "integer",
      countOf: "pouches",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "Surgical: sampled pouches (SG onsite).",
    },
    {
      key: "pouchesDyeLeak",
      label: "# Pouches (Dye Leak Test)",
      type: "integer",
      countOf: "pouches",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "Surgical: flows forward as dye_leak.pouchesTested.",
    },
    {
      key: "inspectionLevel",
      label: "Inspection Level",
      type: "select",
      options: INSPECTION_LEVELS,
      per: [],
      entry: "computed",
      formula: "config inspectionLevel, else the client's; none without either. The level the plans are worked out at.",
      rules: [2, 8],
    },
    {
      key: "lotSizeGloves",
      label: "Lot Size (Gloves)",
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "computed",
      formula: "order_lots.lotSizeGloves: qtyCases × packing_config.glovesPerCase. The lot the inspection level's plan is for.",
      rules: [2],
    },
    {
      key: "codeLetter",
      label: "Code Letter",
      type: "select",
      options: CODE_LETTERS,
      per: ["size"],
      entry: "computed",
      formula:
        "ISO 2859-1 Table 1 from order_lots.lotSizeGloves and config inspectionLevel (lib/aql planFromLotSize); none without a level.",
      rules: [2, 8],
    },
    {
      key: "planSampleSize",
      label: "Sample Size by Plan",
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "computed",
      formula:
        "The largest Table 2-A n for codeLetter among the AQLs the inspection checks on the watertight and visual sample (watertight, and visual's classes switched on), arrows followed; Table 1's n when it checks none. A glovesWatertightVisual below it raises the module warning.",
      rules: [2, 8],
    },
    {
      key: "totals",
      label: "Total:",
      type: "count_map",
      keyedBy: "sampling column",
      per: [],
      entry: "computed",
      formula: "Sum over the ordered sizes of each column on (the onsite forms' Total: row).",
      rules: [2],
    },
  ],
  config: [
    {
      key: "columns",
      type: "Record<SamplingColumn, boolean>",
      default: { ...allOn(SAMPLING_COLUMNS), pouches: false, pouchesDyeLeak: false },
      meaning: "Columns on or off (BUILD_SPEC: columns on/off). The surgical pouch columns are off by default.",
    },
    {
      key: "inspectionLevel",
      type: '"S-1" | "S-2" | "S-3" | "S-4" | "I" | "II" | "III" | null',
      default: null,
      meaning:
        "ISO 2859-1 level used to suggest n per size from the lot size and flag a sample below the plan. null: samples are entered directly with no plan check.",
    },
  ],
  labels: [
    {
      key: "samplingQuantity",
      label: "Sampling Quantity",
      labels: { STD_SG: "Sampling Quantity (WTT & Visual)" },
      meaning: "Caption over the case, inner unit and glove (and pouch) columns.",
    },
    {
      key: "orderQty",
      label: "Order Qty (Case)",
      labels: { STD_SG: "Qty (Case)" },
      meaning: "Caption of the column that shows order_lots.qtyCases again.",
    },
    { key: "gloveSize", label: "Glove Size", meaning: "Caption of the size column on the capture screen." },
  ],
});

const cartonSampling = defineModule({
  key: "carton_sampling",
  kind: "report",
  alwaysOn: false,
  title: "Finished Goods Sampling Information (Carton Number)",
  captures: "Per size: the sampled carton numbers.",
  result: "fail on a validation error (rule 6); pass when every ordered size has its full, valid list; not_done before.",
  rules: [1, 2, 4, 6],
  data: [
    {
      key: "cartonNumbers",
      label: "(Carton #)",
      type: "integer_list",
      per: ["size"],
      entry: "entered",
      rules: [1, 6],
      notes:
        "Unique per size, each from 1 to order_lots.qtyCases, as many as sampling_plan.cases (rule 6). The report grid holds 50 (10 columns × 5 rows); the app takes as many as were sampled. Box pickers in dispensing and labeling read this list (rule 7).",
    },
    {
      key: "samplingQuantity",
      label: "Sampling Quantity",
      type: "integer",
      countOf: "cartons",
      per: ["size"],
      entry: "computed",
      formula: "Count of cartonNumbers; must equal sampling_plan.cases.",
      rules: [2, 6],
    },
  ],
  config: [],
  labels: [{ key: "sizeCaption", label: "{size} (Carton #)", meaning: "Caption of each size's grid." }],
});

const dimensions = defineModule({
  key: "dimensions",
  kind: "report",
  alwaysOn: false,
  title: "Dimension",
  captures: "Per size, per glove (default 13): the measures on, from length, width, finger, palm and cuff thickness (mm).",
  result:
    "Per size and measure: the statistic against the spec (pass, fail, na for an NA or missing spec). Fail if any measure fails; not_done until every glove row of every ordered size is complete.",
  rules: [1, 2, 4, 5],
  data: [
    { key: "length", label: "Length", type: "decimal", unit: "mm", per: ["size", "glove"], entry: "entered", rules: [1] },
    { key: "width", label: "Width", type: "decimal", unit: "mm", per: ["size", "glove"], entry: "entered", rules: [1] },
    {
      key: "fingerThickness",
      label: "Finger Thickness",
      type: "decimal",
      unit: "mm",
      per: ["size", "glove"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "palmThickness",
      label: "Palm Thickness",
      type: "decimal",
      unit: "mm",
      per: ["size", "glove"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "cuffThickness",
      label: "Cuff Thickness",
      type: "decimal",
      unit: "mm",
      per: ["size", "glove"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "statistic",
      label: "Median",
      labels: { SAFEDON_EG: "Average" },
      type: "decimal",
      unit: "mm",
      per: ["size"],
      keyedBy: "measure",
      entry: "computed",
      formula: "Median or average (config statistic) of the measure's glove values, shown at config decimals.",
      rules: [2],
    },
    {
      key: "measureResult",
      label: "P/F *",
      labels: { SAFEDON_EG: "A / Rej." },
      type: "select",
      options: ["pass", "fail", "na", "not_done"],
      per: ["size"],
      keyedBy: "measure",
      entry: "computed",
      formula:
        "statistic against the measure's spec in the size's row of config specs (lib/stats summarizeColumn); an NA or missing spec gives na.",
      rules: [2, 5],
    },
  ],
  config: [
    {
      key: "measures",
      type: "Measure[]",
      default: MEASURES,
      meaning: "The measures on, in column order (BUILD_SPEC: measures on/off).",
    },
    {
      key: "statistic",
      type: '"median" | "average"',
      default: "median",
      meaning: "Median (EN 455 style, STD_EG) or average (ASTM style, SAFEDON_EG).",
    },
    {
      key: "specs",
      type: "{ size: string; specs: Partial<Record<Measure, Spec>> }[]",
      default: [],
      meaning:
        "One row per size with the spec of each measure, as lib/stats Spec: min (≥), max (≤), range, tolerance (nominal ± tolerance) or na. A list, so a child template replaces it whole; a size or measure with no spec is not judged. Empty by default: specs belong to the product (BUILD_SPEC 13).",
    },
    {
      key: "decimals",
      type: "Record<Measure, number>",
      default: DIMENSION_DECIMALS,
      meaning:
        "Decimals the statistic is shown with, as the reports print it, for every measure (on or off). lib/stats judges the shown value.",
    },
    {
      key: "rows",
      type: "number",
      default: 13,
      meaning: "Gloves per size. sampling_plan.glovesDimensions sets it when entered.",
    },
  ],
  labels: [
    { key: "sizeHeading", label: "Dimension - Size {size}", meaning: "Heading of each size's table." },
    { key: "rowNo", label: "No.", meaning: "Caption of the glove row number column." },
    { key: "specRow", label: "Spec.", meaning: "Caption of the spec row (config specs, printed as lib/stats formatSpec)." },
    { key: "pass", label: "Passed", labels: { SAFEDON_EG: "A" }, meaning: "Word for pass in the result row." },
    { key: "fail", label: "Failed", labels: { SAFEDON_EG: "Rej." }, meaning: "Word for fail in the result row." },
  ],
});

const weight = defineModule({
  key: "weight",
  kind: "report",
  alwaysOn: false,
  title: "Weight (g) - Average of 13 Gloves per Size",
  titles: { SAFEDON_EG: "Weight (g)" },
  captures: "Per size: the gloves weighed (1 or 13 values) and their average, compared with the indicative weight.",
  result:
    "Per size: pass or fail against a spec when one is set; warn when the size of the indicative weight deviates by more than the threshold; info otherwise. not_done until n values are entered.",
  rules: [1, 2, 4, 5, 9],
  data: [
    {
      key: "values",
      label: "Weight (g)",
      type: "decimal_list",
      unit: "g",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes:
        "config n values per size: 13 gloves weighed one by one (STD_EG) or one value per size (SAFEDON_EG, printed as a merged column of the dimension table).",
    },
    {
      key: "average",
      label: "Average",
      type: "decimal",
      unit: "g",
      per: ["size"],
      entry: "computed",
      formula: "Mean of values (the value itself when n is 1), shown at config decimals.",
      rules: [2],
    },
    {
      key: "deviationPct",
      label: "Deviation From Indicative Weight",
      type: "decimal",
      unit: "%",
      per: ["size"],
      entry: "computed",
      formula:
        "(average − glove_info.indicativeWeight) / glove_info.indicativeWeight × 100, for the size in glove_info config indicativeWeightSize only.",
      rules: [2, 9],
    },
    {
      key: "result",
      label: "Remark",
      labels: { SAFEDON_EG: "A / Rej." },
      type: "select",
      options: ["pass", "fail", "warn", "info", "not_done"],
      per: ["size"],
      entry: "computed",
      formula:
        "Against the size's row of config specs when there is one; warn when |deviationPct| > config warnThresholdPct; info otherwise.",
      rules: [2, 5, 9],
    },
  ],
  config: [
    { key: "n", type: "number", default: 13, meaning: "Gloves weighed per size: 13 one by one, or 1 value." },
    {
      key: "specs",
      type: "{ size: string; spec: Spec }[]",
      default: [],
      meaning:
        "Optional spec per size (BUILD_SPEC: optional spec), one row per size; a list, so a child template replaces it whole. A size with no row has no spec row and its result is info.",
    },
    {
      key: "warnThresholdPct",
      type: "number",
      default: 10,
      meaning: "Deviation from the indicative weight, in %, above which the module warns (rule 9).",
    },
    { key: "decimals", type: "number", default: 2, meaning: "Decimals the average is shown with (both reports print 2)." },
  ],
  labels: [
    { key: "info", label: "Info", labels: { SAFEDON_EG: "A" }, meaning: "Word printed for a result with no spec." },
    { key: "rowNo", label: "No.", meaning: "Caption of the glove row number column (13 gloves weighed one by one)." },
    { key: "specRow", label: "Spec.", meaning: "Caption of the spec row (config specs, printed as lib/stats formatSpec)." },
    {
      key: "pass",
      label: "Passed",
      labels: { SAFEDON_EG: "A" },
      meaning: "Word for pass in the result row of a size with a spec.",
    },
    {
      key: "fail",
      label: "Failed",
      labels: { SAFEDON_EG: "Rej." },
      meaning: "Word for fail in the result row of a size with a spec.",
    },
  ],
});

const forceAtBreak = defineModule({
  key: "force_at_break",
  kind: "report",
  alwaysOn: false,
  title: "Force at Break in Newton (Refer to Attached Where Applicable)",
  captures: "Per size, per glove (default 13): force at break (N), its median, and the lab report file.",
  result: "Per size: the median against config specMin. not_done until n readings are entered.",
  rules: [1, 2, 4, 5],
  data: [
    {
      key: "values",
      label: "Force at Break (N)",
      type: "decimal_list",
      unit: "N",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "config n readings per size, from the lab report. The report prints only their median.",
    },
    {
      key: "labReport",
      label: "Lab Report",
      type: "file",
      per: [],
      entry: "entered",
      notes:
        "'Refer to attached where applicable': inspection_files, kind lab_report, module force_at_break. Tag a size when the lab issues one report per size.",
    },
    {
      key: "median",
      label: "Median",
      type: "decimal",
      unit: "N",
      per: ["size"],
      entry: "computed",
      formula: "Median of values, shown at config decimals.",
      rules: [2],
    },
    {
      key: "result",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "median ≥ config specMin.",
      rules: [2, 5],
    },
  ],
  config: [
    { key: "n", type: "number", default: 13, meaning: "Readings per size." },
    { key: "specMin", type: "number (N)", default: 6, meaning: "Minimum median force at break, every size." },
    {
      key: "standardLabel",
      type: "string | null",
      default: null,
      meaning: "Standard printed with the spec, e.g. 'Spec. (EN 455)'. STD_EG prints none.",
    },
    { key: "decimals", type: "number", default: 3, meaning: "Decimals the median is shown with (STD_EG prints 3)." },
  ],
  labels: [
    { key: "rowNo", label: "No.", meaning: "Caption of the reading number column." },
    { key: "specRow", label: "Spec.", meaning: "Caption of the spec row (≥ specMin N)." },
  ],
});

const tensile = defineModule({
  key: "tensile",
  kind: "report",
  alwaysOn: false,
  title: "Physical Properties Average (Refer to Attached Lab. Reports)",
  captures: "Per size: tensile strength average (MPa) and elongation at break average (%) from the lab report; the lab report file.",
  result: "Per size: both averages against their minimums; fail if either fails. not_done until both values and the lab report are in.",
  rules: [1, 2, 4, 5],
  data: [
    {
      key: "tensileStrength",
      label: "Tensile Strength (Average) (MPa)",
      type: "decimal",
      unit: "MPa",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes:
        "The lab report's average, typed as printed: the app holds no individual readings (BUILD_SPEC 6.1), so this is a typed average, not one the app computes.",
    },
    {
      key: "elongationAtBreak",
      label: "Elongation at Break, Average (%)",
      type: "decimal",
      unit: "%",
      per: ["size"],
      entry: "entered",
      rules: [1],
      notes: "The lab report's average, typed as printed.",
    },
    {
      key: "labReport",
      label: "Lab Report",
      type: "file",
      per: [],
      entry: "entered",
      notes: "Required (BUILD_SPEC 6.1): inspection_files, kind lab_report, module tensile.",
    },
    {
      key: "tensileResult",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "tensileStrength ≥ config tensileMin.",
      rules: [2, 5],
    },
    {
      key: "elongationResult",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "elongationAtBreak ≥ config elongationMin.",
      rules: [2, 5],
    },
  ],
  config: [
    { key: "tensileMin", type: "number (MPa)", default: 14, meaning: "Minimum tensile strength." },
    { key: "elongationMin", type: "number (%)", default: 500, meaning: "Minimum elongation at break." },
    {
      key: "standardLabel",
      type: "string",
      default: "ASTM D6319",
      meaning: "Standard printed with the specs: 'Spec. (ASTM D6319)'.",
    },
    {
      key: "decimals",
      type: "{ tensileStrength: number; elongationAtBreak: number }",
      default: { tensileStrength: 2, elongationAtBreak: 0 },
      meaning: "Decimals the values are shown with, as printed.",
    },
  ],
  labels: [{ key: "specRow", label: "Spec. ({standardLabel})", meaning: "Caption of each spec row." }],
});

const watertight = defineModule({
  key: "watertight",
  kind: "report",
  alwaysOn: false,
  title: "Freedom From Holes by Watertight Test",
  titles: { STD_SG: "Watertight Inspection" },
  captures: "Per size (R and L when handSplit): gloves tested and holes by location.",
  result: "Per size: accept or reject from the AQL engine on the total (both hands). not_done until tested is entered.",
  rules: [1, 2, 4, 5, 8],
  data: [
    {
      key: "tested",
      label: "No. of Sample Tested",
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "entered",
      prefill: "sampling_plan.glovesWatertightVisual",
      rules: [1, 8],
    },
    {
      key: "holes",
      label: "Pin Hole",
      labels: { SAFEDON_EG: "Holes", STD_SG: "Defect" },
      type: "count_map",
      keyedBy: "hole location: a defect code from config locations",
      per: ["size", "hand"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "otherDescription",
      label: "Other : Description",
      type: "text",
      per: ["size", "hand"],
      entry: "entered",
      addition: "The 'Other :' row of both reports ends in a colon for the location; this holds it.",
    },
    {
      key: "unmapped",
      label: "Defect Not in the List",
      type: "label_counts",
      per: ["size", "hand"],
      entry: "entered",
      notes:
        "One-off labels (the onsite forms' handwritten rows) with their counts, saved unmapped and flagged for an admin (BUILD_SPEC 4.2 rule 4, 8). They count towards the total.",
    },
    {
      key: "codeLetter",
      label: "Sampling Code Letter",
      type: "select",
      options: CODE_LETTERS,
      per: ["size"],
      entry: "computed",
      formula:
        "lib/aql planFromSampleSize(tested, config aql): the plan's codeLetter, from n (a non-standard n uses the standard n below it, with a warning). Its usedLetter, n and arrow go into computed with it.",
      rules: [2, 8],
    },
    {
      key: "accept",
      label: "Accept",
      type: "integer",
      per: ["size"],
      entry: "computed",
      formula: "The plan's ac: Table 2-A for config aql at the usedLetter (arrows followed).",
      rules: [2, 8],
    },
    {
      key: "reject",
      label: "Reject",
      type: "integer",
      per: ["size"],
      entry: "computed",
      formula: "The plan's re (ac + 1).",
      rules: [2, 8],
    },
    {
      key: "totalDefects",
      label: "Total Number of Defects Found",
      labels: { STD_SG: "Total WTT" },
      type: "integer",
      per: ["size"],
      entry: "computed",
      formula: "Sum of holes and unmapped counts, both hands. Printed as <total>/<tested>.",
      rules: [2],
    },
    {
      key: "result",
      label: "Freedom From Holes (Passed / Failed)",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "totalDefects ≤ accept passes; ≥ reject fails.",
      rules: [2, 5],
    },
  ],
  config: [
    { key: "aql", type: "number", default: 1.5, meaning: "AQL of the watertight test." },
    {
      key: "locations",
      type: "{ code: string; label: string }[]",
      default: listItems(WATERTIGHT_LOCATIONS.STD_EG),
      defaultNote: "STD_EG's five locations (see Defects)",
      meaning:
        "Hole locations in the template's order and wording, each mapped to a defect code (BUILD_SPEC: between fingers/crotch, palm, finger, cuff, glove burst, other).",
    },
    {
      key: "handSplit",
      type: "boolean",
      default: false,
      meaning: "Record R and L separately (surgical). Holes are per hand; tested and the limits stay per size.",
    },
  ],
  labels: [
    {
      key: "heading",
      label: "Freedom From Holes by Watertight Test (Single Sampling Code Letter {codeLetters}, AQL {aql})",
      labels: {
        SAFEDON_EG: "Freedom From Holes by Watertight Test (Sampling Code Letter {codeLetters}; AQL={aql})",
        STD_SG: "Watertight Inspection",
      },
      meaning: "Full heading as printed: the code letters of the ordered sizes and the AQL are filled in.",
    },
    { key: "defectLimit", label: "Defect Limit", meaning: "Caption of the Accept / Reject row." },
  ],
});

const visual = defineModule({
  key: "visual",
  kind: "report",
  alwaysOn: false,
  title: "Visual Inspection",
  groups: ["critical", "major", "minor"],
  captures: "Per size (R and L when handSplit), per class: gloves inspected and defect counts.",
  result:
    "Per size and class: accept or reject from the AQL engine; any critical defect fails. Fail if any class fails; not_done until inspected is entered.",
  rules: [1, 2, 4, 5, 8],
  data: [
    {
      key: "inspected",
      label: "No. of Sample Inspected",
      type: "integer",
      unit: "pcs",
      per: ["size", "class"],
      entry: "entered",
      prefill: "sampling_plan.glovesWatertightVisual",
      rules: [1, 8],
    },
    {
      key: "counts",
      label: "Defects",
      groupLabels: {
        critical: { label: "Critical Defects" },
        major: { label: "Major Defects", labels: { STD_SG: "Major Defect" } },
        minor: { label: "Minor Defects", labels: { STD_SG: "Minor Defect" } },
      },
      type: "count_map",
      keyedBy: "defect code from config classes[class].defects",
      per: ["size", "hand", "class"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "unmapped",
      label: "Defect Not in the List",
      type: "label_counts",
      per: ["size", "hand", "class"],
      entry: "entered",
      notes:
        "One-off labels (the onsite forms' handwritten rows) with their counts, saved unmapped and flagged for an admin. They count towards the class total.",
    },
    {
      key: "codeLetter",
      label: "Sampling Code Letter",
      type: "select",
      options: CODE_LETTERS,
      per: ["size", "class"],
      entry: "computed",
      formula:
        "lib/aql planFromSampleSize(inspected, class AQL): codeLetter from n; an arrow moves the class's plan to its usedLetter (expected-results B: minor at N uses M), kept in computed with it.",
      rules: [2, 8],
    },
    {
      key: "accept",
      label: "Accept",
      // The word before the number in the limit row: STD_EG prints the critical row Acc. = 0 / Rej. = 1.
      groupLabels: { critical: { label: "Acc. =", labels: { SAFEDON_EG: "Accept" } } },
      type: "integer",
      per: ["size", "class"],
      entry: "computed",
      formula: "The class plan's ac at its usedLetter; always 0 for critical (AQL 0).",
      rules: [2, 8],
    },
    {
      key: "reject",
      label: "Reject",
      groupLabels: { critical: { label: "Rej. =", labels: { SAFEDON_EG: "Reject" } } },
      type: "integer",
      per: ["size", "class"],
      entry: "computed",
      formula: "The class plan's re (ac + 1); always 1 for critical.",
      rules: [2, 8],
    },
    {
      key: "total",
      label: "Total Number of Defects Found",
      groupLabels: {
        critical: { label: 'Total Number of "Critical Defects" Found' },
        major: { label: 'Total Number of "Major Defects" Found', labels: { STD_SG: "Total Major" } },
        minor: { label: 'Total Number of "Minor Defects" Found', labels: { STD_SG: "Total Minor" } },
      },
      type: "integer",
      per: ["size", "class"],
      entry: "computed",
      formula: "Sum of counts and unmapped counts of the class, both hands. Printed as <total>/<inspected>.",
      rules: [2],
    },
    {
      key: "result",
      label: "Disposition (Passed / Failed)",
      groupLabels: {
        critical: { label: "Disposition - Visual Critical (Passed / Failed)" },
        major: { label: "Disposition - Visual Major (Passed / Failed)" },
        minor: { label: "Disposition - Visual Minor (Passed / Failed)" },
      },
      type: "select",
      options: RESULT,
      per: ["size", "class"],
      entry: "computed",
      formula: "total ≤ accept passes; ≥ reject fails. Both reports print the critical line as 'Visual Minor' [sic].",
      rules: [2, 5],
    },
  ],
  config: [
    {
      key: "handSplit",
      type: "boolean",
      default: false,
      meaning: "Record R and L separately (surgical). Counts are per hand; inspected and the limits stay per size.",
    },
    {
      key: "classes",
      type: "Record<DefectClass, { include: boolean; aql: number; defects: { code: string; label: string }[] }>",
      default: {
        critical: { include: true, aql: 0, defects: listItems(VISUAL_DEFECTS.STD_EG.critical) },
        major: { include: true, aql: 2.5, defects: listItems(VISUAL_DEFECTS.STD_EG.major) },
        minor: { include: true, aql: 4, defects: listItems(VISUAL_DEFECTS.STD_EG.minor) },
      },
      defaultNote: "all three classes on, AQL 0, 2.5 and 4.0, with STD_EG's defect lists (see Defects)",
      meaning:
        "Classes on or off with their AQL, and each class's defect list in the template's order and wording, mapped to defect codes. Severity is the class the template puts a code in (rule 4.2.4).",
    },
  ],
  labels: [
    {
      key: "heading",
      label: "Visual Inspection (Single Sampling Code Letter {codeLetters})",
      labels: {
        SAFEDON_EG: "Visual Inspection (Sampling Code Letter {codeLetters})",
        STD_SG: "Visual Inspection",
      },
      meaning: "Full heading as printed, with the code letters of the ordered sizes.",
    },
    { key: "criticalHeading", label: "Critical Defects (AQL {aql})", meaning: "Heading of the critical class (AQL printed 0.0)." },
    {
      key: "majorHeading",
      label: "Major Defects (AQL {aql})",
      labels: { STD_SG: "Major Defect" },
      meaning: "Heading of the major class.",
    },
    {
      key: "minorHeading",
      label: "Minor Defects (AQL {aql})",
      labels: { STD_SG: "Minor Defect" },
      meaning: "Heading of the minor class.",
    },
    {
      key: "criticalLimit",
      label: "Defect Limit : Accept / Reject",
      labels: { SAFEDON_EG: "Defect Limit" },
      meaning: "Caption of the critical class's limit row (STD_EG prints Acc. = 0 / Rej. = 1).",
    },
    { key: "defectLimit", label: "Defect Limit", meaning: "Caption of the major and minor limit rows." },
  ],
});

const dispensingPacking = defineModule({
  key: "dispensing_packing",
  kind: "report",
  alwaysOn: false,
  title: "Glove Packing Check",
  captures: "Per size, per box (picked from the carton list): layering %, dispensing %, stickiness code, note.",
  result:
    "Per size: layering and dispensing averages against the minimums; any box with a failing stickiness code fails. not_done until the size's boxes are entered.",
  rules: [1, 2, 4, 5, 7],
  data: [
    {
      key: "boxNo",
      label: "Box #",
      type: "integer",
      per: ["size", "box"],
      entry: "entered",
      rules: [7],
      notes: "Picked from carton_sampling.cartonNumbers of the size (rule 7).",
    },
    {
      key: "layeringPct",
      label: "Layering %",
      type: "decimal",
      unit: "%",
      per: ["size", "box"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "dispensingPct",
      label: "Dispensing %",
      type: "decimal",
      unit: "%",
      per: ["size", "box"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "stickiness",
      label: "Stickiness **",
      type: "select",
      per: ["size", "box"],
      entry: "entered",
      notes: "One of config stickinessCodes.",
    },
    {
      key: "note",
      label: "Others:",
      type: "text",
      per: ["size", "box"],
      entry: "entered",
      addition: "The EG onsite form's 'Others:' column, one note per box.",
    },
    {
      key: "codeLetter",
      label: "Sampling Code Letter",
      type: "select",
      options: CODE_LETTERS,
      per: ["size"],
      entry: "computed",
      formula: "From the number of boxes tested (BUILD_SPEC 7), for the heading.",
      rules: [2],
    },
    {
      key: "layeringAverage",
      label: "Average",
      type: "decimal",
      unit: "%",
      per: ["size"],
      entry: "computed",
      formula: "Mean of layeringPct.",
      rules: [2],
    },
    {
      key: "dispensingAverage",
      label: "Average",
      type: "decimal",
      unit: "%",
      per: ["size"],
      entry: "computed",
      formula: "Mean of dispensingPct.",
      rules: [2],
    },
    {
      key: "stickinessSummary",
      label: "Average",
      type: "select",
      per: ["size"],
      entry: "computed",
      formula: "The worst code entered: the latest in config stickinessCodes order. The report prints a code in the Average row.",
      rules: [2],
    },
    {
      key: "layeringResult",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "layeringAverage ≥ config minLayeringPct.",
      rules: [2, 5],
    },
    {
      key: "dispensingResult",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "dispensingAverage ≥ config minDispensingPct.",
      rules: [2, 5],
    },
    {
      key: "stickinessResult",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "Fails when any box has a code whose pass is false.",
      rules: [2, 5],
    },
  ],
  config: [
    { key: "minLayeringPct", type: "number (%)", default: 70, meaning: "Minimum average layering." },
    { key: "minDispensingPct", type: "number (%)", default: 80, meaning: "Minimum average dispensing." },
    {
      key: "stickinessCodes",
      type: "{ code: string; label: string; pass: boolean }[]",
      default: stickinessCodes(),
      defaultNote: "STD_EG's legend: A, B, B1 and C pass, D fails (see Defects)",
      meaning: "Codes from least to most sticky, with their legend and whether they pass.",
    },
    {
      key: "boxesPerSize",
      type: "{ default: number; bySize?: Record<size, number> }",
      default: { default: 13 },
      meaning: "Box rows per size. sampling_plan.innerUnitsDispensing sets them when entered.",
    },
  ],
  labels: [
    {
      key: "heading",
      label:
        "Glove Packing Check (Sampling Code Letter {codeLetters}) : Min. {minLayeringPct}% Layering & {minDispensingPct}% Dispensing",
      meaning: "Full heading as printed: code letters of the box counts and the two minimums.",
    },
    { key: "itemColumn", label: "Item", meaning: "Caption of the box row number column." },
    { key: "stickinessLegend", label: "**Glove Stickiness Code", meaning: "Caption of the stickiness code legend." },
  ],
});

const dispensingSafedon = defineModule({
  key: "dispensing_safedon",
  kind: "report",
  alwaysOn: false,
  title: "Glove Dispensing Inspection",
  captures:
    "Per size, per box (picked from the carton list): counts of the six Safedon dispensing defects. Per box defects, gloves and rate; per size total and rate.",
  result: "Per size: the defect rate against config maxRatePct. not_done until the size's boxes are entered.",
  rules: [1, 2, 4, 5, 7],
  data: [
    {
      key: "boxNo",
      label: "Box #",
      type: "integer",
      per: ["size", "box"],
      entry: "entered",
      rules: [7],
      notes: "Picked from carton_sampling.cartonNumbers of the size (rule 7). The report's box numbers are page 1 carton numbers.",
    },
    {
      key: "counts",
      label: "Safedon Packing Defects",
      type: "count_map",
      keyedBy: "defect code from config defects",
      per: ["size", "box"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "codeLetter",
      label: "Sampling Code Letter",
      type: "select",
      options: CODE_LETTERS,
      per: ["size"],
      entry: "computed",
      formula: "From the number of boxes tested (BUILD_SPEC 7), for the heading.",
      rules: [2],
    },
    {
      key: "boxDefects",
      label: "Defects / Gloves per Pack",
      type: "integer",
      per: ["size", "box"],
      entry: "computed",
      formula: "Sum of the box's counts. Printed as <defects>/<glovesPerPack> (Total, line 1).",
      rules: [2],
    },
    {
      key: "boxRatePct",
      label: "Defect Rate",
      type: "decimal",
      unit: "%",
      per: ["size", "box"],
      entry: "computed",
      formula:
        "boxDefects / config glovesPerPack × 100 (Total, line 2: the report prints it as a percentage with one decimal, e.g. 0.8%).",
      rules: [2],
    },
    {
      key: "boxesTested",
      label: "Boxes Tested",
      type: "integer",
      countOf: "boxes",
      per: ["size"],
      entry: "computed",
      formula: "Boxes with a box number (onsite/SAFEDON_EG.md, mapping to the core).",
      rules: [2],
    },
    {
      key: "boxesFailed",
      label: "Boxes Failed",
      type: "integer",
      countOf: "boxes",
      per: ["size"],
      entry: "computed",
      formula: "Boxes with any count above zero.",
      rules: [2],
    },
    {
      key: "totalDefects",
      label: "Total",
      type: "integer",
      per: ["size"],
      entry: "computed",
      formula: "Sum of the size's box counts (Total, line 3: <defects> / <gloves> (<rate> %)).",
      rules: [2],
    },
    {
      key: "glovesInspected",
      label: "Gloves Inspected",
      type: "integer",
      unit: "pcs",
      per: ["size"],
      entry: "computed",
      formula: "boxesTested × config glovesPerPack.",
      rules: [2],
    },
    {
      key: "ratePct",
      label: "Defect Rate (%)",
      type: "decimal",
      unit: "%",
      per: ["size"],
      entry: "computed",
      formula: "totalDefects / glovesInspected × 100.",
      rules: [2],
    },
    {
      key: "result",
      label: "Conclusion",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "ratePct ≤ config maxRatePct.",
      rules: [2, 5],
    },
  ],
  config: [
    {
      key: "defects",
      type: "{ code: string; label: string; hint: string }[]",
      default: safedonDefectItems(),
      defaultNote: "the six Safedon dispensing defects with the app's hints (see Defects)",
      meaning: "The six defects in the template's order and wording, mapped to defect codes, with the definition shown as a hint.",
    },
    {
      key: "glovesPerPack",
      type: "number (pcs)",
      default: 125,
      meaning: "Gloves dispensed per box, the denominator of the rates.",
    },
    { key: "maxRatePct", type: "number (%)", default: 5, meaning: "Maximum defect rate per size (≤, inclusive)." },
    {
      key: "boxesPerSize",
      type: "{ default: number; bySize?: Record<size, number> }",
      default: { default: 13 },
      meaning: "Box columns per size (13 on the onsite sheet; more can be added). sampling_plan.innerUnitsDispensing sets them when entered.",
    },
  ],
  labels: [
    {
      key: "heading",
      label: "Glove Dispensing Inspection (Sampling Code Letter {codeLetters})",
      meaning: "Full heading as printed on the report, with the code letters of the box counts.",
    },
    { key: "totalGroup", label: "Total", meaning: "Caption over the three computed total lines." },
    { key: "specRow", label: "Specification / Requirement", meaning: "Caption of the row that prints ≤ maxRatePct %." },
  ],
});

const labeling = defineModule({
  key: "labeling",
  kind: "report",
  alwaysOn: false,
  title: "Packaging Labeling Inspection",
  groups: ["inner", "carton"],
  captures: "Per size, per level (inner unit, carton): boxes inspected, picked from the carton list, and defects per check.",
  result: "Per size and level: any defect fails (Accept 0 / Reject 1). not_done until inspected is entered.",
  rules: [1, 2, 4, 5, 7],
  data: [
    {
      key: "inspected",
      label: "No. of Sampled Boxes Inspected",
      type: "integer",
      countOf: "boxes",
      per: ["size", "level"],
      entry: "entered",
      prefill: "config levels[level].n",
      rules: [1],
    },
    {
      key: "boxNos",
      label: "Box #",
      type: "integer_list",
      per: ["size", "level"],
      entry: "entered",
      rules: [7],
      addition: "Rule 6.2.7 picks labelling boxes from the size's carton list; the reports print only how many were inspected.",
    },
    {
      key: "defects",
      label: "Defects",
      type: "count_map",
      keyedBy: "labelling check code from config levels[level].checks",
      per: ["size", "level"],
      entry: "entered",
      rules: [1],
    },
    {
      key: "accept",
      label: "Accept",
      // The word before the number in each level's limit row: SAFEDON_EG prints Acc. = 0 / Rej. = 1.
      groupLabels: {
        inner: { label: "Accept", labels: { SAFEDON_EG: "Acc. =" } },
        carton: { label: "Accept", labels: { SAFEDON_EG: "Acc. =" } },
      },
      type: "integer",
      per: ["size", "level"],
      entry: "computed",
      formula: "Always 0 (BUILD_SPEC 7: labelling is Accept 0 / Reject 1).",
      rules: [2],
    },
    {
      key: "reject",
      label: "Reject",
      groupLabels: {
        inner: { label: "Reject", labels: { SAFEDON_EG: "Rej. =" } },
        carton: { label: "Reject", labels: { SAFEDON_EG: "Rej. =" } },
      },
      type: "integer",
      per: ["size", "level"],
      entry: "computed",
      formula: "Always 1.",
      rules: [2],
    },
    {
      key: "total",
      label: "Total Number of Defects Found",
      type: "integer",
      per: ["size", "level"],
      entry: "computed",
      formula: "Sum of defects.",
      rules: [2],
    },
    {
      key: "result",
      label: "Disposition (Passed / Failed)",
      groupLabels: {
        inner: { label: "Disposition - Inner Box (Passed / Failed)" },
        carton: { label: "Disposition - Carton Box (Passed / Failed)" },
      },
      type: "select",
      options: RESULT,
      per: ["size", "level"],
      entry: "computed",
      formula: "total ≥ 1 fails. STD_EG prints the carton line as 'Inner Box' [sic].",
      rules: [2, 5],
    },
  ],
  config: [
    {
      key: "levels",
      type: "Record<LabellingLevel, { include: boolean; n: number; checks: { code: LabellingCheck; label: string }[] }>",
      default: {
        inner: { include: true, n: 3, checks: LABELLING_CHECK_LISTS.STD_EG.inner },
        carton: { include: true, n: 1, checks: LABELLING_CHECK_LISTS.STD_EG.carton },
      },
      defaultNote: "both levels on, 3 inner units and 1 carton, with STD_EG's checks",
      meaning: "Levels on or off, boxes inspected per level, and each level's checks in the template's order and wording.",
    },
  ],
  labels: [
    { key: "innerLevel", label: "Dispenser Box", labels: { SAFEDON_EG: "Inner Boxes/Packs" }, meaning: "Heading of the inner unit level." },
    { key: "cartonLevel", label: "Carton Box", labels: { SAFEDON_EG: "Carton Boxes" }, meaning: "Heading of the carton level." },
    {
      key: "defectLimit",
      label: "Defect Limit",
      labels: { SAFEDON_EG: "Limit : Accept / Reject" },
      meaning: "Caption of the Accept / Reject row.",
    },
  ],
});

const conclusion = defineModule({
  key: "conclusion",
  kind: "report",
  alwaysOn: true,
  title: "Conclusion",
  captures: "Suggested result, final result, remark, inspector, date and the signature drawn on the iPad.",
  result: "The final result as chosen; not_done until it is chosen.",
  rules: [2, 3, 11],
  data: [
    {
      key: "suggestedResult",
      label: "Suggested Result",
      type: "select",
      options: ["pass", "fail", "hold"],
      per: [],
      entry: "computed",
      column: "inspections.suggested_result",
      formula: "From the included modules' results (BUILD_SPEC 6.1). Not on the reports.",
      rules: [2],
    },
    {
      key: "finalResult",
      label: "Conclusion",
      type: "select",
      options: ["pass", "fail", "hold"],
      per: [],
      entry: "entered",
      column: "inspections.result",
      notes: "The reports print PASSED or FAILED; the app adds hold.",
    },
    { key: "remark", label: "Remark", type: "textarea", per: [], entry: "entered", column: "inspections.remarks" },
    {
      key: "inspector",
      label: "Inspected By",
      type: "reference",
      per: [],
      entry: "system",
      column: "inspections.inspector_id",
      rules: [11],
      notes: "The same person as header.inspector, shown beside the signature (SAFEDON_EG prints it here).",
    },
    {
      key: "date",
      label: "Date",
      type: "date",
      per: [],
      entry: "entered",
      prefill: "today, when the conclusion is signed",
      rules: [3],
      notes: "The report date: BUILD_SPEC 6.1 lists it under header, both reports print it once, here.",
    },
    {
      key: "signature",
      label: "Signature",
      type: "signature",
      per: [],
      entry: "entered",
      notes: "Drawn on the iPad (BUILD_SPEC 6.1; bucket signatures). BUILD_SPEC 13 asks whether clients accept it.",
    },
  ],
  config: [],
  labels: [
    { key: "pass", label: "PASSED", meaning: "Word printed for a pass." },
    { key: "fail", label: "FAILED", meaning: "Word printed for a fail." },
    { key: "hold", label: "HOLD", meaning: "Word for hold (not on the reports)." },
  ],
});

/* ------------------------------------------------------------------ *
 * Optional modules (not on the current reports)
 * ------------------------------------------------------------------ */

const dyeLeak = defineModule({
  key: "dye_leak",
  kind: "optional",
  alwaysOn: false,
  title: "Dye Leak Test",
  captures: "Per size: pouches tested, pouches failed, notes.",
  result: "Per size: any failed pouch fails. not_done until pouchesTested is entered.",
  rules: [1, 2, 4, 5],
  data: [
    {
      key: "pouchesTested",
      label: "Pouches Tested",
      type: "integer",
      countOf: "pouches",
      per: ["size"],
      entry: "entered",
      prefill: "sampling_plan.pouchesDyeLeak, else config n",
      rules: [1],
    },
    {
      key: "pouchesFailed",
      label: "Pouches Failed",
      type: "integer",
      countOf: "pouches",
      per: ["size"],
      entry: "entered",
      rules: [1],
    },
    { key: "notes", label: "Notes", type: "textarea", per: ["size"], entry: "entered" },
    {
      key: "pouchesPlanned",
      label: "Pouches Planned",
      type: "integer",
      countOf: "pouches",
      per: ["size"],
      entry: "computed",
      formula: "sampling_plan.pouchesDyeLeak when it plans any, else config n; none when neither does.",
      rules: [2],
    },
    {
      key: "result",
      label: "Passed / Failed",
      type: "select",
      options: RESULT,
      per: ["size"],
      entry: "computed",
      formula: "pouchesFailed = 0 passes.",
      rules: [2, 5],
    },
    {
      key: "totalTested",
      label: "Total Pouches Tested",
      type: "integer",
      countOf: "pouches",
      per: [],
      entry: "computed",
      formula: "Sum of pouchesTested over the ordered sizes that have it; none until one does.",
      rules: [2],
    },
    {
      key: "totalFailed",
      label: "Total Pouches Failed",
      type: "integer",
      countOf: "pouches",
      per: [],
      entry: "computed",
      formula: "Sum of pouchesFailed over the ordered sizes that have it; none until one does.",
      rules: [2],
    },
  ],
  config: [
    {
      key: "n",
      type: "number | null",
      default: null,
      meaning: "Pouches tested per size when the sampling plan has none. null: take sampling_plan.pouchesDyeLeak.",
    },
  ],
  labels: [],
  notes: ["The SG onsite form plans the pouches ('# pouches (dye leak test)') but has nowhere to record results."],
});

const documents = defineModule({
  key: "documents",
  kind: "optional",
  alwaysOn: false,
  title: "Documents",
  captures: "Checklist of certificates and reports: verified, not verified or NA; reference no.; expiry date; file.",
  result: "fail if a required item is not verified; warn if an item has expired; pass otherwise.",
  rules: [2, 3, 5],
  data: [
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["verified", "not_verified", "na"],
      per: ["item"],
      entry: "entered",
    },
    { key: "referenceNo", label: "Reference No.", type: "text", per: ["item"], entry: "entered" },
    { key: "expiryDate", label: "Expiry Date", type: "date", per: ["item"], entry: "entered", rules: [3] },
    {
      key: "file",
      label: "File",
      type: "file",
      per: ["item"],
      entry: "entered",
      notes: "inspection_files, kind certificate or lab_report, module documents.",
    },
    {
      key: "expired",
      label: "Expired",
      type: "yes_no",
      per: ["item"],
      entry: "computed",
      formula: "expiryDate before header.inspectionDate.",
      rules: [2],
    },
    {
      key: "itemStatus",
      label: "Item Result",
      type: "select",
      options: ["pass", "fail", "warn", "info", "not_done"],
      per: ["item"],
      entry: "computed",
      formula:
        "not_done without a status; fail when required and not verified; warn when expired; pass when verified; info when not verified or NA and not required. The chip on the item's row.",
      rules: [2, 5],
    },
    {
      key: "counts",
      label: "Items per Status",
      type: "count_map",
      keyedBy: "status (verified, not_verified, na, and open for none yet)",
      per: [],
      entry: "computed",
      formula: "Items on the checklist per status.",
      rules: [2],
    },
    {
      key: "fileState",
      label: "File Status",
      type: "select",
      options: ["none", "attached", "missing"],
      per: ["item"],
      entry: "computed",
      formula:
        "The file the item keeps against the inspection's files: none kept, attached, or missing (deleted, or still uploading from another device). Attached while the inspection's files are not known.",
      rules: [2],
    },
  ],
  config: [
    {
      key: "items",
      type: "{ key: DocumentItem; include: boolean; required: boolean }[]",
      default: DOCUMENT_ITEMS.map((key) => ({ key, include: true, required: false })),
      meaning: "Items on or off and required (BUILD_SPEC: items on/off and required).",
    },
  ],
  labels: [
    { key: "certificateOfAnalysis", label: "Certificate of Analysis", meaning: "Item label." },
    { key: "labTestReports", label: "Lab Test Reports", meaning: "Item label." },
    { key: "sterilisation", label: "Sterilisation Certificate and Records", meaning: "Item label." },
    { key: "iso13485", label: "ISO 13485", meaning: "Item label." },
    { key: "fdaCe", label: "FDA / CE Certificates", meaning: "Item label." },
    { key: "declarationOfOrigin", label: "Declaration of Origin", meaning: "Item label." },
    { key: "required", label: "Required", meaning: "Badge on an item the template requires." },
    { key: "status.verified", label: "Verified", meaning: "Word for the status verified." },
    { key: "status.not_verified", label: "Not Verified", meaning: "Word for the status not_verified." },
    { key: "status.na", label: "NA", meaning: "Word for the status na." },
  ],
  notes: ["Not on any current form: the website's QC scope (forms/README.md)."],
});

const loading = defineModule({
  key: "loading",
  kind: "optional",
  alwaysOn: false,
  title: "Loading",
  captures: "Container no., seal no., cartons loaded against the PO, carton condition; photos at each loading stage.",
  result: "warn when cartonsLoaded is not cartonsOrdered; info otherwise.",
  rules: [1, 2],
  data: [
    { key: "containerNo", label: "Container No.", type: "text", per: [], entry: "entered" },
    { key: "sealNo", label: "Seal No.", type: "text", per: [], entry: "entered" },
    {
      key: "cartonsLoaded",
      label: "Cartons Loaded",
      type: "integer",
      countOf: "cartons",
      per: [],
      entry: "entered",
      rules: [1],
    },
    { key: "cartonCondition", label: "Carton Condition", type: "textarea", per: [], entry: "entered" },
    {
      key: "cartonsOrdered",
      label: "Cartons Ordered",
      type: "integer",
      countOf: "cartons",
      per: [],
      entry: "computed",
      formula: "order_lots.totalCartons.",
      rules: [2],
    },
    {
      key: "cartonsDifference",
      label: "Cartons Loaded Less Ordered",
      type: "integer",
      countOf: "cartons",
      per: [],
      entry: "computed",
      formula: "cartonsLoaded − cartonsOrdered: below 0 is short, above 0 over; none until both are known.",
      rules: [2],
    },
  ],
  config: [
    {
      key: "fields",
      type: "Record<LoadingField, boolean>",
      default: allOn(LOADING_FIELDS),
      meaning: "Which fields show (BUILD_SPEC: fields on/off).",
    },
  ],
  labels: [
    { key: "loadingStage", label: "Loading Stage", meaning: "Caption of the stage picker that tags loading photos." },
    { key: "emptyContainer", label: "Empty Container", meaning: "Loading stage, for photo tags." },
    { key: "halfLoaded", label: "Half Loaded", meaning: "Loading stage, for photo tags." },
    { key: "fullyLoaded", label: "Fully Loaded", meaning: "Loading stage, for photo tags." },
    { key: "doorsClosed", label: "Doors Closed", meaning: "Loading stage, for photo tags." },
    { key: "sealed", label: "Sealed", meaning: "Loading stage, for photo tags." },
  ],
  notes: [
    "Not on any current form: the website's QC scope. Loading-stage photos are the module's photos; the stages are to confirm.",
  ],
});

/* ------------------------------------------------------------------ *
 * The dictionary
 * ------------------------------------------------------------------ */

export const MODULE_DICTIONARY = {
  header,
  glove_info: gloveInfo,
  order_lots: orderLots,
  packing_config: packingConfig,
  sampling_plan: samplingPlan,
  carton_sampling: cartonSampling,
  dimensions,
  weight,
  force_at_break: forceAtBreak,
  tensile,
  watertight,
  visual,
  dispensing_packing: dispensingPacking,
  dispensing_safedon: dispensingSafedon,
  labeling,
  conclusion,
  dye_leak: dyeLeak,
  documents,
  loading,
} satisfies { readonly [K in ModuleKey]: ModuleSpec & { readonly key: K } };

export type Dictionary = typeof MODULE_DICTIONARY;
type DataFieldOf<M extends ModuleKey> = Dictionary[M]["data"][number];
/** Every data field key of a module: entered, system and computed. */
export type DataKey<M extends ModuleKey> = DataFieldOf<M>["key"];
/**
 * Keys the inspector enters: what the module's zod data schema holds
 * (`file` fields are inspection_files rows, `signature` a drawn image).
 */
export type EnteredKey<M extends ModuleKey> = Extract<DataFieldOf<M>, { readonly entry: "entered" }>["key"];
/** Keys the app records itself (the inspector): never typed, not in the module's data. */
export type SystemKey<M extends ModuleKey> = Extract<DataFieldOf<M>, { readonly entry: "system" }>["key"];
/** Keys the app computes (rule 6.2.2): the module's `computed` values, never its data. */
export type ComputedKey<M extends ModuleKey> = Extract<DataFieldOf<M>, { readonly entry: "computed" }>["key"];
export type ConfigKey<M extends ModuleKey> = Dictionary[M]["config"][number]["key"];
/** Caption keys of a module; `title` is the module title. */
export type LabelKey<M extends ModuleKey> = Dictionary[M]["labels"][number]["key"] | "title";

export function moduleSpec(module: ModuleKey): ModuleSpec {
  return MODULE_DICTIONARY[module];
}

export function dataField(module: ModuleKey, key: string): DataFieldSpec | undefined {
  return moduleSpec(module).data.find((field) => field.key === key);
}

/** A module's data field keys with the given entry, in dictionary order. */
export function dataKeys(module: ModuleKey, entry: Entry): string[] {
  return moduleSpec(module)
    .data.filter((field) => field.entry === entry)
    .map((field) => field.key);
}

/**
 * The label key of a class or level wording: the group, then the field
 * (`majorTotal`, `innerResult`), like the captions `majorHeading` and
 * `innerLevel`. camelCase, so it fits the framework's label keys and never
 * meets a snake_case defect code.
 */
export function groupLabelKey(field: string, group: string): string {
  return `${group}${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

/**
 * A module's default labels (STD_EG's wording), keyed as ModuleConfig.labels
 * and a module definition's `labels` are: data field keys, class and level
 * keys (`groupLabelKey`) and caption keys. The title is separate.
 */
export function defaultLabels(module: ModuleKey): Record<string, string> {
  const spec = moduleSpec(module);
  const labels: Record<string, string> = {};
  for (const field of spec.data) {
    labels[field.key] = field.label;
    for (const [group, wording] of Object.entries(field.groupLabels ?? {})) {
      labels[groupLabelKey(field.key, group)] = wording.label;
    }
  }
  for (const caption of spec.labels) labels[caption.key] = caption.label;
  return labels;
}

function captionSpec(module: ModuleKey, key: string): LabelSpec | undefined {
  return moduleSpec(module).labels.find((label) => label.key === key);
}

/** The module's title in a template's wording. */
export function moduleTitle(template: TemplateCode, module: ModuleKey): string {
  const spec = moduleSpec(module);
  return spec.titles?.[template] ?? spec.title;
}

/** A data field's label in a template's wording; `group` picks a class or level label. */
export function fieldLabel(template: TemplateCode, module: ModuleKey, key: string, group?: string): string | undefined {
  const field = dataField(module, key);
  if (!field) return undefined;
  const byGroup = group === undefined ? undefined : field.groupLabels?.[group];
  if (byGroup) return byGroup.labels?.[template] ?? byGroup.label;
  return field.labels?.[template] ?? field.label;
}

/** A caption in a template's wording; `title` gives the module title. */
export function captionLabel(template: TemplateCode, module: ModuleKey, key: string): string | undefined {
  if (key === "title") return moduleTitle(template, module);
  const caption = captionSpec(module, key);
  return caption ? (caption.labels?.[template] ?? caption.label) : undefined;
}

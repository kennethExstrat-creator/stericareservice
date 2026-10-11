// Source-field coverage inventory (BUILD_SPEC 4.2 rules 2 and 10): every
// field on every source document in docs/forms, verbatim, with where it goes
// in the app. Nothing is dropped or merged on entry: a field no module holds
// maps to a custom module field. The template's coverage checklist is built
// from this list; docs/DATA_DICTIONARY.md renders it as the coverage matrix.
//
// Labels are as printed, typos included; `corrected` is the printed words
// with the typo fixed, where the source has one. The app writes them in
// Title Case (Kenneth, 8 October 2026): wording.ts compares the two. Where
// docs/forms/reports summarises a row, the label is taken from the example
// report (labels only, no values).
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ConfigKey, DataKey, LabelKey } from "./fields";
import type {
  ConfigTarget,
  CustomTarget,
  FieldTarget,
  LabelTarget,
  LayoutTarget,
  SourceField,
  SourceId,
  TemplateProperty,
  TemplateTarget,
} from "./types";

export type SourceDocument = {
  readonly id: SourceId;
  /** Path under docs/forms. */
  readonly file: string;
  readonly title: string;
  /** Reports are primary; onsite forms add what the reports lack (forms/README.md). */
  readonly kind: "report" | "onsite";
};

export const SOURCE_DOCUMENTS: Readonly<Record<SourceId, SourceDocument>> = {
  report_STD_EG: {
    id: "report_STD_EG",
    file: "reports/STD_EG.md",
    title: "Report: Standard EG (nitrile examination gloves, EN 455 style)",
    kind: "report",
  },
  report_SAFEDON_EG: {
    id: "report_SAFEDON_EG",
    file: "reports/SAFEDON_EG.md",
    title: "Report: Safedon EG (nitrile examination gloves, ASTM D6319 style)",
    kind: "report",
  },
  onsite_EG: { id: "onsite_EG", file: "onsite/EG.md", title: "Form: EG (examination gloves)", kind: "onsite" },
  onsite_SG: { id: "onsite_SG", file: "onsite/SG.md", title: "Form: SG (sterile surgical gloves)", kind: "onsite" },
  onsite_SAFEDON_EG: {
    id: "onsite_SAFEDON_EG",
    file: "onsite/SAFEDON_EG.md",
    title: "Form: Safedon EG (examination gloves)",
    kind: "onsite",
  },
};

/* ------------------------------------------------------------------ *
 * Builders: the typed helpers check module, field, config and caption keys
 * against fields.ts at compile time.
 * ------------------------------------------------------------------ */

type Row = Omit<SourceField, "id" | "source" | "section">;

function f<M extends ModuleKey>(module: M, field: DataKey<M>, at: { group?: string; key?: string } = {}): FieldTarget {
  return { module, field, ...at };
}

function c<M extends ModuleKey>(module: M, config: ConfigKey<M>, key?: string): ConfigTarget {
  return key === undefined ? { module, config } : { module, config, key };
}

function l<M extends ModuleKey>(module: M, label: LabelKey<M>): LabelTarget {
  return { module, label };
}

function custom(module: string, field: string): CustomTarget {
  return { custom: module, field };
}

function tpl(template: TemplateProperty): TemplateTarget {
  return { template };
}

function layout(what: string): LayoutTarget {
  return { layout: what };
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function section(source: SourceId, name: string, rows: readonly Row[]): SourceField[] {
  return rows.map((row) => ({ id: `${source}:${slug(name)}:${slug(row.label)}`, source, section: name, ...row }));
}

const PAGE_NUMBER = layout("Page number: the AI report numbers its own pages.");

/* ------------------------------------------------------------------ *
 * reports/STD_EG.md
 * ------------------------------------------------------------------ */

const STD = "report_STD_EG";

const REPORT_STD_EG: SourceField[] = [
  ...section(STD, "All pages", [
    { label: "Page <n> of 4", input: "page", targets: [PAGE_NUMBER] },
    {
      label: "Pre-shipment Inspection : <PO> <product>",
      input: "page",
      targets: [
        layout(
          "Running header of pages 2 to 4, 'Pre-shipment Inspection : <PO> <product>': the AI report draws it from header.poNo and header.productName.",
        ),
      ],
      notes: "BUILD_SPEC 4.3's report settings hold the title and the client logo only.",
    },
  ]),
  ...section(STD, "Page 1 > Title", [
    { label: "Preshipment Inspection", input: "heading", targets: [tpl("report.titleLines")] },
    { label: "Nitrile Disposable Examination Gloves", input: "heading", targets: [tpl("report.titleLines")] },
  ]),
  ...section(STD, "Page 1 > Manufacturer Information", [
    { label: "Manufacturer Information", input: "heading", targets: [l("header", "title")] },
    {
      label: "Manufacturer / Supplier",
      input: "text",
      targets: [f("header", "manufacturer")],
      notes: "Printed as the manufacturer's name with the factory name in brackets.",
    },
    { label: "Supplier Factory Address / Location", input: "text", targets: [f("header", "factoryAddress")] },
    {
      label: "PO / SO Number",
      input: "text",
      targets: [f("header", "poNo")],
      notes: "The PO with the SO number in brackets: one value.",
    },
    { label: "Product Name (Brand, code & description)", input: "text", targets: [f("header", "productName")] },
    { label: "Client Name", input: "text", targets: [f("header", "client")] },
    { label: "Inspection date", input: "date", targets: [f("header", "inspectionDate")] },
    { label: "Manufacturing date", input: "date", targets: [f("header", "mfgDate")] },
    { label: "Expiry date", input: "date", targets: [f("header", "expiryDate")] },
    {
      label: "Factrory glove code",
      corrected: "Factory glove code",
      input: "text",
      targets: [f("header", "factoryGloveCode")],
      notes:
        "No 'Inspected by' row on this report; the app records the inspector anyway, and STD_EG shows the row because the EG onsite form prints it (header.inspector).",
    },
  ]),
  ...section(STD, "Page 1 > Glove Information", [
    { label: "Glove Information", input: "heading", targets: [l("glove_info", "title")] },
    { label: "Glove surface texture", input: "text", targets: [f("glove_info", "surfaceTexture")] },
    {
      label: "Indicative weight (size M)",
      input: "number",
      targets: [f("glove_info", "indicativeWeight"), c("glove_info", "indicativeWeightSize")],
      notes: "Grams.",
    },
    { label: "Glove colour", input: "text", targets: [f("glove_info", "colour")] },
    { label: "Glove length", input: "text", targets: [f("glove_info", "length")], notes: "Text, e.g. a minimum in mm." },
  ]),
  ...section(STD, "Page 1 > Order table", [
    { label: "Size", input: "size", targets: [tpl("sizes")], notes: "Rows XS, S, M, L, XL." },
    { label: "Qty (cases)", input: "number", targets: [f("order_lots", "qtyCases")] },
    { label: "Lot Number", input: "text", targets: [f("order_lots", "lotNumbers")] },
    { label: "Total # carton", input: "computed", targets: [f("order_lots", "totalCartons")] },
    { label: "Total # gloves", input: "computed", targets: [f("order_lots", "totalGloves")] },
  ]),
  ...section(STD, "Page 1 > Packing configuration", [
    { label: "Packing configuration", input: "label", targets: [l("packing_config", "title")] },
    {
      label: "# glove per inner box",
      input: "number",
      targets: [f("packing_config", "glovesPerInner"), c("packing_config", "innerUnit")],
      notes: "Names the inner unit: inner box.",
    },
    { label: "# inners per case", input: "number", targets: [f("packing_config", "innersPerCase")] },
    { label: "# gloves per case", input: "number", targets: [f("packing_config", "glovesPerCase")] },
  ]),
  ...section(STD, "Page 1 > Sampling Plan", [
    { label: "Sampling Plan", input: "heading", targets: [l("sampling_plan", "title")] },
    { label: "Glove Size", input: "size", targets: [tpl("sizes")] },
    {
      label: "Order Qty (case)",
      input: "repeat",
      targets: [l("sampling_plan", "orderQty"), f("order_lots", "qtyCases")],
      notes: "The order quantity again: entered once, in the order table.",
    },
    { label: "Sampling Quantity", input: "label", targets: [l("sampling_plan", "samplingQuantity")] },
    { label: "Case", input: "number", targets: [f("sampling_plan", "cases")] },
    { label: "Inner Box", input: "number", targets: [f("sampling_plan", "innerUnits")] },
    { label: "Gloves", input: "number", targets: [f("sampling_plan", "gloves")] },
    { label: "# gloves for watertight & Visual", input: "number", targets: [f("sampling_plan", "glovesWatertightVisual")] },
    { label: "# gloves for dimension", input: "number", targets: [f("sampling_plan", "glovesDimensions")] },
    { label: "# gloves for FAB", input: "number", targets: [f("sampling_plan", "glovesPhysical")] },
    {
      label: "# inner box for packaing & dispensing inspection",
      corrected: "# inner box for packaging & dispensing inspection",
      input: "number",
      targets: [f("sampling_plan", "innerUnitsDispensing")],
    },
  ]),
  ...section(STD, "Page 1 > Finished Goods Sampling Information (carton number)", [
    {
      label: "Finished Goods Sampling Information (carton number)",
      input: "heading",
      targets: [l("carton_sampling", "title")],
    },
    {
      label: "(Carton #)",
      input: "number",
      targets: [f("carton_sampling", "cartonNumbers"), l("carton_sampling", "sizeCaption")],
      notes:
        "One grid per size, XS to XL: 10 columns × 5 rows, up to 50 carton numbers. Printed after the size ('M (Carton #)'; 'XS (carton #)' in lower case).",
    },
    {
      label: "Sampling Quantity",
      input: "number",
      targets: [f("carton_sampling", "samplingQuantity")],
      notes: "The app counts the carton numbers; the count must equal the sampled cases (rule 6).",
    },
  ]),
  ...section(STD, "Page 2 > Dimension - Size <size>", [
    {
      label: "Dimension - Size <size>",
      input: "heading",
      targets: [l("dimensions", "sizeHeading"), l("dimensions", "title")],
      notes: "One table per size, XS to XL.",
    },
    { label: "No.", input: "fixed", targets: [l("dimensions", "rowNo"), c("dimensions", "rows")], notes: "Rows 1 to 13." },
    { label: "Length", input: "number", targets: [f("dimensions", "length")] },
    { label: "Width", input: "number", targets: [f("dimensions", "width")] },
    { label: "Finger Thickness", input: "number", targets: [f("dimensions", "fingerThickness")] },
    { label: "Palm Thickness", input: "number", targets: [f("dimensions", "palmThickness")] },
    { label: "Cuff Thickness", input: "number", targets: [f("dimensions", "cuffThickness")] },
    {
      label: "Median",
      input: "computed",
      targets: [f("dimensions", "statistic"), c("dimensions", "statistic"), c("dimensions", "decimals")],
    },
    {
      label: "Spec.",
      input: "fixed",
      targets: [l("dimensions", "specRow"), c("dimensions", "specs")],
      notes: "Length ≥ 240; Width XS ≤ 80, S 80 ± 10, M 95 ± 10, L 110 ± 10, XL ≥ 110; thickness NA.",
    },
    { label: "P/F *", input: "computed", targets: [f("dimensions", "measureResult"), l("dimensions", "pass"), l("dimensions", "fail")] },
    {
      label: "* P = Passed F = Failed",
      input: "fixed",
      targets: [layout("Legend of the P/F row: the app shows result words and chips.")],
    },
  ]),
  ...section(STD, "Page 2 > Force At Break in Newton", [
    {
      label: "Force At Break in Newton (Refer to attached where applicable)",
      input: "heading",
      targets: [l("force_at_break", "title"), f("force_at_break", "labReport")],
      notes: "'Refer to attached': the lab report, uploaded as a file.",
    },
    { label: "Size", input: "size", targets: [tpl("sizes")] },
    {
      label: "Median",
      input: "computed",
      targets: [f("force_at_break", "median"), f("force_at_break", "values"), c("force_at_break", "n")],
      notes: "Only the median is printed; the app keeps the n readings and computes it (rule 2).",
    },
    {
      label: "Spec.",
      input: "fixed",
      targets: [l("force_at_break", "specRow"), c("force_at_break", "specMin")],
      notes: "≥ 6 N (left blank for XS).",
    },
    { label: "Passed / Failed", input: "computed", targets: [f("force_at_break", "result")] },
  ]),
  ...section(STD, "Page 2 > Weight (g) - average of 13 gloves per size", [
    {
      label: "Weight (g) - average of 13 gloves per size",
      input: "heading",
      targets: [l("weight", "title"), c("weight", "n")],
    },
    { label: "Size", input: "size", targets: [tpl("sizes")] },
    {
      label: "Average",
      input: "computed",
      targets: [f("weight", "average"), f("weight", "values"), c("weight", "decimals")],
      notes: "The 13 weighings are not printed; the app keeps them and computes the average.",
    },
    {
      label: "Remark",
      input: "computed",
      targets: [f("weight", "result"), l("weight", "info"), c("weight", "specs")],
      notes: "Printed 'Info': no weight spec.",
    },
  ]),
  ...section(STD, "Page 3 > Freedom from Holes by watertight test", [
    {
      label: "Freedom from Holes by watertight test (Single sampling code letter k, L & M, AQL 1.5)",
      input: "heading",
      targets: [l("watertight", "heading"), l("watertight", "title"), f("watertight", "codeLetter"), c("watertight", "aql")],
      notes: "The code letters (printed 'k, L & M') follow from the samples: computed (rule 2).",
    },
    { label: "Glove Size", input: "size", targets: [tpl("sizes")] },
    { label: "No. of sample tested", input: "number", targets: [f("watertight", "tested")] },
    {
      label: "Defect Limit",
      input: "computed",
      targets: [l("watertight", "defectLimit"), f("watertight", "accept"), f("watertight", "reject")],
      notes: "Accept / Reject per size, from the AQL engine.",
    },
    { label: "Pin hole", input: "label", targets: [f("watertight", "holes"), c("watertight", "locations")] },
    { label: "Between fingers (crotch)", input: "number", targets: [f("watertight", "holes", { key: "hole_crotch" })] },
    { label: "Palm", input: "number", targets: [f("watertight", "holes", { key: "hole_palm" })] },
    { label: "Finger", input: "number", targets: [f("watertight", "holes", { key: "hole_finger" })] },
    { label: "Cuff", input: "number", targets: [f("watertight", "holes", { key: "hole_cuff" })] },
    {
      label: "Other :",
      input: "number",
      targets: [f("watertight", "holes", { key: "hole_other" }), f("watertight", "otherDescription")],
      notes: "The colon takes the location: watertight.otherDescription.",
    },
    {
      label: "Total number of defects found",
      input: "computed",
      targets: [f("watertight", "totalDefects")],
      notes: "Printed as <defects>/<tested>.",
    },
    { label: "Freedom from holes (Passed / Failed)", input: "computed", targets: [f("watertight", "result")] },
  ]),
  ...section(STD, "Page 3 > Visual Inspection", [
    {
      label: "Visual Inspection (Single Sampling code letter K, L & M)",
      input: "heading",
      targets: [l("visual", "heading"), l("visual", "title"), f("visual", "codeLetter")],
    },
  ]),
  ...visualClassRows(STD, "Page 3 > Visual Inspection", {
    critical: {
      heading: "Critical Defects (AQL 0.0)",
      limit: "Defect Limit : Accept / Reject",
      limitNotes: "Printed Acc. = 0 / Rej. = 1: AQL 0 is always Accept 0 / Reject 1.",
      group: "Critical Defects",
      defects: [
        ["Embeded Insects", "embedded_insect", "Embedded Insects"],
        ["Embeded metal debris", "embedded_metal", "Embedded metal debris"],
      ],
      total: 'Total number of "Critical Defects" found',
      result: ["Disposition - Visual Minor (Passed / Failed)", "Disposition - Visual Critical (Passed / Failed)"],
    },
    major: {
      heading: "Major Defects (AQL 2.5)",
      limit: "Defect Limit",
      group: "Major Defects",
      defects: [
        ["Thin area between fingers (crotch)", "thin_crotch_area"],
        ["Ring-shaped thin area (crotch)", "thin_crotch_ring"],
        ["Thin area on glove body", "thin_body_area"],
        ["Thin spot on glove body", "thin_spot"],
        ["Non-removable dirt", "dirt_nonremovable"],
        ["Oil stain", "stain"],
        ["Residue material / foreign matter", "foreign_matter"],
        ["Defective bead", "bead_defective", undefined, "Major here; 'Defective beads' is minor: same code, severity per class."],
        ["Big Lumps (>2mm)", "lump_big"],
      ],
      total: 'Total number of "Major Defects" found',
      result: ["Disposition - Visual Major (Passed / Failed)"],
    },
    minor: {
      heading: "Minor Defects (AQL 4.0)",
      limit: "Defect Limit",
      group: "Minor Defects",
      defects: [
        ["Small dirt / stain", "dirt_small"],
        ["Sticky pleats (< 5mm)", "sticky_pleats"],
        ["Lumps (<2mm)", "lump_small"],
        ["Poor beading", "bead_poor"],
        ["Rolled bead", "bead_rolled"],
        ["Defective beads", "bead_defective", undefined, "Minor here; 'Defective bead' is major: same code, severity per class."],
      ],
      total: 'Total number of "Minor Defects" found',
      result: ["Disposition - Visual Minor (Passed / Failed)"],
    },
  }),
  ...section(STD, "Page 4 > Glove Packing Check", [
    {
      label: "Glove Packing Check (Sampling code letter D & E) : min. 70% layering & 80% dispensing",
      input: "heading",
      targets: [
        l("dispensing_packing", "heading"),
        l("dispensing_packing", "title"),
        f("dispensing_packing", "codeLetter"),
        c("dispensing_packing", "minLayeringPct"),
        c("dispensing_packing", "minDispensingPct"),
      ],
    },
    {
      label: "<size>",
      input: "size",
      targets: [tpl("sizes")],
      notes: "One block per size, headed by the size.",
    },
    {
      label: "Item",
      input: "fixed",
      targets: [l("dispensing_packing", "itemColumn"), c("dispensing_packing", "boxesPerSize")],
      notes: "Rows 1 to 13 (1 to 5 in the XL block).",
    },
    { label: "Box #", input: "number", targets: [f("dispensing_packing", "boxNo")], notes: "Carton numbers (rule 7)." },
    { label: "Layering %", input: "number", targets: [f("dispensing_packing", "layeringPct")] },
    { label: "Dispensing %", input: "number", targets: [f("dispensing_packing", "dispensingPct")] },
    { label: "Stickiness **", input: "select", targets: [f("dispensing_packing", "stickiness")] },
    {
      label: "Average",
      input: "computed",
      targets: [
        f("dispensing_packing", "layeringAverage"),
        f("dispensing_packing", "dispensingAverage"),
        f("dispensing_packing", "stickinessSummary"),
      ],
      notes: "One per column; the stickiness column prints a code.",
    },
    {
      label: "Passed / Failed",
      input: "computed",
      targets: [
        f("dispensing_packing", "layeringResult"),
        f("dispensing_packing", "dispensingResult"),
        f("dispensing_packing", "stickinessResult"),
      ],
      notes: "One per column.",
    },
    {
      label: "**Glove stickiness Code",
      input: "label",
      targets: [l("dispensing_packing", "stickinessLegend"), c("dispensing_packing", "stickinessCodes")],
    },
    {
      label: "A = Non sticky (Passed)",
      input: "fixed",
      targets: [c("dispensing_packing", "stickinessCodes", "A")],
    },
    {
      label: "B = A mix of non sticky to lightly sticky (Passed)",
      input: "fixed",
      targets: [c("dispensing_packing", "stickinessCodes", "B")],
    },
    {
      label: "B1 = A mix of non sticky to light sickiness at the bead (Passed)",
      corrected: "B1 = A mix of non sticky to light stickiness at the bead (Passed)",
      input: "fixed",
      targets: [c("dispensing_packing", "stickinessCodes", "B1")],
    },
    {
      label: "C = Lightly sticky but dispensable (Passed)",
      input: "fixed",
      targets: [c("dispensing_packing", "stickinessCodes", "C")],
    },
    {
      label: "D = Too sticky & affect dispensing (Failed)",
      input: "fixed",
      targets: [c("dispensing_packing", "stickinessCodes", "D")],
    },
  ]),
  ...section(STD, "Page 4 > Packaging Labeling Inspection", [
    { label: "Packaging Labeling Inspection", input: "heading", targets: [l("labeling", "title")] },
  ]),
  ...labellingLevelRows(STD, "Page 4 > Packaging Labeling Inspection", "inner", {
    heading: "Dispenser Box",
    limit: "Defect Limit",
    limitNotes: "Accept 0 / Reject 1.",
    checks: [
      ["Wrong / No lot number", "lot_no"],
      ["Wrong / No mfg. date", "mfg_date"],
      ["Wrong artwork print", "artwork"],
    ],
    result: ["Disposition - Inner Box (Passed / Failed)"],
    nNotes: "3 per size.",
  }),
  ...labellingLevelRows(STD, "Page 4 > Packaging Labeling Inspection", "carton", {
    heading: "Carton Box",
    limit: "Defect Limit",
    limitNotes: "Accept 0 / Reject 1.",
    checks: [
      ["Wrong / No lot number", "lot_no"],
      ["Wrong / No mfg. date", "mfg_date"],
      ["Wrong artwork print", "artwork"],
      ["No carton number printed", "carton_no"],
    ],
    result: ["Disposition - Inner Box (Passed / Failed)", "Disposition - Carton Box (Passed / Failed)"],
    nNotes: "1 per size.",
  }),
  ...section(STD, "Page 4 > Conclusion", [
    {
      label: "Conclusion",
      input: "select",
      targets: [f("conclusion", "finalResult"), l("conclusion", "pass"), l("conclusion", "fail")],
      notes: "PASSED / FAILED.",
    },
    {
      label: "(signature)",
      input: "signature",
      targets: [f("conclusion", "signature")],
      notes: "Signature image beside the conclusion, no label.",
    },
    { label: "Date", input: "date", targets: [f("conclusion", "date")], notes: "The report date." },
    { label: "Remark", input: "text", targets: [f("conclusion", "remark")] },
  ]),
];

/* ------------------------------------------------------------------ *
 * reports/SAFEDON_EG.md
 * ------------------------------------------------------------------ */

const SAF = "report_SAFEDON_EG";

const SAFEDON_DEFECT_ROWS: readonly [label: string, code: string, printedHint: string, correctedHint?: string][] = [
  ["No cuff", "no_cuff", "Cuff should ideallly be at least 2 cm out", "Cuff should ideally be at least 2 cm out"],
  ["Finger out", "finger_out", "Only cuff but no finger should be out first"],
  ["Multiple gloves out", "multiple_out", "Only one glove should be out at one time"],
  [
    "Glove stuck",
    "stuck",
    "Glove ould not be dispensed or very difficult to dispense",
    "Glove could not be dispensed or very difficult to dispense",
  ],
  ["Sticky glove", "sticky", "Two or more gloves out at the same time caused by gloves sticking together"],
  ["Faulty cuff", "faulty_cuff", "Deformed or out of shaped cuff which causes dispensing problem"],
];

function safedonDefectRows(): Row[] {
  return SAFEDON_DEFECT_ROWS.flatMap(([label, code, printedHint, correctedHint]) => [
    { label, input: "number", targets: [f("dispensing_safedon", "counts", { key: code })], notes: "A count per box." },
    {
      label: printedHint,
      ...(correctedHint ? { corrected: correctedHint } : {}),
      input: "fixed",
      targets: [c("dispensing_safedon", "defects", code)],
      notes: `Definition of '${label}', printed beside the row; the app shows its own wording as the hint.`,
    } satisfies Row,
  ]);
}

const REPORT_SAFEDON_EG: SourceField[] = [
  ...section(SAF, "All pages", [
    { label: "Page <n> of 4", input: "page", targets: [PAGE_NUMBER] },
    {
      label: "Preshipment Report (PO# <PO>: <product>)",
      input: "page",
      targets: [
        layout(
          "Running header of pages 2 to 4, 'Preshipment Report (PO# <PO>: <product>)': the AI report draws it from header.poNo and header.productName.",
        ),
      ],
      notes: "BUILD_SPEC 4.3's report settings hold the title and the client logo only.",
    },
  ]),
  ...section(SAF, "Page 1 > Title", [
    { label: "Preshipment Inspection", input: "heading", targets: [tpl("report.titleLines")] },
    { label: "Safedon Nitrile PF Exam Gloves", input: "heading", targets: [tpl("report.titleLines")] },
    {
      label: "(client logo)",
      input: "image",
      targets: [tpl("report.showClientLogo")],
      notes:
        "Top left: the logo (clients.logo_path) of the inspection's client, in place of a Client Name row. The client is picked on /inspections/new and kept in inspections.client_id; the header's Client Name row is off.",
    },
  ]),
  ...section(SAF, "Page 1 > Manufacturer Information", [
    { label: "Manufacturer Information", input: "heading", targets: [l("header", "title")] },
    { label: "Manufacturer / Supplier", input: "text", targets: [f("header", "manufacturer")] },
    { label: "Supplier Factory Address / Location", input: "text", targets: [f("header", "factoryAddress")] },
    {
      label: "PO Number",
      input: "text",
      targets: [f("header", "poNo")],
      notes: "The PO with the client's reference in brackets: one value.",
    },
    { label: "Product Name (Brand & code)", input: "text", targets: [f("header", "productName")] },
    { label: "Inspection date", input: "date", targets: [f("header", "inspectionDate")] },
    {
      label: "Manufacturing date",
      input: "date",
      targets: [f("header", "mfgDate"), c("header", "mfgExpiryPrecision")],
      notes: "Printed as month and year.",
    },
    {
      label: "Expiry date",
      input: "date",
      targets: [f("header", "expiryDate"), c("header", "mfgExpiryPrecision")],
      notes: "Printed as month and year.",
    },
    {
      label: "Inspected by",
      input: "text",
      targets: [f("header", "inspector")],
      notes: "The app records the logged-in inspector (rule 11).",
    },
  ]),
  ...section(SAF, "Page 1 > Glove Information", [
    { label: "Glove Information", input: "heading", targets: [l("glove_info", "title")] },
    { label: "Glove surface texture", input: "text", targets: [f("glove_info", "surfaceTexture")] },
    {
      label: "Indicative weight (size M)",
      input: "number",
      targets: [f("glove_info", "indicativeWeight"), c("glove_info", "indicativeWeightSize")],
      notes: "Grams.",
    },
    { label: "Glove colour", input: "text", targets: [f("glove_info", "colour")] },
    { label: "Glove length", input: "text", targets: [f("glove_info", "length")] },
  ]),
  ...section(SAF, "Page 1 > Order table", [
    { label: "Size", input: "size", targets: [tpl("sizes")], notes: "Rows XS, S, M, L, XL." },
    { label: "Qty (cases)", input: "number", targets: [f("order_lots", "qtyCases")] },
    { label: "Lot Number", input: "text", targets: [f("order_lots", "lotNumbers")] },
    {
      label: "Packing Site",
      input: "text",
      targets: [f("order_lots", "packingSite"), c("order_lots", "fields")],
      notes: "The site that packed the size's lot.",
    },
    { label: "Total # carton", input: "computed", targets: [f("order_lots", "totalCartons")] },
    { label: "Total # gloves", input: "computed", targets: [f("order_lots", "totalGloves")] },
  ]),
  ...section(SAF, "Page 1 > Packing configuration", [
    { label: "Packing configuration", input: "label", targets: [l("packing_config", "title")] },
    {
      label: "# glove per plastic pack",
      input: "number",
      targets: [f("packing_config", "glovesPerInner"), c("packing_config", "innerUnit")],
      notes: "Names the inner unit: plastic pack.",
    },
    { label: "# packs per case", input: "number", targets: [f("packing_config", "innersPerCase")] },
    { label: "# gloves per case", input: "number", targets: [f("packing_config", "glovesPerCase")] },
  ]),
  ...section(SAF, "Page 1 > Sampling Plan", [
    { label: "Sampling Plan", input: "heading", targets: [l("sampling_plan", "title")] },
    { label: "Glove Size", input: "size", targets: [tpl("sizes")] },
    {
      label: "Order Qty (case)",
      input: "repeat",
      targets: [l("sampling_plan", "orderQty"), f("order_lots", "qtyCases")],
      notes: "The order quantity again: entered once, in the order table.",
    },
    { label: "Sampling Quantity", input: "label", targets: [l("sampling_plan", "samplingQuantity")] },
    { label: "Case", input: "number", targets: [f("sampling_plan", "cases")] },
    { label: "Inner pack", input: "number", targets: [f("sampling_plan", "innerUnits")] },
    { label: "Gloves", input: "number", targets: [f("sampling_plan", "gloves")] },
    { label: "# gloves for watertight & Visual", input: "number", targets: [f("sampling_plan", "glovesWatertightVisual")] },
    { label: "# gloves for dimension", input: "number", targets: [f("sampling_plan", "glovesDimensions")] },
    { label: "# gloves for Tensile", input: "number", targets: [f("sampling_plan", "glovesPhysical")] },
    {
      label: "# inner packs for packaing & dispensing inspection",
      corrected: "# inner packs for packaging & dispensing inspection",
      input: "number",
      targets: [f("sampling_plan", "innerUnitsDispensing")],
    },
  ]),
  ...section(SAF, "Page 1 > Finished Goods Sampling Information (carton number)", [
    {
      label: "Finished Goods Sampling Information (carton number)",
      input: "heading",
      targets: [l("carton_sampling", "title")],
    },
    {
      label: "(Carton #)",
      input: "number",
      targets: [f("carton_sampling", "cartonNumbers"), l("carton_sampling", "sizeCaption")],
      notes: "Same grid as STD_EG: 10 columns × 5 rows per size.",
    },
    {
      label: "Sampling Quantity",
      input: "number",
      targets: [f("carton_sampling", "samplingQuantity")],
      notes: "The app counts the carton numbers (rule 6).",
    },
  ]),
  ...section(SAF, "Page 2 > Dimension - Size <size>", [
    {
      label: "Dimension - Size <size>",
      input: "heading",
      targets: [l("dimensions", "sizeHeading"), l("dimensions", "title")],
      notes: "One table per ordered size.",
    },
    { label: "No.", input: "fixed", targets: [l("dimensions", "rowNo"), c("dimensions", "rows")], notes: "Rows 1 to 13." },
    { label: "Length", input: "number", targets: [f("dimensions", "length")] },
    { label: "Width", input: "number", targets: [f("dimensions", "width")] },
    { label: "Finger Thickness", input: "number", targets: [f("dimensions", "fingerThickness")] },
    { label: "Palm Thickness", input: "number", targets: [f("dimensions", "palmThickness")] },
    {
      label: "Weight (g)",
      input: "number",
      targets: [f("weight", "values"), c("weight", "n"), l("weight", "title")],
      notes: "One value per size in a merged cell (weight, n = 1), printed as a column of the dimension table.",
    },
    {
      label: "Average",
      input: "computed",
      targets: [f("dimensions", "statistic"), c("dimensions", "statistic"), c("dimensions", "decimals")],
    },
    {
      label: "Spec.",
      input: "fixed",
      targets: [l("dimensions", "specRow"), c("dimensions", "specs"), c("weight", "specs")],
      notes: "Length ≥ 230; Width XS 76 ± 4, S 86 ± 4, M 98 ± 4, L 107 ± 4; Finger 0.18 ± 0.04; Palm 0.14 ± 0.04; Weight NA.",
    },
    {
      label: "A / Rej.",
      input: "computed",
      targets: [f("dimensions", "measureResult"), f("weight", "result"), l("dimensions", "pass"), l("dimensions", "fail")],
      notes: "A = accepted. The weight column prints A against its NA spec.",
    },
  ]),
  ...section(SAF, "Page 2 > Physical Properties", [
    {
      label: "Physical Properties average (Refer to attached lab. reports)",
      input: "heading",
      targets: [l("tensile", "title"), f("tensile", "labReport")],
      notes: "'Refer to attached lab. reports': uploaded as files.",
    },
  ]),
  ...section(SAF, "Page 2 > Physical Properties > Tensile Strength", [
    { label: "Size", input: "size", targets: [tpl("sizes")] },
    { label: "Tensile Strength (Average) (MPa)", input: "number", targets: [f("tensile", "tensileStrength")] },
    {
      label: "Spec. (ASTM D6319)",
      input: "fixed",
      targets: [l("tensile", "specRow"), c("tensile", "tensileMin"), c("tensile", "standardLabel")],
      notes: "≥ 14.00 MPa.",
    },
    { label: "Passed / Failed", input: "computed", targets: [f("tensile", "tensileResult")] },
  ]),
  ...section(SAF, "Page 2 > Physical Properties > Elongation at break", [
    { label: "Size", input: "size", targets: [tpl("sizes")] },
    { label: "Elongation at break, average (%)", input: "number", targets: [f("tensile", "elongationAtBreak")] },
    {
      label: "Spec. (ASTM D6319)",
      input: "fixed",
      targets: [l("tensile", "specRow"), c("tensile", "elongationMin"), c("tensile", "decimals")],
      notes: "≥ 500%.",
    },
    { label: "Passed / Failed", input: "computed", targets: [f("tensile", "elongationResult")] },
  ]),
  ...section(SAF, "Page 3 > Glove Dispensing Inspection", [
    {
      label: "Glove Dispensing Inspection (Sampling code letter C & D)",
      input: "heading",
      targets: [l("dispensing_safedon", "heading"), l("dispensing_safedon", "title"), f("dispensing_safedon", "codeLetter")],
    },
    {
      label: "Size",
      input: "size",
      targets: [tpl("sizes")],
      notes: "Two sizes share a block row, the 13 box columns split between them; the app shows one block per size.",
    },
    {
      label: "Box #",
      input: "number",
      targets: [f("dispensing_safedon", "boxNo"), c("dispensing_safedon", "boxesPerSize")],
      notes: "Carton numbers from page 1 (rule 7).",
    },
    {
      label: "Safedon Packing Defects",
      input: "label",
      targets: [f("dispensing_safedon", "counts"), c("dispensing_safedon", "defects")],
    },
    ...safedonDefectRows(),
    {
      label: "Total",
      input: "computed",
      targets: [
        l("dispensing_safedon", "totalGroup"),
        f("dispensing_safedon", "boxDefects"),
        f("dispensing_safedon", "boxRatePct"),
        f("dispensing_safedon", "totalDefects"),
        f("dispensing_safedon", "glovesInspected"),
        f("dispensing_safedon", "ratePct"),
        c("dispensing_safedon", "glovesPerPack"),
      ],
      notes:
        "Three lines: per box <defects>/<gloves per pack>; per box the rate as a percentage with one decimal (e.g. 0.8%); per size <defects> / <gloves> (<rate> %).",
    },
    {
      label: "Specification / Requirement",
      input: "fixed",
      targets: [l("dispensing_safedon", "specRow"), c("dispensing_safedon", "maxRatePct")],
      notes: "≤ 5% per size.",
    },
    { label: "Conclusion", input: "computed", targets: [f("dispensing_safedon", "result")], notes: "Passed / Failed per size." },
  ]),
  ...section(SAF, "Page 4 > Freedom from Holes by watertight test", [
    {
      label: "Freedom from Holes by watertight test (Sampling code letter J & L; AQL=1.5)",
      input: "heading",
      targets: [l("watertight", "heading"), l("watertight", "title"), f("watertight", "codeLetter"), c("watertight", "aql")],
    },
    { label: "Glove Size", input: "size", targets: [tpl("sizes")] },
    { label: "No. of sample tested", input: "number", targets: [f("watertight", "tested")] },
    {
      label: "Defect Limit",
      input: "computed",
      targets: [l("watertight", "defectLimit"), f("watertight", "accept"), f("watertight", "reject")],
      notes: "Accept / Reject per size.",
    },
    { label: "Holes", input: "label", targets: [f("watertight", "holes"), c("watertight", "locations")] },
    { label: "Between fingers", input: "number", targets: [f("watertight", "holes", { key: "hole_crotch" })] },
    { label: "Palm", input: "number", targets: [f("watertight", "holes", { key: "hole_palm" })] },
    { label: "Cuff", input: "number", targets: [f("watertight", "holes", { key: "hole_cuff" })] },
    { label: "Finger", input: "number", targets: [f("watertight", "holes", { key: "hole_finger" })] },
    { label: "Glove burst", input: "number", targets: [f("watertight", "holes", { key: "glove_burst" })] },
    {
      label: "Other :",
      input: "number",
      targets: [f("watertight", "holes", { key: "hole_other" }), f("watertight", "otherDescription")],
      notes: "The colon takes the location: watertight.otherDescription.",
    },
    {
      label: "Total number of defects found",
      input: "computed",
      targets: [f("watertight", "totalDefects")],
      notes: "Printed as <defects> / <tested>.",
    },
    { label: "Freedom from holes (Passed / Failed)", input: "computed", targets: [f("watertight", "result")] },
  ]),
  ...section(SAF, "Page 4 > Visual Inspection", [
    {
      label: "Visual Inspection (Sampling code letter J & L)",
      input: "heading",
      targets: [l("visual", "heading"), l("visual", "title"), f("visual", "codeLetter")],
    },
  ]),
  ...visualClassRows(SAF, "Page 4 > Visual Inspection", {
    critical: {
      heading: "Critical Defects (AQL 0.0)",
      limit: "Defect Limit",
      limitNotes: "Accept 0 / Reject 1.",
      group: "Critical Defects",
      defects: [
        ["Embeded Insects", "embedded_insect", "Embedded Insects"],
        ["Embeded metal debris", "embedded_metal", "Embedded metal debris"],
      ],
      total: 'Total number of "Critical Defects" found',
      result: ["Disposition - Visual Minor (Passed / Failed)", "Disposition - Visual Critical (Passed / Failed)"],
    },
    major: {
      heading: "Major Defects (AQL 2.5)",
      limit: "Defect Limit",
      group: "Major Defects",
      defects: [
        ["Thin ring between fingers (crotch)", "thin_crotch_ring"],
        ["Thin area between fingers (crotch)", "thin_crotch_area"],
        ["Thin batch / area (body)", "thin_body_area", "Thin patch / area (body)"],
        ["Thin spot", "thin_spot"],
        ["Non-removable dirt", "dirt_nonremovable"],
        ["Stain", "stain"],
        ["Powder mark", "powder_mark"],
        ["Bead blister", "bead_blister"],
      ],
      total: 'Total number of "Major Defects" found',
      result: ["Disposition - Visual Major (Passed / Failed)"],
    },
    minor: {
      heading: "Minor Defects (AQL 4.0)",
      limit: "Defect Limit",
      group: "Minor Defects",
      defects: [
        ["Small dirt / stain", "dirt_small"],
        ["Sticky pleats (< 5mm)", "sticky_pleats"],
        ["Lumps (<2mm)", "lump_small"],
        ["Thin bead", "bead_thin"],
        ["Thin bead / small beading defect", "bead_small_defect"],
      ],
      total: 'Total number of "Minor Defects" found',
      result: ["Disposition - Visual Minor (Passed / Failed)"],
    },
  }),
  ...section(SAF, "Page 4 > Packaging Labeling Inspection", [
    { label: "Packaging Labeling Inspection", input: "heading", targets: [l("labeling", "title")] },
  ]),
  ...labellingLevelRows(SAF, "Page 4 > Packaging Labeling Inspection", "inner", {
    heading: "Inner Boxes/Packs",
    sizeRow: true,
    limit: "Limit : Accept / Reject",
    limitNotes: "Acc. = 0 / Rej. = 1.",
    checks: [
      ["Wrong / No lot number", "lot_no"],
      ["Wrong / No mfg. date", "mfg_date"],
      ["Wrong / No expiry date", "expiry_date"],
      ["Wrong artwork print", "artwork"],
    ],
    result: ["Disposition - Inner Box (Passed / Failed)"],
    nNotes: "3 per size.",
  }),
  ...labellingLevelRows(SAF, "Page 4 > Packaging Labeling Inspection", "carton", {
    heading: "Carton Boxes",
    sizeRow: true,
    limit: "Limit : Accept / Reject",
    limitNotes: "Acc. = 0 / Rej. = 1.",
    checks: [
      ["Wrong / No lot number", "lot_no"],
      ["Wrong / No mfg. date", "mfg_date"],
      ["Wrong / No expiry date", "expiry_date"],
      ["Wrong artwork print", "artwork"],
      ["No carton number", "carton_no"],
    ],
    result: ["Disposition - Carton Box (Passed / Failed)"],
    nNotes: "1 per size.",
  }),
  ...section(SAF, "Page 4 > Conclusion", [
    {
      label: "Conclusion",
      input: "select",
      targets: [f("conclusion", "finalResult"), l("conclusion", "pass"), l("conclusion", "fail")],
      notes: "PASSED / FAILED.",
    },
    { label: "Inspected by", input: "text", targets: [f("conclusion", "inspector")], notes: "The logged-in inspector." },
    { label: "Date", input: "date", targets: [f("conclusion", "date")], notes: "The report date." },
    {
      label: "(signature)",
      input: "signature",
      targets: [f("conclusion", "signature")],
      notes: "Signature image beside the conclusion, no label.",
    },
    { label: "Remark", input: "text", targets: [f("conclusion", "remark")] },
  ]),
];

/* ------------------------------------------------------------------ *
 * Onsite forms: sections shared by EG, SG and Safedon EG
 * ------------------------------------------------------------------ */

/**
 * The onsite forms' first block. Glove Type goes to each glove variant
 * (glove_info) where the template has Glove Information (EG and Safedon,
 * since 11 October 2026), else to the custom module glove_type (SG).
 */
function shipmentRows(heading: string, gloveType: "glove_info" | "custom" = "glove_info"): Row[] {
  return [
    { label: heading, input: "heading", targets: [l("header", "title")] },
    { label: "Manufacturer Name", input: "text", targets: [f("header", "manufacturer")] },
    { label: "Purchase/Sales Order No.", input: "text", targets: [f("header", "poNo")] },
    { label: "Product Name", input: "text", targets: [f("header", "productName")] },
    {
      label: "Lot Number",
      input: "text",
      targets: [f("order_lots", "lotNumbers")],
      notes: "Double-height box for several lots, not split by size; the app records the lots per size.",
    },
    {
      label: "Mfg / Exp Date",
      input: "text",
      targets: [f("header", "mfgDate"), f("header", "expiryDate")],
      templateLabel: false,
      notes: "One box for both dates; the app splits it into two date pickers (rule 3).",
    },
    {
      label: "Glove Type",
      input: "text",
      targets: gloveType === "glove_info" ? [f("glove_info", "gloveType")] : [custom("glove_type", "gloveType")],
      notes:
        gloveType === "glove_info"
          ? "Each glove variant's Glove Type (glove_info; a custom module of its own until 11 October 2026)."
          : "No Glove Information on this template: custom module glove_type.",
    },
    {
      label: "Packing Mode",
      input: "text",
      targets: [f("packing_config", "packingMode"), c("packing_config", "fields")],
    },
  ];
}

const INSPECTED_BY_ROWS: readonly Row[] = [
  { label: "Inspected by", input: "heading", targets: [f("header", "inspector")] },
  {
    label: "Name",
    input: "text",
    targets: [f("header", "inspector")],
    templateLabel: false,
    notes: "The logged-in inspector, recorded by the app.",
  },
  { label: "Date", input: "date", targets: [f("header", "inspectionDate")], notes: "The inspection date." },
  {
    label: "(unlabelled tall box)",
    input: "blank",
    targets: [f("conclusion", "signature"), f("conclusion", "remark")],
    notes: "Likely signature or remarks: the app takes both in the conclusion.",
  },
];

/* ------------------------------------------------------------------ *
 * onsite/EG.md
 * ------------------------------------------------------------------ */

function egRows(source: SourceId, shipmentHeading: string): SourceField[] {
  return [
    ...section(source, "1. Purchase Order / Shipment Information", shipmentRows(shipmentHeading)),
    ...section(source, "2. Inspected by", INSPECTED_BY_ROWS),
    ...section(source, "3. PO Info / Sampling Plan", [
      { label: "PO Info", input: "label", targets: [l("order_lots", "title")] },
      { label: "Glove Size", input: "size", targets: [tpl("sizes")], notes: "5 blank size rows." },
      { label: "Qty (case)", input: "number", targets: [f("order_lots", "qtyCases")] },
      { label: "Sampling Plan", input: "heading", targets: [l("sampling_plan", "title")] },
      { label: "Sampling Quantity", input: "label", targets: [l("sampling_plan", "samplingQuantity")] },
      { label: "Case", input: "number", targets: [f("sampling_plan", "cases")] },
      { label: "Inner", input: "number", targets: [f("sampling_plan", "innerUnits")] },
      { label: "Gloves", input: "number", targets: [f("sampling_plan", "gloves")] },
      { label: "# Gloves for WTT & Visual", input: "number", targets: [f("sampling_plan", "glovesWatertightVisual")] },
      { label: "# Gloves dimension", input: "number", targets: [f("sampling_plan", "glovesDimensions")] },
      { label: "# Gloves for FAB", input: "number", targets: [f("sampling_plan", "glovesPhysical")] },
      { label: "# inner for dispensing test", input: "number", targets: [f("sampling_plan", "innerUnitsDispensing")] },
      {
        label: "Total:",
        input: "computed",
        targets: [f("sampling_plan", "totals"), f("order_lots", "totalCartons")],
        notes: "Sums every column except Glove Size.",
      },
    ]),
    ...section(source, "4. Watertight Inspection", [
      { label: "Watertight Inspection", input: "heading", targets: [l("watertight", "title")] },
      { label: "Size", input: "size", targets: [tpl("sizes")], notes: "5 size columns, no R/L split." },
      {
        label: "Defect",
        input: "handwritten_rows",
        targets: [f("watertight", "holes"), f("watertight", "unmapped")],
        notes:
          "6 blank rows: a handwritten defect name and a count per size. Names in the template's location list count there; others are saved unmapped for an admin.",
      },
      { label: "Total:", input: "computed", targets: [f("watertight", "totalDefects")], notes: "One total per size." },
    ]),
    ...section(source, "5. Visual Inspection", [
      { label: "Visual Inspection", input: "heading", targets: [l("visual", "title")] },
      { label: "Size", input: "size", targets: [tpl("sizes")], notes: "One shared row of 5 sizes." },
      {
        label: "Major defect",
        input: "handwritten_rows",
        targets: [f("visual", "counts", { group: "major" }), f("visual", "unmapped", { group: "major" })],
        notes: "7 blank rows: defect name and a count per size.",
      },
      { label: "Total Major", input: "computed", targets: [f("visual", "total", { group: "major" })] },
      {
        label: "Minor defect",
        input: "handwritten_rows",
        targets: [f("visual", "counts", { group: "minor" }), f("visual", "unmapped", { group: "minor" })],
        notes: "5 blank rows: defect name and a count per size.",
      },
      { label: "Total Minor", input: "computed", targets: [f("visual", "total", { group: "minor" })] },
    ]),
  ];
}

const ONSITE_EG: SourceField[] = [
  ...egRows("onsite_EG", "Purchase Order / Shipment Information"),
  ...section("onsite_EG", "6. Dispensing Result", [
    { label: "Dispensing Result", input: "heading", targets: [l("dispensing_packing", "title")] },
    { label: "Size", input: "size", targets: [tpl("sizes")], notes: "A size per row; the app shows one block per size." },
    {
      label: "No.",
      input: "computed",
      targets: [l("dispensing_packing", "itemColumn"), c("dispensing_packing", "boxesPerSize")],
      notes: "Running row number, automatic. 51 blank rows, one per box tested.",
    },
    { label: "Box Number", input: "text", targets: [f("dispensing_packing", "boxNo")], notes: "Picked from the carton list (rule 7)." },
    { label: "Layering (%)", input: "number", targets: [f("dispensing_packing", "layeringPct")] },
    { label: "Dispensing (%)", input: "number", targets: [f("dispensing_packing", "dispensingPct")] },
    {
      label: "Stickiness",
      input: "text",
      targets: [f("dispensing_packing", "stickiness"), c("dispensing_packing", "stickinessCodes")],
      notes:
        "onsite/EG.md suggests none / slight / severe plus a note; the report's codes A, B, B1, C, D apply (report first, rule 4.2.1).",
    },
    { label: "Others:", input: "text", targets: [f("dispensing_packing", "note")] },
  ]),
];

/* ------------------------------------------------------------------ *
 * onsite/SG.md
 * ------------------------------------------------------------------ */

function handRows(module: "watertight" | "visual"): Row[] {
  return (["R", "L"] as const).map((hand) => ({
    label: hand,
    input: "label",
    targets: [c(module, "handSplit")],
    notes: hand === "R" ? "Each size column splits into R and L." : undefined,
  }));
}

function sgVisualRows(cls: "major" | "minor", heading: string, total: string, blankRows: number): Row[] {
  return [
    { label: "Size", input: "size", targets: [tpl("sizes")], notes: "8 sizes, each split R / L." },
    ...handRows("visual"),
    {
      label: heading,
      input: "handwritten_rows",
      targets: [
        f("visual", "counts", { group: cls }),
        f("visual", "unmapped", { group: cls }),
        l("visual", cls === "major" ? "majorHeading" : "minorHeading"),
      ],
      notes: `${blankRows} blank rows: defect name and a count per size per hand.`,
    },
    {
      label: total,
      input: "computed",
      targets: [f("visual", "total", { group: cls })],
      notes: "One total per size, spanning R and L.",
    },
  ];
}

const ONSITE_SG: SourceField[] = [
  ...section("onsite_SG", "1. Purchase Order / Shipment Information", shipmentRows("Purchase Order / Shipment Information", "custom")),
  ...section("onsite_SG", "2. Inspected by", INSPECTED_BY_ROWS),
  ...section("onsite_SG", "3. PO Info / Sampling Plan", [
    { label: "PO Info", input: "label", targets: [l("order_lots", "title")] },
    { label: "Glove Size", input: "size", targets: [tpl("sizes")], notes: "8 blank size rows." },
    { label: "Qty (case)", input: "number", targets: [f("order_lots", "qtyCases")] },
    { label: "Sampling Plan", input: "heading", targets: [l("sampling_plan", "title")] },
    {
      label: "Sampling Quantity (WTT & Visual)",
      input: "label",
      targets: [l("sampling_plan", "samplingQuantity")],
      notes: "Unlike EG, the watertight and visual sample is inside Sampling Quantity.",
    },
    { label: "Case", input: "number", targets: [f("sampling_plan", "cases")] },
    { label: "Inner Box", input: "number", targets: [f("sampling_plan", "innerUnits")] },
    { label: "Pouches", input: "number", targets: [f("sampling_plan", "pouches")] },
    {
      label: "# gloves",
      input: "number",
      targets: [f("sampling_plan", "glovesWatertightVisual")],
      notes: "The watertight and visual sample; STD_SG has no separate Gloves column.",
    },
    { label: "# Gloves dimension", input: "number", targets: [f("sampling_plan", "glovesDimensions")] },
    {
      label: "# Gloves (FAB)",
      input: "number",
      targets: [f("sampling_plan", "glovesPhysical")],
      notes: "Planned only: no FAB results on the form, and BUILD_SPEC 11 has no force_at_break in STD_SG.",
    },
    {
      label: "# pouches (dye leak test)",
      input: "number",
      targets: [f("sampling_plan", "pouchesDyeLeak")],
      notes: "Planned only on the form; results go to dye_leak.",
    },
    {
      label: "Total:",
      input: "computed",
      targets: [f("sampling_plan", "totals"), f("order_lots", "totalCartons")],
      notes: "Sums every column except Glove Size.",
    },
  ]),
  ...section("onsite_SG", "4. Watertight Inspection", [
    { label: "Watertight Inspection", input: "heading", targets: [l("watertight", "title")] },
    { label: "Size", input: "size", targets: [tpl("sizes")], notes: "8 size columns." },
    ...handRows("watertight"),
    {
      label: "Defect",
      input: "handwritten_rows",
      targets: [f("watertight", "holes"), f("watertight", "unmapped")],
      notes: "7 blank rows: a handwritten defect name and a count per size per hand.",
    },
    {
      label: "Total WTT",
      input: "computed",
      targets: [f("watertight", "totalDefects")],
      notes: "One total per size, spanning R and L.",
    },
  ]),
  ...section("onsite_SG", "5. Visual Inspection", [
    { label: "Visual Inspection", input: "heading", targets: [l("visual", "title")] },
  ]),
  ...section("onsite_SG", "5. Visual Inspection > Major defect", sgVisualRows("major", "Major defect", "Total Major", 7)),
  ...section("onsite_SG", "5. Visual Inspection > Minor defect", sgVisualRows("minor", "Minor defect", "Total Minor", 6)),
];

/* ------------------------------------------------------------------ *
 * onsite/SAFEDON_EG.md: sections 1 to 5 as EG, section 6 the Safedon sheet
 * ------------------------------------------------------------------ */

const ONSITE_SAFEDON_EG: SourceField[] = [
  ...egRows("onsite_SAFEDON_EG", "Purchase Order / Shipment Information (Safedon)"),
  ...section("onsite_SAFEDON_EG", "6. Glove Dispensing Inspection", [
    { label: "Glove Dispensing Inspection", input: "heading", targets: [l("dispensing_safedon", "title")] },
    { label: "Size", input: "text", targets: [tpl("sizes")], notes: "One per block; 3 identical blocks on the page." },
    {
      label: "Box #",
      input: "number",
      targets: [f("dispensing_safedon", "boxNo"), c("dispensing_safedon", "boxesPerSize")],
      notes: "13 box columns, the box number written at the top of each; the app allows more.",
    },
    {
      label: "Safedon Packing Defects",
      input: "label",
      targets: [f("dispensing_safedon", "counts"), c("dispensing_safedon", "defects")],
    },
    ...safedonDefectRows(),
    {
      label: "Total",
      input: "computed",
      targets: [
        l("dispensing_safedon", "totalGroup"),
        f("dispensing_safedon", "boxDefects"),
        f("dispensing_safedon", "boxRatePct"),
        f("dispensing_safedon", "totalDefects"),
        f("dispensing_safedon", "glovesInspected"),
        f("dispensing_safedon", "ratePct"),
      ],
      notes: "Three unlabelled lines: two rows of 13 per-box cells, then one full-width cell. All computed.",
    },
    {
      label: "Specification / Requirement",
      input: "text",
      targets: [
        custom("safedon_dispensing_notes", "specRequirement"),
        l("dispensing_safedon", "specRow"),
        c("dispensing_safedon", "maxRatePct"),
      ],
      notes:
        "Free text per block, kept as written in the custom module safedon_dispensing_notes and exported (onsite/SAFEDON_EG.md). The app judges the rate against the template's maxRatePct, which the report prints here (≤ 5%).",
    },
    {
      label: "Conclusion",
      input: "text",
      targets: [custom("safedon_dispensing_notes", "conclusion"), f("dispensing_safedon", "result")],
      notes:
        "Free text per block, kept as written in the custom module safedon_dispensing_notes and exported (onsite/SAFEDON_EG.md). The report prints the computed Passed / Failed here (rule 6.2.2).",
    },
  ]),
];

/* ------------------------------------------------------------------ *
 * Repeated report blocks
 * ------------------------------------------------------------------ */

type VisualClassRows = {
  heading: string;
  limit: string;
  limitNotes?: string;
  group: string;
  /** [printed label, code, corrected label, notes] */
  defects: readonly (readonly [string, string, string?, string?])[];
  total: string;
  /** [printed, corrected] */
  result: readonly [string, string?];
};

function visualClassRows(
  source: SourceId,
  sectionName: string,
  classes: Readonly<Record<"critical" | "major" | "minor", VisualClassRows>>,
): SourceField[] {
  return (["critical", "major", "minor"] as const).flatMap((cls) => {
    const spec = classes[cls];
    const heading = cls === "critical" ? "criticalHeading" : cls === "major" ? "majorHeading" : "minorHeading";
    const limitCaption = cls === "critical" ? "criticalLimit" : "defectLimit";
    const [result, resultCorrected] = spec.result;
    return section(source, `${sectionName} > ${spec.heading}`, [
      { label: spec.heading, input: "heading", targets: [l("visual", heading), c("visual", "classes", cls)] },
      { label: "Glove Size", input: "size", targets: [tpl("sizes")] },
      { label: "No. of sample inspected", input: "number", targets: [f("visual", "inspected", { group: cls })] },
      {
        label: spec.limit,
        input: "computed",
        targets: [l("visual", limitCaption), f("visual", "accept", { group: cls }), f("visual", "reject", { group: cls })],
        ...(spec.limitNotes ? { notes: spec.limitNotes } : {}),
      },
      { label: spec.group, input: "label", targets: [f("visual", "counts", { group: cls })] },
      ...spec.defects.map(
        ([label, code, corrected, notes]): Row => ({
          label,
          ...(corrected ? { corrected } : {}),
          input: "number",
          targets: [f("visual", "counts", { group: cls, key: code })],
          ...(notes ? { notes } : {}),
        }),
      ),
      { label: spec.total, input: "computed", targets: [f("visual", "total", { group: cls })] },
      {
        label: result,
        ...(resultCorrected ? { corrected: resultCorrected } : {}),
        input: "computed",
        targets: [f("visual", "result", { group: cls })],
        ...(resultCorrected ? { notes: "Mislabelled on the report: the app labels the critical line Critical." } : {}),
      },
    ]);
  });
}

type LabellingLevelRows = {
  heading: string;
  /** The level prints a "Glove Size" row (SAFEDON_EG). */
  sizeRow?: boolean;
  limit: string;
  limitNotes: string;
  /** [printed label, check code] */
  checks: readonly (readonly [string, string])[];
  /** [printed, corrected] */
  result: readonly [string, string?];
  nNotes: string;
};

function labellingLevelRows(
  source: SourceId,
  sectionName: string,
  level: "inner" | "carton",
  spec: LabellingLevelRows,
): SourceField[] {
  const [result, resultCorrected] = spec.result;
  return section(source, `${sectionName} > ${spec.heading}`, [
    {
      label: spec.heading,
      input: "heading",
      targets: [l("labeling", level === "inner" ? "innerLevel" : "cartonLevel"), c("labeling", "levels", level)],
    },
    ...(spec.sizeRow ? [{ label: "Glove Size", input: "size", targets: [tpl("sizes")] } satisfies Row] : []),
    {
      label: "No. of sampled boxes inspected",
      input: "number",
      targets: [f("labeling", "inspected", { group: level }), c("labeling", "levels", level)],
      notes: spec.nNotes,
    },
    {
      label: spec.limit,
      input: "computed",
      targets: [l("labeling", "defectLimit"), f("labeling", "accept", { group: level }), f("labeling", "reject", { group: level })],
      notes: spec.limitNotes,
    },
    ...spec.checks.map(
      ([label, code]): Row => ({
        label,
        input: "number",
        targets: [f("labeling", "defects", { group: level, key: code })],
      }),
    ),
    { label: "Total number of defects found", input: "computed", targets: [f("labeling", "total", { group: level })] },
    {
      label: result,
      ...(resultCorrected ? { corrected: resultCorrected } : {}),
      input: "computed",
      targets: [f("labeling", "result", { group: level })],
      ...(resultCorrected ? { notes: "Mislabelled on the report: the carton line reads Inner Box." } : {}),
    },
  ]);
}

/* ------------------------------------------------------------------ *
 * The inventory
 * ------------------------------------------------------------------ */

export const SOURCE_FIELDS: readonly SourceField[] = [
  ...REPORT_STD_EG,
  ...REPORT_SAFEDON_EG,
  ...ONSITE_EG,
  ...ONSITE_SG,
  ...ONSITE_SAFEDON_EG,
];

export function sourceFields(source: SourceId): readonly SourceField[] {
  return SOURCE_FIELDS.filter((field) => field.source === source);
}

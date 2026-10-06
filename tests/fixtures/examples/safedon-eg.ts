// SAFEDON_EG example report (ASTM D6319 style, client-branded), anonymised.
// See docs/FIXTURES.md.
//
// Transcribed page by page from the 4-page SAFEDON_EG example PDF in
// docs/examples/ (git-ignored client data). Every measurement and count is as
// printed, and so are the report's own mistakes; names, codes, lots, cartons
// and dates are placeholders. Sizes XS, S, M and L were ordered.
//
// Precision: the report prints the thickness readings rounded to 2 decimals.
// The 4-decimal thickness averages in the expected results come from the
// source workbook's unrounded readings, which this print does not show.
import type { Spec } from "@/lib/stats";
import { deepFreeze, textCell } from "./helpers";
import type { LabelingEntry, SafedonEgExample, TensileEntry, VisualEntry, WatertightEntry } from "./types";

const LENGTH: Spec = { kind: "min", min: 230 };
const FINGER: Spec = { kind: "tolerance", nominal: 0.18, tolerance: 0.04 };
const PALM: Spec = { kind: "tolerance", nominal: 0.14, tolerance: 0.04 };
const width = (nominal: number): Spec => ({ kind: "tolerance", nominal, tolerance: 4 });
const printedSpec = (widthText: string) =>
  ({ length: "≥ 230", width: widthText, finger: "0.18 ± 0.04", palm: "0.14 ± 0.04" }) as const;
const ACCEPTED = { length: "A", width: "A", finger: "A", palm: "A" } as const;

// Size S, gloves 1 to 3: five cells typed with a space. The spreadsheet stored
// them as text and its AVERAGE skipped them (BUILD_SPEC 6.2 rule 1).
const TYPED_WITH_A_SPACE = "Typed with a space, stored as text and skipped by the report's average.";

const NO_HOLES = {
  hole_crotch: 0,
  hole_palm: 0,
  hole_cuff: 0,
  hole_finger: 0,
  glove_burst: 0,
  hole_other: 0,
} as const;

const noVisualDefects = (
  inspected: number,
  counts: VisualEntry["counts"],
  printedLimit: VisualEntry["printedLimit"],
): VisualEntry => ({ inspected, counts, printedLimit, printedTotal: `0 / ${inspected}`, printedResult: "Passed" });

const tensile = (tensileMPa: number, elongationPct: number): TensileEntry => ({
  tensileMPa,
  elongationPct,
  printedSpec: { tensile: "≥ 14.00", elongation: "≥ 500%" },
  printedResult: { tensile: "Passed", elongation: "Passed" },
});

const CRITICAL_NONE = { embedded_insect: 0, embedded_metal: 0 } as const;
const MAJOR_NONE = {
  thin_crotch_ring: 0,
  thin_crotch_area: 0,
  thin_body_area: 0,
  thin_spot: 0,
  dirt_nonremovable: 0,
  stain: 0,
  powder_mark: 0,
  bead_blister: 0,
} as const;
const MINOR_NONE = { dirt_small: 0, sticky_pleats: 0, lump_small: 0, bead_thin: 0, bead_small_defect: 0 } as const;

const innerLabels = (): LabelingEntry => ({
  inspected: 3,
  defects: { lot_no: 0, mfg_date: 0, expiry_date: 0, artwork: 0 },
  printedLimit: { accept: 0, reject: 1 },
  printedTotal: "0",
  printedResult: "Passed",
});

const cartonLabels = (): LabelingEntry => ({
  inspected: 1,
  defects: { lot_no: 0, mfg_date: 0, expiry_date: 0, artwork: 0, carton_no: 0 },
  printedLimit: { accept: 0, reject: 1 },
  printedTotal: "0",
  printedResult: "Passed",
});

const noHoles = (tested: number, accept: number): WatertightEntry => ({
  tested,
  holes: NO_HOLES,
  printedLimit: { accept, reject: accept + 1 },
  printedTotal: `0 / ${tested}`,
  printedResult: "Passed",
});

export const SAFEDON_EG_EXAMPLE = deepFreeze<SafedonEgExample>({
  template: "SAFEDON_EG",
  standard: "ASTM_D6319",
  productType: "examination",
  unit: "pcs",
  sizesOnReport: ["XS", "S", "M", "L", "XL"],
  sizesOrdered: ["XS", "S", "M", "L"],

  /* ---------------------------------------------------------------- *
   * Page 1
   * ---------------------------------------------------------------- */

  header: {
    manufacturer: "Manufacturer B",
    factoryAddress: "Address B",
    // The PO, then the client's own order reference in brackets.
    po: { printed: "PO-0002 (REF-0002)", poNo: "PO-0002", ref: "REF-0002" },
    productName: "Brand B Nitrile PF Examination Gloves",
    productCode: null,
    clientLogo: "Client A",
    inspectedBy: "Inspector A",
    inspectionDate: {
      iso: "2025-02-19",
      printed: "Wednesday, February 19, 2025",
      format: "dddd, MMMM D, YYYY",
    },
    // Month and two-digit year only: "Feb-25" is February 2025, not 25 February.
    mfgDate: { iso: "2025-02", printed: "Feb-25", format: "MMM-YY" },
    expiryDate: { iso: "2030-01", printed: "Jan-30", format: "MMM-YY" },
  },

  gloveInfo: {
    surfaceTexture: "Finger-textured",
    indicativeWeightG: 3.2,
    indicativeWeightPrinted: "3.2 g",
    colour: "Purple blue",
    length: "240 mm minimum",
  },

  order: {
    // Two packing sites: the manufacturer itself, and a second packer.
    lines: {
      XS: { qtyCases: 60, lots: ["LOT-B01"], packingSite: "Packer C" },
      S: { qtyCases: 850, lots: ["LOT-B02"], packingSite: "Manufacturer B" },
      M: { qtyCases: 560, lots: ["LOT-B03"], packingSite: "Manufacturer B" },
      L: { qtyCases: 60, lots: ["LOT-B04"], packingSite: "Packer C" },
    },
    printedTotalCartons: 1530,
    printedTotalGloves: 3_060_000,
  },

  packing: { innerUnit: "plastic pack", glovesPerInner: 125, innersPerCase: 16, printedGlovesPerCase: 2000 },

  // Below ISO 2859-1 level I (BUILD_SPEC 13): XS and L need 200, S and M need 500.
  sampling: {
    XS: {
      orderQtyCases: 60,
      cases: 5,
      inners: 10,
      gloves: 80,
      watertightVisualGloves: 80,
      dimensionGloves: 13,
      physicalTestGloves: 13,
      dispensingInners: 5,
    },
    S: {
      orderQtyCases: 850,
      cases: 20,
      inners: 25,
      gloves: 200,
      watertightVisualGloves: 200,
      dimensionGloves: 13,
      physicalTestGloves: 13,
      dispensingInners: 8,
    },
    M: {
      orderQtyCases: 560,
      cases: 15,
      inners: 15,
      gloves: 200,
      watertightVisualGloves: 200,
      dimensionGloves: 13,
      physicalTestGloves: 13,
      dispensingInners: 8,
    },
    L: {
      orderQtyCases: 60,
      cases: 5,
      inners: 10,
      gloves: 80,
      watertightVisualGloves: 80,
      dimensionGloves: 13,
      physicalTestGloves: 13,
      dispensingInners: 5,
    },
  },

  cartons: {
    XS: { rows: [[1, 12, 18, 25, 33]], printedSamplingQuantity: 5 },
    S: {
      // 81 breaks the rising run between 365 and 393, as the original number
      // did. It is unique and in range, so the app accepts it.
      rows: [
        [51, 88, 136, 347, 356, 365, 81, 393, 475, 497],
        [503, 520, 539, 597, 671, 771, 786, 790, 810, 814],
      ],
      printedSamplingQuantity: 20,
    },
    M: {
      rows: [
        [92, 118, 122, 173, 174, 222, 269, 318, 340, 378],
        [382, 419, 492, 549, 550],
      ],
      printedSamplingQuantity: 15,
    },
    L: { rows: [[6, 16, 27, 40, 52]], printedSamplingQuantity: 5 },
  },

  /* ---------------------------------------------------------------- *
   * Page 2
   * ---------------------------------------------------------------- */

  dimensions: {
    statistic: "average",
    columns: ["length", "width", "finger", "palm"],
    perSize: {
      XS: {
        gloves: [
          [241, 76, 0.19, 0.11],
          [241, 75, 0.18, 0.12],
          [240, 77, 0.19, 0.12],
          [243, 76, 0.19, 0.12],
          [242, 77, 0.18, 0.12],
          [240, 77, 0.18, 0.12],
          [243, 76, 0.17, 0.13],
          [242, 76, 0.16, 0.13],
          [240, 75, 0.17, 0.11],
          [241, 76, 0.16, 0.12],
          [240, 77, 0.17, 0.12],
          [243, 77, 0.17, 0.12],
          [242, 76, 0.19, 0.13],
        ],
        spec: { length: LENGTH, width: width(76), finger: FINGER, palm: PALM },
        printedSpec: printedSpec("76 ± 4"),
        printedStatistic: { length: "241", width: "76", finger: "0.18", palm: "0.12" },
        printedResult: ACCEPTED,
      },
      S: {
        gloves: [
          [243, 87, textCell("0 .18", 0.18, TYPED_WITH_A_SPACE), textCell("0 .11", 0.11, TYPED_WITH_A_SPACE)],
          [242, 86, textCell("0 .18", 0.18, TYPED_WITH_A_SPACE), textCell("0 .12", 0.12, TYPED_WITH_A_SPACE)],
          [textCell("2 42", 242, TYPED_WITH_A_SPACE), 87, 0.17, 0.11],
          [244, 87, 0.17, 0.12],
          [243, 87, 0.16, 0.12],
          [242, 86, 0.17, 0.13],
          [241, 88, 0.17, 0.13],
          [243, 87, 0.17, 0.12],
          [245, 87, 0.19, 0.12],
          [244, 86, 0.19, 0.12],
          [246, 86, 0.18, 0.13],
          [244, 87, 0.17, 0.12],
          [245, 86, 0.18, 0.12],
        ],
        spec: { length: LENGTH, width: width(86), finger: FINGER, palm: PALM },
        printedSpec: printedSpec("86 ± 4"),
        // The report averaged the numeric cells only: 243.5, 86.69, 0.1748 and
        // 0.1197 by the expected results.
        printedStatistic: { length: "244", width: "87", finger: "0.17", palm: "0.12" },
        printedResult: ACCEPTED,
      },
      M: {
        gloves: [
          [242, 97, 0.18, 0.11],
          [243, 97, 0.18, 0.11],
          [241, 98, 0.18, 0.11],
          [245, 97, 0.18, 0.11],
          [241, 97, 0.17, 0.11],
          [242, 98, 0.16, 0.11],
          [243, 97, 0.16, 0.11],
          [242, 98, 0.18, 0.11],
          [244, 97, 0.17, 0.11],
          [241, 97, 0.17, 0.11],
          [241, 97, 0.18, 0.11],
          [246, 98, 0.18, 0.11],
          [242, 97, 0.17, 0.11],
        ],
        spec: { length: LENGTH, width: width(98), finger: FINGER, palm: PALM },
        printedSpec: printedSpec("98 ± 4"),
        printedStatistic: { length: "243", width: "97", finger: "0.17", palm: "0.11" },
        printedResult: ACCEPTED,
      },
      L: {
        gloves: [
          [242, 108, 0.17, 0.12],
          [244, 107, 0.17, 0.12],
          [245, 106, 0.17, 0.12],
          [243, 107, 0.16, 0.12],
          [241, 106, 0.19, 0.12],
          [245, 107, 0.19, 0.12],
          [242, 106, 0.18, 0.12],
          [243, 107, 0.18, 0.12],
          [242, 107, 0.18, 0.12],
          [241, 106, 0.17, 0.12],
          [241, 107, 0.17, 0.12],
          [242, 106, 0.17, 0.12],
          [243, 106, 0.17, 0.12],
        ],
        spec: { length: LENGTH, width: width(107), finger: FINGER, palm: PALM },
        printedSpec: printedSpec("107 ± 4"),
        printedStatistic: { length: "243", width: "107", finger: "0.17", palm: "0.12" },
        printedResult: ACCEPTED,
      },
    },
  },

  // "Weight (g)": one merged cell per size in the dimension table.
  weight: {
    XS: { gloves: 1, values: [2.56], averageG: 2.56, printed: "2.56", printedSpec: "NA", printedResult: "A" },
    S: { gloves: 1, values: [2.94], averageG: 2.94, printed: "2.94", printedSpec: "NA", printedResult: "A" },
    M: { gloves: 1, values: [3.18], averageG: 3.18, printed: "3.18", printedSpec: "NA", printedResult: "A" },
    L: { gloves: 1, values: [3.55], averageG: 3.55, printed: "3.55", printedSpec: "NA", printedResult: "A" },
  },

  // "Physical Properties average (Refer to attached lab. reports)".
  tensile: {
    XS: tensile(34.18, 536),
    S: tensile(32.99, 547),
    M: tensile(34.03, 555),
    L: tensile(33.17, 543),
  },

  /* ---------------------------------------------------------------- *
   * Page 3 (the report prints the L block before M)
   * ---------------------------------------------------------------- */

  dispensingSafedon: {
    printedTitle: "Glove Dispensing Inspection (Sampling code letter C & D)",
    glovesPerPack: 125,
    maxRatePct: 5,
    rows: [
      { code: "no_cuff", label: "No cuff", definition: "Cuff should ideallly be at least 2 cm out" },
      { code: "finger_out", label: "Finger out", definition: "Only cuff but no finger should be out first" },
      { code: "multiple_out", label: "Multiple gloves out", definition: "Only one glove should be out at one time" },
      { code: "stuck", label: "Glove stuck", definition: "Glove ould not be dispensed or very difficult to dispense" },
      {
        code: "sticky",
        label: "Sticky glove",
        definition: "Two or more gloves out at the same time caused by gloves sticking together",
      },
      {
        code: "faulty_cuff",
        label: "Faulty cuff",
        definition: "Deformed or out of shaped cuff which causes dispensing problem",
      },
    ],
    perSize: {
      XS: {
        boxes: [1, 12, 18, 25, 33],
        counts: {
          no_cuff: [0, 0, 0, 0, 2],
          finger_out: [0, 0, 0, 0, 0],
          multiple_out: [0, 0, 0, 0, 0],
          stuck: [0, 0, 0, 0, 0],
          sticky: [1, 0, 0, 0, 0],
          faulty_cuff: [0, 0, 0, 0, 0],
        },
        printedPerBox: ["1/125", "0/125", "0/125", "0/125", "2/125"],
        // Wrong: box 18 had no defect but shows 0.8%; box 33 had 2 (1.6%) but shows 0.0%.
        printedRatePerBox: ["0.8%", "0.0%", "0.8%", "0.0%", "0.0%"],
        printedSizeTotal: "3 / 625 (0.48 %)",
        printedSpec: "≤ 5%",
        printedConclusion: "Passed",
      },
      S: {
        boxes: [51, 136, 365, 475, 539, 771, 790, 814],
        counts: {
          no_cuff: [0, 0, 0, 0, 0, 0, 0, 0],
          finger_out: [0, 0, 0, 0, 0, 0, 0, 0],
          multiple_out: [0, 0, 0, 0, 0, 0, 0, 0],
          stuck: [0, 0, 0, 0, 0, 0, 0, 0],
          sticky: [0, 0, 0, 0, 0, 0, 0, 0],
          faulty_cuff: [0, 0, 0, 0, 0, 0, 0, 0],
        },
        printedPerBox: ["0/125", "0/125", "0/125", "0/125", "0/125", "0/125", "0/125", "0/125"],
        printedRatePerBox: ["0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%"],
        printedSizeTotal: "0 / 1000 (0%)",
        printedSpec: "≤ 5%",
        printedConclusion: "Passed",
      },
      M: {
        boxes: [92, 122, 174, 269, 382, 492, 549, 550],
        counts: {
          no_cuff: [0, 0, 0, 0, 0, 0, 0, 0],
          finger_out: [0, 0, 0, 0, 0, 0, 0, 0],
          multiple_out: [0, 0, 0, 0, 0, 0, 0, 0],
          stuck: [0, 0, 0, 0, 0, 0, 0, 0],
          sticky: [0, 0, 2, 0, 1, 3, 2, 3],
          faulty_cuff: [0, 0, 0, 0, 0, 0, 0, 0],
        },
        printedPerBox: ["0/125", "0/125", "2/125", "0/125", "1/125", "3/125", "2/125", "3/125"],
        printedRatePerBox: ["0.0%", "0.0%", "1.6%", "0.0%", "0.8%", "2.4%", "1.6%", "2.4%"],
        printedSizeTotal: "11 / 1000 (1.1%)",
        printedSpec: "≤ 5%",
        printedConclusion: "Passed",
      },
      L: {
        boxes: [6, 16, 27, 40, 52],
        counts: {
          no_cuff: [0, 0, 0, 0, 0],
          finger_out: [0, 0, 0, 0, 0],
          multiple_out: [0, 0, 0, 0, 0],
          stuck: [0, 0, 0, 0, 0],
          sticky: [0, 0, 0, 0, 0],
          faulty_cuff: [0, 0, 0, 0, 0],
        },
        printedPerBox: ["0/125", "0/125", "0/125", "0/125", "0/125"],
        printedRatePerBox: ["0.0%", "0.0%", "0.0%", "0.0%", "0.0%"],
        // Wrong: no defects were counted for L.
        printedSizeTotal: "7 / 625 (1.12%)",
        printedSpec: "≤ 5%",
        printedConclusion: "Passed",
      },
    },
  },

  /* ---------------------------------------------------------------- *
   * Page 4
   * ---------------------------------------------------------------- */

  watertight: {
    printedTitle: "Freedom from Holes by watertight test (Sampling code letter J & L; AQL=1.5)",
    aql: 1.5,
    rows: [
      { code: "hole_crotch", label: "Between fingers" },
      { code: "hole_palm", label: "Palm" },
      { code: "hole_cuff", label: "Cuff" },
      { code: "hole_finger", label: "Finger" },
      { code: "glove_burst", label: "Glove burst" },
      { code: "hole_other", label: "Other :" },
    ],
    perSize: {
      XS: {
        tested: 80,
        holes: { ...NO_HOLES, hole_finger: 1 },
        printedLimit: { accept: 3, reject: 4 },
        // A count shown as a date, 1 January 1980: most likely "1/80" typed
        // into the total cell and stored as a date (BUILD_SPEC 6.2 rule 3).
        printedTotal: "Jan-80",
        printedResult: "Passed",
      },
      S: noHoles(200, 7),
      M: noHoles(200, 7),
      L: {
        tested: 80,
        holes: { ...NO_HOLES, glove_burst: 1 },
        printedLimit: { accept: 3, reject: 4 },
        printedTotal: "1 / 80",
        printedResult: "Passed",
      },
    },
  },

  visual: {
    printedTitle: "Visual Inspection (Sampling code letter J & L)",
    critical: {
      printedTitle: "Critical Defects (AQL 0.0)",
      aql: 0,
      rows: [
        { code: "embedded_insect", label: "Embeded Insects" },
        { code: "embedded_metal", label: "Embeded metal debris" },
      ],
      // [sic]: the critical result line is labelled "Visual Minor".
      printedResultLabel: "Disposition - Visual Minor (Passed / Failed)",
      perSize: {
        XS: noVisualDefects(80, CRITICAL_NONE, { accept: 0, reject: 1 }),
        S: noVisualDefects(200, CRITICAL_NONE, { accept: 0, reject: 1 }),
        M: noVisualDefects(200, CRITICAL_NONE, { accept: 0, reject: 1 }),
        L: noVisualDefects(80, CRITICAL_NONE, { accept: 0, reject: 1 }),
      },
    },
    major: {
      printedTitle: "Major Defects (AQL 2.5)",
      aql: 2.5,
      rows: [
        { code: "thin_crotch_ring", label: "Thin ring between fingers (crotch)" },
        { code: "thin_crotch_area", label: "Thin area between fingers (crotch)" },
        { code: "thin_body_area", label: "Thin batch / area (body)" },
        { code: "thin_spot", label: "Thin spot" },
        { code: "dirt_nonremovable", label: "Non-removable dirt" },
        { code: "stain", label: "Stain" },
        { code: "powder_mark", label: "Powder mark" },
        { code: "bead_blister", label: "Bead blister" },
      ],
      printedResultLabel: "Disposition - Visual Major (Passed / Failed)",
      perSize: {
        XS: noVisualDefects(80, MAJOR_NONE, { accept: 5, reject: 6 }),
        S: noVisualDefects(200, MAJOR_NONE, { accept: 10, reject: 11 }),
        M: noVisualDefects(200, MAJOR_NONE, { accept: 10, reject: 11 }),
        L: noVisualDefects(80, MAJOR_NONE, { accept: 5, reject: 6 }),
      },
    },
    minor: {
      printedTitle: "Minor Defects (AQL 4.0)",
      aql: 4,
      rows: [
        { code: "dirt_small", label: "Small dirt / stain" },
        { code: "sticky_pleats", label: "Sticky pleats (< 5mm)" },
        { code: "lump_small", label: "Lumps (<2mm)" },
        { code: "bead_thin", label: "Thin bead" },
        { code: "bead_small_defect", label: "Thin bead / small beading defect" },
      ],
      printedResultLabel: "Disposition - Visual Minor (Passed / Failed)",
      perSize: {
        XS: noVisualDefects(80, MINOR_NONE, { accept: 7, reject: 8 }),
        S: noVisualDefects(200, MINOR_NONE, { accept: 14, reject: 15 }),
        M: noVisualDefects(200, MINOR_NONE, { accept: 14, reject: 15 }),
        L: noVisualDefects(80, MINOR_NONE, { accept: 7, reject: 8 }),
      },
    },
  },

  labeling: {
    inner: {
      printedTitle: "Inner Boxes/Packs",
      rows: [
        { code: "lot_no", label: "Wrong / No lot number" },
        { code: "mfg_date", label: "Wrong / No mfg. date" },
        { code: "expiry_date", label: "Wrong / No expiry date" },
        { code: "artwork", label: "Wrong artwork print" },
      ],
      printedResultLabel: "Disposition - Inner Box (Passed / Failed)",
      perSize: { XS: innerLabels(), S: innerLabels(), M: innerLabels(), L: innerLabels() },
    },
    carton: {
      printedTitle: "Carton Boxes",
      rows: [
        { code: "lot_no", label: "Wrong / No lot number" },
        { code: "mfg_date", label: "Wrong / No mfg. date" },
        { code: "expiry_date", label: "Wrong / No expiry date" },
        { code: "artwork", label: "Wrong artwork print" },
        { code: "carton_no", label: "No carton number" },
      ],
      printedResultLabel: "Disposition - Carton Box (Passed / Failed)",
      perSize: { XS: cartonLabels(), S: cartonLabels(), M: cartonLabels(), L: cartonLabels() },
    },
  },

  conclusion: {
    printedResult: "PASSED",
    remark: null,
    inspectedBy: "Inspector A",
    date: { iso: "2025-02-19", printed: "2/19/2025", format: "M/D/YYYY" },
    signed: true,
  },

  // XL was not ordered and its columns are blank everywhere.
  unorderedSizes: [],
});

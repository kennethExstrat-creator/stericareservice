// STD_EG example report (EN 455 style), anonymised. See docs/FIXTURES.md.
//
// Transcribed page by page from the 4-page STD_EG example PDF in
// docs/examples/ (git-ignored client data). Every measurement and count is as
// printed, and so are the report's own mistakes; names, codes, lots, cartons
// and dates are placeholders. Only size M was ordered.
import type { Spec } from "@/lib/stats";
import { deepFreeze } from "./helpers";
import type { StdEgExample, UnorderedSizeCells } from "./types";

const NA: Spec = { kind: "na" };
const PASSED_X3 = ["Passed", "Passed", "Passed"] as const;
const PASSED_X5 = ["Passed", "Passed", "Passed", "Passed", "Passed"] as const;

function unordered(
  section: UnorderedSizeCells["section"],
  sizes: readonly UnorderedSizeCells["size"][],
  cells: UnorderedSizeCells["cells"],
): UnorderedSizeCells[] {
  return sizes.map((size) => ({ section, size, cells }));
}

export const STD_EG_EXAMPLE = deepFreeze<StdEgExample>({
  template: "STD_EG",
  standard: "EN455",
  productType: "examination",
  unit: "pcs",
  sizesOnReport: ["XS", "S", "M", "L", "XL"],
  sizesOrdered: ["M"],

  /* ---------------------------------------------------------------- *
   * Page 1
   * ---------------------------------------------------------------- */

  header: {
    manufacturer: "Manufacturer A",
    factory: "Factory A1",
    factoryAddress: "Address A",
    po: { printed: "PO-0001 (SO-0001)", poNo: "PO-0001", ref: "SO-0001" },
    // Printed on two lines: brand, code and colour, then the colour name again.
    productName: "Brand A PC-A01 Blue Nitrile",
    productCode: "PC-A01",
    // The source file's name carries a code one character off the report's.
    productCodeElsewhere: { where: "source file name", code: "PC-A02" },
    client: null,
    factoryGloveCode: null,
    // No inspector field anywhere on this format (expected results: "missing").
    inspectionDate: { iso: "2025-04-11", printed: "Friday, April 11, 2025", format: "dddd, MMMM D, YYYY" },
    // Month first, while the conclusion date is day first: 4/1 is 1 April.
    mfgDate: { iso: "2025-04-01", printed: "4/1/2025", format: "M/D/YYYY" },
    expiryDate: { iso: "2030-03-01", printed: "3/1/2030", format: "M/D/YYYY" },
  },

  gloveInfo: {
    surfaceTexture: "Finger-textured",
    indicativeWeightG: 3.5,
    indicativeWeightPrinted: "3.5g",
    // Printed as a shade name that repeats the product name: kept as the plain colour.
    colour: "Blue",
    length: "240 mm minimum",
  },

  order: {
    lines: { M: { qtyCases: 2900, lots: ["LOT-A01"] } },
    printedTotalCartons: 2900,
    printedTotalGloves: 5_800_000,
  },

  packing: { innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, printedGlovesPerCase: 2000 },

  sampling: {
    M: {
      orderQtyCases: 2900,
      cases: 50,
      inners: 50,
      gloves: 500,
      watertightVisualGloves: 500,
      dimensionGloves: 13,
      physicalTestGloves: 13,
      dispensingInners: 13,
    },
  },

  cartons: {
    M: {
      // 525 is entered twice (row 2 column 10, row 3 column 1): 50 entries,
      // 49 unique. The app must reject the duplicate (BUILD_SPEC 6.2 rule 6).
      rows: [
        [2834, 686, 299, 848, 1515, 174, 1880, 1324, 1541, 337],
        [416, 809, 313, 1930, 1908, 523, 1457, 2597, 1039, 525],
        [525, 1230, 1159, 382, 1780, 199, 1913, 1514, 1438, 2702],
        [2099, 1726, 1614, 2352, 2549, 1601, 1863, 13, 1208, 2819],
        [2236, 2675, 2405, 2714, 1297, 221, 595, 1899, 112, 2854],
      ],
      printedSamplingQuantity: 50,
    },
  },

  /* ---------------------------------------------------------------- *
   * Page 2
   * ---------------------------------------------------------------- */

  dimensions: {
    statistic: "median",
    columns: ["length", "width", "finger", "palm", "cuff"],
    perSize: {
      M: {
        gloves: [
          [245, 95, 0.08, 0.05, 0.04],
          [245, 94, 0.1, 0.05, 0.04],
          [248, 95, 0.09, 0.06, 0.04],
          [245, 95, 0.09, 0.05, 0.04],
          [248, 96, 0.1, 0.06, 0.04],
          [246, 96, 0.09, 0.05, 0.04],
          [245, 95, 0.09, 0.05, 0.04],
          [244, 96, 0.1, 0.05, 0.04],
          [245, 95, 0.09, 0.05, 0.04],
          [245, 96, 0.09, 0.05, 0.04],
          [245, 96, 0.1, 0.05, 0.04],
          [246, 96, 0.09, 0.05, 0.04],
          [245, 95, 0.1, 0.05, 0.04],
        ],
        spec: {
          length: { kind: "min", min: 240 },
          width: { kind: "tolerance", nominal: 95, tolerance: 10 },
          finger: NA,
          palm: NA,
          cuff: NA,
        },
        printedSpec: { length: "≥ 240", width: "95 ± 10", finger: "NA", palm: "NA", cuff: "NA" },
        printedStatistic: { length: "245", width: "95", finger: "0.09", palm: "0.05", cuff: "0.04" },
        // "Passed" is printed under the NA thickness columns too.
        printedResult: { length: "Passed", width: "Passed", finger: "Passed", palm: "Passed", cuff: "Passed" },
      },
    },
  },

  forceAtBreak: {
    // Only the median is printed; the readings are in the attached lab report.
    M: { readingsN: null, medianN: 6.537, printedMedian: "6.537", printedSpec: "≥ 6 N", printedResult: "Passed" },
  },

  weight: {
    // "Weight (g) - average of 13 gloves per size": only the average is printed.
    // 2.9 g is 17% below the indicative 3.5 g, but the remark says "Info".
    M: { gloves: 13, values: null, averageG: 2.9, printed: "2.90", printedRemark: "Info" },
  },

  /* ---------------------------------------------------------------- *
   * Page 3
   * ---------------------------------------------------------------- */

  watertight: {
    // n 500 is code letter N, not K, L or M.
    printedTitle: "Freedom from Holes by watertight test (Single sampling code letter k, L & M, AQL 1.5)",
    aql: 1.5,
    rows: [
      { code: "hole_crotch", label: "Between fingers (crotch)" },
      { code: "hole_palm", label: "Palm" },
      { code: "hole_finger", label: "Finger" },
      { code: "hole_cuff", label: "Cuff" },
      { code: "hole_other", label: "Other :" },
    ],
    perSize: {
      M: {
        tested: 500,
        holes: { hole_crotch: 0, hole_palm: 0, hole_finger: 1, hole_cuff: 0, hole_other: 0 },
        // The code M limit; n 500 (code N) gives 14 / 15.
        printedLimit: { accept: 10, reject: 11 },
        printedTotal: "1/500",
        printedResult: "Passed",
      },
    },
  },

  visual: {
    printedTitle: "Visual Inspection (Single Sampling code letter K, L & M)",
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
        M: {
          inspected: 500,
          counts: { embedded_insect: 0, embedded_metal: 0 },
          printedLimit: { accept: 0, reject: 1 },
          printedTotal: "0",
          printedResult: "Passed",
        },
      },
    },
    major: {
      printedTitle: "Major Defects (AQL 2.5)",
      aql: 2.5,
      rows: [
        { code: "thin_crotch_area", label: "Thin area between fingers (crotch)" },
        { code: "thin_crotch_ring", label: "Ring-shaped thin area (crotch)" },
        { code: "thin_body_area", label: "Thin area on glove body" },
        { code: "thin_spot", label: "Thin spot on glove body" },
        { code: "dirt_nonremovable", label: "Non-removable dirt" },
        { code: "stain", label: "Oil stain" },
        { code: "foreign_matter", label: "Residue material / foreign matter" },
        { code: "bead_defective", label: "Defective bead" },
        { code: "lump_big", label: "Big Lumps (>2mm)" },
      ],
      printedResultLabel: "Disposition - Visual Major (Passed / Failed)",
      perSize: {
        M: {
          inspected: 500,
          counts: {
            thin_crotch_area: 2,
            thin_crotch_ring: 0,
            thin_body_area: 1,
            thin_spot: 5,
            dirt_nonremovable: 0,
            stain: 0,
            foreign_matter: 0,
            bead_defective: 0,
            lump_big: 0,
          },
          // The code M limit; code N at AQL 2.5 gives 21 / 22.
          printedLimit: { accept: 14, reject: 15 },
          printedTotal: "8/500",
          printedResult: "Passed",
        },
      },
    },
    minor: {
      printedTitle: "Minor Defects (AQL 4.0)",
      aql: 4,
      rows: [
        { code: "dirt_small", label: "Small dirt / stain" },
        { code: "sticky_pleats", label: "Sticky pleats (< 5mm)" },
        { code: "lump_small", label: "Lumps (<2mm)" },
        { code: "bead_poor", label: "Poor beading" },
        { code: "bead_rolled", label: "Rolled bead" },
        { code: "bead_defective", label: "Defective beads" },
      ],
      printedResultLabel: "Disposition - Visual Minor (Passed / Failed)",
      perSize: {
        M: {
          inspected: 500,
          counts: { dirt_small: 0, sticky_pleats: 0, lump_small: 0, bead_poor: 0, bead_rolled: 0, bead_defective: 0 },
          // Right by coincidence: code N at AQL 4.0 follows the arrow up to code M.
          printedLimit: { accept: 21, reject: 22 },
          printedTotal: "0/500",
          printedResult: "Passed",
        },
      },
    },
  },

  /* ---------------------------------------------------------------- *
   * Page 4
   * ---------------------------------------------------------------- */

  dispensingPacking: {
    printedTitle: "Glove Packing Check (Sampling code letter D & E) : min. 70% layering & 80% dispensing",
    minLayeringPct: 70,
    minDispensingPct: 80,
    perSize: {
      M: {
        boxes: [
          { box: 13, layeringPct: 90, dispensingPct: 92, stickiness: "A" },
          { box: 299, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 337, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 686, layeringPct: 90, dispensingPct: 92, stickiness: "A" },
          { box: 1039, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 1324, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 1541, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 1614, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 1863, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 1880, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 1913, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          // Not in the carton list: the report accepted it. Likely carton 2236
          // (one digit off), which is listed (BUILD_SPEC 6.2 rule 7).
          { box: 2336, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
          { box: 2819, layeringPct: 88, dispensingPct: 90, stickiness: "A" },
        ],
        printedAverage: { layering: "88%", dispensing: "90%", stickiness: "A" },
        printedResult: { layering: "Passed", dispensing: "Passed", stickiness: "Passed" },
      },
    },
  },

  labeling: {
    inner: {
      printedTitle: "Dispenser Box",
      rows: [
        { code: "lot_no", label: "Wrong / No lot number" },
        { code: "mfg_date", label: "Wrong / No mfg. date" },
        { code: "artwork", label: "Wrong artwork print" },
      ],
      printedResultLabel: "Disposition - Inner Box (Passed / Failed)",
      perSize: {
        M: {
          inspected: 3,
          defects: { lot_no: 0, mfg_date: 0, artwork: 0 },
          printedLimit: { accept: 0, reject: 1 },
          printedTotal: "0",
          printedResult: "Passed",
        },
      },
    },
    carton: {
      printedTitle: "Carton Box",
      rows: [
        { code: "lot_no", label: "Wrong / No lot number" },
        { code: "mfg_date", label: "Wrong / No mfg. date" },
        { code: "artwork", label: "Wrong artwork print" },
        { code: "carton_no", label: "No carton number printed" },
      ],
      // [sic]: the carton result line is labelled "Inner Box".
      printedResultLabel: "Disposition - Inner Box (Passed / Failed)",
      perSize: {
        M: {
          inspected: 1,
          defects: { lot_no: 0, mfg_date: 0, artwork: 0, carton_no: 0 },
          printedLimit: { accept: 0, reject: 1 },
          printedTotal: "0",
          printedResult: "Passed",
        },
      },
    },
  },

  conclusion: {
    printedResult: "PASSED",
    remark: null,
    // Day first, unlike the header dates.
    date: { iso: "2025-04-12", printed: "12/04/2025", format: "DD/MM/YYYY" },
    signed: true,
  },

  // Sizes XS, S, L and XL were not ordered and have no data, yet the report
  // prints spreadsheet errors, pre-filled limits and "Passed" for them. The XS
  // columns are blank apart from the dimension spec.
  unorderedSizes: [
    ...unordered("dimensions", ["XS"], { "Spec.": ["≥ 240", "≤ 80", "NA", "NA", "NA"] }),
    ...unordered("dimensions", ["S"], {
      Median: ["#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!"],
      "Spec.": ["≥ 240", "80 ± 10", "NA", "NA", "NA"],
      "P/F": PASSED_X5,
    }),
    ...unordered("dimensions", ["L"], {
      Median: ["#DIV/0!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!"],
      "Spec.": ["≥ 240", "110 ± 10", "NA", "NA", "NA"],
      "P/F": PASSED_X5,
    }),
    ...unordered("dimensions", ["XL"], {
      Median: ["#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!", "#VALUE!"],
      "Spec.": ["≥ 240", "≥ 110", "NA", "NA", "NA"],
      "P/F": PASSED_X5,
    }),
    ...unordered("forceAtBreak", ["S", "L", "XL"], { "Spec.": "≥ 6 N", "Passed / Failed": "Passed" }),
    ...unordered("weight", ["S", "L", "XL"], { Remark: "Info" }),
    ...unordered("watertight", ["S", "L"], { "Defect Limit": ["7", "8"] }),
    ...unordered("watertight", ["XL"], { "Defect Limit": ["5", "6"] }),
    ...unordered("visual.critical", ["S", "L", "XL"], { "Defect Limit": ["Acc. = 0", "Rej. = 1"] }),
    ...unordered("visual.major", ["S", "L"], { "Defect Limit": ["10", "11"] }),
    ...unordered("visual.major", ["XL"], { "Defect Limit": ["7", "8"] }),
    ...unordered("visual.minor", ["S", "L"], { "Defect Limit": ["14", "15"] }),
    ...unordered("visual.minor", ["XL"], { "Defect Limit": ["10", "11"] }),
    ...unordered("dispensingPacking", ["S", "XL"], {
      Average: ["#DIV/0!", "#DIV/0!", ""],
      "Passed / Failed": PASSED_X3,
    }),
    ...unordered("dispensingPacking", ["L"], {
      Average: ["#DIV/0!", "#DIV/0!", "A"],
      "Passed / Failed": PASSED_X3,
    }),
    ...unordered("labeling.inner", ["S", "L", "XL"], {
      "No. of sampled boxes inspected": "3",
      "Defect Limit": ["0", "1"],
      "Wrong / No lot number": "0",
      "Wrong / No mfg. date": "0",
      "Wrong artwork print": "0",
      "Total number of defects found": "0",
      "Disposition - Inner Box (Passed / Failed)": "Passed",
    }),
    ...unordered("labeling.carton", ["S", "L", "XL"], {
      "No. of sampled boxes inspected": "1",
      "Defect Limit": ["0", "1"],
      "Wrong / No lot number": "0",
      "Wrong / No mfg. date": "0",
      "Wrong artwork print": "0",
      "No carton number printed": "0",
      "Total number of defects found": "0",
      "Disposition - Inner Box (Passed / Failed)": "Passed",
    }),
  ],
});

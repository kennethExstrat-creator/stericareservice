import type { InspectionExport } from "@/lib/schemas";

/* ------------------------------------------------------------------ *
 * STD_EG example as a submitted export (docs/examples/expected-results.md, B)
 *
 * Measurements are kept from the example report: size M dimensions per
 * glove, watertight and visual counts, dispensing percentages and the
 * medians and averages. Per BUILD_SPEC rule 7 every client, manufacturer,
 * PO, lot and carton identifier is a placeholder, and the carton list is
 * synthetic. The example gives only the force-at-break median and the
 * weight average, so those 13 readings are synthetic too, chosen to
 * reproduce 6.537 N and 2.90 g.
 *
 * State: submitted after the carton errors were fixed, with the weight
 * warning (2.9 g vs 3.5 g indicative, 17% below) still in the export.
 * ------------------------------------------------------------------ */

export const FIXTURE_IDS = {
  inspector: "00000000-0000-4000-8000-000000000101",
  manufacturer: "00000000-0000-4000-8000-000000000201",
  photoThinSpot: "00000000-0000-4000-8000-000000000301",
  photoPinHole: "00000000-0000-4000-8000-000000000302",
  photoScale: "00000000-0000-4000-8000-000000000303",
  photoCartonLabel: "00000000-0000-4000-8000-000000000304",
  photoDispenserHeic: "00000000-0000-4000-8000-000000000305",
  fileLabReport: "00000000-0000-4000-8000-000000000401",
} as const;

/** Synthetic carton numbers between 1 and the 2,900 cases ordered. */
export const FIXTURE_CARTONS_M = [
  32, 609, 1186, 1763, 2340, 17, 594, 1171, 1748, 2325, 2, 579, 1156, 1733, 2310, 2887, 564, 1141, 1718,
  2295, 2872, 549, 1126, 1703, 2280, 2857, 534, 1111, 1688, 2265, 2842, 519, 1096, 1673, 2250, 2827, 504,
  1081, 1658, 2235, 2812, 489, 1066, 1643, 2220, 2797, 474, 1051, 1628, 2205,
] as const;

const DISPENSING_BOXES_M = [32, 594, 1156, 1733, 2310, 564, 1141, 2295, 549, 1703, 2857, 1096, 2205] as const;

const DIMENSIONS_M = [
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
] as const;

const photoUrl = (id: string, extension = "jpg") =>
  `https://storage.example.com/inspection-photos/${id}.${extension}?token=placeholder`;

/** A fresh copy on every call, so tests can change it freely. */
export function makeStdEgExport(): InspectionExport {
  return {
    schemaVersion: "1",
    refNo: "INS-2024-0001",
    status: "submitted",
    timestamps: {
      createdAt: "2024-07-12T00:45:00.000Z",
      updatedAt: "2024-07-13T09:12:00.000Z",
      submittedAt: "2024-07-13T09:12:00.000Z",
      approvedAt: null,
      exportedAt: "2024-07-13T09:15:00.000Z",
    },
    inspector: { id: FIXTURE_IDS.inspector, name: "Inspector A", email: "inspector@test.local" },
    template: {
      code: "STD_EG",
      version: 1,
      standard: "EN455",
      productType: "examination",
      client: null,
      manufacturer: { id: FIXTURE_IDS.manufacturer, name: "Manufacturer A" },
      reportTitle: "Preshipment Inspection: Nitrile Disposable Examination Gloves",
      clientLogoUrl: null,
      sourceFile: null,
    },
    modules: [
      {
        key: "header",
        title: "Manufacturer Information",
        labels: {
          manufacturer: "Manufacturer / Supplier",
          factoryAddress: "Supplier Factory Address / Location",
          poNo: "PO / SO Number",
          productName: "Product Name (Brand, code & description)",
          client: "Client Name",
          factoryGloveCode: "Factory glove code",
        },
        data: {
          manufacturer: "Manufacturer A (Factory 1)",
          factoryAddress: "Placeholder address, Industrial Area, Country A",
          poNo: "PO-0001 (SO-0001)",
          productName: "Brand X Nitrile Examination Glove, blue",
          client: null,
          factoryGloveCode: null,
          inspectionDate: "2024-07-12",
          mfgDate: "2024-07-01",
          expiryDate: "2029-06-01",
          reportDate: "2024-07-13",
        },
        computed: {},
        result: { status: "info", summary: "Expiry date 2029-06-01 is after the manufacturing date 2024-07-01." },
        warnings: [],
        comment: null,
      },
      {
        key: "glove_info",
        title: "Glove Information",
        labels: { indicativeWeight: "Indicative weight (size M)" },
        data: {
          surfaceTexture: "Finger-textured",
          indicativeWeight: 3.5,
          colour: "Blue",
          length: "240 mm minimum",
        },
        computed: {},
        result: { status: "info", summary: "Indicative weight 3.5 g (size M)." },
        warnings: [],
        comment: null,
      },
      {
        key: "order_lots",
        title: "Order",
        labels: { qtyCases: "Qty (cases)", lotNumbers: "Lot Number" },
        data: { lots: [{ size: "M", qtyCases: 2900, lotNumbers: ["LOT-M-0001"] }] },
        computed: { totalCartons: 2900, totalGloves: 5_800_000 },
        result: { status: "info", summary: "2,900 cartons, 5,800,000 gloves, size M only." },
        warnings: [],
        comment: null,
      },
      {
        key: "packing_config",
        title: "Packing configuration",
        labels: { glovesPerInner: "# glove per inner box", innersPerCase: "# inners per case" },
        data: { innerUnit: "inner box", glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2000 },
        computed: { glovesPerCaseCheck: 2000 },
        result: { status: "info", summary: "200 gloves x 10 inner boxes = 2,000 gloves per case." },
        warnings: [],
        comment: null,
      },
      {
        key: "sampling_plan",
        title: "Sampling Plan",
        labels: { packagingDispensing: "# inner box for packaging & dispensing inspection" },
        data: {
          sizes: {
            M: {
              cases: 50,
              innerUnits: 50,
              gloves: 500,
              watertightVisual: 500,
              dimensions: 13,
              physical: 13,
              packagingDispensing: 13,
            },
          },
        },
        computed: { M: { inspectionLevel: "I", lotSizeGloves: 5_800_000, codeLetter: "N", planSampleSize: 500 } },
        result: {
          status: "pass",
          summary: "Samples meet ISO 2859-1 level I (code N, n 500).",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "carton_sampling",
        title: "Finished Goods Sampling Information (carton number)",
        labels: {},
        data: { sizes: { M: [...FIXTURE_CARTONS_M] } },
        computed: { M: { count: 50, unique: 50, sampledCases: 50, orderQty: 2900 } },
        result: {
          status: "pass",
          summary: "50 unique carton numbers between 1 and 2,900.",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "dimensions",
        title: "Dimension",
        labels: {
          length: "Length",
          width: "Width",
          finger: "Finger Thickness",
          palm: "Palm Thickness",
          cuff: "Cuff Thickness",
        },
        data: {
          sizes: {
            M: DIMENSIONS_M.map(([length, width, finger, palm, cuff]) => ({ length, width, finger, palm, cuff })),
          },
        },
        computed: {
          statistic: "median",
          M: {
            median: { length: 245, width: 95, finger: 0.09, palm: 0.05, cuff: 0.04 },
            spec: { length: { min: 240 }, width: { nominal: 95, tolerance: 10 }, finger: null, palm: null, cuff: null },
          },
        },
        result: {
          status: "pass",
          summary: "Size M medians within spec: length 245 mm (>= 240), width 95 mm (95 +/- 10).",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "force_at_break",
        title: "Force At Break in Newton (Refer to attached where applicable)",
        labels: { median: "Median", spec: "Spec." },
        data: {
          sizes: {
            M: {
              forces: [6.47, 6.884, 6.301, 6.537, 6.65, 6.214, 6.79, 6.512, 6.611, 6.42, 6.702, 6.388, 6.58],
              labReportFileId: FIXTURE_IDS.fileLabReport,
            },
          },
        },
        computed: { M: { median: 6.537, specMin: 6 } },
        result: {
          status: "pass",
          summary: "Size M median 6.537 N (>= 6 N).",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "weight",
        title: "Weight (g) - average of 13 gloves per size",
        labels: { average: "Average", remark: "Remark" },
        data: {
          sizes: {
            M: { values: [2.86, 2.91, 2.88, 2.93, 2.9, 2.87, 2.92, 2.89, 2.94, 2.88, 2.91, 2.9, 2.91] },
          },
        },
        computed: { M: { average: 2.9, indicative: 3.5, deviationPct: -17.1, warnThresholdPct: 10 } },
        result: {
          status: "warn",
          summary: "Size M average 2.9 g is 17% below the indicative 3.5 g.",
          perSize: { M: { status: "warn", summary: "17% below indicative weight" } },
        },
        warnings: [
          {
            code: "weight_deviation",
            message: "Average weight 2.9 g is 17.1% below the indicative 3.5 g (threshold 10%).",
            size: "M",
          },
        ],
        comment: "Weighed on the factory scale; the indicative weight is from the glove spec sheet.",
      },
      {
        key: "watertight",
        title: "Freedom from Holes by watertight test",
        labels: {
          crotch: "Between fingers (crotch)",
          palm: "Palm",
          finger: "Finger",
          cuff: "Cuff",
          other: "Other",
        },
        data: { sizes: { M: { tested: 500, holes: { crotch: 0, palm: 0, finger: 1, cuff: 0, other: 0 } } } },
        computed: { M: { codeLetter: "N", aql: 1.5, accept: 14, reject: 15, defects: 1 } },
        result: {
          status: "pass",
          summary: "Size M: 1 hole in 500 (finger), limit 14 / 15.",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "visual",
        title: "Visual Inspection",
        labels: {
          embedded_insect: "Embedded Insects",
          embedded_metal: "Embedded metal debris",
          thin_crotch_area: "Thin area between fingers (crotch)",
          thin_crotch_ring: "Ring-shaped thin area (crotch)",
          thin_body_area: "Thin area on glove body",
          thin_spot: "Thin spot on glove body",
        },
        data: {
          sizes: {
            M: {
              critical: { inspected: 500, counts: { embedded_insect: 0, embedded_metal: 0 } },
              major: {
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
              },
              minor: {
                inspected: 500,
                counts: {
                  dirt_small: 0,
                  sticky_pleats: 0,
                  lump_small: 0,
                  bead_poor: 0,
                  bead_rolled: 0,
                  bead_defective: 0,
                },
              },
            },
          },
        },
        computed: {
          M: {
            critical: { aql: 0, accept: 0, reject: 1, found: 0 },
            major: { codeLetter: "N", aql: 2.5, accept: 21, reject: 22, found: 8 },
            minor: { codeLetter: "M", aql: 4.0, accept: 21, reject: 22, found: 0, note: "arrow up from N to M" },
          },
        },
        result: {
          status: "pass",
          summary: "Size M: critical 0 (0 / 1), major 8 (21 / 22), minor 0 (21 / 22).",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: "Major defects: 2 thin areas between fingers, 1 thin area on the body, 5 thin spots.",
      },
      {
        key: "dispensing_packing",
        title: "Glove Packing Check",
        labels: { layeringPct: "Layering %", dispensingPct: "Dispensing %", stickiness: "Stickiness" },
        data: {
          sizes: {
            M: DISPENSING_BOXES_M.map((box, index) => ({
              box,
              layeringPct: index === 0 || index === 3 ? 90 : 88,
              dispensingPct: index === 0 || index === 3 ? 92 : 90,
              stickiness: "A",
            })),
          },
        },
        computed: { M: { layeringAvg: 88.3, dispensingAvg: 90.3, minLayering: 70, minDispensing: 80 } },
        result: {
          status: "pass",
          summary: "Size M: layering 88.3% (>= 70%), dispensing 90.3% (>= 80%), stickiness A on all 13 boxes.",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "labeling",
        title: "Packaging Labeling Inspection",
        labels: { inner: "Dispenser Box", carton: "Carton Box" },
        data: {
          sizes: {
            M: {
              inner: { inspected: 3, boxes: [609, 1748, 2872], defects: { lot_no: 0, mfg_date: 0, artwork: 0 } },
              carton: {
                inspected: 1,
                boxes: [1171],
                defects: { lot_no: 0, mfg_date: 0, artwork: 0, carton_no: 0 },
              },
            },
          },
        },
        computed: { M: { inner: { accept: 0, reject: 1, found: 0 }, carton: { accept: 0, reject: 1, found: 0 } } },
        result: {
          status: "pass",
          summary: "Size M: 3 dispenser boxes and 1 carton, no labelling defects.",
          perSize: { M: { status: "pass" } },
        },
        warnings: [],
        comment: null,
      },
      {
        key: "conclusion",
        title: "Conclusion",
        labels: { remark: "Remark" },
        data: { finalResult: "pass", remark: null, signed: true },
        computed: { suggestedResult: "pass" },
        result: { status: "pass", summary: "Final result: pass." },
        warnings: [],
        comment: null,
      },
    ],
    excludedModules: [],
    custom: [],
    photos: [
      {
        id: FIXTURE_IDS.photoThinSpot,
        url: photoUrl(FIXTURE_IDS.photoThinSpot),
        moduleKey: "visual",
        target: "size:M/defect:thin_spot",
        caption: "Thin spot on glove body",
        takenAt: "2024-07-12T03:10:00.000Z",
        includeInReport: true,
        flagged: false,
      },
      {
        id: FIXTURE_IDS.photoPinHole,
        url: photoUrl(FIXTURE_IDS.photoPinHole),
        moduleKey: "watertight",
        target: "size:M/defect:hole_finger",
        caption: "Pin hole on a finger after the watertight test",
        takenAt: "2024-07-12T02:40:00.000Z",
        includeInReport: true,
        flagged: false,
      },
      {
        id: FIXTURE_IDS.photoScale,
        url: photoUrl(FIXTURE_IDS.photoScale),
        moduleKey: "weight",
        target: "size:M",
        caption: "Scale reading, 13 gloves",
        takenAt: "2024-07-12T04:05:00.000Z",
        includeInReport: false,
        flagged: false,
      },
      {
        id: FIXTURE_IDS.photoCartonLabel,
        url: photoUrl(FIXTURE_IDS.photoCartonLabel),
        moduleKey: "labeling",
        target: "size:M/box:1171",
        caption: "Carton label",
        takenAt: "2024-07-12T05:20:00.000Z",
        includeInReport: false,
        flagged: false,
      },
      {
        id: FIXTURE_IDS.photoDispenserHeic,
        url: photoUrl(FIXTURE_IDS.photoDispenserHeic, "heic"),
        moduleKey: "dispensing_packing",
        target: "size:M/box:32",
        caption: "Dispenser box layering",
        takenAt: "2024-07-12T05:45:00.000Z",
        includeInReport: false,
        flagged: true,
      },
    ],
    files: [
      {
        id: FIXTURE_IDS.fileLabReport,
        url: "https://storage.example.com/inspection-files/fab-lab-report.pdf?token=placeholder",
        moduleKey: "force_at_break",
        kind: "lab_report",
        name: "Force at break lab report.pdf",
      },
    ],
    conclusion: {
      suggestedResult: "pass",
      finalResult: "pass",
      remark: null,
      inspector: { id: FIXTURE_IDS.inspector, name: "Inspector A" },
      date: "2024-07-13",
    },
  };
}

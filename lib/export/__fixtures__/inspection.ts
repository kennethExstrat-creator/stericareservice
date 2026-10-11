import { TEST_ADMIN_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import type { ResolvedTemplate } from "@/lib/schemas/template";

/* ------------------------------------------------------------------ *
 * One submitted inspection as the database holds it, for the export and
 * AI tests. It runs on the framework's test modules (TEST_REGISTRY), so
 * its results do not change when the real modules land. Identifiers are
 * placeholders (BUILD_SPEC rule 7). What it exercises:
 *
 *   header, glove_info (with a comment), order_lots (size M only),
 *   packing_config (a warning), sampling_plan, carton_sampling (a
 *   duplicate carton: failed, with an error), dimensions (switched off for
 *   this inspection), weight (17% below the indicative weight: a warning;
 *   size L saved but not ordered), visual (pass), conclusion (hold), and
 *   a custom module after header. Photos: tagged, untagged, a blank tag, a
 *   flagged HEIC original and one whose object is missing from Storage.
 * ------------------------------------------------------------------ */

export const IDS = {
  inspection: "11111111-1111-4111-8111-111111111111",
  template: "22222222-2222-4222-8222-222222222222",
  client: "33333333-3333-4333-8333-333333333333",
  manufacturer: "44444444-4444-4444-8444-444444444444",
  inspector: TEST_INSPECTOR.id,
  admin: TEST_ADMIN_ID,
  otherInspector: "55555555-5555-4555-8555-555555555555",
  photoVisual: "66666666-6666-4666-8666-000000000001",
  photoWeight: "66666666-6666-4666-8666-000000000002",
  photoUntagged: "66666666-6666-4666-8666-000000000003",
  photoHeic: "66666666-6666-4666-8666-000000000004",
  photoMissing: "66666666-6666-4666-8666-000000000005",
  fileLab: "77777777-7777-4777-8777-000000000001",
} as const;

export const UPDATED_AT = "2026-10-05T09:30:00.654321+00:00";

const photoPath = (id: string, extension = "jpg") => `${IDS.inspection}/${id}.${extension}`;
const thumbPath = (id: string) => `${IDS.inspection}/thumbs/${id}.jpg`;

export const PATHS = {
  photoVisual: photoPath(IDS.photoVisual),
  photoWeight: photoPath(IDS.photoWeight),
  photoUntagged: photoPath(IDS.photoUntagged),
  photoHeic: photoPath(IDS.photoHeic, "heic"),
  photoMissing: photoPath(IDS.photoMissing),
  thumbVisual: thumbPath(IDS.photoVisual),
  thumbWeight: thumbPath(IDS.photoWeight),
  fileLab: `${IDS.inspection}/${IDS.fileLab}.pdf`,
  logo: "client-a.png",
  source: "TEST_EG/v3/source.pdf",
} as const;

export function makeResolvedTemplate(overrides: Partial<ResolvedTemplate> = {}): ResolvedTemplate {
  return makeTestTemplate(
    TEST_REGISTRY,
    [
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      {
        key: "dimensions",
        config: { statistic: "median", specs: { M: { width: { kind: "tolerance", nominal: 95, tolerance: 10 } } } },
      },
      "weight",
      "visual",
      { key: "conclusion", title: "Conclusion" },
    ],
    {
      customModules: [
        {
          key: "glove_type",
          title: "Glove Type",
          after: "header",
          layout: "fields",
          fields: [{ key: "gloveType", label: "Glove Type", type: "text" }],
        },
      ],
      report: { title: "Preshipment Inspection: Nitrile Disposable Examination Gloves", showClientLogo: true },
      sourceFile: null,
      ...overrides,
    },
  );
}

const WEIGHTS_M = [2.86, 2.91, 2.88, 2.93, 2.9, 2.87, 2.92, 2.89, 2.94, 2.88, 2.91, 2.9, 2.91];

export function makeInspectionData() {
  return {
    modules: {
      header: { poNo: "PO-0001", productName: "Brand X Nitrile Examination Glove", client: "Client A" },
      glove_info: { indicativeWeight: 3.5, colour: "Blue", comment: "Indicative weight from the glove spec sheet." },
      order_lots: { lots: [{ size: "M", qtyCases: 2900, lotNumbers: ["LOT-M-0001"] }] },
      packing_config: { glovesPerInner: 200, innersPerCase: 10, glovesPerCase: 2100 },
      sampling_plan: { sizes: { M: { cases: 50, watertightVisual: 500, dimensions: 13 } } },
      carton_sampling: { sizes: { M: [32, 578, 578] } },
      dimensions: { sizes: { M: { width: [95, 96, 95] } } },
      weight: {
        sizes: { M: { values: WEIGHTS_M }, L: { values: WEIGHTS_M } },
        comment: "Weighed on the factory scale.",
      },
      visual: { sizes: { M: { critical: 0, major: 8 } } },
      conclusion: { finalResult: "hold", remark: "Weight below the indicative value; waiting for the spec sheet." },
    },
    custom: { glove_type: { gloveType: "Nitrile, powder free" } },
  };
}

type Row = Record<string, unknown>;

/** The inspection row with its embeds joined, as INSPECTION_RECORD_SELECT returns it. */
export function makeInspectionRow(overrides: Row = {}, template: Row = {}): Row {
  return {
    id: IDS.inspection,
    ref_no: "INS-2026-0042",
    status: "submitted",
    inspection_date: "2026-10-05",
    inspector_id: IDS.inspector,
    data: makeInspectionData(),
    module_overrides: {
      dimensions: { reason: "Calipers out for calibration.", by: IDS.admin, at: "2026-10-05T08:00:00+00:00" },
    },
    result: "hold",
    suggested_result: "fail",
    // The list's copy of the remark, from before the inspector last changed it.
    remarks: "Remark as first saved.",
    report_url: null,
    created_at: "2026-10-05T01:00:00.123456+00:00",
    updated_at: UPDATED_AT,
    submitted_at: UPDATED_AT,
    approved_at: null,
    template: {
      id: IDS.template,
      code: "TEST_EG",
      version: 3,
      standard: "EN455",
      product_type: "examination",
      resolved: makeResolvedTemplate(),
      source_file_path: PATHS.source,
      ...template,
    },
    client: { id: IDS.client, name: "Client A", logo_path: PATHS.logo },
    manufacturer: { id: IDS.manufacturer, name: "Manufacturer A", factory_name: "Factory 1" },
    inspector: { id: IDS.inspector, full_name: "Inspector A", email: "inspector@test.local" },
    ...overrides,
  };
}

function photo(id: string, values: Row): Row {
  return {
    id,
    inspection_id: IDS.inspection,
    module_key: null,
    target: null,
    storage_path: photoPath(id),
    thumb_path: thumbPath(id),
    caption: null,
    taken_at: null,
    include_in_report: false,
    flagged: false,
    created_at: "2026-10-05T03:00:00+00:00",
    ...values,
  };
}

export function makePhotoRows(): Row[] {
  return [
    photo(IDS.photoVisual, {
      module_key: "visual",
      target: "size:M/defect:thin_spot",
      caption: "Thin spot on glove body",
      taken_at: "2026-10-05T04:10:00+00:00",
      include_in_report: true,
    }),
    photo(IDS.photoWeight, { module_key: "weight", target: "size:M", caption: "Scale reading", taken_at: "2026-10-05T03:05:00+00:00" }),
    photo(IDS.photoUntagged, { caption: "   ", taken_at: "2026-10-05T05:00:00+00:00" }),
    photo(IDS.photoHeic, {
      module_key: "  ",
      storage_path: PATHS.photoHeic,
      thumb_path: null,
      flagged: true,
      taken_at: "2026-10-05T05:30:00+00:00",
    }),
    photo(IDS.photoMissing, { module_key: "visual", caption: "Lost upload", taken_at: "2026-10-05T04:20:00+00:00" }),
  ];
}

export function makeFileRows(): Row[] {
  return [
    {
      id: IDS.fileLab,
      inspection_id: IDS.inspection,
      module_key: "weight",
      kind: "lab_report",
      storage_path: PATHS.fileLab,
      name: "Lab report.pdf",
      created_at: "2026-10-05T06:00:00+00:00",
    },
  ];
}

/** Every object of the fixture that exists in Storage (the missing photo does not). */
export function makeObjects(): Record<string, string[]> {
  return {
    "inspection-photos": [
      PATHS.photoVisual,
      PATHS.photoWeight,
      PATHS.photoUntagged,
      PATHS.photoHeic,
      PATHS.thumbVisual,
      PATHS.thumbWeight,
    ],
    "inspection-files": [PATHS.fileLab],
    "client-logos": [PATHS.logo],
    "template-sources": [PATHS.source],
  };
}

export function makeTables(): Record<string, Row[]> {
  return {
    inspections: [makeInspectionRow()],
    inspection_photos: makePhotoRows(),
    inspection_files: makeFileRows(),
  };
}

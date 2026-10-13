// The STD_EG example report (tests/fixtures/examples, docs/FIXTURES.md) as an
// inspection of the real modules: the STD_EG seed template resolved against
// the module registry of the day, and each report section in its module's
// data shape, as the capture screen saves it. The export fixture
// (lib/ai/__fixtures__/std-eg-export.ts), the export's own tests and the
// e2e export fixture run it through the framework, so a module whose data or
// results change fails them instead of drifting from a typed copy.
//
// Identifiers are placeholders (BUILD_SPEC rule 7). Only size M was ordered.
// The report prints only the force-at-break median and the weight average,
// so 13 readings with that median and 13 gloves of that average stand in for
// them, as the modules' own tests do.
import { lookupFrom } from "@/lib/templates";
import { STD_EG_SEED } from "@/lib/templates/definitions";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { resolveTemplate } from "@/modules";
import type { InspectionData } from "@/modules/_framework";
import { TEST_INSPECTOR } from "@/modules/_framework/testing";
import type { FileRecord, InspectionRecord, PhotoRecord } from "../record";
import type { CartonSamplingData } from "@/modules/carton_sampling/schema";
import type { ConclusionData } from "@/modules/conclusion/schema";
import type { DimensionsData } from "@/modules/dimensions/schema";
import type { DispensingPackingData } from "@/modules/dispensing_packing/schema";
import type { ForceAtBreakData } from "@/modules/force_at_break/schema";
import type { GloveInfoData } from "@/modules/glove_info/schema";
import type { HeaderData } from "@/modules/header/schema";
import type { LabelingData } from "@/modules/labeling/schema";
import type { OrderLotsData } from "@/modules/order_lots/schema";
import type { PackingConfigData } from "@/modules/packing_config/schema";
import type { SamplingPlanData } from "@/modules/sampling_plan/schema";
import type { VisualData } from "@/modules/visual/schema";
import type { WatertightData } from "@/modules/watertight/schema";
import type { WeightData } from "@/modules/weight/schema";
import {
  cartonList,
  intendedValue,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type FictionalDate,
} from "@/tests/fixtures/examples";

const EXAMPLE = STD_EG_EXAMPLE;

/** The STD_EG seed template, resolved against the real modules (as a version saved in the editor today). */
export function stdEgTemplate(): ResolvedTemplate {
  const definition = STD_EG_SEED.definition();
  const resolution = resolveTemplate(definition, lookupFrom([]));
  if (!resolution.ok) {
    throw new Error(`STD_EG does not resolve with the real modules: ${JSON.stringify(resolution.problems)}`);
  }
  return resolution.template;
}

export type StdEgDataOptions = {
  /**
   * The expected results' correction (STD_EG_EXPECTED.corrections): the
   * duplicate carton, as an inspector fixes it before submitting. Default
   * true; false keeps the report's mistake, which carton sampling turns into
   * an error.
   */
  corrected?: boolean;
  /** inspection_files id of the force-at-break lab report, kept in the module's data. Null: none attached. */
  labReportFileId?: string | null;
  /** Inspector comments, by module key (the framework's reserved `comment`). */
  comments?: Readonly<Record<string, string>>;
  /** The conclusion's remark. Default: none, as on the report. */
  remark?: string | null;
  /**
   * The conclusion's To Sign After Exported (Kenneth, 13 October 2026): the
   * report signed by hand after export, the drawn signature still saved.
   * Default false, as on the report.
   */
  signAfterExport?: boolean;
};

/** The whole report as saved inspection data (`inspections.data`). */
export function stdEgInspectionData(options: StdEgDataOptions = {}): InspectionData {
  const { corrected = true, labReportFileId = null, comments = {}, remark = null, signAfterExport = false } = options;
  const modules: Record<string, Record<string, unknown>> = {
    header: headerData(),
    glove_info: gloveInfoData(),
    order_lots: orderLotsData(),
    packing_config: packingConfigData(),
    sampling_plan: samplingPlanData(),
    carton_sampling: cartonSamplingData(corrected),
    dimensions: dimensionsData(),
    force_at_break: forceAtBreakData(labReportFileId),
    weight: weightData(),
    watertight: watertightData(),
    visual: visualData(),
    dispensing_packing: dispensingPackingData(),
    labeling: labelingData(),
    conclusion: conclusionData(remark, signAfterExport),
  };
  for (const [key, comment] of Object.entries(comments)) {
    modules[key] = { ...(modules[key] ?? {}), comment };
  }
  return { modules, custom: {} };
}

/* ------------------------------------------------------------------ *
 * One report section per module
 * ------------------------------------------------------------------ */

/** A date picker's value: a month printed as "Feb-25" is its first day. */
function picked(date: FictionalDate): string {
  return date.iso.length === 7 ? `${date.iso}-01` : date.iso;
}

function headerData(): HeaderData {
  const { header } = EXAMPLE;
  return {
    factoryAddress: header.factoryAddress,
    poNo: header.po.printed,
    productName: header.productName,
    productCode: header.productCode,
    factoryGloveCode: header.factoryGloveCode ?? null,
    inspectionDate: picked(header.inspectionDate),
    mfgDate: picked(header.mfgDate),
    expiryDate: picked(header.expiryDate),
  };
}

function gloveInfoData(): GloveInfoData {
  const { gloveInfo } = EXAMPLE;
  // One variant, every size: the example report gives one set of values (indicative weight for size M).
  return {
    // From the onsite form (the report prints no glove type): Glove Information's own since 11 October 2026.
    gloveType: STD_EG_GLOVE_TYPE,
    variants: [
      {
        sizes: [],
        surfaceTexture: gloveInfo.surfaceTexture,
        indicativeWeight: gloveInfo.indicativeWeightG,
        colour: gloveInfo.colour,
        // In mm since 11 October 2026: the report's "240 mm minimum" as its number.
        length: Number(/\d+(?:\.\d+)?/.exec(gloveInfo.length)?.[0] ?? Number.NaN),
      },
    ],
  };
}

function orderLotsData(): OrderLotsData {
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.order.lines).map(([size, line]) => [
        size,
        { qtyCases: line.qtyCases, lotNumbers: [...line.lots], packingSite: line.packingSite ?? null },
      ]),
    ),
  };
}

function packingConfigData(): PackingConfigData {
  const { packing } = EXAMPLE;
  return {
    glovesPerInner: packing.glovesPerInner,
    innersPerCase: packing.innersPerCase,
    glovesPerCase: packing.printedGlovesPerCase,
    packingMode: null,
  };
}

function samplingPlanData(): SamplingPlanData {
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.sampling).map(([size, row]) => [
        size,
        {
          cases: row.cases,
          innerUnits: row.inners,
          gloves: row.gloves,
          glovesWatertightVisual: row.watertightVisualGloves,
          glovesDimensions: row.dimensionGloves,
          glovesPhysical: row.physicalTestGloves,
          // Named in the report's weight heading ("average of 13 gloves per size"), not in its Sampling Plan.
          glovesWeight: EXAMPLE.weight[size as keyof typeof EXAMPLE.weight]?.gloves ?? null,
          innerUnitsDispensing: row.dispensingInners,
          pouches: null,
          pouchesDyeLeak: null,
        },
      ]),
    ),
  };
}

/** The carton grid row by row; corrected, the second entry of the duplicate becomes the expected results' number. */
function cartonSamplingData(corrected: boolean): CartonSamplingData {
  const fix = STD_EG_EXPECTED.corrections.duplicateCarton;
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.cartons).map(([size, grid]) => {
        const cartons = cartonList(grid);
        if (corrected && size === fix.size) {
          const index = (fix.cell.row - 1) * 10 + (fix.cell.column - 1);
          if (cartons[index] !== fix.from) throw new Error("The carton correction no longer matches the example.");
          cartons[index] = fix.to;
        }
        return [size, { cartonNumbers: cartons }];
      }),
    ),
  };
}

const MEASURE_KEY = {
  length: "length",
  width: "width",
  finger: "fingerThickness",
  palm: "palmThickness",
  cuff: "cuffThickness",
} as const;

function dimensionsData(): DimensionsData {
  const { columns, perSize } = EXAMPLE.dimensions;
  return {
    sizes: Object.fromEntries(
      Object.entries(perSize).map(([size, table]) => [
        size,
        {
          gloves: table.gloves.map((row) => ({
            length: null,
            width: null,
            fingerThickness: null,
            palmThickness: null,
            cuffThickness: null,
            ...Object.fromEntries(columns.map((column, index) => [MEASURE_KEY[column], intendedValue(row[index])])),
          })),
        },
      ]),
    ),
  };
}

/**
 * 13 readings out of order whose median is exactly `median`: the report
 * prints only the median (the readings are on the lab report).
 */
export function readingsWithMedian(median: number, n = 13): number[] {
  const half = (n - 1) / 2;
  const below = Array.from({ length: half }, (_, index) => Math.round((median - 0.04 * (index + 1)) * 1000) / 1000);
  const above = Array.from({ length: half }, (_, index) => Math.round((median + 0.05 * (index + 1)) * 1000) / 1000);
  // Interleaved, so the median is computed, not read off the middle.
  return [...above.slice(0, 3), ...below.slice(0, 3), median, ...below.slice(3), ...above.slice(3)];
}

function forceAtBreakData(labReport: string | null): ForceAtBreakData {
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.forceAtBreak).map(([size, entry]) => [
        size,
        { values: entry.readingsN ? [...entry.readingsN] : readingsWithMedian(entry.medianN) },
      ]),
    ),
    labReport,
  };
}

/** STD_EG prints only the average of its 13 gloves: 13 gloves of that weight stand in for them. */
function weightData(): WeightData {
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.weight).map(([size, entry]) => [
        size,
        { values: entry.values ? [...entry.values] : Array.from({ length: entry.gloves }, () => entry.averageG) },
      ]),
    ),
  };
}

function watertightData(): WatertightData {
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.watertight.perSize).map(([size, entry]) => [
        size,
        { tested: entry.tested, holes: { ...entry.holes }, otherDescription: null, unmapped: [] },
      ]),
    ),
  };
}

function visualData(): VisualData {
  const { critical, major, minor } = EXAMPLE.visual;
  const sizes = Object.keys(critical.perSize) as (keyof typeof critical.perSize)[];
  const level = (entry: { inspected: number; counts: Readonly<Record<string, number | undefined>> } | undefined) => ({
    inspected: entry?.inspected ?? null,
    counts: Object.fromEntries(Object.entries(entry?.counts ?? {}).filter((pair): pair is [string, number] => pair[1] !== undefined)),
    unmapped: [],
  });
  return {
    sizes: Object.fromEntries(
      sizes.map((size) => [
        size,
        { critical: level(critical.perSize[size]), major: level(major.perSize[size]), minor: level(minor.perSize[size]) },
      ]),
    ),
  };
}

/** The packing check per box, the box/carton numbers as typed: box 2336 is in no carton list, a warning (6.2 rule 7). */
function dispensingPackingData(): DispensingPackingData {
  return {
    sizes: Object.fromEntries(
      Object.entries(EXAMPLE.dispensingPacking.perSize).map(([size, entry]) => [
        size,
        {
          boxes: entry.boxes.map((box) => ({
            boxNo: box.box,
            layeringPct: box.layeringPct,
            dispensingPct: box.dispensingPct,
            stickiness: box.stickiness,
            note: null,
          })),
        },
      ]),
    ),
  };
}

/** The boxes the labels were read on, by their box/carton numbers as typed, each one sampled for size M (6.2 rule 7). */
export const LABELING_BOXES = { inner: [686, 1515, 2597], carton: [1324] } as const;

function labelingData(): LabelingData {
  const { inner, carton } = EXAMPLE.labeling;
  return {
    sizes: Object.fromEntries(
      Object.keys(inner.perSize).map((size) => {
        const key = size as keyof typeof inner.perSize;
        const level = (entry: (typeof inner.perSize)[typeof key], boxNos: readonly number[]) => ({
          inspected: entry?.inspected ?? null,
          boxNos: [...boxNos],
          defects: { ...(entry?.defects ?? {}) },
        });
        return [size, { inner: level(inner.perSize[key], LABELING_BOXES.inner), carton: level(carton.perSize[key], LABELING_BOXES.carton) }];
      }),
    ),
  };
}

/**
 * The final result as printed, the conclusion's date, and a drawn signature
 * (the report is signed), kept when the report is to be signed by hand after
 * export instead.
 */
function conclusionData(remark: string | null, signAfterExport: boolean): ConclusionData {
  const { conclusion } = EXAMPLE;
  return {
    finalResult: conclusion.printedResult === "PASSED" ? "pass" : "fail",
    remark,
    // Not on the paper report.
    inspectionSummary: null,
    date: picked(conclusion.date),
    signature: conclusion.signed ? { width: 600, height: 200, strokes: [[40, 150, 120, 60, 200, 140, 300, 70]] } : null,
    signAfterExport,
  };
}

/* ------------------------------------------------------------------ *
 * The inspection as the database holds it: submitted after the carton
 * errors were fixed, with the weight warning still open (expected
 * results B), comments on weight and visual, the custom Glove Type, the
 * force-at-break lab report attached, and five photos (a flagged HEIC
 * original among them).
 * ------------------------------------------------------------------ */

export const STD_EG_IDS = {
  inspection: "00000000-0000-4000-8000-000000000501",
  template: "00000000-0000-4000-8000-000000000601",
  inspector: TEST_INSPECTOR.id,
  manufacturer: "00000000-0000-4000-8000-000000000201",
  photoThinSpot: "00000000-0000-4000-8000-000000000301",
  photoPinHole: "00000000-0000-4000-8000-000000000302",
  photoScale: "00000000-0000-4000-8000-000000000303",
  photoCartonLabel: "00000000-0000-4000-8000-000000000304",
  photoDispenserHeic: "00000000-0000-4000-8000-000000000305",
  fileLabReport: "00000000-0000-4000-8000-000000000401",
} as const;

export const STD_EG_REF_NO = "INS-2025-0001";
export const STD_EG_UPDATED_AT = "2025-04-12T09:12:00.123456+00:00";

export const STD_EG_COMMENTS = {
  weight: "Weighed on the factory scale; the indicative weight is from the glove spec sheet.",
  visual: "Major defects: 2 thin areas between fingers, 1 thin area on the body, 5 thin spots.",
} as const;

export const STD_EG_GLOVE_TYPE = "Nitrile, powder free";

const IDS = STD_EG_IDS;

const photoPath = (id: string, extension = "jpg") => `${IDS.inspection}/${id}.${extension}`;
const thumbPath = (id: string) => `${IDS.inspection}/thumbs/${id}.jpg`;

function photo(id: string, values: Partial<PhotoRecord>): PhotoRecord {
  return {
    id,
    moduleKey: null,
    target: null,
    storagePath: photoPath(id),
    thumbPath: thumbPath(id),
    caption: null,
    takenAt: null,
    includeInReport: false,
    flagged: false,
    createdAt: "2025-04-11T06:00:00.000000+00:00",
    ...values,
  };
}

/** The photos, in the order they were taken (the export sorts them by module). */
export function stdEgPhotos(): PhotoRecord[] {
  return [
    photo(IDS.photoPinHole, {
      moduleKey: "watertight",
      target: "size:M/defect:hole_finger",
      caption: "Pin hole on a finger after the watertight test",
      takenAt: "2025-04-11T02:40:00.000Z",
      includeInReport: true,
    }),
    photo(IDS.photoThinSpot, {
      moduleKey: "visual",
      target: "size:M/defect:thin_spot",
      caption: "Thin spot on glove body",
      takenAt: "2025-04-11T03:10:00.000Z",
      includeInReport: true,
    }),
    photo(IDS.photoScale, {
      moduleKey: "weight",
      target: "size:M",
      caption: "Scale reading, 13 gloves",
      takenAt: "2025-04-11T04:05:00.000Z",
    }),
    photo(IDS.photoCartonLabel, {
      moduleKey: "labeling",
      target: `size:M/box:${LABELING_BOXES.carton[0]}`,
      caption: "Carton label",
      takenAt: "2025-04-11T05:20:00.000Z",
    }),
    // An original the browser could not convert: no thumbnail.
    photo(IDS.photoDispenserHeic, {
      moduleKey: "dispensing_packing",
      target: "size:M/box:13",
      caption: "Dispenser box layering",
      takenAt: "2025-04-11T05:45:00.000Z",
      storagePath: photoPath(IDS.photoDispenserHeic, "heic"),
      thumbPath: null,
      flagged: true,
    }),
  ];
}

export function stdEgFiles(): FileRecord[] {
  return [
    {
      id: IDS.fileLabReport,
      moduleKey: "force_at_break",
      kind: "lab_report",
      storagePath: `${IDS.inspection}/${IDS.fileLabReport}.pdf`,
      name: "Force at break lab report.pdf",
      createdAt: "2025-04-11T07:30:00.000000+00:00",
    },
  ];
}

/** The STD_EG example inspection as the export reads it (loadInspectionRecord). */
export function stdEgRecord(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  const data = stdEgInspectionData({ labReportFileId: IDS.fileLabReport, comments: STD_EG_COMMENTS });
  return {
    id: IDS.inspection,
    refNo: STD_EG_REF_NO,
    status: "submitted",
    inspectionDate: EXAMPLE.header.inspectionDate.iso,
    data,
    moduleOverrides: {},
    result: "pass",
    suggestedResult: "pass",
    remarks: null,
    reportUrl: null,
    createdAt: "2025-04-11T00:45:00.000000+00:00",
    updatedAt: STD_EG_UPDATED_AT,
    submittedAt: STD_EG_UPDATED_AT,
    approvedAt: null,
    template: {
      id: IDS.template,
      code: "STD_EG",
      version: 1,
      standard: "EN455",
      productType: "examination",
      resolved: stdEgTemplate(),
      sourceFilePath: null,
    },
    client: null,
    manufacturer: { id: IDS.manufacturer, name: EXAMPLE.header.manufacturer, factoryName: EXAMPLE.header.factory ?? null },
    inspectorId: IDS.inspector,
    inspector: { id: IDS.inspector, fullName: TEST_INSPECTOR.name, email: "inspector@test.local" },
    photos: stdEgPhotos(),
    files: stdEgFiles(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * The same rows for the fake Supabase client (fake-supabase.ts)
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

/** The inspection, its photos and files as tables, as INSPECTION_RECORD_SELECT and the photo and file reads return them. */
export function stdEgTables(record: InspectionRecord = stdEgRecord()): Record<string, Row[]> {
  const template = record.template;
  return {
    inspections: [
      {
        id: record.id,
        ref_no: record.refNo,
        status: record.status,
        inspection_date: record.inspectionDate,
        inspector_id: record.inspectorId,
        data: record.data,
        module_overrides: record.moduleOverrides,
        result: record.result,
        suggested_result: record.suggestedResult,
        remarks: record.remarks,
        report_url: record.reportUrl,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        submitted_at: record.submittedAt,
        approved_at: record.approvedAt,
        template: template && {
          id: template.id,
          code: template.code,
          version: template.version,
          standard: template.standard,
          product_type: template.productType,
          resolved: template.resolved,
          source_file_path: template.sourceFilePath,
        },
        client: record.client && { id: record.client.id, name: record.client.name, logo_path: record.client.logoPath },
        manufacturer: record.manufacturer && {
          id: record.manufacturer.id,
          name: record.manufacturer.name,
          factory_name: record.manufacturer.factoryName,
        },
        inspector: record.inspector && {
          id: record.inspector.id,
          full_name: record.inspector.fullName,
          email: record.inspector.email,
        },
      },
    ],
    inspection_photos: record.photos.map((entry) => ({
      id: entry.id,
      inspection_id: record.id,
      module_key: entry.moduleKey,
      target: entry.target,
      storage_path: entry.storagePath,
      thumb_path: entry.thumbPath,
      caption: entry.caption,
      taken_at: entry.takenAt,
      include_in_report: entry.includeInReport,
      flagged: entry.flagged,
      created_at: entry.createdAt,
    })),
    inspection_files: record.files.map((entry) => ({
      id: entry.id,
      inspection_id: record.id,
      module_key: entry.moduleKey,
      kind: entry.kind,
      storage_path: entry.storagePath,
      name: entry.name,
      created_at: entry.createdAt,
    })),
  };
}

/** Every object of the record in Storage. */
export function stdEgObjects(record: InspectionRecord = stdEgRecord()): Record<string, string[]> {
  return {
    "inspection-photos": record.photos.flatMap((entry) => [entry.storagePath, ...(entry.thumbPath ? [entry.thumbPath] : [])]),
    "inspection-files": record.files.map((entry) => entry.storagePath),
  };
}

// The export the Report page previews from: the capture screen's own copy
// of the inspection, as it stands on this device mid-edit and offline too,
// assembled by the export's own pure assembly (lib/export/assemble.ts) and
// validated by ExportSchema, so the preview's pages are the printed ones
// (buildReportModel). What the screen does not hold stands in: no signed
// file links, no inspector email, the creation time read as the last save.
// The print route builds the real export on the server instead
// (buildInspectionExport), from what is saved.
import { assembleExport } from "@/lib/export/assemble";
import type { EvaluatedInspection } from "@/lib/export/evaluate";
import type { InspectionRecord, PhotoRecord } from "@/lib/export/record";
import type { CaptureEvaluation, CaptureMeta } from "@/lib/inspections/capture/evaluate";
import type { InspectionResult, InspectionStatus, ProductType, Standard } from "@/lib/schemas/common";
import { ExportPhotoSchema, ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import type { InspectionData } from "@/modules/_framework";

/** A photo as the screen's media store has it, with a link the browser can show. */
export type LivePhoto = Pick<PhotoRecord, "id" | "moduleKey" | "target" | "caption" | "takenAt" | "includeInReport" | "flagged" | "storagePath" | "createdAt"> & {
  url: string | null;
};

export type LiveExportInput = {
  inspectionId: string;
  refNo: string;
  status: InspectionStatus;
  /** The inspection row's day: a blank header date falls back to it. */
  inspectionDate: string;
  /** inspections.updated_at as last saved. */
  updatedAt: string;
  submittedAt: string | null;
  /** The row's copy of the final result, for data from before the conclusion module (inspectorDecision). */
  result: InspectionResult | null;
  /** The template version's row: its code, version, standard and product type go out; `resolved` as stored. */
  template: { code: string; version: number; standard: Standard; productType: ProductType; resolved: ResolvedTemplate };
  /** The screen's evaluation of `data` (evaluateCapture): overrides applied, titles as shown. */
  evaluation: CaptureEvaluation;
  data: InspectionData;
  meta: CaptureMeta;
  /** "Manufacturer A · Factory A1", as the export names a manufacturer. */
  manufacturerLabel: string | null;
  photos?: readonly LivePhoto[];
};

/** The export of the screen's copy; null when it does not validate (the page then says so). */
export function liveReportExport(input: LiveExportInput): InspectionExport | null {
  const { meta, evaluation } = input;
  const inspector = meta.inspector ?? null;
  if (!inspector) return null;
  const manufacturer = meta.manufacturer ? { id: meta.manufacturer.id, name: input.manufacturerLabel ?? meta.manufacturer.name } : null;
  const photos = (input.photos ?? []).filter((photo) => photo.url !== null);
  const record: InspectionRecord = {
    id: input.inspectionId,
    refNo: input.refNo,
    status: input.status,
    inspectionDate: input.inspectionDate,
    data: input.data,
    moduleOverrides: {},
    result: input.result,
    suggestedResult: null,
    remarks: null,
    reportUrl: null,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    submittedAt: input.submittedAt,
    approvedAt: null,
    // The template row's id never goes out with the export.
    template: { id: "", ...input.template, sourceFilePath: null },
    client: meta.client ? { id: meta.client.id, name: meta.client.name, logoPath: null } : null,
    manufacturer: manufacturer ? { id: manufacturer.id, name: manufacturer.name, factoryName: null } : null,
    inspectorId: inspector.id,
    inspector: { id: inspector.id, fullName: inspector.name, email: null },
    photos: photos.map((photo) => ({
      id: photo.id,
      moduleKey: photo.moduleKey,
      target: photo.target,
      storagePath: photo.storagePath,
      thumbPath: null,
      caption: photo.caption,
      takenAt: photo.takenAt,
      includeInReport: photo.includeInReport,
      flagged: photo.flagged,
      createdAt: photo.createdAt,
    })),
    files: [],
  };
  const evaluated: EvaluatedInspection = {
    template: evaluation.template,
    data: input.data,
    context: evaluation.context,
    report: evaluation.report,
    inspector,
    client: meta.client ?? null,
    manufacturer,
  };
  try {
    const doc = assembleExport({
      record,
      evaluated,
      links: {
        photos: new Map(photos.map((photo) => [photo.storagePath, photo.url as string])),
        files: new Map(),
        clientLogo: null,
        sourceFile: null,
      },
      exportedAt: input.updatedAt,
    });
    // A photo the export could not carry (a link that is no web address) is left out, never the whole preview.
    const parsed = ExportSchema.safeParse({ ...doc, photos: doc.photos.filter((entry) => ExportPhotoSchema.safeParse(entry).success) });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The inspection export (BUILD_SPEC 9.1): one JSON document per inspection,
// validated by ExportSchema (lib/schemas/export.ts), for the AI report and the
// AI second opinion. An inspection of several POs is one document, its other
// parts in `parts`; the second opinion takes one part's export alone. Server
// only: it reads through a Supabase client and signs storage links.
import "server-only";

export {
  buildInspectionExport,
  exportFromEvaluation,
  exportOfParts,
  type BuildExportOptions,
  type ExportFailureReason,
  type ExportResult,
  type SkippedObject,
} from "./build";
export { loadInspectionParts, type LoadPartsResult, type PartRecord } from "./parts";
export { assembleExport, conclusionOf, type AssembleInput, type ExportInput, type SignedLinks } from "./assemble";
export { evaluateRecord, inspectorRef, type EvaluatedInspection, type EvaluateResult } from "./evaluate";
export {
  INSPECTION_RECORD_SELECT,
  loadInspectionRecord,
  parseInspectionId,
  type ExportClient,
  type FileRecord,
  type InspectionRecord,
  type LoadRecordResult,
  type PhotoRecord,
} from "./record";
export {
  CLIENT_LOGO_BUCKET,
  EXPORT_URL_TTL_SECONDS,
  TEMPLATE_SOURCE_BUCKET,
  signObjects,
  type SignBucket,
  type SignResult,
} from "./sign";
export { exportFileName, exportPath } from "./paths";
export { canExportInspection, type ExportViewer } from "./access";

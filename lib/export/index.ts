// The inspection export (BUILD_SPEC 9.1): one JSON document per inspection,
// validated by ExportSchema (lib/schemas/export.ts), for the Client Report and
// the AI second opinion. Server only: it reads through a Supabase client and
// signs storage links.
import "server-only";

export {
  buildInspectionExport,
  exportFromEvaluation,
  type BuildExportOptions,
  type ExportFailureReason,
  type ExportResult,
  type SkippedObject,
} from "./build";
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
export { exportFileName } from "./paths";
export { canExportInspection, type ExportViewer } from "./access";

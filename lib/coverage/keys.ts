// Closed lists of canonical keys that config values and maps use.
// fields.test.ts checks each list against the dictionary.

/** Dimension measures, in report column order (BUILD_SPEC 6.1 dimensions). */
export const MEASURES = ["length", "width", "fingerThickness", "palmThickness", "cuffThickness"] as const;
export type Measure = (typeof MEASURES)[number];

/** Columns of the sampling plan, in report order; the last two are surgical (SG onsite). */
export const SAMPLING_COLUMNS = [
  "cases",
  "innerUnits",
  "gloves",
  "glovesWatertightVisual",
  "glovesDimensions",
  "glovesPhysical",
  "innerUnitsDispensing",
  "pouches",
  "pouchesDyeLeak",
] as const;
export type SamplingColumn = (typeof SAMPLING_COLUMNS)[number];

export const HEADER_FIELDS = [
  "manufacturer",
  "factoryAddress",
  "poNo",
  "productName",
  "productCode",
  "client",
  "factoryGloveCode",
  "inspectionDate",
  "mfgDate",
  "expiryDate",
  "inspector",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

export const GLOVE_INFO_FIELDS = ["gloveType", "surfaceTexture", "indicativeWeight", "colour", "length"] as const;
export type GloveInfoField = (typeof GLOVE_INFO_FIELDS)[number];

export const LOADING_FIELDS = ["containerNo", "sealNo", "cartonsLoaded", "cartonCondition"] as const;
export type LoadingField = (typeof LOADING_FIELDS)[number];

/** Loading stages where photos are taken, in order (to confirm with Kenneth). */
export const LOADING_STAGES = ["emptyContainer", "halfLoaded", "fullyLoaded", "doorsClosed", "sealed"] as const;
export type LoadingStage = (typeof LOADING_STAGES)[number];

/** Visual defect classes, in report order. */
export const DEFECT_CLASSES = ["critical", "major", "minor"] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

/** Labelling levels: the inner unit (dispenser box, plastic pack) and the carton. */
export const LABELLING_LEVELS = ["inner", "carton"] as const;
export type LabellingLevel = (typeof LABELLING_LEVELS)[number];

/** Labelling checks (BUILD_SPEC 11): codes, like defect codes. */
export const LABELLING_CHECKS = ["lot_no", "mfg_date", "expiry_date", "artwork", "carton_no"] as const;
export type LabellingCheck = (typeof LABELLING_CHECKS)[number];

/** Inner unit names (BUILD_SPEC 6.1 packing_config). */
export const INNER_UNITS = ["inner_box", "plastic_pack", "dispenser_box", "pouch"] as const;
export type InnerUnit = (typeof INNER_UNITS)[number];

/** ISO 2859-1 inspection levels (BUILD_SPEC 7). */
export const INSPECTION_LEVELS = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];

/** ISO 2859-1 code letters (BUILD_SPEC 7): no I or O. */
export const CODE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"] as const;

/** Documents checklist items (BUILD_SPEC 6.1 documents). */
export const DOCUMENT_ITEMS = [
  "certificateOfAnalysis",
  "labTestReports",
  "sterilisation",
  "iso13485",
  "fdaCe",
  "declarationOfOrigin",
] as const;
export type DocumentItem = (typeof DOCUMENT_ITEMS)[number];

/** Result values a computed result field takes. */
export const RESULT_VALUES = ["pass", "fail", "not_done"] as const;

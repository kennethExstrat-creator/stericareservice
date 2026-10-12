// What module code imports: the contract, the context, data helpers and the
// validation building blocks, from one path. Module folders import only this
// (plus lib/stats, lib/sizes, lib/aql and lib/schemas); never the registry,
// `@/modules` or `@/lib/validation`, which import the modules back.
export type {
  JsonObject,
  CalcInput,
  CalcOutput,
  ContributeInput,
  CanonicalPath,
  CaptureFocus,
  CaptureProps,
  CaptureComponent,
  ModuleDefinition,
  AnyModuleDefinition,
  ModuleRegistry,
  PackagingLevel,
  TitleInput,
} from "./contract";
export { PACKAGING_LEVELS } from "./contract";
export { defineModule, stubModule, NOT_BUILT_SUMMARY, type ModuleSpec, type StubSpec } from "./define";
export { SpecSchema } from "./config-schemas";
export { labelFor, effectiveLabels, type Labels } from "./labels";
export {
  AQL_CHECKS,
  AQL_DEFAULTS,
  AQL_SOURCES,
  CONTEXT_SOURCES,
  EMPTY_SAMPLING,
  INSPECTION_LEVELS,
  baseContext,
  buildInspectionContext,
  applyContribution,
  splitContribution,
  restrictToOrderedSizes,
  samplingFor,
  cartonsFor,
  lotSizeGloves,
  sizeLabel,
  initialSize,
  includedModules,
  moduleTitle,
  moduleShortTitle,
  inspectionRowValues,
  readableData,
  type AqlCheck,
  type AqlDefaults,
  type AqlSettings,
  type BuildContextInput,
  type ContextContribution,
  type ContributionError,
  type HeaderValues,
  type IncludedModule,
  type IndicativeWeight,
  type InspectionContext,
  type InspectionLevel,
  type InspectionMeta,
  type OrderLine,
  type PackingValues,
  type SamplingValues,
} from "./context";
export {
  FILE_KINDS,
  FileKindSchema,
  FileIdCellSchema,
  heldFileState,
  moduleFileState,
  missingFileMessage,
  type AttachedFile,
  type FileKind,
  type HeldFileState,
  type InspectionFileRef,
} from "./files";
export { salvageData, type SalvagedData } from "./salvage";
export { buildInspectionView, fillGloveCount, withShownTitles, type InspectionView } from "./titles";
export {
  COMMENT_KEY,
  InspectionDataSchema,
  emptyInspectionData,
  readModuleEntry,
  parseModuleData,
  writeModuleData,
  writeModuleComment,
  perSizeData,
  type DataNamespace,
  type InspectionData,
  type ModuleEntry,
} from "./data";
export { HANDS, HAND_LABEL, HandSchema, isHandSplit, type Hand } from "./hands";
export { calcOrder, dependenciesOf, resultsFor } from "./order";
export {
  parseCanonicalPath,
  canonicalPathOf,
  findCanonicalPath,
  isMappableType,
  readPath,
  writePath,
  type ParsedCanonicalPath,
} from "./paths";
export {
  evaluateInspection,
  evaluationOf,
  type CustomModuleEvaluation,
  type EvaluateInput,
  type ExcludedModule,
  type InspectionEvaluation,
  type ModuleEvaluation,
} from "./evaluate";

// Validation building blocks (lib/validation), re-exported for module code.
export {
  errorIssue,
  warningIssue,
  type CalcIssue,
  type IssueLevel,
  type IssueLocation,
  type IssuePath,
  type ValidationIssue,
} from "@/lib/validation/issues";
export {
  DecimalCellSchema,
  CountCellSchema,
  CartonNumberCellSchema,
  BoxNumberSchema,
  BoxNumberCellSchema,
  TextCellSchema,
  DateCellSchema,
  YesNoCellSchema,
  readDecimalCell,
  readCountCell,
  isBlank,
} from "@/lib/validation/cells";
export {
  STATUS_SEVERITY,
  worstStatus,
  combinePerSize,
  perSizeResults,
  resultFromSizes,
  notDone,
} from "@/lib/validation/results";
export { suggestResult, suggestionReasons, type SuggestedResult, type SuggestionInput } from "@/lib/validation/suggested-result";
export { describeDataPath, fieldIssues } from "@/lib/validation/rules";

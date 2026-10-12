// The validation framework (BUILD_SPEC 6.2). Module code imports these
// building blocks through `@/modules/_framework`, never from here: this index
// also exports validateInspection, which loads the module registry.
export {
  ISSUE_LEVELS,
  ISSUE_CODE_PATTERN,
  IssueLevelSchema,
  IssuePathSchema,
  ValidationIssueSchema,
  errorIssue,
  warningIssue,
  stampIssues,
  isError,
  partitionIssues,
  sortIssues,
  toExportIssue,
  exportIssuesOf,
  type CalcIssue,
  type IssueLevel,
  type IssueLocation,
  type IssuePath,
  type ValidationIssue,
} from "./issues";
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
} from "./cells";
export {
  STATUS_SEVERITY,
  NO_DATA_SUMMARY,
  NO_SIZES_SUMMARY,
  worstStatus,
  notDone,
  perSizeResults,
  combinePerSize,
  resultFromSizes,
  enforceResultRules,
  type ResultRules,
} from "./results";
export {
  FRAMEWORK_ISSUE_CODES,
  restrictToOrderedSizes,
  sizeNotOrderedIssues,
  sizeDuplicateIssues,
  notDoneIssues,
  inspectorIssues,
  describeDataPath,
  fieldIssues,
} from "./rules";
export {
  fieldValueSchema,
  customValuesSchema,
  emptyCustomValues,
  evaluateCustomValues,
  type CustomEvaluation,
  type CustomEvaluationInput,
} from "./custom";
export { suggestResult, type SuggestedResult, type SuggestionInput } from "./suggested-result";
export { validateInspection, type ValidationReport } from "./validate";

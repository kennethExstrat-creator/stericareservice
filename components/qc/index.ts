// Domain UI primitives for inspection screens (docs/DESIGN.md). Display logic
// only: modules own their data, calculations and saving.
export { StatusPill } from "./status-pill";
export { StatusIcon, STATUS_ICON } from "./status-icon";
export { ResultChip } from "./result-chip";
export { SaveStatus, type SaveState } from "./save-status";
export { Stepper } from "./stepper";
export { DefectChip } from "./defect-chip";
export { DefectChipGroup, type DefectChipItem } from "./defect-chip-group";
export { NumericCell, type InvalidEntry } from "./numeric-cell";
export {
  MeasurementGrid,
  type Measure,
  type MeasureSummary,
  type MeasurementCell,
  type MeasurementChange,
  type MeasurementGridLabels,
  type MeasurementValues,
} from "./measurement-grid";
export { ModuleCard, type PhotoSource } from "./module-card";
export { PhotoTile, type PhotoState } from "./photo-tile";
export { tagLine, type PhotoTags } from "./photo-tags";
export { ProgressTracker, type ProgressStep, type StepState } from "./progress-tracker";
export { PageHeader } from "./page-header";

// Capture kit: shared building blocks for module Capture screens (docs/CAPTURE_KIT.md).
// Accept/reject decisions are calc's, with lib/aql: the kit only displays them.
export { useDataUpdater } from "./use-data-updater";
export type { DataChange } from "./data-updater";
export { SizeTabs, SizeStatusStrip, type ResultLike, type SizeResults } from "./size-tabs";
export { HandToggle, handsOf, type HandView } from "./hand-toggle";
export { BoxPicker } from "./box-picker";
export {
  CounterTable,
  type CounterColumn,
  type CounterRow,
  type CounterSummaryRow,
  type CounterTableLabels,
} from "./counter-table";
export { columnTotal, type CounterCell, type CounterHand, type CountReader } from "./counter-model";
export {
  NumberField,
  PercentField,
  EnterGroup,
  EntryProblems,
  type EntryProblem,
  type NumberFieldProps,
} from "./number-field";
export {
  RequirementList,
  SpecValue,
  specOutcome,
  type Requirement,
  type RequirementLabels,
  type RequirementOutcome,
} from "./requirement-list";
export { ModuleSection } from "./module-section";
export { Figure } from "./figure";
export {
  issuePathKey,
  issuePathProps,
  issueNoticeProps,
  focusIssuePath,
  findIssue,
  type IssuePath,
} from "./issue-path";
export { useIssueFocus } from "./use-issue-focus";

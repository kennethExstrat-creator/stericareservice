// Domain UI primitives for inspection screens (docs/DESIGN.md). Display logic
// only: modules own their data, calculations and saving.
export { StatusPill } from "./status-pill";
export { StatusIcon, STATUS_ICON } from "./status-icon";
export { ResultChip } from "./result-chip";
export { SaveStatus, type SaveState } from "./save-status";
export { Stepper } from "./stepper";
export { CountField } from "./count-field";
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
export { ProgressTracker, type ProgressGroup, type ProgressStep, type StepState } from "./progress-tracker";
export { PageHeader } from "./page-header";

// Capture kit: shared building blocks for module Capture screens (docs/CAPTURE_KIT.md).
// Accept/reject decisions are calc's, with lib/aql: the kit only displays them.
export { useDataUpdater } from "./use-data-updater";
// The updater without React, for tests of a module's writes (and anything outside a component).
export { batchDataChanges, createDataUpdater, type DataChange, type DataUpdater } from "./data-updater";
export { useMediaQuery, WIDE_QUERY, COARSE_QUERY } from "./use-media-query";
export { SizeTabs, SizeStatusStrip, type ResultLike, type SizeResults } from "./size-tabs";
export { SizeBlock, SideBySideText, useSizeTabsLayout, type SizeTabsLayout } from "./size-block";
export { HandToggle, handsOf, HAND_NAME, type HandView } from "./hand-toggle";
export { BoxPicker } from "./box-picker";
// A box number as the inspector types it (dispensing, labelling): not a carton number (BUILD_SPEC 6.2 rule 7).
export { BoxNumberField, type BoxNumberFieldProps } from "./box-number-field";
export {
  CounterTable,
  type CounterColumn,
  type CounterRow,
  type CounterSummaryRow,
  type CounterTableLabels,
} from "./counter-table";
export { columnTotal, type CounterCell, type CounterHand, type CountReader } from "./counter-model";
export { ColumnSwitcher } from "./column-switcher";
export {
  NumberField,
  PercentField,
  EnterGroup,
  EntryProblems,
  type EntryProblem,
  type NumberFieldProps,
} from "./number-field";
// What a paste left out, on screen: NumberField, EnterGroup and MeasurementGrid show it themselves.
export { PasteNotice } from "./paste-notice";
// Where the capture screen keeps refused entries ("2 42") so they outlive their field: NumberField and MeasurementGrid use it.
export { RefusedEntryStoreContext, useRefusedEntryStore, type RefusedEntryStore } from "./refused-entries";
export type { PasteLeftOut } from "./field-navigation";
export {
  RequirementList,
  SpecValue,
  specOutcome,
  type Requirement,
  type RequirementLabels,
  type RequirementOutcome,
} from "./requirement-list";
export { DateField } from "./date-field";
// Formatted text read-only (lib/schemas/rich-text.ts). Its editor, RichTextEditor, is imported by its path
// (@/components/qc/rich-text-editor) so Tiptap stays in the chunk of the Capture that uses it.
export { RichTextView } from "./rich-text-view";
export { AttachmentStatus, type AttachmentState } from "./attachment-status";
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
export { isRevealOnly, revealOnlyPath, useIssueFocus } from "./use-issue-focus";

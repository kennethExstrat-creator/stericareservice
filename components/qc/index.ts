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
export { MeasurementGrid, type Measure, type MeasurementValues } from "./measurement-grid";
export { ModuleCard, type PhotoSource } from "./module-card";
export { PhotoTile, type PhotoState } from "./photo-tile";
export { tagLine, type PhotoTags } from "./photo-tags";
export { ProgressTracker, type ProgressStep, type StepState } from "./progress-tracker";
export { PageHeader } from "./page-header";

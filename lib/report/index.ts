// The app's own report (docs/REPORT.md): the export turned into a typed model
// of pages (model.ts), the Summary's checks and verdict (checks.ts), the
// readers, words and chart arithmetic the sections share, the live export
// the Report page previews from, and the print route's paths. Pure and
// client-safe.
export {
  buildReportModel,
  paperOf,
  reportPageChrome,
  poOf,
  orderMixOf,
  photoGroupsOf,
  sectionTitle,
  summaryPlacement,
  orderTotals,
  preparedFor,
  bandReference,
  NOT_STATED,
  NOT_CONCLUDED,
  SUMMARY_ROOM,
  type ReportModel,
  type ReportChrome,
  type PageChrome,
  type ReportPaper,
  type ReportOrientation,
  type ReportStatus,
  type ReportFact,
  type ReportConclusion,
  type SummaryModel,
  type SummaryText,
  type OrderMix,
  type OrderMixRow,
  type ReportSections,
  type ReportSectionContent,
  type ReportPlanEntry,
  type ReportPlanEntryFor,
  type ReportSlotKey,
  type ReportSummaryPlanEntry,
  type ReportSectionPlanEntry,
  type ReportPhotosPlanEntry,
  type ReportPhotoRecord,
  type ReportPhoto,
  type OrderSamplingSection,
  type DimensionsSection,
  type MeasurementsSection,
  type ForceAtBreakSection,
  type HolesVisualSection,
  type PackingSection,
  type LabellingConclusionSection,
  type PhotosSection,
} from "./model";
export { checkRows, checksVerdict, type CheckRow, type CheckStatus } from "./checks";
export { SECTION_BUILDERS, sectionBuilder, defineSection, type SectionBuilder, type AnySectionBuilder } from "./sections";
export { STERICARE_LETTERHEAD, type Letterhead } from "./letterhead";
export { longDate, weekdayDate, andList, counted, rangeText, sharesOf, shareText, aqlText } from "./format";
export { isRecord, rec, list, num, text, at, moduleOf, labelOf, orderedSizes, inTemplateOrder, sizeLabel } from "./read";
export {
  position,
  niceStep,
  ticksBetween,
  niceAxis,
  stackDots,
  stackHeight,
  median,
  bandEdges,
  trackGeometry,
  type Axis,
  type StackedDot,
} from "./geometry";
export { liveReportExport, type LiveExportInput, type LivePhoto } from "./live-export";
export { reportPrintPath, reportPagePath, REPORT_AUTO_PRINT_PARAM } from "./paths";

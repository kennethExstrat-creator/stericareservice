// The app's own report (docs/REPORT.md): the document, the page frame, the
// Summary and the primitives the sections are drawn with, which the
// sampling plan for manufacturers shares. Pure markup, no hooks:
// server-rendered on the print route, scaled on the Report page.
export { ReportDocument, reportBodies, type ReportDocumentProps, type DocumentPage } from "./report-document";
export {
  SECTION_PAGES,
  sectionPages,
  defineSectionPages,
  type SectionPages,
  type SectionPagesProps,
  type AnySectionPages,
} from "./sections";
export { SizeChip, type SizeChipProps } from "./size-chip";
export { ReportPage, DraftTag, type ReportPageProps } from "./report-page";
export { SummaryPage, summaryPages, ConclusionCard, OrderMixBlock, SummaryTextCard, ChecksBlock } from "./summary-page";
export { ComingNextPage, comingNextPages, comingNextText } from "./coming-next-page";
export { SectionHeading, BlockHeading, type SectionHeadingProps } from "./section-heading";
export { StatusChip, StatusTick, REPORT_STATUS_ICON, type StatusChipProps, type StatusTickProps } from "./status-chip";
export { InfoCard, KeyValueGrid, type InfoCardProps, type KeyValueItem, type KeyValueGridProps } from "./info-card";
export { ReportTable, type ReportColumn, type ReportColumnGroup, type ReportRow, type ReportTableProps } from "./report-table";
export { StackedBar, StackedLegend, segmentShares, type StackedSegment, type StackedBarProps, type StackedLegendProps } from "./stacked-bar";
export { DotPlot, dotRowHeight, DOT, type DotPlotRow, type DotPlotProps } from "./dot-plot";
export { RangeBand, stretch, type RangeBandRow, type RangeBandProps } from "./range-band";
export {
  HBars,
  GroupedHBars,
  barLength,
  SERIES_TONE,
  type HBarRow,
  type HBarsProps,
  type GroupedHBarRow,
  type GroupedHBarSeries,
  type GroupedHBarsProps,
} from "./bars";
export { StripPlot, stripPosition, type StripRow, type StripPlotProps } from "./strip-plot";
export { TrackBar, acceptText, type TrackBarProps } from "./track-bar";
export { TickMatrix, type TickMatrixRow, type TickMatrixProps } from "./tick-matrix";
export { PhotoGrid, type GridPhoto, type PhotoGridProps } from "./photo-grid";
export { along, AxisTicks, GridLines, LimitLine, AsideLines, ChartKey, plainTick, type AsideLine, type AxisTicksProps } from "./chart-parts";
export { PAPER_CLASS, PAGE_GUTTER, contentWidth, TYPE, sequenceFor, sizeTone, type SequenceStep } from "./theme";

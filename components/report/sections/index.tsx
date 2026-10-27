// The report's sections' pages, each drawn by a file of its own in this
// folder (docs/REPORT.md, "Adding a section"), from its slot's content
// (lib/report/sections builds it) and its plan entry. `Pages` returns one
// body per page, as many as the content's pageCount; ReportDocument puts
// each in its frame, with the chrome and "Page X of N" across the report,
// in the plan's order (the Summary first). A planned section with no entry
// here prints "coming next". To add a section's pages: write
// components/report/sections/<key>.tsx exporting `defineSectionPages({ key,
// Pages })` and add one line to the list below. The keys are the report
// options' section keys, and "photos".
import type { ReactNode } from "react";
import type { ReportModel, ReportPlanEntryFor, ReportSections, ReportSlotKey } from "@/lib/report/model";
import { forceAtBreakPages } from "./forceAtBreak";

export type SectionPagesProps<K extends ReportSlotKey> = {
  model: ReportModel;
  entry: ReportPlanEntryFor<K>;
  content: NonNullable<ReportSections[K]>;
};

export type SectionPages<K extends ReportSlotKey> = {
  key: K;
  /** One body per page of the content (content.pageCount); the frame adds the chrome. */
  Pages: (props: SectionPagesProps<K>) => ReactNode[];
};

/** The pages of any slot. */
export type AnySectionPages = { [K in ReportSlotKey]: SectionPages<K> }[ReportSlotKey];

/** Types a section's pages by its key: `export const orderSamplingPages = defineSectionPages({ key: "orderSampling", Pages })`. */
export function defineSectionPages<K extends ReportSlotKey>(pages: SectionPages<K>): SectionPages<K> {
  return pages;
}

/** Every built section's pages, one line each, in any order: the plan sets the order. */
export const SECTION_PAGES: readonly AnySectionPages[] = [
  // orderSampling, dimensions, measurements, forceAtBreak, holesVisual, packing, labellingConclusion, photos
  forceAtBreakPages,
];

/** The pages of a slot, if listed. */
export function sectionPages<K extends ReportSlotKey>(key: K): SectionPages<K> | undefined {
  return SECTION_PAGES.find((pages) => pages.key === key) as SectionPages<K> | undefined;
}

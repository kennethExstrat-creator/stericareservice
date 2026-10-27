// The report's sections after the Summary, each built from the export by a
// file of its own in this folder (docs/REPORT.md, "Adding a section"). A
// section's builder turns the export and its plan entry (its blocks switched
// on, its modules, its number and title) into its slot's content
// (ReportSections in ../model.ts), or null to print "coming next"; its pages
// are drawn by components/report/sections. To add a section: write
// lib/report/sections/<key>.ts exporting `defineSection({ key, build })`,
// widen its content type in ../model.ts, and add one line to the list
// below. The keys are the report options' section keys, and "photos".
//
// Builders import from ../read, ../format, ../geometry and ../checks, and
// only types from ../model, which imports this list.
import type { InspectionExport } from "@/lib/schemas/export";
import type { ReportPlanEntryFor, ReportSections, ReportSlotKey } from "../model";
import { forceAtBreak } from "./forceAtBreak";

export type SectionBuilder<K extends ReportSlotKey> = {
  key: K;
  /** The slot's content from the export, for its plan entry; null to print "coming next". */
  build: (doc: InspectionExport, entry: ReportPlanEntryFor<K>) => NonNullable<ReportSections[K]> | null;
};

/** A builder of any slot. */
export type AnySectionBuilder = { [K in ReportSlotKey]: SectionBuilder<K> }[ReportSlotKey];

/** Types a section's builder by its key: `export const orderSampling = defineSection({ key: "orderSampling", build })`. */
export function defineSection<K extends ReportSlotKey>(builder: SectionBuilder<K>): SectionBuilder<K> {
  return builder;
}

/**
 * Every built section's builder, one line each, in any order: the plan
 * prints them in the report's order (REPORT_SECTIONS, then the photos).
 */
export const SECTION_BUILDERS: readonly AnySectionBuilder[] = [
  // orderSampling, dimensions, measurements, forceAtBreak, holesVisual, packing, labellingConclusion, photos
  forceAtBreak,
];

/** The builder of a slot, if one is listed. */
export function sectionBuilder<K extends ReportSlotKey>(key: K): SectionBuilder<K> | undefined {
  return SECTION_BUILDERS.find((builder) => builder.key === key) as SectionBuilder<K> | undefined;
}

// The capture screen's Report page (Kenneth, 27 October 2026: "After
// conclusion page, give another page "Report", thats the page where report
// generation is done, inclusing customizing report"; BUILD_SPEC 10). Pure
// and client-safe: the page, the save action and the export read the same
// rules.
//
// - Options: saved with the inspection's data (`data.report`,
//   lib/schemas/report-options.ts) through the autosave, read with their
//   defaults (readReportOptions). They follow the report's design: the
//   Summary's blocks, a switch per section with a switch per block, the
//   photo records (Kenneth: "make the setting of report match the the report
//   design"). Options saved in the morning's first shape, a switch per
//   capture step, are read into this one. The save checks them when they
//   change (reportOptionsProblem), as it checks a module's entry.
// - Sections: a section none of whose modules the inspection includes (a
//   step switched off for the inspection is none) is left out of the report
//   and shown on the page as not in this inspection (reportSectionsAvailable).
// - Generate Report: the AI report hand-off (BUILD_SPEC 9.1), the action
//   the review screen's Send to Steri-AI Report runs, with its rules: an
//   admin, a submitted or approved inspection and a report service
//   (generateAvailability). The page offers it only then, beside Download
//   PDF, the app's own report (lib/report).
import type { z } from "zod";
import { contentHash } from "@/lib/offline/stable-json";
import {
  DEFAULT_REPORT_OPTIONS,
  DEFAULT_REPORT_TITLE,
  REPORT_PHOTO_GROUPS,
  REPORT_SECTIONS,
  REPORT_SUMMARY,
  ReportOptionsSchema,
  ReportPhotosPerGroupSchema,
  type ReportOptions,
  type ReportSectionKey,
} from "@/lib/schemas/report-options";
import type { InspectionData } from "@/modules/_framework";
import { REPORT_TITLE } from "./sections";

/* ------------------------------------------------------------------ *
 * The options, saved with the data
 * ------------------------------------------------------------------ */

/**
 * The report options saved with the inspection, each with its default
 * where none is saved: data from before the Report page, an option added
 * since, or one this build cannot read (the others are kept, switch by
 * switch). Options saved in the first shape are read into this one first
 * (withFirstShape).
 */
export function readReportOptions(data: Pick<InspectionData, "report">): ReportOptions {
  const stored = isRecord(data.report) ? withFirstShape(data.report) : {};
  const parsed = ReportOptionsSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  const read = ReportOptionsSchema.safeParse(readEach(stored));
  return read.success ? read.data : DEFAULT_REPORT_OPTIONS;
}

/** Each option on its own: one that cannot be read takes its default, the rest stay. */
function readEach(stored: Record<string, unknown>): Record<string, unknown> {
  const shape = ReportOptionsSchema.shape;
  const field = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  const sections = record(stored.sections);
  const photos = record(stored.photos);
  return {
    template: field(shape.template, stored.template, DEFAULT_REPORT_OPTIONS.template),
    pageSize: field(shape.pageSize, stored.pageSize, DEFAULT_REPORT_OPTIONS.pageSize),
    title: field(shape.title, stored.title, DEFAULT_REPORT_OPTIONS.title),
    showClient: switchOf(stored.showClient),
    footerNote: field(shape.footerNote, stored.footerNote, DEFAULT_REPORT_OPTIONS.footerNote),
    summary: switchesOf(REPORT_SUMMARY.blocks, stored.summary),
    sections: Object.fromEntries(
      REPORT_SECTIONS.map((section) => {
        const saved = record(sections[section.key]);
        return [section.key, { include: switchOf(saved.include), blocks: switchesOf(section.blocks, saved.blocks) }];
      }),
    ),
    photos: {
      groups: switchesOf(REPORT_PHOTO_GROUPS, photos.groups),
      perGroup: field(ReportPhotosPerGroupSchema, photos.perGroup, DEFAULT_REPORT_OPTIONS.photos.perGroup),
    },
  };
}

/** A switch as saved; anything else is on, its default. */
const switchOf = (value: unknown): boolean => (typeof value === "boolean" ? value : true);

function switchesOf(keys: readonly { key: string }[], saved: unknown): Record<string, boolean> {
  const values = record(saved);
  return Object.fromEntries(keys.map(({ key }) => [key, switchOf(values[key])]));
}

/* ------------------------------------------------------------------ *
 * The first shape (27 October 2026, morning): a switch per capture step
 * (`omittedSteps`), Include Photos with Photos per Step and Photo Size,
 * Show Client Name, Include Inspection Summary, Include Inspector Signature
 * ------------------------------------------------------------------ */

const FIRST_SHAPE_KEYS = [
  "omittedSteps",
  "includePhotos",
  "photosPerStep",
  "photoSize",
  "showClientName",
  "includeSummary",
  "includeSignature",
] as const;

/** What a block (or a section of none) drew on in the first shape: off once any of these steps, or all, were switched off. */
type FirstShapeSource = { readonly any?: readonly string[]; readonly all?: readonly string[] };

/** A section left out whole when any of these steps was switched off: one of them is the section's only step. */
const FIRST_SHAPE_SECTIONS: Partial<Record<ReportSectionKey, readonly string[]>> = {
  measurements: ["dimensions"],
  forceAtBreak: ["force_at_break", "tensile"],
  packing: ["dispensing_packing", "dispensing_safedon"],
};

/** Each block and the steps whose pages held what it shows. Defects Against Acceptance Limit shows both tests. */
const FIRST_SHAPE_BLOCKS: Partial<Record<ReportSectionKey, Readonly<Record<string, FirstShapeSource>>>> = {
  orderSampling: {
    gloveInformation: { any: ["order_lots"] },
    packingConfiguration: { any: ["order_lots"] },
    orderLotsSampling: { any: ["order_lots", "sampling_plan"] },
    finishedGoodsSampling: { any: ["carton_sampling"] },
  },
  dimensions: {
    gloveLength: { any: ["dimensions"] },
    palmWidth: { any: ["dimensions"] },
    medianResults: { any: ["dimensions"] },
    weightPerGlove: { any: ["weight"] },
  },
  holesVisual: {
    defectsAgainstLimit: { all: ["watertight", "visual"] },
    pinholesByLocation: { any: ["watertight"] },
    visualCritical: { any: ["visual"] },
    defectPhotos: { any: ["visual"] },
    visualMajorMinor: { any: ["visual"] },
  },
  labellingConclusion: { dispenserCartonBox: { any: ["labeling"] } },
};

/** Photos per step (2, 4 or 6, with each step) as photos per group, a group spanning several steps. */
const PER_GROUP_FROM_PER_STEP: Readonly<Record<number, number>> = { 2: 4, 4: 8, 6: 12 };

/**
 * Options saved in the first shape, read into this one: a step switched off
 * switches off the blocks its page held, and a section once none of its
 * blocks is left; Show Client Name is Show Client, Include Inspection
 * Summary the Summary's block, Include Inspector Signature the conclusion's
 * signature, Include Photos off every photo record, and Photos per Step
 * doubles into Photos per Group (the default 4 is the default 8). Photo Size
 * goes: the design's grids set it. What the new shape saves wins.
 */
export function withFirstShape(stored: Record<string, unknown>): Record<string, unknown> {
  if (!FIRST_SHAPE_KEYS.some((key) => key in stored)) return stored;
  const next: Record<string, unknown> = { ...stored };
  for (const key of FIRST_SHAPE_KEYS) delete next[key];
  if (!("showClient" in stored) && typeof stored.showClientName === "boolean") next.showClient = stored.showClientName;
  if (!("summary" in stored) && typeof stored.includeSummary === "boolean") next.summary = { inspectionSummary: stored.includeSummary };
  if (!("sections" in stored)) next.sections = firstShapeSections(stored);
  if (!("photos" in stored)) {
    next.photos = {
      groups: Object.fromEntries(REPORT_PHOTO_GROUPS.map((group) => [group.key, stored.includePhotos !== false])),
      perGroup: typeof stored.photosPerStep === "number" ? (PER_GROUP_FROM_PER_STEP[stored.photosPerStep] ?? stored.photosPerStep) : 8,
    };
  }
  return next;
}

function firstShapeSections(stored: Record<string, unknown>): Record<string, unknown> {
  const off = new Set(Array.isArray(stored.omittedSteps) ? stored.omittedSteps.filter((key) => typeof key === "string") : []);
  const drawsOn = ({ any = [], all = [] }: FirstShapeSource) =>
    any.some((key) => off.has(key)) || (all.length > 0 && all.every((key) => off.has(key)));
  return Object.fromEntries(
    REPORT_SECTIONS.map((section) => {
      const sources = FIRST_SHAPE_BLOCKS[section.key] ?? {};
      const blocks: Record<string, boolean> = Object.fromEntries(
        section.blocks.map(({ key }) => [key, !(sources[key] !== undefined && drawsOn(sources[key]))]),
      );
      if (section.key === "labellingConclusion" && stored.includeSignature === false) blocks.inspectorSignature = false;
      const wholeOff = (FIRST_SHAPE_SECTIONS[section.key] ?? []).some((key) => off.has(key));
      const noBlockLeft = section.blocks.length > 0 && Object.values(blocks).every((on) => !on);
      return [section.key, { include: !wholeOff && !noBlockLeft, blocks }];
    }),
  );
}

/** The inspection's data with these report options, whole: what the autosave sends. */
export function writeReportOptions(data: InspectionData, options: ReportOptions): InspectionData {
  return { ...data, report: options };
}

/**
 * Why the save refuses the report options it is sent, as the autosave pill
 * words a module's problem ("Report: Keep the footer note to 300
 * characters."); null when they are as stored, or read. Options left as
 * stored pass untouched, so options saved by another build never stop a
 * save, as a module's old data does not.
 */
export function reportOptionsProblem(previous: InspectionData, next: InspectionData): string | null {
  if (next.report === undefined) return null;
  if (previous.report !== undefined && contentHash(previous.report) === contentHash(next.report)) return null;
  const parsed = ReportOptionsSchema.safeParse(next.report);
  if (parsed.success) return null;
  return `${REPORT_TITLE}: ${parsed.error.issues[0]?.message ?? "the options could not be read."}`;
}

/** The report's title: as typed, trimmed; blank, the default title. */
export function reportTitle(options: Pick<ReportOptions, "title">): string {
  return options.title.trim() || DEFAULT_REPORT_TITLE;
}

/** The footer note, trimmed; null while blank. */
export function reportFooterNote(options: Pick<ReportOptions, "footerNote">): string | null {
  return options.footerNote.trim() || null;
}

/* ------------------------------------------------------------------ *
 * Sections the inspection can show
 * ------------------------------------------------------------------ */

/** Beside a section the inspection cannot show, on the Report page. */
export const NOT_IN_INSPECTION = "Not in this inspection";

/**
 * Which sections the inspection can show: those one of whose modules it
 * includes. A module switched off for the inspection is not included, so a
 * section of switched-off steps is shown as not in this inspection and left
 * out of the report.
 */
export function reportSectionsAvailable(moduleKeys: Iterable<string>): Record<ReportSectionKey, boolean> {
  const included = new Set(moduleKeys);
  return Object.fromEntries(
    REPORT_SECTIONS.map((section) => [section.key, section.modules.some((key) => included.has(key))]),
  ) as Record<ReportSectionKey, boolean>;
}

/* ------------------------------------------------------------------ *
 * Generate Report and the last report
 * ------------------------------------------------------------------ */

/** Why Generate Report may not run, for the screens that say so. */
export const GENERATE_REASONS = {
  notYet: "Available to admins once the inspection is submitted.",
  notSetUp: "The report service is not set up yet.",
} as const;

export type GenerateAvailability = { allowed: true } | { allowed: false; reason: string };

/**
 * Generate Report's rules, the AI report's (BUILD_SPEC 9.1), which
 * sendInspectionToAiReport checks again on the server: an admin, a submitted
 * or approved inspection (`reportable`, AI_STATUSES), and a report service
 * (AI_REPORT_WEBHOOK_URL, `connected`).
 */
export function generateAvailability({
  isAdmin,
  reportable,
  connected,
}: {
  isAdmin: boolean;
  reportable: boolean;
  connected: boolean;
}): GenerateAvailability {
  if (!isAdmin || !reportable) return { allowed: false, reason: GENERATE_REASONS.notYet };
  if (!connected) return { allowed: false, reason: GENERATE_REASONS.notSetUp };
  return { allowed: true };
}

/**
 * The report last made for the inspection: its link (inspections.report_url)
 * and, where the audit log records it (`ai_report.sent` with that link),
 * when it was made: `label` in Malaysia time, as the AI panel writes times.
 */
export type LastReport = { url: string; madeAt: { iso: string; label: string } | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

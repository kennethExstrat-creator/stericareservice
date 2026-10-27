// The capture screen's Report page (Kenneth, 27 October 2026: "After
// conclusion page, give another page "Report", thats the page where report
// generation is done, inclusing customizing report"; BUILD_SPEC 10). Pure
// and client-safe: the page, the save action and the export read the same
// rules.
//
// - Options: saved with the inspection's data (`data.report`,
//   lib/schemas/report-options.ts) through the autosave, read with their
//   defaults (readReportOptions). The save checks them when they change
//   (reportOptionsProblem), as it checks a module's entry.
// - Sections: one switch per step the inspection includes, in step order
//   (reportSteps: Source Documents and the included pages, as the sidebar
//   lists its steps), named by the step's short name. A step switched off
//   for the inspection is no step, so it is not offered. A step switched off
//   here leaves out every section on its page (the order's page: the order,
//   Glove Information and packing configuration); the export lists them by
//   key (omittedSectionKeys, from evaluatedReportSteps).
// - Generate Report: the AI report hand-off (BUILD_SPEC 9.1), the action
//   the review screen's Send to Steri-AI Report runs, with its rules: an
//   admin, a submitted or approved inspection and a report service
//   (generateAvailability). Otherwise the button waits, saying why.
import { SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import { contentHash } from "@/lib/offline/stable-json";
import {
  DEFAULT_REPORT_OPTIONS,
  DEFAULT_REPORT_TITLE,
  ReportOptionsSchema,
  type ReportOptions,
} from "@/lib/schemas/report-options";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import type { ValidationReport } from "@/lib/validation";
import type { InspectionData } from "@/modules/_framework";
import {
  capturePages,
  captureSections,
  isStepPage,
  leadPagesFirst,
  pageSectionKeys,
  REPORT_TITLE,
  withSourceDocuments,
  type CapturePage,
} from "./sections";

/* ------------------------------------------------------------------ *
 * The options, saved with the data
 * ------------------------------------------------------------------ */

/**
 * The report options saved with the inspection, each with its default
 * where none is saved: data from before the Report page, an option added
 * since, or one this build cannot read (the others are kept).
 */
export function readReportOptions(data: Pick<InspectionData, "report">): ReportOptions {
  const stored = isRecord(data.report) ? data.report : {};
  const parsed = ReportOptionsSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  const shape = ReportOptionsSchema.shape;
  const read = Object.fromEntries(
    (Object.keys(shape) as (keyof typeof shape)[]).map((key) => {
      const field = shape[key].safeParse(stored[key]);
      return [key, field.success ? field.data : DEFAULT_REPORT_OPTIONS[key]];
    }),
  );
  const whole = ReportOptionsSchema.safeParse(read);
  return whole.success ? whole.data : DEFAULT_REPORT_OPTIONS;
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
 * Sections: the steps
 * ------------------------------------------------------------------ */

/** A step the report shows or leaves out: a page the progress steps stand for. */
export type ReportStep = {
  key: string;
  /** In the template's wording, as its card heading: on hover. */
  title: string;
  /** Its name on the Report page and in the preview (docs/DESIGN.md, Step Names). */
  shortTitle: string;
  /** The sections on its page, in screen order: what the report leaves out with it. */
  sectionKeys: readonly string[];
};

/** The steps of these pages, in screen order: Source Documents and the included pages. Switched-off pages are none. */
export function reportSteps(pages: readonly CapturePage[]): ReportStep[] {
  return pages.filter(isStepPage).map((page) => ({
    key: page.key,
    title: page.title,
    shortTitle: page.shortTitle,
    sectionKeys: pageSectionKeys(page),
  }));
}

/**
 * The steps as the capture screen lists them, from an evaluation alone (the
 * export's, overrides applied): Source Documents first, General Information
 * on its page, then the lead pages and the others. Their results and
 * progress play no part.
 */
export function evaluatedReportSteps(evaluation: {
  template: ResolvedTemplate;
  report: Pick<ValidationReport, "modules" | "custom" | "issues">;
  data: InspectionData;
}): ReportStep[] {
  const files = {
    key: SOURCE_DOCUMENTS_KEY,
    title: SOURCE_DOCUMENTS_TITLE,
    shortTitle: SOURCE_DOCUMENTS_TITLE,
    status: "not_done",
    progress: "not_started",
  } as const;
  const sections = captureSections(evaluation.template, evaluation.report, evaluation.data);
  return reportSteps(withSourceDocuments(files, leadPagesFirst(capturePages(sections))));
}

/** The step goes in the report: it is not switched off on the Report page. */
export function stepInReport(options: Pick<ReportOptions, "omittedSteps">, key: string): boolean {
  return !options.omittedSteps.includes(key);
}

/** The options with one step switched on or off. */
export function withStepInReport(options: ReportOptions, key: string, on: boolean): ReportOptions {
  const others = options.omittedSteps.filter((entry) => entry !== key);
  return { ...options, omittedSteps: on ? others : [...others, key] };
}

/** The sections the report leaves out: every one on the page of a step switched off, in step order. */
export function omittedSectionKeys(options: Pick<ReportOptions, "omittedSteps">, steps: readonly ReportStep[]): string[] {
  return steps.filter((step) => !stepInReport(options, step.key)).flatMap((step) => [...step.sectionKeys]);
}

/* ------------------------------------------------------------------ *
 * Generate Report and the last report
 * ------------------------------------------------------------------ */

/** Why Generate Report waits, under the button. */
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

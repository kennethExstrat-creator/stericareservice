// The capture screen's section list (BUILD_SPEC 8 and 10): every module the
// inspection includes, in template order, each custom module right after the
// module it follows, and the modules an admin switched off for this
// inspection, in their place but marked off. Modules the template itself
// leaves out are not listed at all. Each section carries its result for the
// chip and the pill, as the review shows it (the conclusion's HOLD reads On
// hold, not Warning), its progress for the tracker and its issue counts.
import type { Status } from "@/lib/design/status";
import { shownStatus } from "@/lib/inspections/review/results";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ModuleOverride, ResolvedTemplate } from "@/lib/schemas/template";
import type { ValidationReport } from "@/lib/validation";
import { readModuleEntry, type InspectionData } from "@/modules/_framework";

/** ProgressTracker's step states (components/qc/progress-tracker.tsx). */
export type SectionProgress = "done" | "in_progress" | "not_started";

/** A ProgressTracker step with the section's result. */
export type SectionStep = { key: string; label: string; state: SectionProgress; result: Status };

type Counts = { errors: number; warnings: number };

export type CaptureSection =
  | ({
      kind: "module";
      key: ModuleKey;
      title: string;
      /**
       * The result as shown: the module's status, except the conclusion's
       * HOLD, which its status records as warn (shownStatus). The
       * suggestion and submit read the module's own status.
       */
      status: Status;
      summary: string;
      progress: SectionProgress;
      /** A placeholder module from the framework: "Not built yet". */
      stub: boolean;
    } & Counts)
  | ({
      kind: "custom";
      key: string;
      title: string;
      status: Status;
      summary: string;
      progress: SectionProgress;
      custom: CustomModule;
    } & Counts)
  | {
      kind: "excluded";
      key: ModuleKey;
      title: string;
      override: ModuleOverride;
    };

export type IncludedSection = Extract<CaptureSection, { kind: "module" | "custom" }>;

/**
 * @param template the inspection's copy of the template (overrides applied)
 * @param report the validation report for the same template and data
 */
export function captureSections(
  template: ResolvedTemplate,
  report: Pick<ValidationReport, "modules" | "custom" | "issues">,
  data: InspectionData,
): CaptureSection[] {
  const counts = countIssues(report.issues);
  const customAfter = new Map<string, CustomModule[]>();
  for (const custom of template.customModules) {
    customAfter.set(custom.after, [...(customAfter.get(custom.after) ?? []), custom]);
  }

  const sections: CaptureSection[] = [];
  const addCustom = (custom: CustomModule) => sections.push(customSection(custom, report, data, counts));
  for (const entry of template.modules) {
    if (entry.include) {
      const evaluation = report.modules.find((candidate) => candidate.key === entry.key);
      const status = evaluation ? shownStatus(evaluation) : "not_done";
      const hasData = evaluation?.hasData ?? false;
      sections.push({
        kind: "module",
        key: entry.key,
        title: entry.title,
        status,
        summary: evaluation?.result.summary ?? "",
        progress: progressOf(status, hasData),
        stub: evaluation?.stub ?? false,
        ...(counts.get(entry.key) ?? NO_ISSUES),
      });
    } else if (entry.override) {
      sections.push({ kind: "excluded", key: entry.key, title: entry.title, override: entry.override });
    }
    for (const custom of customAfter.get(entry.key) ?? []) addCustom(custom);
    customAfter.delete(entry.key);
  }
  // A custom module whose module is missing from the template goes last (lib/templates sections).
  for (const orphans of customAfter.values()) orphans.forEach(addCustom);
  return sections;
}

export function isIncluded(section: CaptureSection): section is IncludedSection {
  return section.kind !== "excluded";
}

export function findSection(sections: readonly CaptureSection[], key: string | null): CaptureSection | undefined {
  return key === null ? undefined : sections.find((section) => section.key === key);
}

/** The section to open: the one asked for when it exists, else the first included one. */
export function initialSectionKey(sections: readonly CaptureSection[], requested: string | null): string | null {
  return findSection(sections, requested)?.key ?? sections.find(isIncluded)?.key ?? sections[0]?.key ?? null;
}

/**
 * The included sections before and after `key` in screen order, for the
 * Previous and Next buttons. Switched-off sections are stepped over; from
 * one of them, the buttons go to the included sections around it.
 */
export function neighbours(
  sections: readonly CaptureSection[],
  key: string,
): { previous: IncludedSection | null; next: IncludedSection | null } {
  const index = sections.findIndex((section) => section.key === key);
  if (index === -1) return { previous: null, next: sections.find(isIncluded) ?? null };
  let previous: IncludedSection | null = null;
  for (let before = index - 1; before >= 0 && previous === null; before -= 1) {
    const section = sections[before];
    if (isIncluded(section)) previous = section;
  }
  const next = sections.slice(index + 1).find(isIncluded) ?? null;
  return { previous, next };
}

/** The included sections as ProgressTracker steps, each with its result. */
export function progressSteps(sections: readonly CaptureSection[]): SectionStep[] {
  return sections.filter(isIncluded).map((section) => ({
    key: section.key,
    label: section.title,
    state: section.progress,
    result: section.status,
  }));
}

export function progressSummary(sections: readonly CaptureSection[]): { done: number; total: number } {
  const included = sections.filter(isIncluded);
  return { done: included.filter((section) => section.progress === "done").length, total: included.length };
}

/** Done once it has a result, on hold too; in progress while something is entered; not started otherwise. */
export function progressOf(status: Status, hasData: boolean): SectionProgress {
  if (status !== "not_done") return "done";
  return hasData ? "in_progress" : "not_started";
}

const NO_ISSUES: Counts = { errors: 0, warnings: 0 };

function countIssues(issues: ValidationReport["issues"]): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  for (const issue of issues) {
    const current = counts.get(issue.moduleKey) ?? { errors: 0, warnings: 0 };
    if (issue.level === "error") current.errors += 1;
    else current.warnings += 1;
    counts.set(issue.moduleKey, current);
  }
  return counts;
}

/**
 * Custom modules have no result of their own (BUILD_SPEC 4.3): "Info" once
 * something is entered and nothing is wrong, "Not done" until then, so an
 * empty or incomplete one never looks finished.
 */
function customSection(
  custom: CustomModule,
  report: Pick<ValidationReport, "custom">,
  data: InspectionData,
  counts: Map<string, Counts>,
): CaptureSection {
  const own = counts.get(custom.key) ?? NO_ISSUES;
  const hasData = readModuleEntry(data, "custom", custom.key).hasData || hasMappedValues(custom, report);
  const status: Status = hasData && own.errors === 0 ? "info" : "not_done";
  return {
    kind: "custom",
    key: custom.key,
    title: custom.title,
    status,
    summary: "",
    progress: progressOf(status, hasData),
    custom,
    ...own,
  };
}

/** A fields layout whose fields map to modules shows their values: those count as entered. */
function hasMappedValues(custom: CustomModule, report: Pick<ValidationReport, "custom">): boolean {
  const evaluation = report.custom.find((entry) => entry.custom.key === custom.key);
  if (!evaluation) return false;
  return custom.fields.some(
    (field) =>
      field.mapsTo !== undefined &&
      evaluation.values[field.key] !== null &&
      evaluation.values[field.key] !== undefined &&
      evaluation.values[field.key] !== "",
  );
}

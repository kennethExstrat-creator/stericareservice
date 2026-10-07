// The capture screen's sections and pages (BUILD_SPEC 8 and 10). Sections:
// every module the inspection includes, in screen order, each custom module
// right after the module it follows, and the modules an admin switched off
// for this inspection, in their place but marked off. Modules the template
// itself leaves out are not listed at all. Each section carries its result
// for the chip and the pill, as the review shows it (the conclusion's HOLD
// reads On Hold, not Warning), its progress for the tracker and its issue
// counts.
//
// Pages (capturePages): what a tab, a sidebar row, a progress step and
// Previous or Next open. One section each, except a module shown on another
// module's page (SHOWN_WITH): packing configuration sits right below the
// order. Each module keeps its own frame, result, comment, photos and
// Pending row; the page takes its host's title, the worst of their results
// and their progress together. Screen order is template order with a guest
// moved up to its host; the review and the export keep template order.
import type { Status } from "@/lib/design/status";
import { shownStatus } from "@/lib/inspections/review/results";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ModuleOverride, ResolvedModule, ResolvedTemplate } from "@/lib/schemas/template";
import { STATUS_SEVERITY, type ValidationReport } from "@/lib/validation";
import { readModuleEntry, type InspectionData } from "@/modules/_framework";

/**
 * Modules shown on another module's page, guest to host: the guest's frame
 * sits right below the host's, on the host's tab, wherever the template
 * lists the guest. Layout only: the data, the results, the review and the
 * export keep every module apart. Kenneth (8 October 2026): "packing
 * configuration should go with order, if not how the total # glove be
 * calculated if the relied input is in the next page"; the printed report
 * has the packing block right below the order table
 * (docs/forms/reports/STD_EG.md). Only while both are included, overrides
 * applied: either alone has a page of its own. A guest with a sticky size
 * bar of its own would stick over the host's frame too: check the sticky
 * offsets (use-sticky-offsets.ts) before adding one.
 */
export const SHOWN_WITH: Readonly<Partial<Record<ModuleKey, ModuleKey>>> = { packing_config: "order_lots" };

/** ProgressTracker's step states (components/qc/progress-tracker.tsx). */
export type SectionProgress = "done" | "in_progress" | "not_started";

/** A ProgressTracker step with the page's result. */
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
      /** Shown on this module's page, right below it (SHOWN_WITH). */
      shownWith?: ModuleKey;
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
export type ExcludedSection = Extract<CaptureSection, { kind: "excluded" }>;

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
  // Each host's guests, in template order, while both are included.
  const included = new Set(template.modules.filter((entry) => entry.include).map((entry) => entry.key));
  const guestsOf = new Map<ModuleKey, ResolvedModule[]>();
  for (const entry of template.modules) {
    const host = SHOWN_WITH[entry.key];
    if (entry.include && host !== undefined && included.has(host)) guestsOf.set(host, [...(guestsOf.get(host) ?? []), entry]);
  }
  const guests = new Set([...guestsOf.values()].flat().map((entry) => entry.key));

  const sections: CaptureSection[] = [];
  const addCustomAfter = (key: string) => {
    for (const custom of customAfter.get(key) ?? []) sections.push(customSection(custom, report, data, counts));
    customAfter.delete(key);
  };
  for (const entry of template.modules) {
    // On its host's page, the custom modules after it with it.
    if (guests.has(entry.key)) continue;
    if (entry.include) {
      sections.push(moduleSection(entry, report, counts));
      const own = guestsOf.get(entry.key) ?? [];
      for (const guest of own) sections.push(moduleSection(guest, report, counts, entry.key));
      addCustomAfter(entry.key);
      for (const guest of own) addCustomAfter(guest.key);
    } else {
      if (entry.override) sections.push({ kind: "excluded", key: entry.key, title: entry.title, override: entry.override });
      addCustomAfter(entry.key);
    }
  }
  // A custom module whose module is missing from the template goes last (lib/templates sections).
  for (const orphans of customAfter.values()) {
    for (const custom of orphans) sections.push(customSection(custom, report, data, counts));
  }
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

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

/**
 * What a tab, a sidebar row, a progress step and Previous or Next open: one
 * section, or a module with the modules shown on its page (SHOWN_WITH),
 * keyed and named by the first. Its result is the worst of its sections'
 * (pageStatus) and its progress theirs together (pageProgress). A module
 * switched off is a page of its own, wherever its host is.
 */
export type CapturePage =
  | {
      kind: "included";
      key: string;
      title: string;
      sections: readonly IncludedSection[];
      status: Status;
      progress: SectionProgress;
    }
  | { kind: "excluded"; key: ModuleKey; title: string; section: ExcludedSection };

export type IncludedPage = Extract<CapturePage, { kind: "included" }>;

/** The sections in pages, in screen order: a guest joins its host's page (captureSections puts it right after). */
export function capturePages(sections: readonly CaptureSection[]): CapturePage[] {
  const groups: ({ excluded: ExcludedSection } | { included: IncludedSection[] })[] = [];
  const byHost = new Map<string, IncludedSection[]>();
  for (const section of sections) {
    if (section.kind === "excluded") {
      groups.push({ excluded: section });
      continue;
    }
    const host = section.kind === "module" && section.shownWith !== undefined ? byHost.get(section.shownWith) : undefined;
    if (host) {
      host.push(section);
      continue;
    }
    const own = [section];
    byHost.set(section.key, own);
    groups.push({ included: own });
  }
  return groups.map((group): CapturePage => {
    if ("excluded" in group) {
      const { excluded } = group;
      return { kind: "excluded", key: excluded.key, title: excluded.title, section: excluded };
    }
    const [first] = group.included;
    return {
      kind: "included",
      key: first.key,
      title: first.title,
      sections: group.included,
      status: pageStatus(group.included),
      progress: pageProgress(group.included),
    };
  });
}

export function isIncludedPage(page: CapturePage): page is IncludedPage {
  return page.kind === "included";
}

/** The page with this key, else the page a section with this key is on (?module=packing_config opens the order's). */
export function findPage(pages: readonly CapturePage[], key: string | null): CapturePage | undefined {
  if (key === null) return undefined;
  return pages.find((page) => page.key === key) ?? pages.find((page) => pageSectionKeys(page).includes(key));
}

/** The keys of the sections on a page, in screen order: the page's own key first. */
export function pageSectionKeys(page: CapturePage): string[] {
  return page.kind === "included" ? page.sections.map((section) => section.key) : [page.key];
}

/** Worst first, as module results combine (lib/validation STATUS_SEVERITY), with On Hold between a warning and not done. */
function pageSeverity(status: Status): number {
  return status === "hold" ? (STATUS_SEVERITY.warn + STATUS_SEVERITY.not_done) / 2 : STATUS_SEVERITY[status];
}

/** A page's result for its tab, its sidebar row and its step: the worst of its sections'. */
export function pageStatus(sections: readonly IncludedSection[]): Status {
  let worst: Status = sections[0]?.status ?? "not_done";
  for (const section of sections) if (pageSeverity(section.status) > pageSeverity(worst)) worst = section.status;
  return worst;
}

/**
 * Done once every section on the page is, not started while none is
 * started, in progress otherwise: an order filled in beside a packing
 * configuration not started yet is in progress, never done.
 */
export function pageProgress(sections: readonly IncludedSection[]): SectionProgress {
  if (sections.every((section) => section.progress === "done")) return "done";
  if (sections.every((section) => section.progress === "not_started")) return "not_started";
  return "in_progress";
}

/**
 * The included pages before and after the page holding `key`, in screen
 * order, for the Previous and Next buttons. Switched-off pages are stepped
 * over; from one of them, the buttons go to the included pages around it.
 */
export function neighbours(
  pages: readonly CapturePage[],
  key: string,
): { previous: IncludedPage | null; next: IncludedPage | null } {
  const index = pages.findIndex((page) => pageSectionKeys(page).includes(key));
  if (index === -1) return { previous: null, next: pages.find(isIncludedPage) ?? null };
  let previous: IncludedPage | null = null;
  for (let before = index - 1; before >= 0 && previous === null; before -= 1) {
    const page = pages[before];
    if (isIncludedPage(page)) previous = page;
  }
  const next = pages.slice(index + 1).find(isIncludedPage) ?? null;
  return { previous, next };
}

/** The included pages as ProgressTracker steps, each with its result. */
export function progressSteps(pages: readonly CapturePage[]): SectionStep[] {
  return pages.filter(isIncludedPage).map((page) => ({
    key: page.key,
    label: page.title,
    state: page.progress,
    result: page.status,
  }));
}

export function progressSummary(pages: readonly CapturePage[]): { done: number; total: number } {
  const included = pages.filter(isIncludedPage);
  return { done: included.filter((page) => page.progress === "done").length, total: included.length };
}

/** Done once it has a result, on hold too; in progress while something is entered; not started otherwise. */
export function progressOf(status: Status, hasData: boolean): SectionProgress {
  if (status !== "not_done") return "done";
  return hasData ? "in_progress" : "not_started";
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

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

/** An included module with its result as shown; `shownWith` its host, for a guest on another module's page. */
function moduleSection(
  entry: ResolvedModule,
  report: Pick<ValidationReport, "modules">,
  counts: Map<string, Counts>,
  shownWith?: ModuleKey,
): CaptureSection {
  const evaluation = report.modules.find((candidate) => candidate.key === entry.key);
  const status = evaluation ? shownStatus(evaluation) : "not_done";
  return {
    kind: "module",
    key: entry.key,
    title: entry.title,
    status,
    summary: evaluation?.result.summary ?? "",
    progress: progressOf(status, evaluation?.hasData ?? false),
    stub: evaluation?.stub ?? false,
    ...(shownWith === undefined ? {} : { shownWith }),
    ...(counts.get(entry.key) ?? NO_ISSUES),
  };
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

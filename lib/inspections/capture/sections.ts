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
// module's page (SHOWN_WITH): Glove Information and packing configuration
// sit under the order, side by side (SIDE_BY_SIDE; Kenneth, 26 October 2026).
// Each module keeps its own frame, result, comment, photos and
// Pending row; the page takes its host's title, the worst of their results
// and their progress together. Screen order is template order with a guest
// moved up to its host, the lead pages first (LEAD_PAGE_KEYS); the review
// and the export keep template order. General Information (the header) has
// no page of its own: it sits beside the files on Source Documents' page
// (withSourceDocuments; Kenneth, 26 October 2026).
//
// Names: every section and page carries its title, the template's wording
// (with a count filled in, shownTitle), for its card heading, and its short
// name (lib/templates/short-titles.ts), for the tabs, the sidebar, the
// progress bar, Previous / Next, Pending and the messages that name it
// (docs/DESIGN.md, Step Names). The header is General Information in both
// (lib/design/screen-names.ts).
import { screenShortTitle, screenTitle } from "@/lib/design/screen-names";
import type { Status } from "@/lib/design/status";
import { shownStatus } from "@/lib/inspections/review/results";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ModuleOverride, ResolvedModule, ResolvedTemplate } from "@/lib/schemas/template";
import { customShortTitle } from "@/lib/templates/short-titles";
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
 * (docs/forms/reports/STD_EG.md). Glove Information too (Kenneth, 26
 * October 2026: "move the glove information to order page ... remove the
 * whole glove information page"): one glove per inspection, beside the
 * packing (SIDE_BY_SIDE). Only while both are included, overrides applied:
 * either alone has a page of its own. A guest with a sticky size bar of its
 * own would stick over the host's frame too: check the sticky offsets
 * (use-sticky-offsets.ts) before adding one.
 */
export const SHOWN_WITH: Readonly<Partial<Record<ModuleKey, ModuleKey>>> = {
  glove_info: "order_lots",
  packing_config: "order_lots",
};

/**
 * Two modules shown side by side on their host's page, under the host's
 * frame (Kenneth, 26 October 2026: "to the left side of packing configuration
 * card, glove info take 35% width while packing config get 65% width"):
 * `left` then `right`, each with the custom modules shown with it. While the
 * page has only one of them, it has the width (sideBySideSections).
 */
export const SIDE_BY_SIDE = { left: "glove_info", right: "packing_config" } as const satisfies Record<string, ModuleKey>;

/**
 * Custom modules shown on a module's page, never a page of their own, on
 * the first of these the template includes (Kenneth, 11 October 2026: Glove
 * Type is not a page of its own); `first` puts it before the module. Glove
 * Type leads Glove Information, as Glove Information's own Glove Type does
 * since STD_EG version 3 (Kenneth, 12 October 2026): on the order's page, in
 * its column, since Glove Information sits there (SHOWN_WITH); on a template
 * without it (STD_SG), it follows the header: the onsite forms write it under
 * Purchase Order / Shipment Information.
 */
export const CUSTOM_SHOWN_WITH: Readonly<Record<string, readonly { host: ModuleKey; first?: true }[]>> = {
  glove_type: [{ host: "glove_info", first: true }, { host: "header" }],
};

/** ProgressTracker's step states (components/qc/progress-tracker.tsx). */
export type SectionProgress = "done" | "in_progress" | "not_started";

/** A ProgressTracker step with the page's result: `label` its short name, `title` its full title (shown on hover). */
export type SectionStep = { key: string; label: string; title: string; state: SectionProgress; result: Status };

type Counts = { errors: number; warnings: number };

export type CaptureSection =
  | ({
      kind: "module";
      key: ModuleKey;
      /** In the template's wording: the section's card heading. */
      title: string;
      /** Its name in the menus, Pending and messages (lib/templates/short-titles.ts). */
      shortTitle: string;
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
      shortTitle: string;
      status: Status;
      summary: string;
      progress: SectionProgress;
      custom: CustomModule;
      /** Shown on this module's page, right below it (CUSTOM_SHOWN_WITH). */
      shownWith?: ModuleKey;
      /**
       * The module it is shown with when that module is itself a guest on
       * `shownWith`'s page: Glove Type with Glove Information, in its column
       * there (SIDE_BY_SIDE).
       */
      beside?: ModuleKey;
    } & Counts)
  | {
      kind: "excluded";
      key: ModuleKey;
      title: string;
      shortTitle: string;
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
  const included = new Set(template.modules.filter((entry) => entry.include).map((entry) => entry.key));
  // The page a module is on: its host's, while it is a guest there (SHOWN_WITH), else its own.
  const pageOf = (key: ModuleKey): ModuleKey => {
    const host = SHOWN_WITH[key];
    return host !== undefined && included.has(key) && included.has(host) ? host : key;
  };
  // A custom module on a module's page (CUSTOM_SHOWN_WITH) leads or follows that module, on that module's page (a
  // guest's: its host's, beside the guest); the rest follow their `after`.
  const hostOf = new Map<string, ModuleKey>();
  const besideOf = new Map<string, ModuleKey>();
  const customBefore = new Map<string, CustomModule[]>();
  const customAfter = new Map<string, CustomModule[]>();
  for (const custom of template.customModules) {
    const place = CUSTOM_SHOWN_WITH[custom.key]?.find((entry) => included.has(entry.host));
    if (place) {
      hostOf.set(custom.key, pageOf(place.host));
      if (pageOf(place.host) !== place.host) besideOf.set(custom.key, place.host);
    }
    const into = place?.first ? customBefore : customAfter;
    const key = place?.host ?? custom.after;
    into.set(key, [...(into.get(key) ?? []), custom]);
  }
  // Each host's guests, in template order, while both are included.
  const guestsOf = new Map<ModuleKey, ResolvedModule[]>();
  for (const entry of template.modules) {
    const host = SHOWN_WITH[entry.key];
    if (entry.include && host !== undefined && included.has(host)) guestsOf.set(host, [...(guestsOf.get(host) ?? []), entry]);
  }
  const guests = new Set([...guestsOf.values()].flat().map((entry) => entry.key));

  const sections: CaptureSection[] = [];
  const placed = (custom: CustomModule) => customSection(custom, report, data, counts, hostOf.get(custom.key), besideOf.get(custom.key));
  const addCustomAfter = (key: string) => {
    for (const custom of customAfter.get(key) ?? []) sections.push(placed(custom));
    customAfter.delete(key);
  };
  for (const entry of template.modules) {
    // On its host's page, the custom modules after it with it.
    if (guests.has(entry.key)) continue;
    if (entry.include) {
      for (const custom of customBefore.get(entry.key) ?? []) sections.push(placed(custom));
      customBefore.delete(entry.key);
      sections.push(moduleSection(entry, report, counts));
      const own = guestsOf.get(entry.key) ?? [];
      for (const guest of own) {
        // A custom module that leads the guest leads it on the host's page too.
        for (const custom of customBefore.get(guest.key) ?? []) sections.push(placed(custom));
        customBefore.delete(guest.key);
        sections.push(moduleSection(guest, report, counts, entry.key));
      }
      addCustomAfter(entry.key);
      for (const guest of own) addCustomAfter(guest.key);
    } else {
      if (entry.override) {
        sections.push({
          kind: "excluded",
          key: entry.key,
          title: screenTitle(entry.key, entry.title),
          shortTitle: screenShortTitle(entry.key, entry.title),
          override: entry.override,
        });
      }
      addCustomAfter(entry.key);
    }
  }
  // A custom module whose module is missing from the template goes last (lib/templates sections).
  for (const orphans of [...customBefore.values(), ...customAfter.values()]) {
    for (const custom of orphans) sections.push(customSection(custom, report, data, counts));
  }
  return sections;
}

export function isIncluded(section: CaptureSection): section is IncludedSection {
  return section.kind !== "excluded";
}

/**
 * A page's sections around its side-by-side row (SIDE_BY_SIDE): those above
 * it, in screen order, and each column's, a custom module going with the
 * module it is shown beside. Null while the page has neither module.
 */
export function sideBySideSections<T extends IncludedSection>(
  sections: readonly T[],
): { above: T[]; left: T[]; right: T[] } | null {
  const columnOf = (section: T): string => (section.kind === "custom" ? (section.beside ?? "") : section.key);
  const left = sections.filter((section) => columnOf(section) === SIDE_BY_SIDE.left);
  const right = sections.filter((section) => columnOf(section) === SIDE_BY_SIDE.right);
  if (left.length === 0 && right.length === 0) return null;
  return { above: sections.filter((section) => !left.includes(section) && !right.includes(section)), left, right };
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
 * keyed and named by the first (its title and its short name). Its result is
 * the worst of its sections' (pageStatus) and its progress theirs together
 * (pageProgress). A module switched off is a page of its own, wherever its
 * host is.
 */
export type CapturePage =
  | {
      kind: "included";
      key: string;
      title: string;
      shortTitle: string;
      sections: readonly IncludedSection[];
      status: Status;
      progress: SectionProgress;
    }
  | { kind: "excluded"; key: ModuleKey; title: string; shortTitle: string; section: ExcludedSection }
  /**
   * Source Documents, before every module: the files the inspection starts
   * from, which the AI reads to fill the pages after it (docs/AI.md), with
   * General Information beside them (`sections`: the header and any module
   * shown on its page; withSourceDocuments). Its result is the worst of the
   * files' ("pass" once every file is AI Verified) and those sections', its
   * progress theirs together.
   */
  | {
      kind: "documents";
      key: string;
      title: string;
      shortTitle: string;
      sections: readonly IncludedSection[];
      status: Status;
      progress: SectionProgress;
    };

export type IncludedPage = Extract<CapturePage, { kind: "included" }>;
export type DocumentsPage = Extract<CapturePage, { kind: "documents" }>;
/** A page the steps, the tabs and Previous / Next go to: every page but a switched-off one. */
export type StepPage = IncludedPage | DocumentsPage;

export function isStepPage(page: CapturePage): page is StepPage {
  return page.kind !== "excluded";
}

/**
 * The sections in pages, in screen order: a guest joins its host's page
 * (captureSections puts it right after, or right before when it leads), and
 * the page takes the host's key, title and short name.
 */
export function capturePages(sections: readonly CaptureSection[]): CapturePage[] {
  const groups: ({ excluded: ExcludedSection } | { included: IncludedSection[] })[] = [];
  const byHost = new Map<string, IncludedSection[]>();
  // Guests that lead their host's page, until the host comes.
  const leading = new Map<string, IncludedSection[]>();
  for (const section of sections) {
    if (section.kind === "excluded") {
      groups.push({ excluded: section });
      continue;
    }
    if (section.shownWith !== undefined) {
      const host = byHost.get(section.shownWith);
      if (host) host.push(section);
      else leading.set(section.shownWith, [...(leading.get(section.shownWith) ?? []), section]);
      continue;
    }
    const own = [...(leading.get(section.key) ?? []), section];
    leading.delete(section.key);
    byHost.set(section.key, own);
    groups.push({ included: own });
  }
  for (const left of leading.values()) for (const section of left) groups.push({ included: [section] });
  return groups.map((group): CapturePage => {
    if ("excluded" in group) {
      const { excluded } = group;
      return { kind: "excluded", key: excluded.key, title: excluded.title, shortTitle: excluded.shortTitle, section: excluded };
    }
    const own = group.included.find((section) => section.shownWith === undefined) ?? group.included[0];
    return {
      kind: "included",
      key: own.key,
      title: own.title,
      shortTitle: own.shortTitle,
      sections: group.included,
      status: pageStatus(group.included),
      progress: pageProgress(group.included),
    };
  });
}

/**
 * The pages that come straight after Source Documents on the capture screen,
 * in this order, outside the sidebar's Inspection Steps group (Kenneth, 26
 * October 2026: "move order, sampling plan and box carton number below source
 * document (out from hidden section)"). The report keeps the template's order.
 */
export const LEAD_PAGE_KEYS: readonly string[] = ["order_lots", "sampling_plan", "carton_sampling"];

/** The capture screen's page order: the lead pages an inspection includes first, then the rest as they were. */
export function leadPagesFirst(pages: readonly CapturePage[]): CapturePage[] {
  const lead = LEAD_PAGE_KEYS.flatMap((key) => pages.filter((page) => page.kind === "included" && page.key === key));
  return [...lead, ...pages.filter((page) => !lead.includes(page))];
}

/**
 * The module shown beside the files on Source Documents' page, never a page
 * of its own (Kenneth, 26 October 2026: "move this to left beside the source
 * document column ... and then remove the manufacturer step"): the header,
 * General Information on screen.
 */
export const BESIDE_SOURCE_DOCUMENTS: ModuleKey = "header";

/**
 * Source Documents' page first, then the pages after it: the page the header
 * would have (with any module shown on it, STD_SG's Glove Type) joins
 * Source Documents' page, its result and progress joining the files'. With
 * no such page (the header switched off, or left out by the template): the
 * files alone, the other pages as they were.
 */
export function withSourceDocuments(
  files: Omit<DocumentsPage, "kind" | "sections">,
  pages: readonly CapturePage[],
): CapturePage[] {
  const beside = pages.find((page): page is IncludedPage => page.kind === "included" && page.key === BESIDE_SOURCE_DOCUMENTS);
  const documents: DocumentsPage = beside
    ? {
        ...files,
        kind: "documents",
        sections: beside.sections,
        status: worse(files.status, beside.status),
        progress: together(files.progress, beside.progress),
      }
    : { ...files, kind: "documents", sections: [] };
  return [documents, ...pages.filter((page) => page !== beside)];
}

/** The worse of two results, as a page's sections combine (pageStatus). */
function worse(a: Status, b: Status): Status {
  return pageSeverity(b) > pageSeverity(a) ? b : a;
}

/** Two progresses together, as a page's sections combine (pageProgress). */
function together(a: SectionProgress, b: SectionProgress): SectionProgress {
  if (a === "done" && b === "done") return "done";
  if (a === "not_started" && b === "not_started") return "not_started";
  return "in_progress";
}

export function isIncludedPage(page: CapturePage): page is IncludedPage {
  return page.kind === "included";
}

/** The page with this key, else the page a section with this key is on (?module=packing_config opens the order's). */
export function findPage(pages: readonly CapturePage[], key: string | null): CapturePage | undefined {
  if (key === null) return undefined;
  return pages.find((page) => page.key === key) ?? pages.find((page) => pageSectionKeys(page).includes(key));
}

/**
 * The keys of the sections on a page, in screen order (a leading guest before
 * the page's own; on Source Documents' page, General Information before the
 * files).
 */
export function pageSectionKeys(page: CapturePage): string[] {
  if (page.kind === "included") return page.sections.map((section) => section.key);
  if (page.kind === "documents") return [...page.sections.map((section) => section.key), page.key];
  return [page.key];
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
): { previous: StepPage | null; next: StepPage | null } {
  const index = pages.findIndex((page) => pageSectionKeys(page).includes(key));
  if (index === -1) return { previous: null, next: pages.find(isStepPage) ?? null };
  let previous: StepPage | null = null;
  for (let before = index - 1; before >= 0 && previous === null; before -= 1) {
    const page = pages[before];
    if (isStepPage(page)) previous = page;
  }
  const next = pages.slice(index + 1).find(isStepPage) ?? null;
  return { previous, next };
}

/**
 * The pages a step stands for (Source Documents and the included pages) as
 * ProgressTracker steps, each with its result, named by its short name, with
 * its full title for the hover.
 */
export function progressSteps(pages: readonly CapturePage[]): SectionStep[] {
  return pages.filter(isStepPage).map((page) => ({
    key: page.key,
    label: page.shortTitle,
    title: page.title,
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
    title: screenTitle(entry.key, entry.title),
    shortTitle: screenShortTitle(entry.key, entry.title),
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
  shownWith?: ModuleKey,
  beside?: ModuleKey,
): CaptureSection {
  const own = counts.get(custom.key) ?? NO_ISSUES;
  const hasData = readModuleEntry(data, "custom", custom.key).hasData || hasMappedValues(custom, report);
  const status: Status = hasData && own.errors === 0 ? "info" : "not_done";
  return {
    kind: "custom",
    key: custom.key,
    title: custom.title,
    shortTitle: customShortTitle(custom),
    status,
    summary: "",
    progress: progressOf(status, hasData),
    custom,
    ...(shownWith ? { shownWith } : {}),
    ...(beside ? { beside } : {}),
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

// The issues panel (BUILD_SPEC 6.2, last paragraph): errors block submit and
// warnings are allowed, each listed with a link to its problem. Issues arrive
// in screen order (lib/validation sortIssues: template order, errors first
// within a section); here they are grouped under their section's title. The
// screen shows them as tasks ("Pending"), one short row per section
// (pendingTasks): errors are needed before submit, warnings are the rest to do.
// Entries a field refused (refused.ts) join their section's row first: the
// row names the field and links to it. A section here is one module (or
// custom module), also where a page shows two (sections.ts SHOWN_WITH): each
// keeps its own row, and its link opens the page it is on.
import { FRAMEWORK_ISSUE_CODES, type IssuePath, type ValidationIssue } from "@/lib/validation";
import { REFUSED_ENTRY_CODE, refusedEntriesStatus } from "./refused";
import { findPage, type CapturePage, type CaptureSection } from "./sections";

export type IssueGroup = {
  /** The section's key: where the links go. */
  key: string;
  title: string;
  /** False when the section is not on screen (switched off or unknown): its issues have no link. */
  linkable: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function groupIssues(issues: readonly ValidationIssue[], sections: readonly CaptureSection[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    let group = groups.get(issue.moduleKey);
    if (!group) {
      const section = sections.find((candidate) => candidate.key === issue.moduleKey);
      group = {
        key: issue.moduleKey,
        title: section?.title ?? issue.moduleKey,
        linkable: section !== undefined && section.kind !== "excluded",
        errors: [],
        warnings: [],
      };
      groups.set(issue.moduleKey, group);
    }
    (issue.level === "error" ? group.errors : group.warnings).push(issue);
  }
  return [...groups.values()];
}

export function countIssues(issues: readonly Pick<ValidationIssue, "level">[]): { errors: number; warnings: number } {
  const errors = issues.filter((issue) => issue.level === "error").length;
  return { errors, warnings: issues.length - errors };
}

/* ------------------------------------------------------------------ *
 * Pending: one short task per section
 * ------------------------------------------------------------------ */

/**
 * One row of the Pending panel (Kenneth: "too crowded and many words, make
 * it cleaner and easy to read"): a section with open items, its title and
 * one short status under it ("4 sizes not done", "Final result and date"),
 * with the sizes it is about as chips. Display only: the export, the review
 * and lib/validation keep the full messages.
 */
export type PendingTask = {
  key: string;
  /** The section's title, without a trailing note in brackets ("(Refer to attached lab. reports)"). */
  title: string;
  /** False when the section is not on screen (switched off or unknown): the row has no link. */
  linkable: boolean;
  /** Something here must be fixed before submit (an error). */
  needed: boolean;
  /** The short status: "Not started", "4 sizes not done", "Sample below plan". */
  status: string;
  /** The sizes the status is about, in the order's order: the row's chips. */
  sizes: string[];
  /** Other kinds of open items in the section, beyond the status: "· 1 more". */
  more: number;
  /** Where the row goes: a refused entry's field first, else the section's first open item, what submit needs first. */
  first: ValidationIssue;
};

/** What the summary reads besides the issues: from the section and its module's result. */
export type TaskContext = {
  /** The section's own title, for its not-done message ("Weight is not done: …"). */
  title: string;
  /** Nothing entered in the section yet. */
  notStarted: boolean;
  /** The ordered sizes the module's result says are not done, in order. */
  sizesNotDone: readonly string[];
};

type ModuleResults = readonly { key: string; result: { perSize?: Readonly<Record<string, { status: string }>> } }[];

/**
 * The panel's rows: one per section with open items, what submit needs first
 * (in capture order), then the rest (in capture order). A section's refused
 * entries (code REFUSED_ENTRY_CODE) come first in its row.
 */
export function pendingTasks(
  groups: readonly IssueGroup[],
  sections: readonly CaptureSection[],
  modules: ModuleResults,
): PendingTask[] {
  const position = new Map(sections.map((section, index) => [section.key, index]));
  const ordered = [...groups].sort(
    (a, b) => (position.get(a.key) ?? sections.length) - (position.get(b.key) ?? sections.length),
  );
  const tasks = ordered.flatMap((group): PendingTask[] => {
    const issues = [...group.errors, ...group.warnings];
    const first = issues.find(isRefusedEntry) ?? issues[0];
    if (!first) return [];
    const section = sections.find((candidate) => candidate.key === group.key);
    const perSize = modules.find((entry) => entry.key === group.key)?.result.perSize ?? {};
    const summary = summariseIssues(issues, {
      title: group.title,
      notStarted: section !== undefined && section.kind !== "excluded" && section.progress === "not_started",
      sizesNotDone: Object.entries(perSize).flatMap(([size, result]) => (result.status === "not_done" ? [size] : [])),
    });
    return [{ key: group.key, title: shortTitle(group.title), linkable: group.linkable, needed: group.errors.length > 0, first, ...summary }];
  });
  return [...tasks.filter((task) => task.needed), ...tasks.filter((task) => !task.needed)];
}

/** An entry a field refused, listed with the section's issues (refused.ts). */
export function isRefusedEntry(issue: Pick<ValidationIssue, "code">): boolean {
  return issue.code === REFUSED_ENTRY_CODE;
}

/** "Physical Properties average (Refer to attached lab. reports)" as "Physical Properties average"; a title that is only brackets stays. */
export function shortTitle(title: string): string {
  const match = /^(.{8,}?)\s*\([^()]*\)$/.exec(title.trim());
  return match ? match[1] : title.trim();
}

/** How many sections are open, and how many of them submit needs. */
export function pendingCounts(tasks: readonly Pick<PendingTask, "needed">[]): { total: number; needed: number } {
  return { total: tasks.length, needed: tasks.filter((task) => task.needed).length };
}

/** Sections with an error: what blocks submit, counted the way the Pending panel shows it. */
export function neededSectionCount(issues: readonly Pick<ValidationIssue, "level" | "moduleKey">[]): number {
  return new Set(issues.filter((issue) => issue.level === "error").map((issue) => issue.moduleKey)).size;
}

/**
 * Everything open as a to-do count of sections, and what of it submit needs:
 * "10 to do · 1 needed before you submit", "2 to do", "Nothing pending".
 * `separator` joins the two parts (", " where it is read out).
 */
export function describePending({ total, needed }: { total: number; needed: number }, separator = " · "): string {
  if (total === 0) return "Nothing pending";
  return needed > 0 ? `${total} to do${separator}${needed} needed before you submit` : `${total} to do`;
}

/** Why submit was refused while sections need work: the screen's and the server's words. */
export function blockedSubmitMessage(needed: number): string {
  return needed === 1 ? "1 item is needed before you can submit." : `${needed} items are needed before you can submit.`;
}

/** A task's name for screen readers: "Weight (g): 4 sizes not done: XS, S, M and L. Needed before you submit." */
export function taskName(task: Pick<PendingTask, "title" | "status" | "sizes" | "more" | "needed">): string {
  const sizes = task.sizes.length > 0 ? `: ${joinWords(task.sizes)}` : "";
  const more = task.more > 0 ? `, and ${task.more} more` : "";
  return `${task.title}: ${task.status}${sizes}${more}.${task.needed ? " Needed before you submit." : ""}`;
}

/* The summariser: the section's issues, grouped by code, each group in a
   few words. Errors come first, then the section's own not-done status, then
   the rest; the first is the status, the others count as "more". */

const NOT_DONE = /^(.+?) (?:is not done|must be complete before submit)(?:: ([\s\S]+)|\.)$/;

/** Code families and their words; the first that matches. */
const PHRASES: readonly (readonly [RegExp, string])[] = [
  [/^final_result_differs$/, "Explain the result under Remark"],
  [/^size_not_ordered$/, "Data for a size not ordered"],
  [/^order_size_not_in_template$/, "Size not in this template"],
  [/^box_not_in_carton_list$/, "Box not in the carton list"],
  [/^carton_duplicate$/, "Carton entered twice"],
  [/^box_duplicate$/, "Box entered twice"],
  [/^lot_number_duplicate$/, "Lot number entered twice"],
  [/^(order_size_duplicate|size_duplicate)$/, "Size entered twice"],
  [/_duplicate$/, "Entered twice"],
  [/_below_plan$/, "Sample below plan"],
  [/^lab_report_missing$/, "Lab report not attached"],
  [/^document_file_missing$/, "File not attached"],
  [/^document_expired$/, "Document expired"],
  [/^(date_before_inspection|expiry_not_after_mfg|mfg_after_inspection)$/, "Dates to check"],
  [/^hand_split_mismatch$/, "Saved without a hand"],
  [/^weight_deviation$/, "Weight differs from indicative"],
  [/(_not_in_|_not_listed$|_unmapped$|_unknown$)/, "Not in the list"],
  [/(_exceed_|_beyond_|_above_|^too_many|_not_planned$)/, "More than planned"],
  [/_mismatch$/, "Numbers do not match"],
  [/(^container_no|check_digit)/, "Container number to check"],
  [/^inspector_missing$/, "No inspector recorded"],
  [/^(invalid_data|invalid_config|calc_failed|contribute_failed|invalid_output)$/, "Could not be read"],
  [/(_not_positive$|out_of_range$|^too_(small|big)$|^invalid_|^not_multiple_of$|_too_small$|_inspected_missing$)/, "Value to check"],
];

/** The words for one field a section lacks, where the field is named like the section. */
const FIELD_WORDS: Readonly<Record<string, string>> = { Conclusion: "Final result" };

/** At most this long, a single issue's own message is its status (custom fields: "Container seal intact is required"). */
const SHORT_MESSAGE = 36;

export function summariseIssues(
  issues: readonly ValidationIssue[],
  context: TaskContext,
): { status: string; sizes: string[]; more: number } {
  const byCode = new Map<string, ValidationIssue[]>();
  for (const issue of issues) byCode.set(issue.code, [...(byCode.get(issue.code) ?? []), issue]);
  const items: { rank: number; status: string; sizes: string[] }[] = [];
  for (const [code, group] of byCode) {
    // A refused entry first: the row then names the field its link focuses.
    const rank =
      code === REFUSED_ENTRY_CODE
        ? -1
        : group.some((issue) => issue.level === "error")
          ? 0
          : code === FRAMEWORK_ISSUE_CODES.moduleNotDone
            ? 1
            : 2;
    const item =
      code === REFUSED_ENTRY_CODE
        ? refusedStatus(group)
        : code === FRAMEWORK_ISSUE_CODES.moduleNotDone
          ? notDoneStatus(group[0], context)
          : codeStatus(code, group);
    const same = items.find((existing) => existing.status === item.status);
    if (same) {
      same.rank = Math.min(same.rank, rank);
      same.sizes = union(same.sizes, item.sizes);
    } else {
      items.push({ rank, ...item });
    }
  }
  items.sort((a, b) => a.rank - b.rank);
  const [first] = items;
  return first ? { status: first.status, sizes: first.sizes, more: items.length - 1 } : { status: "To check", sizes: [], more: 0 };
}

/** One refused entry says itself (its message is its status, refusedTaskIssues); several are counted. */
function refusedStatus(issues: readonly ValidationIssue[]): { status: string; sizes: string[] } {
  const sizes = union(
    [],
    issues.flatMap((issue) => (issue.size ? [issue.size] : [])),
  );
  return { status: issues.length === 1 ? issues[0].message : refusedEntriesStatus(issues.length), sizes };
}

function notDoneStatus(issue: ValidationIssue, { notStarted, sizesNotDone }: TaskContext): { status: string; sizes: string[] } {
  const detail = NOT_DONE.exec(issue.message.trim())?.[2]?.trim() ?? "";
  if (/\bno sizes? ordered yet\b/i.test(detail)) return { status: "No sizes ordered yet", sizes: [] };
  const missing = /^Missing: ([\s\S]+?)\.(?:\s|$)/.exec(detail);
  const fields = missing ? splitList(missing[1]).map((field) => FIELD_WORDS[field] ?? field) : [];
  // A short list of fields says itself best, even before anything is entered: "Final result and date".
  const named = fieldsStatus(fields);
  if (named && fields.length <= 2) return { status: named, sizes: [] };
  if (notStarted) return { status: "Not started", sizes: [] };
  if (sizesNotDone.length > 0) {
    const count = sizesNotDone.length;
    return { status: `${count} ${count === 1 ? "size" : "sizes"} not done`, sizes: [...sizesNotDone] };
  }
  if (fields.length > 0) return { status: named ?? `${fields.length} fields to fill`, sizes: [] };
  if (/\blab report not attached\b/i.test(detail)) return { status: "Lab report not attached", sizes: [] };
  if (/\blot size unknown\b/i.test(detail)) return { status: "Lot size unknown", sizes: [] };
  return { status: "Not done yet", sizes: [] };
}

/** One or two short field names as the task ("Glove colour and glove length"); null when that would be long. */
function fieldsStatus(fields: readonly string[]): string | null {
  if (fields.length === 1 && fields[0].length <= 30) return fields[0];
  if (fields.length === 2) {
    const both = `${fields[0]} and ${lowerFirst(fields[1])}`;
    if (both.length <= 32) return both;
  }
  return fields.length > 2 ? `${fields.length} fields to fill` : null;
}

function codeStatus(code: string, issues: readonly ValidationIssue[]): { status: string; sizes: string[] } {
  const sizes = union(
    [],
    issues.flatMap((issue) => (issue.size ? [issue.size] : [])),
  );
  if (code === FRAMEWORK_ISSUE_CODES.required) {
    const own = issues.length === 1 ? shortMessage(issues[0].message) : null;
    return { status: own ?? `${issues.length} required ${issues.length === 1 ? "field" : "fields"}`, sizes };
  }
  const phrase = PHRASES.find(([pattern]) => pattern.test(code))?.[1];
  if (phrase) return { status: phrase, sizes };
  const own = issues.length === 1 ? shortMessage(issues[0].message) : null;
  return { status: own ?? "To check", sizes };
}

/** A message short and plain enough to be a status, without its full stop; null otherwise. */
function shortMessage(message: string): string | null {
  const text = message.trim().replace(/\.$/, "");
  return text.length <= SHORT_MESSAGE && !/[;:()]/.test(text) ? text : null;
}

/** "A, B (x, y), C" into its parts, commas inside brackets kept. */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth++;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

/** "Date" as "date"; "PO / SO Number" stays (an acronym). */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function union(into: readonly string[], more: readonly string[]): string[] {
  const out = [...into];
  for (const item of more) if (!out.includes(item)) out.push(item);
  return out;
}

/** "XS", "XS and S", "XS, S, M and L". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Where an issue's link goes: the page its section is on (the order's, for
 * packing configuration), the section, and the data path to focus there.
 */
export type IssueTarget = { pageKey: string; sectionKey: string; path: IssuePath };

export function issueTarget(issue: Pick<ValidationIssue, "moduleKey" | "path">, pages: readonly CapturePage[]): IssueTarget {
  return { pageKey: findPage(pages, issue.moduleKey)?.key ?? issue.moduleKey, sectionKey: issue.moduleKey, path: issue.path };
}

/** A stable key for a list item: the same issue keeps its key while the list changes around it. */
export function issueKey(issue: ValidationIssue): string {
  return `${issue.moduleKey}|${issue.level}|${issue.code}|${JSON.stringify(issue.path)}|${issue.size ?? ""}|${issue.message}`;
}

/**
 * The issues the server found that the screen does not list: what it checked
 * (sections switched on or off, the data saved) differs from what is on
 * screen, because the inspection changed elsewhere.
 */
export function unseenIssues(
  found: readonly ValidationIssue[] | null,
  shown: readonly ValidationIssue[],
): ValidationIssue[] {
  if (!found || found.length === 0) return [];
  const keys = new Set(shown.map(issueKey));
  return found.filter((issue) => !keys.has(issueKey(issue)));
}

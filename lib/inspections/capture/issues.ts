// The issues panel (BUILD_SPEC 6.2, last paragraph): errors block submit and
// warnings are allowed, each listed with a link to its problem. Issues arrive
// in screen order (lib/validation sortIssues: template order, errors first
// within a section); here they are grouped under their section's title. The
// screen words them as tasks ("Pending"): errors are needed before submit,
// warnings are the rest to do.
import { FRAMEWORK_ISSUE_CODES, type IssuePath, type ValidationIssue } from "@/lib/validation";
import type { CaptureSection } from "./sections";

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

/**
 * Everything open as a to-do count, and what of it submit needs: "13 to do ·
 * 1 needed before you submit", "2 to do", "Nothing pending". `separator`
 * joins the two parts (", " where it is read out).
 */
export function describePending({ errors, warnings }: { errors: number; warnings: number }, separator = " · "): string {
  const open = errors + warnings;
  if (open === 0) return "Nothing pending";
  return errors > 0 ? `${open} to do${separator}${errors} needed before you submit` : `${open} to do`;
}

/** Why submit was refused while errors are open: the screen's and the server's words. */
export function blockedSubmitMessage(errors: number): string {
  return errors === 1 ? "1 item is needed before you can submit." : `${errors} items are needed before you can submit.`;
}

const NOT_DONE = /^(.+?) (?:is not done|must be complete before submit)(?:: (.+)|\.)$/;

/**
 * An issue as a task under its section's heading. A section that is not done
 * says so in the heading's own words ("Glove Information is not done:
 * Missing: Glove colour."), so the task keeps what follows ("Missing: Glove
 * colour.") or, with nothing more, "Not done yet.". Other issues read as
 * they are. Only for the screen: the export and the review keep the message.
 */
export function taskText(issue: Pick<ValidationIssue, "code" | "message">, sectionTitle: string): string {
  if (issue.code !== FRAMEWORK_ISSUE_CODES.moduleNotDone) return issue.message;
  const match = NOT_DONE.exec(issue.message.trim());
  if (!match || match[1] !== sectionTitle) return issue.message;
  const detail = match[2]?.trim();
  return detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}` : "Not done yet.";
}

/** Where an issue's link goes: its section, and the data path to focus there. */
export type IssueTarget = { sectionKey: string; path: IssuePath };

export function issueTarget(issue: Pick<ValidationIssue, "moduleKey" | "path">): IssueTarget {
  return { sectionKey: issue.moduleKey, path: issue.path };
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

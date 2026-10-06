// The issues panel (BUILD_SPEC 6.2, last paragraph): errors block submit and
// warnings are allowed, each listed with a link to its problem. Issues arrive
// in screen order (lib/validation sortIssues: template order, errors first
// within a section); here they are grouped under their section's title.
import type { IssuePath, ValidationIssue } from "@/lib/validation";
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

/** "2 errors and 5 warnings", "1 warning", "No issues". */
export function describeIssueCounts({ errors, warnings }: { errors: number; warnings: number }): string {
  const parts = [
    errors > 0 ? `${errors} ${errors === 1 ? "error" : "errors"}` : null,
    warnings > 0 ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "No issues" : parts.join(" and ");
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

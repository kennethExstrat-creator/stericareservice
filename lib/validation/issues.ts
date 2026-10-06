// Validation issues (BUILD_SPEC 6.2, last paragraph): errors block submit and
// list each problem with a link to it; warnings are allowed but go into the
// export. Modules return issues from calc without their key; the framework
// stamps it, so an issue always names the module it belongs to.
import { z } from "zod";
import type { ExportIssue } from "@/lib/schemas/export";

export const ISSUE_LEVELS = ["error", "warning"] as const;
export const IssueLevelSchema = z.enum(ISSUE_LEVELS);
export type IssueLevel = z.infer<typeof IssueLevelSchema>;

/** Snake case, stable: screens and the export match on it, e.g. `carton_duplicate`. */
export const ISSUE_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Where the problem is, relative to the module's own data: `["sizes", "M", 12]`
 * is the 13th carton of size M. `[]` is the module as a whole. The capture
 * screen turns it into the link.
 */
export const IssuePathSchema = z.array(z.union([z.string(), z.number().int().min(0)]));
export type IssuePath = readonly (string | number)[];

export const ValidationIssueSchema = z.strictObject({
  level: IssueLevelSchema,
  /** Module key, or a custom module key. */
  moduleKey: z.string().min(1),
  code: z.string().regex(ISSUE_CODE_PATTERN),
  /** One sentence for the inspector, in the template's wording where a label is involved. */
  message: z.string().min(1),
  size: z.string().min(1).optional(),
  path: IssuePathSchema,
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

/** An issue as a module's calc returns it: the framework adds `moduleKey`. */
export type CalcIssue = Omit<ValidationIssue, "moduleKey">;

export type IssueLocation = { size?: string; path?: IssuePath };

export function errorIssue(code: string, message: string, at: IssueLocation = {}): CalcIssue {
  return makeIssue("error", code, message, at);
}

export function warningIssue(code: string, message: string, at: IssueLocation = {}): CalcIssue {
  return makeIssue("warning", code, message, at);
}

function makeIssue(level: IssueLevel, code: string, message: string, { size, path = [] }: IssueLocation): CalcIssue {
  return size === undefined ? { level, code, message, path: [...path] } : { level, code, message, size, path: [...path] };
}

export function stampIssues(moduleKey: string, issues: readonly CalcIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, moduleKey }));
}

export function isError(issue: Pick<ValidationIssue, "level">): boolean {
  return issue.level === "error";
}

/** Errors first, then warnings, each in the order given (module order). */
export function partitionIssues<T extends Pick<ValidationIssue, "level">>(
  issues: readonly T[],
): { errors: T[]; warnings: T[] } {
  return { errors: issues.filter(isError), warnings: issues.filter((issue) => !isError(issue)) };
}

/**
 * Stable sort into screen order: by the position of the module in `order`
 * (template order; unknown keys last), errors before warnings within a module.
 */
export function sortIssues(issues: readonly ValidationIssue[], order: readonly string[]): ValidationIssue[] {
  const position = new Map(order.map((key, index) => [key, index]));
  const rankOf = (issue: ValidationIssue) => position.get(issue.moduleKey) ?? order.length;
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort(
      (a, b) =>
        rankOf(a.issue) - rankOf(b.issue) ||
        Number(isError(b.issue)) - Number(isError(a.issue)) ||
        a.index - b.index,
    )
    .map(({ issue }) => issue);
}

/** The export's form of an issue (ExportIssueSchema): the module and path are implied by where it sits. */
export function toExportIssue(issue: ValidationIssue): ExportIssue {
  return issue.size === undefined
    ? { code: issue.code, message: issue.message }
    : { code: issue.code, message: issue.message, size: issue.size };
}

/** Warnings and errors of one module, ready for ExportModuleSchema. */
export function exportIssuesOf(
  issues: readonly ValidationIssue[],
  moduleKey: string,
): { warnings: ExportIssue[]; errors: ExportIssue[] } {
  const own = partitionIssues(issues.filter((issue) => issue.moduleKey === moduleKey));
  return { warnings: own.warnings.map(toExportIssue), errors: own.errors.map(toExportIssue) };
}

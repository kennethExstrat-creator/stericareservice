// The save action's check on what a save changes (BUILD_SPEC 2 rule 3 and
// 6.2 rule 1): every module or custom module entry that differs from the
// stored copy must parse with that module's own schema (a custom module's
// with its field schemas), and may only belong to the inspection's template.
// Entries a save leaves as they are pass untouched, so one module's old,
// unreadable data never stops the others from saving; the engine reports it
// as an invalid_data error, which blocks submit.
//
// A module's schema describes a draft (docs/MODULES.md 5): missing values are
// fine; text in a numeric cell, a mistyped key or a date that is not a date
// are not.
import { screenShortTitle } from "@/lib/design/screen-names";
import { contentHash } from "@/lib/offline/stable-json";
import { isModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { customShortTitle } from "@/lib/templates";
import { customValuesSchema } from "@/lib/validation";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  COMMENT_KEY,
  parseModuleData,
  readModuleEntry,
  type DataNamespace,
  type InspectionData,
  type ModuleRegistry,
} from "@/modules/_framework";

/** Longest inspector comment kept per module. */
export const COMMENT_MAX = 4000;

export type DataProblem = {
  namespace: DataNamespace;
  key: string;
  /** The section's short name (lib/templates/short-titles.ts), or the key when the template has no such section. */
  title: string;
  message: string;
};

export function changedEntryProblems(
  previous: InspectionData,
  next: InspectionData,
  template: ResolvedTemplate,
  registry: ModuleRegistry = MODULE_REGISTRY,
): DataProblem[] {
  const problems: DataProblem[] = [];
  for (const namespace of ["modules", "custom"] as const) {
    for (const [key, value] of Object.entries(next[namespace])) {
      if (sameJson(previous[namespace][key], value)) continue;
      problems.push(...entryProblems(namespace, key, next, template, registry));
    }
  }
  return problems;
}

/** One line for the autosave pill: the first problem, and how many more. */
export function describeProblems(problems: readonly DataProblem[]): string {
  if (problems.length === 0) return "";
  const [first] = problems;
  const more = problems.length - 1;
  const tail = more > 0 ? ` (and ${more} more ${more === 1 ? "problem" : "problems"})` : "";
  return `${first.title}: ${first.message}${tail}`;
}

function entryProblems(
  namespace: DataNamespace,
  key: string,
  data: InspectionData,
  template: ResolvedTemplate,
  registry: ModuleRegistry,
): DataProblem[] {
  const problem = (title: string, message: string): DataProblem => ({ namespace, key, title, message });
  const stored = data[namespace][key];
  if (stored === null) return [];
  if (typeof stored !== "object" || Array.isArray(stored)) return [problem(key, "the saved entry is not an object.")];

  const comment = (stored as Record<string, unknown>)[COMMENT_KEY];
  const commentProblem =
    comment === undefined || comment === null
      ? null
      : typeof comment !== "string"
        ? "the comment must be text."
        : comment.length > COMMENT_MAX
          ? `keep the comment to ${COMMENT_MAX} characters.`
          : null;

  if (namespace === "modules") {
    const resolved = isModuleKey(key) ? template.modules.find((entry) => entry.key === key) : undefined;
    if (!resolved || !isModuleKey(key)) return [problem(key, "is not a section of this inspection's template.")];
    const parsed = parseModuleData(registry[key], readModuleEntry(data, "modules", key));
    const title = screenShortTitle(key, resolved.title);
    return [
      ...(commentProblem ? [problem(title, commentProblem)] : []),
      ...(parsed.success ? [] : [problem(title, describeZodIssue(parsed.error.issues[0]))]),
    ];
  }

  const custom = template.customModules.find((entry) => entry.key === key);
  if (!custom) return [problem(key, "is not a section of this inspection's template.")];
  const entry = readModuleEntry(data, "custom", key);
  const parsed = customValuesSchema(custom).safeParse(entry.value ?? {});
  const title = customShortTitle(custom);
  return [
    ...(commentProblem ? [problem(title, commentProblem)] : []),
    ...(parsed.success ? [] : [problem(title, describeZodIssue(parsed.error.issues[0]))]),
  ];
}

function describeZodIssue(issue: { message: string; path: readonly PropertyKey[] } | undefined): string {
  if (!issue) return "the data could not be read.";
  const where = issue.path.filter((segment) => typeof segment !== "symbol").map(String).join(".");
  return where ? `${where}: ${issue.message}` : issue.message;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return contentHash(a) === contentHash(b);
}

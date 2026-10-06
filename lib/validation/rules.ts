// Cross-module rules of BUILD_SPEC 6.2 that the framework applies to every
// module, so no module has to remember them. Each returns issues without a
// module key (the engine stamps it), except the inspection-wide ones.
import type { z } from "zod";
import type { ModuleResult } from "@/lib/schemas/module-result";
import { normaliseSize, sortSizes } from "@/lib/sizes";
import { HAND_LABEL, HANDS, type Hand } from "@/modules/_framework/hands";
import { errorIssue, warningIssue, type CalcIssue, type IssuePath, type ValidationIssue } from "./issues";

/** Issue codes the framework raises. Module codes must not reuse them. */
export const FRAMEWORK_ISSUE_CODES = {
  /** 6.2.4: data saved for a size that is not in order_lots. Ignored, kept in the database. */
  sizeNotOrdered: "size_not_ordered",
  /** One size saved under two spellings ("M" and "m"). One is used, the other ignored and kept. */
  sizeDuplicate: "size_duplicate",
  /** 6.2.5: the module is not done. A warning, or an error for a module required for submit. */
  moduleNotDone: "module_not_done",
  /** Saved data does not match the module's data schema (text in a numeric cell, rule 6.2.1). */
  invalidData: "invalid_data",
  /** The template's config for the module does not match its config schema. */
  invalidConfig: "invalid_config",
  /** The module's calc threw. */
  calcFailed: "calc_failed",
  /** The module's contribution to the context threw or named a part it does not own; it was left out. */
  contributeFailed: "contribute_failed",
  /** The module's calc returned a result or computed values outside the contract. */
  invalidOutput: "invalid_output",
  /** 6.2.11: no inspector recorded. */
  inspectorMissing: "inspector_missing",
  /** Custom fields. */
  required: "required",
  outOfRange: "out_of_range",
  invalidOption: "invalid_option",
  tooManyColumns: "too_many_columns",
  /** 6.2.10: a value mapped to a module was also saved in the custom module; the module's value is used. */
  mappedValueIgnored: "mapped_value_ignored",
} as const;

const CODES = FRAMEWORK_ISSUE_CODES;

/**
 * Splits per-size data into the ordered sizes (canonical keys, what calc sees),
 * the sizes it holds that are not ordered (6.2.4), and second spellings of an
 * ordered size ("m" beside "M"), which are left out too. Data outside `sizes`
 * is kept as it is.
 */
export function restrictToOrderedSizes<T>(
  data: T,
  sizes: readonly string[],
): { data: T; ignored: string[]; duplicates: string[] } {
  if (!isRecord(data) || !isRecord(data.sizes)) return { data, ignored: [], duplicates: [] };
  const ordered = new Set(sizes);
  const kept = new Map<string, { spelling: string; entry: unknown }>();
  const ignored: string[] = [];
  const duplicates: string[] = [];
  for (const [size, entry] of Object.entries(data.sizes)) {
    const canonical = normaliseSize(size);
    if (canonical === null || !ordered.has(canonical)) {
      ignored.push(size);
      continue;
    }
    const current = kept.get(canonical);
    if (current === undefined) {
      kept.set(canonical, { spelling: size, entry });
    } else if (size === canonical) {
      // An exact canonical key wins over a variant spelling of the same size.
      duplicates.push(current.spelling);
      kept.set(canonical, { spelling: size, entry });
    } else {
      duplicates.push(size);
    }
  }
  const restricted = Object.fromEntries([...kept].map(([canonical, { entry }]) => [canonical, entry]));
  // Size order, not key order: JavaScript lists a key like "7" before "XL".
  return { data: { ...data, sizes: restricted } as T, ignored: sortSizes(ignored), duplicates: sortSizes(duplicates) };
}

export function sizeNotOrderedIssues(ignored: readonly string[], title: string): CalcIssue[] {
  return ignored.map((size) =>
    warningIssue(
      CODES.sizeNotOrdered,
      `${title}: size ${size} has data but is not in the order. It is left out of results and the export.`,
      { size: normaliseSize(size) ?? size, path: ["sizes", size] },
    ),
  );
}

export function sizeDuplicateIssues(duplicates: readonly string[], title: string): CalcIssue[] {
  return duplicates.map((size) => {
    const canonical = normaliseSize(size) ?? size;
    return warningIssue(
      CODES.sizeDuplicate,
      `${title}: size ${canonical} is also saved as "${size}". The values under "${size}" are left out of results and the export.`,
      { size: canonical, path: ["sizes", size] },
    );
  });
}

/**
 * The issues to show beside a field: all but the framework's
 * `module_not_done`, which speaks of the module as a whole and carries a
 * field's path (CalcOutput.notDonePath) only so its link opens that field.
 * Read inline messages through it: `findIssue(fieldIssues(evaluation?.issues), path)`.
 */
export function fieldIssues<T extends { readonly code: string }>(issues: readonly T[] | null | undefined): T[] {
  return (issues ?? []).filter((issue) => issue.code !== CODES.moduleNotDone);
}

/**
 * 6.2.5: one issue per module that is not done. The link goes to `path`, the
 * field the module says to complete first (CalcOutput.notDonePath), else to
 * the module. A warning, so an inspection can be submitted on hold, except
 * for a module required for submit (the conclusion): then an error.
 */
export function notDoneIssues(
  title: string,
  result: ModuleResult,
  requiredForSubmit = false,
  path: IssuePath = [],
): CalcIssue[] {
  if (result.status !== "not_done") return [];
  const detail = result.summary.trim();
  if (requiredForSubmit) {
    return [
      errorIssue(
        CODES.moduleNotDone,
        detail ? `${title} must be complete before submit: ${detail}` : `${title} must be complete before submit.`,
        { path },
      ),
    ];
  }
  return [
    warningIssue(CODES.moduleNotDone, detail ? `${title} is not done: ${detail}` : `${title} is not done.`, { path }),
  ];
}

export type InvalidDataOptions = {
  /** Words for the place of a value in the data: `describeDataPath` with the module's labels. */
  describe?: (path: IssuePath) => string;
  /** A sentence added to each message, e.g. what the other modules do meanwhile. */
  consequence?: string;
};

/**
 * 6.2.1: saved data the schema rejects. One blocking error per rejected
 * value, with its path for the link, naming the module and the field in
 * words: "Order: size M, Lot Number no. 2 is longer than 200 characters."
 */
export function invalidDataIssues(
  title: string,
  error: z.ZodError,
  root: IssuePath = [],
  { describe = (path) => describeDataPath(path), consequence = "" }: InvalidDataOptions = {},
): CalcIssue[] {
  const extra = consequence.trim() === "" ? "" : ` ${consequence.trim()}`;
  return error.issues.flatMap((issue) => {
    const path = issue.path.filter((segment): segment is string | number => typeof segment !== "symbol");
    const targets = issue.code === "unrecognized_keys" ? issue.keys.map((key) => [...path, key]) : [path];
    return targets.map((target) => {
      const where = describe(target);
      const what = plainProblem(issue);
      const sentence =
        what === null
          ? `${where === "" ? "" : `${where}: `}${issue.message.replace(/\.$/, "")}`
          : `${where === "" ? "What is saved" : where} ${what}`;
      return errorIssue(CODES.invalidData, `${title}: ${sentence}.${extra}`, { path: [...root, ...target] });
    });
  });
}

/**
 * The place of a value in a module's data, in words: `["sizes", "M",
 * "lotNumbers", 1]` with order_lots' labels is "size M, Lot Number no. 2".
 * A key is named by its label when there is one; the last key, and a list's
 * own key, are named even without one. A hand under a size (`R` or `L`,
 * hand-split modules) is named too: "size M, right hand, Pin hole".
 */
export function describeDataPath(path: IssuePath, labels: Readonly<Record<string, string>> = {}): string {
  const parts: string[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const next = path[index + 1];
    if (segment === "sizes" && typeof next === "string") {
      parts.push(next.trim() === "" ? "a blank size" : `size ${next}`);
      index += 1;
      const hand = path[index + 1];
      if (isHand(hand)) {
        parts.push(HAND_LABEL[hand].toLowerCase());
        index += 1;
      }
    } else if (typeof segment === "number") {
      const number = `no. ${segment + 1}`;
      if (parts.length > 0) parts[parts.length - 1] = `${parts[parts.length - 1]} ${number}`;
      else parts.push(number);
    } else {
      const label = labels[segment];
      const named = label !== undefined && label.trim() !== "";
      if (named) parts.push(label.trim());
      else if (next === undefined || typeof next === "number") parts.push(segment);
    }
  }
  return parts.join(", ");
}

/** What is wrong with a rejected value, in plain words; null where zod's own message says it better. */
function plainProblem(issue: z.ZodError["issues"][number]): string | null {
  switch (issue.code) {
    case "invalid_type":
      if (/received undefined$/.test(issue.message)) return "is missing";
      if (issue.expected === "int") return "is not a whole number";
      if (issue.expected === "number") return "is not a number";
      if (issue.expected === "string") return "is not text";
      if (issue.expected === "boolean") return "is not yes or no";
      if (issue.expected === "array") return "is not a list";
      if (issue.expected === "object" || issue.expected === "record") return "cannot be read";
      return null;
    case "too_big":
      if (issue.origin === "string") return `is longer than ${String(issue.maximum)} characters`;
      if (issue.origin === "number") return `is more than ${String(issue.maximum)}`;
      if (issue.origin === "array") return `has more than ${String(issue.maximum)} entries`;
      return null;
    case "too_small":
      if (issue.origin === "string") return Number(issue.minimum) <= 1 ? "is empty" : `is shorter than ${String(issue.minimum)} characters`;
      if (issue.origin === "number") return `is less than ${String(issue.minimum)}`;
      if (issue.origin === "array") return `has fewer than ${String(issue.minimum)} entries`;
      return null;
    case "invalid_format":
      if (issue.format === "date") return "is not a date (YYYY-MM-DD)";
      if (issue.format === "uuid") return "is not a file id";
      return null;
    case "unrecognized_keys":
      return "is not a field of this section";
    case "invalid_key":
      return "is not a key this section takes";
    case "invalid_value":
      return "is not one of the choices";
    case "not_multiple_of":
      return "is not a whole number";
    default:
      return null;
  }
}

export function invalidConfigIssues(title: string, error: z.ZodError): CalcIssue[] {
  const where = error.issues
    .slice(0, 3)
    .map((issue) => (issue.path.length ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message))
    .join("; ");
  return [errorIssue(CODES.invalidConfig, `${title}: the template's settings are invalid (${where}). Ask an admin.`)];
}

export function calcFailedIssues(title: string, error: unknown): CalcIssue[] {
  const reason = error instanceof Error ? error.message : String(error);
  return [errorIssue(CODES.calcFailed, `${title} could not be calculated: ${reason}`)];
}

/** What other modules should have received from this one is missing: they may show not done because of it. */
export function contributeFailedIssues(title: string, messages: readonly string[]): CalcIssue[] {
  return messages.map((message) =>
    errorIssue(
      CODES.contributeFailed,
      `${title} could not pass all its values to the other modules (${message}). Report this to a developer.`,
    ),
  );
}

export function invalidOutputIssues(title: string, what: string): CalcIssue[] {
  return [errorIssue(CODES.invalidOutput, `${title} returned an invalid ${what}. Report this to a developer.`)];
}

/** 6.2.11: the inspector is always recorded; the header shows it. */
export function inspectorIssues(inspector: { id: string } | null): ValidationIssue[] {
  if (inspector) return [];
  return [
    {
      ...errorIssue(CODES.inspectorMissing, "No inspector is recorded for this inspection."),
      moduleKey: "header",
    },
  ];
}

function isHand(value: unknown): value is Hand {
  return (HANDS as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

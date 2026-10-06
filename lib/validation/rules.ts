// Cross-module rules of BUILD_SPEC 6.2 that the framework applies to every
// module, so no module has to remember them. Each returns issues without a
// module key (the engine stamps it), except the inspection-wide ones.
import type { z } from "zod";
import type { ModuleResult } from "@/lib/schemas/module-result";
import { normaliseSize, sortSizes } from "@/lib/sizes";
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
 * 6.2.5: one issue per module that is not done; the link goes to the module.
 * A warning, so an inspection can be submitted on hold, except for a module
 * required for submit (the conclusion): then an error.
 */
export function notDoneIssues(title: string, result: ModuleResult, requiredForSubmit = false): CalcIssue[] {
  if (result.status !== "not_done") return [];
  const detail = result.summary.trim();
  if (requiredForSubmit) {
    return [
      errorIssue(
        CODES.moduleNotDone,
        detail ? `${title} must be complete before submit: ${detail}` : `${title} must be complete before submit.`,
      ),
    ];
  }
  return [warningIssue(CODES.moduleNotDone, detail ? `${title} is not done: ${detail}` : `${title} is not done.`)];
}

export function invalidDataIssues(title: string, error: z.ZodError, root: IssuePath = []): CalcIssue[] {
  return error.issues.map((issue) =>
    errorIssue(CODES.invalidData, `${title}: ${issue.message}`, {
      path: [...root, ...issue.path.filter((segment): segment is string | number => typeof segment !== "symbol")],
    }),
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

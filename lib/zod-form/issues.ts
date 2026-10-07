// Validation for generated forms: the zod schema checks the value, and each
// message lands on the field its path names. A schema's own messages (a
// `.refine` error, a regex's error) are kept; zod's generic wording
// ("Too small: expected number to be >=0") is replaced with plain words, per
// parse, so nothing global changes.
import type { z } from "zod";
import { parseDecimal } from "@/lib/stats";

export type FormPath = readonly (string | number)[];

/** Messages by field path (pathKey). */
export type FormIssues = ReadonlyMap<string, readonly string[]>;

export const NO_ISSUES: FormIssues = new Map();

/** One key per path: JSON, because record keys such as sizes ("7.0") hold dots. */
export function pathKey(path: FormPath): string {
  return JSON.stringify(path.map((segment) => (typeof segment === "number" ? segment : String(segment))));
}

export function pathFromKey(key: string): (string | number)[] {
  const parsed: unknown = JSON.parse(key);
  return Array.isArray(parsed) ? parsed.filter((segment) => typeof segment === "string" || typeof segment === "number") : [];
}

type RawIssue = z.core.$ZodRawIssue;

function count(value: unknown): string {
  return typeof value === "bigint" || typeof value === "number" ? String(value) : String(value ?? "");
}

const TYPE_WORDS: Readonly<Record<string, string>> = {
  number: "Enter a number.",
  int: "Enter a whole number.",
  string: "Enter text.",
  boolean: "Choose on or off.",
  array: "Expected a list.",
  object: "Expected a group of settings.",
};

/**
 * Plain wording for zod's built-in issues. Returns undefined for anything the
 * schema words itself, so `.refine(..., { error })` messages come through.
 */
export function friendlyMessage(issue: RawIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type": {
      const expected = String(issue.expected);
      const number = expected === "number" || expected === "int";
      if (issue.input === undefined) return number ? "Enter a number." : "Required.";
      // A number field stores what was typed until it is a number (controls.tsx): say what is wrong with it.
      if (number && typeof issue.input === "string") return notANumber(issue.input);
      return TYPE_WORDS[expected] ?? `Expected ${expected}.`;
    }
    case "too_small": {
      const minimum = count(issue.minimum);
      if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
        return issue.inclusive ? `Must be ${minimum} or more.` : `Must be more than ${minimum}.`;
      }
      if (issue.origin === "string") {
        return minimum === "1" ? "Enter a value." : `Use at least ${minimum} characters.`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return minimum === "1" ? "Add at least one." : `Add at least ${minimum}.`;
      }
      return undefined;
    }
    case "too_big": {
      const maximum = count(issue.maximum);
      if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
        return issue.inclusive ? `Must be ${maximum} or less.` : `Must be less than ${maximum}.`;
      }
      if (issue.origin === "string") return `Use at most ${maximum} characters.`;
      if (issue.origin === "array" || issue.origin === "set") return `No more than ${maximum}.`;
      return undefined;
    }
    case "invalid_format":
      if (issue.format === "regex") {
        return issue.pattern ? `Not in the expected format (${String(issue.pattern)}).` : "Not in the expected format.";
      }
      return `Not a valid ${String(issue.format)}.`;
    case "not_multiple_of":
      return `Must be a multiple of ${count(issue.divisor)}.`;
    case "invalid_value": {
      const values = issue.values.map((value) => String(value));
      return values.length <= 8 ? `Choose one of: ${values.join(", ")}.` : "Choose one of the options.";
    }
    case "invalid_union":
      return "discriminator" in issue && issue.discriminator ? "Choose a type." : "Not a valid value.";
    case "unrecognized_keys":
      return `Unknown ${issue.keys.length === 1 ? "setting" : "settings"}: ${issue.keys.join(", ")}.`;
    case "invalid_key": {
      const nested = issue.issues?.find((entry) => typeof entry.message === "string")?.message;
      return nested ?? "Not a valid key.";
    }
    case "invalid_element":
      return "Not a valid entry.";
    default:
      return undefined;
  }
}

/**
 * lib/stats' advice for a number split by a space; the group is the number it
 * names, if any (240 for "2 40"). The quote may hold a line break ("2\n40" in
 * the JSON), which lib/stats takes for a space and `.` would not match.
 */
const SPACE_ADVICE = /^One number per cell: remove the space(?: \(“[^”]*” → (.+)\))?\.$/;

/**
 * Text where a number belongs: "2 40" typed into a number field, or a number
 * written in quotes in the JSON. The advice is the capture grid's (lib/stats),
 * in an admin's words: a setting is no cell, and the entry is quoted once
 * ("“2 40” is not a number: remove the space (240).").
 */
export function notANumber(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "Enter a number.";
  const parsed = parseDecimal(trimmed);
  if (parsed.ok) return `Write ${trimmed} as a number, without quotes.`;
  const space = SPACE_ADVICE.exec(parsed.error);
  if (space) return `“${trimmed}” is not a number: remove the space${space[1] ? ` (${space[1]})` : ""}.`;
  return `“${trimmed}” is not a number. ${parsed.error}`;
}

/** safeParse with the plain wording. */
export function parseWithMessages<T>(schema: z.ZodType<T>, value: unknown): z.ZodSafeParseResult<T> {
  return schema.safeParse(value, { error: (issue) => friendlyMessage(issue) });
}

/**
 * Messages by path. A discriminator issue (zod puts it on the union's `kind`)
 * stays there, next to the type select; issues without a path belong to the
 * form as a whole (pathKey([])).
 */
export function issuesByPath(error: z.ZodError | null | undefined, prefix: FormPath = []): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  if (!error) return byPath;
  for (const issue of error.issues) {
    const path = [...prefix, ...issue.path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment))];
    const key = pathKey(path);
    const messages = byPath.get(key) ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    byPath.set(key, messages);
  }
  return byPath;
}

/** The messages at exactly this path. */
export function issuesAt(issues: FormIssues, path: FormPath): readonly string[] {
  return issues.get(pathKey(path)) ?? [];
}

/** How many messages sit at this path or anywhere under it: for a collapsed group's badge. */
export function countIssuesUnder(issues: FormIssues, path: FormPath): number {
  const prefix = pathKey(path).slice(0, -1);
  let total = 0;
  for (const [key, messages] of issues) {
    if (key === pathKey(path) || key.startsWith(prefix === "[" ? "[" : `${prefix},`)) total += messages.length;
  }
  return total;
}

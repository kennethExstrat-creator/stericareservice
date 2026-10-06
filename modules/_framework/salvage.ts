// Data tolerance. Saved data that fails its module's schema (data saved
// before a schema or an entry limit changed, such as a lot number over 200
// characters) is not all or nothing: the values the schema rejects are taken
// out and the rest is read. The context is built from what can be read, so
// one bad lot number never takes every ordered size away from the other
// modules; the engine still reports each rejected value as a blocking
// invalid_data error with its path. What it gives is for reading only:
// saving it is removing the rejected values, which needs someone's decision
// (readableData in context.ts).
import type { z } from "zod";
import type { IssuePath } from "@/lib/validation/issues";
import { readPath } from "./paths";

export type SalvagedData<T> = {
  /** The saved data without the values the schema rejects, as the schema parses it. */
  data: T;
  /** Where values were taken out: paths into the saved data. Empty when it parsed as it was. */
  dropped: IssuePath[];
};

/** More rounds than any module's data needs; a bound against data that never settles. */
const MAX_ROUNDS = 100;

/**
 * Takes out what the schema rejects, the smallest part first, and parses the
 * rest. A rejected list item becomes null where the list takes null, so the
 * others keep their places (reading 3 stays reading 3), and is removed where
 * it does not; a rejected field is removed, so its default applies; a field
 * the schema cannot do without takes its parent with it. Null when nothing
 * can be read: the value as a whole is wrong.
 */
export function salvageData<T>(schema: z.ZodType<T>, value: unknown): SalvagedData<T> | null {
  let current = cloneJson(value);
  const dropped = new Map<string, IssuePath>();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const parsed = schema.safeParse(current);
    if (parsed.success) return { data: parsed.data, dropped: [...dropped.values()] };
    const holder = { root: current };
    const takenThisRound: IssuePath[] = [];
    for (const path of repairOrder(parsed.error.issues)) {
      // Inside something already taken out this round: nothing left to do there.
      if (takenThisRound.some((taken) => startsWith(path, taken))) continue;
      const taken = takeOut(holder, ["root", ...path]);
      if (taken === null) return null;
      const inData = taken.slice(1);
      if (inData.length === 0) return null;
      takenThisRound.push(inData);
      dropped.set(pathKey(inData), inData);
    }
    if (takenThisRound.length === 0) return null;
    current = holder.root;
  }
  return null;
}

/** Each rejected value's path, deepest and last first, so taking one out never shifts another. */
function repairOrder(issues: z.ZodError["issues"]): IssuePath[] {
  const paths = new Map<string, IssuePath>();
  for (const issue of issues) {
    const base = cleanPath(issue.path);
    const targets = issue.code === "unrecognized_keys" ? issue.keys.map((key) => [...base, key]) : [base];
    for (const target of targets) paths.set(pathKey(target), target);
  }
  return [...paths.values()].sort(laterFirst);
}

function laterFirst(a: IssuePath, b: IssuePath): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") return right - left;
    return String(left) < String(right) ? -1 : 1;
  }
  return b.length - a.length;
}

/**
 * Takes the value at `path` out of `holder` in place: null for a list item
 * that is not null yet, else removed; a field removed. Where nothing is at
 * the path, its parent is what the schema rejects, so the parent goes.
 * Returns the path taken out, or null when only the holder itself is left.
 */
function takeOut(holder: Record<string, unknown>, path: IssuePath): IssuePath | null {
  for (let at = path; at.length > 1; at = at.slice(0, -1)) {
    const parent = readPath(holder, at.slice(0, -1));
    const key = at[at.length - 1];
    if (Array.isArray(parent) && typeof key === "number" && key < parent.length) {
      if (parent[key] !== null) parent[key] = null;
      else parent.splice(key, 1);
      return at;
    }
    if (isRecord(parent) && typeof key === "string" && Object.hasOwn(parent, key)) {
      delete parent[key];
      return at;
    }
  }
  return null;
}

function cleanPath(path: readonly PropertyKey[]): IssuePath {
  const end = path.findIndex((segment) => typeof segment === "symbol");
  return (end === -1 ? path : path.slice(0, end)) as IssuePath;
}

function startsWith(path: IssuePath, prefix: IssuePath): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

function pathKey(path: IssuePath): string {
  return JSON.stringify(path);
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

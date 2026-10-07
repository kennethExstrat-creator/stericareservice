// Entries a number field refused ("2 42" is not stored: BUILD_SPEC 6.2 rule
// 1), kept by the capture screen for the field's section and issue path, so
// the refused text and its reason outlive the field: a size switch (SizeTabs
// shows one size's panel at a time), a section switch and a reload bring the
// red cell and its link back (Kenneth: nothing typed is ever lost on a
// reload). They are never data: the stored value stays null. One lets go
// when a number lands at its path, however it got there. The Pending panel
// lists them first in their section's row ("Length, No. 3: “2 42” to
// retype"), linked to the cell. The device keeps them beside the local copy
// (lib/offline/refused.ts).
import type { IssuePath, ValidationIssue } from "@/lib/validation";
import { readModuleEntry, readPath, type DataNamespace, type InspectionData } from "@/modules/_framework";
import type { CaptureSection } from "./sections";

/** Where a refused entry was typed: the section's data and the field's issue path in it. */
export type RefusedLocation = { namespace: DataNamespace; section: string; path: IssuePath };

export type RefusedEntry = RefusedLocation & {
  /** The text as typed. */
  raw: string;
  /** Why it was refused. */
  error: string;
  /** The field's name, e.g. "Length, No. 3". */
  label?: string;
};

/** Refused entries by refusedEntryKey, in the order they were refused. */
export type RefusedEntries = ReadonlyMap<string, RefusedEntry>;

export const NO_REFUSED_ENTRIES: RefusedEntries = new Map();

/** Issue code of a refused entry listed in the Pending panel (never a validation issue). */
export const REFUSED_ENTRY_CODE = "entry_not_stored";

export function refusedEntryKey({ namespace, section, path }: RefusedLocation): string {
  return `${namespace}|${section}|${JSON.stringify(path)}`;
}

/** The entries as a map, the later of two at one path winning. */
export function refusedEntriesFrom(list: readonly RefusedEntry[]): RefusedEntries {
  return new Map(list.map((entry) => [refusedEntryKey(entry), entry]));
}

/**
 * The entries with one kept (`refused`) or let go (null) at `location`. The
 * same map comes back when that changes nothing, so a field reporting what
 * it already reported writes nothing.
 */
export function withRefusedEntry(
  entries: RefusedEntries,
  location: RefusedLocation,
  refused: { raw: string; error: string } | null,
  label?: string,
): RefusedEntries {
  const key = refusedEntryKey(location);
  const current = entries.get(key);
  if (refused === null) {
    if (!current) return entries;
    const next = new Map(entries);
    next.delete(key);
    return next;
  }
  const entry: RefusedEntry = {
    namespace: location.namespace,
    section: location.section,
    path: [...location.path],
    raw: refused.raw,
    error: refused.error,
    ...(label ? { label } : current?.label ? { label: current.label } : {}),
  };
  if (current && current.raw === entry.raw && current.error === entry.error && current.label === entry.label) return entries;
  const next = new Map(entries);
  // Refused again: it moves to the end, as the newest.
  next.delete(key);
  next.set(key, entry);
  return next;
}

/** Entries read back from the device, under the ones refused since the screen opened. */
export function mergeRefusedEntries(stored: RefusedEntries, since: RefusedEntries): RefusedEntries {
  if (stored.size === 0) return since;
  if (since.size === 0) return stored;
  const merged = new Map(stored);
  for (const [key, entry] of since) {
    merged.delete(key);
    merged.set(key, entry);
  }
  return merged;
}

/** The entries of one section, by issue path key (components/qc issuePathKey): what its fields read. */
export function sectionRefusedEntries(
  entries: RefusedEntries,
  namespace: DataNamespace,
  section: string,
): ReadonlyMap<string, RefusedEntry> {
  const own = new Map<string, RefusedEntry>();
  for (const entry of entries.values()) {
    if (entry.namespace === namespace && entry.section === section) own.set(JSON.stringify(entry.path), entry);
  }
  return own;
}

/**
 * The entries whose value has since landed: the data holds a value at
 * their path (a number typed or pasted there, another device's, the version
 * kept after a conflict). A path the data does not reach, or holds nothing
 * at, keeps its entry.
 */
export function settledRefusedKeys(entries: RefusedEntries, data: InspectionData): string[] {
  const settled: string[] = [];
  for (const [key, entry] of entries) {
    const value = readPath(readModuleEntry(data, entry.namespace, entry.section).value, entry.path);
    if (value !== null && value !== undefined && typeof value !== "object" && value !== "") settled.push(key);
  }
  return settled;
}

export function withoutRefusedKeys(entries: RefusedEntries, keys: readonly string[]): RefusedEntries {
  if (!keys.some((key) => entries.has(key))) return entries;
  const next = new Map(entries);
  for (const key of keys) next.delete(key);
  return next;
}

/** The size a path is about, by the kit's convention (`["sizes", "M", ...]`). */
export function refusedEntrySize(path: IssuePath): string | undefined {
  return path[0] === "sizes" && typeof path[1] === "string" ? path[1] : undefined;
}

/** Text this long, at most, is quoted whole in the Pending row; longer is cut with an ellipsis. */
const QUOTED_TEXT = 12;
/** A row's status this long, at most, names the field too. */
const NAMED_STATUS = 44;

/** "Length, No. 3: “2 42” to retype", or "“2 42” to retype" when that is too long or the field has no name. */
export function refusedEntryStatus(entry: Pick<RefusedEntry, "raw" | "label">): string {
  const text = entry.raw.trim() === "" ? entry.raw : entry.raw.trim();
  const quoted = `“${text.length > QUOTED_TEXT ? `${text.slice(0, QUOTED_TEXT - 1).trimEnd()}…` : text}”`;
  const named = entry.label ? `${entry.label}: ${quoted} to retype` : null;
  return named && named.length <= NAMED_STATUS ? named : `${quoted} to retype`;
}

/** Several refused entries in one section's row. */
export function refusedEntriesStatus(count: number): string {
  return count === 1 ? "1 entry to retype" : `${count} entries to retype`;
}

/**
 * The entries as items of the Pending panel, in screen order: only those in
 * a section on screen, for an ordered size. Each is a warning (the stored
 * value decides what submit needs: a required reading left empty is the
 * module's own error), worded as its row's status, linking to its field.
 * Entries for a section switched off or a size no longer ordered stay kept
 * on the device, and come back with them.
 */
export function refusedTaskIssues(
  entries: RefusedEntries,
  sections: readonly CaptureSection[],
  orderedSizes: readonly string[],
): ValidationIssue[] {
  const position = new Map(sections.map((section, index) => [section.key, index]));
  const listed = [...entries.values()].filter((entry) => {
    const section = sections.find((candidate) => candidate.key === entry.section);
    if (!section || section.kind === "excluded") return false;
    if ((section.kind === "module") !== (entry.namespace === "modules")) return false;
    const size = refusedEntrySize(entry.path);
    return size === undefined || orderedSizes.includes(size);
  });
  const sizeRank = (entry: RefusedEntry) => {
    const size = refusedEntrySize(entry.path);
    return size === undefined ? -1 : orderedSizes.indexOf(size);
  };
  listed.sort(
    (a, b) =>
      (position.get(a.section) ?? 0) - (position.get(b.section) ?? 0) ||
      sizeRank(a) - sizeRank(b) ||
      comparePaths(a.path, b.path),
  );
  return listed.map((entry) => {
    const size = refusedEntrySize(entry.path);
    return {
      level: "warning",
      moduleKey: entry.section,
      code: REFUSED_ENTRY_CODE,
      message: refusedEntryStatus(entry),
      path: [...entry.path],
      ...(size === undefined ? {} : { size }),
    };
  });
}

/** Paths in reading order: numbers by value (glove 2 before glove 10), names as text. */
function comparePaths(a: IssuePath, b: IssuePath): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right));
  }
  return a.length - b.length;
}

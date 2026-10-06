// What a numeric cell does with its text (BUILD_SPEC 6.2 rule 1), kept pure so
// the numbers-only rule is tested without a browser. NumericCell is the only
// caller; MeasurementGrid applies the same rule to pasted values.
import { formatReading, readDecimal, type Limits } from "@/lib/stats";

/** What was typed that is not a usable number, and why. */
export type InvalidEntry = { raw: string; error: string };

/** The stored value after leaving a cell, and the rejected entry if there is one. */
export type CommittedEntry = { value: number | null; invalid: InvalidEntry | null };

/**
 * Leaving a cell (blur, Enter, arrows) commits its text. A number, or blank,
 * is stored. Anything else, such as "2 42", stores nothing: the value becomes
 * null, so a stale reading never feeds a statistic, and the text comes back
 * exactly as typed with the reason. Text is never stored.
 */
export function commitEntry(raw: string, limits: Limits = {}): CommittedEntry {
  const result = readDecimal(raw, limits);
  return result.ok ? { value: result.value, invalid: null } : { value: null, invalid: { raw, error: result.error } };
}

/** What committing changes, relative to what the cell holds: only the parts that differ. */
export type EntryChange = { value?: number | null; invalid?: InvalidEntry | null };

/**
 * NumericCell's commit decision. A rejected entry clears a held reading (the
 * stale value must not feed a statistic) and records the text; a valid entry
 * clears an earlier rejection. Committing what is already held changes
 * nothing, so no save is triggered by merely leaving a cell.
 */
export function commitChange(raw: string, held: CommittedEntry, limits: Limits = {}): EntryChange {
  const next = commitEntry(raw, limits);
  const change: EntryChange = {};
  if (next.value !== held.value) change.value = next.value;
  if (next.invalid !== null || held.invalid !== null) change.invalid = next.invalid;
  return change;
}

/**
 * What a key does to a cell's text. Enter commits it. Escape drops an edit in
 * progress, so the cell shows what it held before; when nothing is being
 * edited Escape is left alone (it may close a dialog).
 */
export function entryKeyAction(key: string, editing: boolean): "commit" | "revert" | null {
  if (key === "Enter") return "commit";
  if (key === "Escape" && editing) return "revert";
  return null;
}

/**
 * The text a cell shows: the edit in progress; else a rejected entry, as
 * typed; else the stored reading. Escape drops the edit, so the cell falls
 * back to what was there before it.
 */
export function entryText(
  draft: string | null,
  invalid: InvalidEntry | null,
  value: number | null,
  decimals?: number,
): string {
  return draft ?? invalid?.raw ?? formatReading(value, decimals);
}

/**
 * Whether a rejected entry's error shows. It clears as soon as the edit in
 * progress becomes a valid number (reward early), and comes back if it stops
 * being one.
 */
export function showsEntryError(invalid: InvalidEntry | null, draft: string | null, limits: Limits = {}): boolean {
  return invalid !== null && (draft === null || !readDecimal(draft, limits).ok);
}

/**
 * The words for a rejected entry, shown under a field and announced when the
 * cell is left, e.g. "Width, No. 3: “2 42” is not stored. One number per cell…".
 */
export function rejectionMessage(entry: InvalidEntry, where?: string): string {
  return `${where ? `${where}: ` : ""}“${entry.raw}” is not stored. ${entry.error}`;
}

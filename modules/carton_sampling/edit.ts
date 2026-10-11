// Edits of the carton list, pure so they are tested without a browser.
// Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md), so a pasted list lands in one change. Carton numbers
// are stored in the order they were entered, without gaps. A list saved from
// the earlier 10 x 5 grid may still hold blanks (null) between its numbers:
// the screen shows only the numbers, and the first edit stores the list
// without the blanks. Every other size is kept as it was, one no longer
// ordered included (6.2 rule 4). An edit that changes nothing returns `data`
// itself, so nothing is saved, and every edit returns data the schema keeps.
//
// The field refuses what calc could only report: a number the size already
// lists (6.2 rule 6, unique per size) and text that is no carton number (6.2
// rule 1). A number above the order quantity is added: calc fails it, and the
// chip turns red with a link (6.2 rule 6).
import { formatCount } from "@/lib/format";
import { enteredCartons, MAX_CARTONS_PER_SIZE, type CartonSamplingData } from "./schema";

/** Why an entry was not added. */
export type CartonRefusal =
  /** The size lists it already, or the same paste gave it before. */
  | { readonly reason: "listed"; readonly raw: string; readonly carton: number }
  /** Not a whole number from 1: "0", "52.5", "abc". */
  | { readonly reason: "not_a_carton"; readonly raw: string }
  /** Typed text holding more than one number, such as "2 42": one is typed at a time, a pasted list is split. */
  | { readonly reason: "several"; readonly raw: string }
  /** Past the most a size holds (MAX_CARTONS_PER_SIZE). */
  | { readonly reason: "full"; readonly raw: string; readonly carton: number };

/** Carton numbers typed or pasted: separated by spaces, tabs, new lines, commas or semicolons. */
export function splitCartonText(text: string): string[] {
  return text.split(/[\s,;]+/).filter((part) => part !== "");
}

/** One carton number: digits only, a whole number from 1 ("0525" is 525). Null for anything else. */
export function readCartonNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const carton = Number(text);
  return Number.isSafeInteger(carton) && carton >= 1 ? carton : null;
}

export type TypedCarton =
  /** Nothing but spaces or separators. */
  | { readonly kind: "empty" }
  /** One entry, for addCartons to check and add. */
  | { readonly kind: "entry"; readonly raw: string }
  | { readonly kind: "refused"; readonly refusal: CartonRefusal };

/**
 * What Enter, Add or leaving the field does with the typed text. One number
 * is typed at a time: text holding several ("2 42", "32, 578") is refused, as
 * a number field refuses "2 42" (6.2 rule 1), so a stray space never turns
 * one carton into two. A pasted list is split instead (pastedCartons).
 */
export function readTypedCarton(text: string): TypedCarton {
  const parts = splitCartonText(text);
  if (parts.length === 0) return { kind: "empty" };
  if (parts.length > 1) return { kind: "refused", refusal: { reason: "several", raw: text.trim() } };
  return { kind: "entry", raw: parts[0] };
}

/** The entries of a paste that holds several carton numbers, to add at once; null for one or none, pasted as typed text. */
export function pastedCartons(text: string): string[] | null {
  const parts = splitCartonText(text);
  return parts.length > 1 ? parts : null;
}

export type AddedCartons = {
  readonly data: CartonSamplingData;
  /** Added after the size's numbers, in the order given. */
  readonly added: readonly number[];
  /** Left out, in the order given. */
  readonly refused: readonly CartonRefusal[];
};

/**
 * Adds the entries after the size's numbers, in the order given. A number
 * the size lists already (or one given twice), text that is no carton number
 * and anything past the most a size holds are left out; the rest is stored
 * without the blanks a grid-saved list kept.
 */
export function addCartons(data: CartonSamplingData, size: string, entries: readonly string[]): AddedCartons {
  const listed = enteredCartons(data.sizes[size]);
  const seen = new Set(listed);
  const added: number[] = [];
  const refused: CartonRefusal[] = [];
  for (const entry of entries) {
    const raw = entry.trim();
    if (raw === "") continue;
    const carton = readCartonNumber(raw);
    if (carton === null) refused.push({ reason: "not_a_carton", raw });
    else if (seen.has(carton)) refused.push({ reason: "listed", raw, carton });
    else if (listed.length + added.length >= MAX_CARTONS_PER_SIZE) refused.push({ reason: "full", raw, carton });
    else {
      added.push(carton);
      seen.add(carton);
    }
  }
  if (added.length === 0) return { data, added, refused };
  return { data: withCartons(data, size, [...listed, ...added]), added, refused };
}

/**
 * Removes the carton a chip shows, at `index` of the stored list (blanks
 * counted). The latest data can be ahead of the screen, so the number is
 * checked there and found by its value if it moved; one already gone is not
 * removed twice. The rest is stored without blanks.
 */
export function removeCarton(data: CartonSamplingData, size: string, index: number, carton: number): CartonSamplingData {
  const cells = data.sizes[size]?.cartonNumbers ?? [];
  const at = cells[index] === carton ? index : cells.indexOf(carton);
  if (at === -1) return data;
  return withCartons(
    data,
    size,
    cells.filter((value, position): value is number => position !== at && value !== null),
  );
}

/** The line under the field for an entry it refused. */
export function refusalMessage(refusal: CartonRefusal): string {
  switch (refusal.reason) {
    case "listed":
      return `Carton ${refusal.carton} is already in the list.`;
    case "not_a_carton":
      return `“${refusal.raw}” is not a carton number: whole numbers from 1 only.`;
    case "several":
      return `“${refusal.raw}” is more than one number. Add one carton at a time, or paste the list.`;
    case "full":
      return `Carton ${refusal.carton} is not added: a size holds at most ${formatCount(MAX_CARTONS_PER_SIZE)} carton numbers.`;
  }
}

/** Entries quoted in full in a paste's line; more are counted. */
const SHOWN_ENTRIES = 5;

/**
 * The line under the field after a pasted list: how many were added, then
 * what was left out, by why, each named once ("Already in the list: 525, 578.").
 */
export function pasteMessage(added: number, refused: readonly CartonRefusal[]): string {
  const parts = [added === 0 ? "No carton numbers added." : `Added ${counted(added, "carton number")}.`];
  const once = (names: string[]) => [...new Set(names)];
  const listed = once(refused.flatMap((entry) => (entry.reason === "listed" ? [String(entry.carton)] : [])));
  const notCartons = once(refused.flatMap((entry) => (entry.reason === "not_a_carton" ? [`“${entry.raw}”`] : [])));
  const full = once(refused.flatMap((entry) => (entry.reason === "full" ? [String(entry.carton)] : [])));
  if (listed.length > 0) parts.push(`Already in the list: ${some(listed)}.`);
  if (notCartons.length > 0) parts.push(`Not carton numbers: ${some(notCartons)}.`);
  if (full.length > 0) parts.push(`Over the ${formatCount(MAX_CARTONS_PER_SIZE)} a size holds: ${some(full)}.`);
  return parts.join(" ");
}

/** `data` with the size's list replaced; every other size as it was. */
function withCartons(data: CartonSamplingData, size: string, cartons: number[]): CartonSamplingData {
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], cartonNumbers: cartons } } };
}

/** "1 carton number", "8 carton numbers". */
function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** "32, 578" or "32, 578, 1186, 2389, 2865 and 3 more". */
function some(entries: readonly string[]): string {
  if (entries.length <= SHOWN_ENTRIES) return entries.join(", ");
  return `${entries.slice(0, SHOWN_ENTRIES).join(", ")} and ${formatCount(entries.length - SHOWN_ENTRIES)} more`;
}

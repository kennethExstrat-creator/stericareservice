// Edits of the carton table, pure so they are tested without a browser.
// Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md), so a pasted list lands in one change. Carton numbers
// are stored by row (Kenneth, 13 October 2026: a table of rows to fill in):
// index i is row i + 1 of the size's table, a row left empty is null, and
// the empty rows at the end are dropped. Nothing is ever moved up to close a
// gap: a number stays in the row it was typed in. A list saved before then
// (in the order entered, without gaps) simply fills rows 1 to n; one saved
// from the earlier 10 x 5 grid keeps its blanks in their rows. Every other
// size is kept as it was, one no longer ordered included (6.2 rule 4). An
// edit that changes nothing returns `data` itself, so nothing is saved, and
// every edit returns data the schema keeps.
//
// A row refuses what calc could only report: a number another row of the
// size holds (6.2 rule 6, unique per size) and text that is no box/carton
// number (6.2 rule 1). A number above the order quantity is stored: calc
// fails it, and its row turns red with a link (6.2 rule 6). Messages say
// "Box/Carton #1003" for one number and "box/carton numbers" for several
// (Kenneth, 13 October 2026: box # and carton # are one number).
import { boxCartonNumber, countBoxCartonNumbers, formatCount } from "@/lib/format";
import { MAX_CARTONS_PER_SIZE, type CartonSamplingData } from "./schema";

/** Rows on one page of a size's carton table (Kenneth, 13 October 2026). */
export const CARTONS_PER_PAGE = 10;

/** The fewest rows a size's table shows: 10 to fill in while the sampling plan has no cases for it, or fewer. */
export const MIN_CARTON_ROWS = 10;

/** Rows one press of "Add 10 Rows" adds, for the rare carton past the plan. */
export const ADDED_CARTON_ROWS = 10;

/** The page of the table that shows row `index` (from 0), from 0. */
export function cartonPageOf(index: number): number {
  return Math.floor(Math.max(index, 0) / CARTONS_PER_PAGE);
}

/**
 * Rows the table shows: the sampling plan's cases for the size (`planned`,
 * null until the plan gives them), at least 10, more when more rows are saved
 * or asked for with Add 10 Rows (`requested`), never past what a size holds.
 */
export function cartonRowsShown(planned: number | null, saved: number, requested = 0): number {
  return Math.min(MAX_CARTONS_PER_SIZE, Math.max(MIN_CARTON_ROWS, planned ?? 0, saved, requested));
}

/**
 * The row Enter (`step` 1) or Shift+Enter (`step` -1) moves to from row
 * `index`, among the `rows` shown; null past either end. Enter never adds a
 * row: past the last row the focus stays where it is.
 */
export function nextCartonRow(index: number, rows: number, step: 1 | -1): number | null {
  const next = index + step;
  return next >= 0 && next < rows ? next : null;
}

/** The size's rows as stored: index i is row i + 1, null an empty row. */
export function cartonRows(data: CartonSamplingData, size: string): readonly (number | null)[] {
  return data.sizes[size]?.cartonNumbers ?? [];
}

/** Why an entry was not stored. */
export type CartonRefusal =
  /** Another row of the size holds it (row `index`, from 0), or the same paste put it there before. */
  | { readonly reason: "listed"; readonly raw: string; readonly carton: number; readonly index: number }
  /** Not a whole number from 1: "0", "52.5", "abc". */
  | { readonly reason: "not_a_carton"; readonly raw: string }
  /** Typed text holding more than one number, such as "2 42": one is typed per row, a pasted list is split. */
  | { readonly reason: "several"; readonly raw: string }
  /** Past the most a size holds (MAX_CARTONS_PER_SIZE). */
  | { readonly reason: "full"; readonly raw: string; readonly carton: number };

/** Carton numbers typed or pasted: separated by spaces, tabs, new lines, commas or semicolons. */
export function splitCartonText(text: string): string[] {
  return text.split(/[\s,;]+/).filter((part) => part !== "");
}

/** One box/carton number: digits only, a whole number from 1 ("0525" is 525). Null for anything else. */
export function readCartonNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const carton = Number(text);
  return Number.isSafeInteger(carton) && carton >= 1 ? carton : null;
}

export type TypedCarton =
  /** Nothing but spaces or separators: the row is emptied. */
  | { readonly kind: "empty" }
  /** One box/carton number, for setCartonRow to check against the other rows. */
  | { readonly kind: "carton"; readonly carton: number }
  | { readonly kind: "refused"; readonly refusal: CartonRefusal };

/**
 * What Enter or leaving a row does with the text typed in it. One number per
 * row: text holding several ("2 42", "32, 578") is refused, as a number
 * field refuses "2 42" (6.2 rule 1), so a stray space never turns one carton
 * into two. A pasted list is split instead (pastedCartons).
 */
export function readTypedCarton(text: string): TypedCarton {
  const parts = splitCartonText(text);
  if (parts.length === 0) return { kind: "empty" };
  if (parts.length > 1) return { kind: "refused", refusal: { reason: "several", raw: text.trim() } };
  const carton = readCartonNumber(parts[0]);
  return carton === null ? { kind: "refused", refusal: { reason: "not_a_carton", raw: parts[0] } } : { kind: "carton", carton };
}

/** The entries of a paste that holds several box/carton numbers, to fill rows with; null for one or none, pasted as typed text. */
export function pastedCartons(text: string): string[] | null {
  const parts = splitCartonText(text);
  return parts.length > 1 ? parts : null;
}

/** `rows` without the empty rows at its end. */
export function withoutTrailingBlanks(rows: readonly (number | null)[]): (number | null)[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1] === null) end -= 1;
  return rows.slice(0, end);
}

export type CartonRowChange = {
  readonly data: CartonSamplingData;
  /** Why the row was left as it was: another row holds the number, or it is past what a size holds. */
  readonly refusal: CartonRefusal | null;
};

/**
 * Stores `carton` in row `index` (from 0); null empties the row. The rows
 * below keep their place, and empty rows at the end are dropped. A number
 * another row of the size holds is refused and nothing changes (6.2 rule 6:
 * unique per size; the latest data is checked, which can be ahead of the
 * screen). The row already holding it, or an empty row emptied, changes
 * nothing either: the same `data` comes back.
 */
export function setCartonRow(data: CartonSamplingData, size: string, index: number, carton: number | null): CartonRowChange {
  if (!Number.isInteger(index) || index < 0) return { data, refusal: null };
  const rows = cartonRows(data, size);
  if ((rows[index] ?? null) === carton) return { data, refusal: null };
  if (carton !== null) {
    const held = rows.findIndex((other, at) => at !== index && other === carton);
    if (held !== -1) return { data, refusal: { reason: "listed", raw: String(carton), carton, index: held } };
    if (index >= MAX_CARTONS_PER_SIZE) return { data, refusal: { reason: "full", raw: String(carton), carton } };
  }
  const next = [...rows];
  while (next.length <= index) next.push(null);
  next[index] = carton;
  return { data: withRows(data, size, next), refusal: null };
}

/** Empties row `index` (its clear button): the rows below keep their place. */
export function clearCartonRow(data: CartonSamplingData, size: string, index: number): CartonSamplingData {
  return setCartonRow(data, size, index, null).data;
}

/** A row a paste filled. */
export type PlacedCarton = { readonly index: number; readonly carton: number };

export type PastedCartons = {
  readonly data: CartonSamplingData;
  /** The rows filled, one after another from the row pasted into, in the order pasted. */
  readonly placed: readonly PlacedCarton[];
  /** Of those, rows that held another number before. */
  readonly replaced: number;
  /** Left out, in the order pasted. */
  readonly refused: readonly CartonRefusal[];
};

/**
 * A pasted list from row `start` (from 0): its numbers fill that row and the
 * rows below, one a row, in the order pasted, over what those rows held, as
 * a spreadsheet takes a pasted column; past the rows shown the table grows,
 * up to what a size holds. Left out, each with its reason: text that is no
 * box/carton number, a number the paste gives twice, a number a row the paste
 * does not fill holds already (6.2 rule 6), and numbers past what a size
 * holds. The rows filled are the rows the kept numbers take, so a number
 * left out leaves no gap. Nothing filled, or every row filled with the
 * number it held: the same `data` comes back.
 */
export function pasteCartons(data: CartonSamplingData, size: string, start: number, entries: readonly string[]): PastedCartons {
  const rows = cartonRows(data, size);
  const room = Math.max(0, MAX_CARTONS_PER_SIZE - start);
  type Read = { readonly order: number; readonly raw: string; readonly carton: number };
  const notCartons: { order: number; refusal: CartonRefusal }[] = [];
  const repeats: Read[] = [];
  const numbers: Read[] = [];
  const given = new Set<number>();
  entries.forEach((entry, order) => {
    const raw = entry.trim();
    if (raw === "") return;
    const carton = readCartonNumber(raw);
    if (carton === null) notCartons.push({ order, refusal: { reason: "not_a_carton", raw } });
    else if (given.has(carton)) repeats.push({ order, raw, carton });
    else {
      given.add(carton);
      numbers.push({ order, raw, carton });
    }
  });

  // The rows the paste fills depend on how many numbers it keeps, and a row
  // it no longer reaches keeps its number, which a later pasted number may
  // repeat: drop the numbers the rows left alone hold until none does.
  let kept = numbers;
  let held = heldOutside(rows, start, start + Math.min(kept.length, room));
  for (;;) {
    const next = kept.filter((entry) => !held.has(entry.carton));
    if (next.length === kept.length) break;
    kept = next;
    held = heldOutside(rows, start, start + Math.min(kept.length, room));
  }

  const filled = kept.slice(0, room);
  const placed = filled.map((entry, offset) => ({ index: start + offset, carton: entry.carton }));
  const rowOf = new Map(placed.map((entry) => [entry.carton, entry.index]));
  const refused = [
    ...notCartons,
    ...numbers.flatMap((entry) => {
      const at = held.get(entry.carton);
      return at === undefined ? [] : [{ order: entry.order, refusal: listed(entry, at) }];
    }),
    ...kept.slice(room).map((entry) => ({ order: entry.order, refusal: full(entry) })),
    ...repeats.map((entry) => {
      const at = rowOf.get(entry.carton) ?? held.get(entry.carton);
      return { order: entry.order, refusal: at === undefined ? full(entry) : listed(entry, at) };
    }),
  ]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.refusal);

  // Every row filled held its number already: nothing to save.
  if (placed.every(({ index, carton }) => rows[index] === carton)) return { data, placed, replaced: 0, refused };
  const next = [...rows];
  while (next.length < start) next.push(null);
  let replaced = 0;
  for (const { index, carton } of placed) {
    const before = next[index] ?? null;
    if (before !== null && before !== carton) replaced += 1;
    next[index] = carton;
  }
  return { data: withRows(data, size, next), placed, replaced, refused };
}

/** The line under a row for an entry it refused. */
export function refusalMessage(refusal: CartonRefusal): string {
  switch (refusal.reason) {
    case "listed":
      return `${boxCartonNumber(refusal.carton)} is already in row ${refusal.index + 1}.`;
    case "not_a_carton":
      return `“${refusal.raw}” is not a box/carton number: whole numbers from 1 only.`;
    case "several":
      return `“${refusal.raw}” is more than one number. Type one box/carton number per row, or paste the list.`;
    case "full":
      return `${boxCartonNumber(refusal.carton)} is not added: a size holds at most ${countBoxCartonNumbers(MAX_CARTONS_PER_SIZE)}.`;
  }
}

/** Entries quoted in full in a paste's line; more are counted. */
const SHOWN_ENTRIES = 5;

/**
 * The one line a pasted list leaves under the table: the rows it filled,
 * then what was left out and why, each named once ("Left out: 525 (already
 * in row 20), “abc” (not a box/carton number).").
 */
export function pasteMessage({ placed, replaced, refused }: Pick<PastedCartons, "placed" | "replaced" | "refused">): string {
  const parts: string[] = [];
  if (placed.length === 0) parts.push("No box/carton numbers pasted.");
  else {
    const first = placed[0].index + 1;
    const last = placed[placed.length - 1].index + 1;
    const rows = first === last ? `row ${first}` : `rows ${first} to ${last}`;
    const over = replaced > 0 ? `, replacing ${counted(replaced, "number")}` : "";
    parts.push(`Pasted ${countBoxCartonNumbers(placed.length)} into ${rows}${over}.`);
  }
  const leftOut = [...new Set(refused.map(leftOutEntry))];
  if (leftOut.length > 0) parts.push(`Left out: ${some(leftOut)}.`);
  return parts.join(" ");
}

/** `data` with the size's rows replaced, empty rows at the end dropped; every other size as it was. */
function withRows(data: CartonSamplingData, size: string, rows: readonly (number | null)[]): CartonSamplingData {
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], cartonNumbers: withoutTrailingBlanks(rows) } } };
}

/** The numbers held outside rows `from` to `to` (not included), each with the first row holding it. */
function heldOutside(rows: readonly (number | null)[], from: number, to: number): Map<number, number> {
  const held = new Map<number, number>();
  rows.forEach((carton, index) => {
    if (carton !== null && (index < from || index >= to) && !held.has(carton)) held.set(carton, index);
  });
  return held;
}

function listed(entry: { raw: string; carton: number }, index: number): CartonRefusal {
  return { reason: "listed", raw: entry.raw, carton: entry.carton, index };
}

function full(entry: { raw: string; carton: number }): CartonRefusal {
  return { reason: "full", raw: entry.raw, carton: entry.carton };
}

/** How a paste's line names an entry it left out. */
function leftOutEntry(refusal: CartonRefusal): string {
  switch (refusal.reason) {
    case "listed":
      return `${refusal.carton} (already in row ${refusal.index + 1})`;
    case "not_a_carton":
      return `“${refusal.raw}” (not a box/carton number)`;
    case "several":
      return `“${refusal.raw}” (more than one number)`;
    case "full":
      return `${refusal.carton} (past the ${formatCount(MAX_CARTONS_PER_SIZE)} a size holds)`;
  }
}

/** "1 number", "8 numbers". */
function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** "32, 578" or "32, 578, 1186, 2389, 2865 and 3 more". */
function some(entries: readonly string[]): string {
  if (entries.length <= SHOWN_ENTRIES) return entries.join(", ");
  return `${entries.slice(0, SHOWN_ENTRIES).join(", ")} and ${formatCount(entries.length - SHOWN_ENTRIES)} more`;
}

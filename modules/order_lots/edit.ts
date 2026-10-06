// Edits of the order table, pure so they are tested without a browser.
// Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md), so a pasted column of quantities lands in one change
// with every size kept. Each returns the whole data, writes a size under its
// canonical key (dropping another spelling of it, whose line calc already
// ignores) and leaves every other size's line as it was, ordered or not. An
// edit that changes nothing returns `data` itself, and no change is saved.
// Every edit returns data the schema keeps: a lot or a site too long for it
// would leave the order unreadable, and every size with it.
import { normaliseSize } from "@/lib/sizes";
import { readOrder } from "./calc";
import { emptyOrderLine, LOT_NUMBER_MAX_LENGTH, TEXT_MAX_LENGTH, type OrderLine, type OrderLotsData } from "./schema";

/** The saved line a size shows: under its canonical key, else under another spelling of it. */
export function lineFor(data: OrderLotsData, size: string): OrderLine {
  const row = readOrder(data).rows.find((entry) => entry.size === size);
  return row ? data.sizes[row.key] : emptyOrderLine();
}

/** The size's line with `patch` applied, the packing site cut to what the schema keeps; an emptied line is removed. */
export function setLine(data: OrderLotsData, size: string, patch: Partial<OrderLine>): OrderLotsData {
  const merged = { ...lineFor(data, size), ...patch };
  const line = { ...merged, packingSite: merged.packingSite === null ? null : clampText(merged.packingSite, TEXT_MAX_LENGTH) };
  const others = Object.fromEntries(Object.entries(data.sizes).filter(([key]) => normaliseSize(key) !== size));
  return { ...data, sizes: isEmptyLine(line) ? others : { ...others, [size]: line } };
}

/** Trims the size's packing site once it is left; nothing but spaces is blank. */
export function tidySite(data: OrderLotsData, size: string): OrderLotsData {
  const site = lineFor(data, size).packingSite;
  if (site === null || site === site.trim()) return data;
  return setLine(data, size, { packingSite: site.trim() === "" ? null : site.trim() });
}

/** Lots typed or pasted: one per line, or separated by commas, semicolons or tabs. */
export function splitLots(raw: string): string[] {
  return raw
    .split(/[\n\r\t,;]+/)
    .map((lot) => lot.trim())
    .filter((lot) => lot !== "");
}

export type AddedLots = {
  data: OrderLotsData;
  /** Lots the size already has, or given twice. */
  skipped: string[];
  /** Lots longer than LOT_NUMBER_MAX_LENGTH: most likely a list without separators the split knows. */
  tooLong: string[];
};

/** Adds lots after the saved ones; a lot the size already has, one given twice or one too long to keep is left out. */
export function addLots(data: OrderLotsData, size: string, lots: readonly string[]): AddedLots {
  const current = lineFor(data, size).lotNumbers;
  const seen = new Set(current.map((lot) => lot.trim()));
  const added: string[] = [];
  const skipped: string[] = [];
  const tooLong: string[] = [];
  for (const raw of lots) {
    const lot = raw.trim();
    if (lot === "") continue;
    if (lot.length > LOT_NUMBER_MAX_LENGTH) tooLong.push(lot);
    else if (seen.has(lot)) skipped.push(lot);
    else added.push(lot);
    seen.add(lot);
  }
  if (added.length === 0) return { data, skipped, tooLong };
  return { data: setLine(data, size, { lotNumbers: [...current, ...added] }), skipped, tooLong };
}

/** What addLots left out, in a sentence for the lot field; blank when it added everything. */
export function leftOutNotice({ skipped, tooLong }: Pick<AddedLots, "skipped" | "tooLong">): string {
  const parts: string[] = [];
  if (skipped.length > 0) parts.push(`Already listed: ${skipped.join(", ")}.`);
  if (tooLong.length > 0) {
    const shown = tooLong.map((lot) => `“${lot.slice(0, 20)}…”`).join(", ");
    parts.push(
      `Not added, over ${LOT_NUMBER_MAX_LENGTH} characters: ${shown}. Separate lots with commas, semicolons or new lines.`,
    );
  }
  return parts.join(" ");
}

/**
 * Removes the lot a chip shows at `index`. The latest data can be ahead of
 * the screen, so the lot is checked there and found by its text if it moved;
 * one already gone is not removed twice.
 */
export function removeLot(data: OrderLotsData, size: string, index: number, lot: string): OrderLotsData {
  const lots = lineFor(data, size).lotNumbers;
  const at = lots[index] === lot ? index : lots.indexOf(lot);
  if (at === -1) return data;
  return setLine(data, size, { lotNumbers: lots.filter((_, position) => position !== at) });
}

/** Removes a line saved under a key the table does not show: not a size, a second spelling, or a size the template lacks. */
export function removeKey(data: OrderLotsData, key: string): OrderLotsData {
  if (!Object.hasOwn(data.sizes, key)) return data;
  return { ...data, sizes: Object.fromEntries(Object.entries(data.sizes).filter(([saved]) => saved !== key)) };
}

function isEmptyLine(line: OrderLine): boolean {
  return line.qtyCases === null && line.lotNumbers.length === 0 && (line.packingSite === null || line.packingSite === "");
}

/** At most `max` UTF-16 units, as the schema and the field count them, without cutting a character in two. */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

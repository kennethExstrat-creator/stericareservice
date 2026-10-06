// Edits of the order table, pure so they are tested without a browser.
// Capture applies each to the latest data through useDataUpdater
// (docs/CAPTURE_KIT.md), so a pasted column of quantities lands in one change
// with every size kept. Each returns the whole data, writes a size under its
// canonical key (dropping another spelling of it, whose line calc already
// ignores) and leaves every other size's line as it was, ordered or not. An
// edit that changes nothing returns `data` itself, and no change is saved.
import { normaliseSize } from "@/lib/sizes";
import { readOrder } from "./calc";
import { emptyOrderLine, type OrderLine, type OrderLotsData } from "./schema";

/** The saved line a size shows: under its canonical key, else under another spelling of it. */
export function lineFor(data: OrderLotsData, size: string): OrderLine {
  const row = readOrder(data).rows.find((entry) => entry.size === size);
  return row ? data.sizes[row.key] : emptyOrderLine();
}

/** The size's line with `patch` applied; an emptied line is removed. */
export function setLine(data: OrderLotsData, size: string, patch: Partial<OrderLine>): OrderLotsData {
  const line = { ...lineFor(data, size), ...patch };
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

/** Adds lots after the saved ones; a lot the size already has, or one given twice, is skipped. */
export function addLots(data: OrderLotsData, size: string, lots: readonly string[]): { data: OrderLotsData; skipped: string[] } {
  const current = lineFor(data, size).lotNumbers;
  const seen = new Set(current.map((lot) => lot.trim()));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const raw of lots) {
    const lot = raw.trim();
    if (lot === "") continue;
    if (seen.has(lot)) skipped.push(lot);
    else added.push(lot);
    seen.add(lot);
  }
  if (added.length === 0) return { data, skipped };
  return { data: setLine(data, size, { lotNumbers: [...current, ...added] }), skipped };
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

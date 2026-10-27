// Freedom From Holes by Watertight Test, sizes across (modules/watertight):
// the holes found over the gloves tested ("5 / 315"), the size's limit
// ("10 / 11", Accept / Reject) and where the holes were, in the template's
// order and wording ("Between Fingers (Crotch) 1, Palm 3, Cuff 1"), as the
// module's summary writes them. A size rejected is red on its holes. A hole
// the template does not list (an inspector's one-off label, a code it lacks)
// is amber, and so is a hole under "Other :" without saying where, or the
// gloves tested the module warns about (not the sampling plan's, too few).
import { HANDS, labelFor } from "@/modules/_framework";
import type { WatertightComputed, WatertightSizeComputed } from "@/modules/watertight/calc";
import { OTHER_LOCATION } from "@/modules/watertight/config";
import { WatertightDataSchema, type WatertightData, type WatertightHand } from "@/modules/watertight/schema";
import type { SizeTableAdapter, SizeTableCell } from "../size-table";
import { cellsBySize, EMPTY_CELL } from "./cells";
import { cellOf, countedItem, foundCell, hasIssueAt, isRecord, tableOf, toneOf, withWarning } from "./counts-format";

export const watertightTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as WatertightComputed;
  if (!isRecord(computed.sizes)) return null;
  const locations = Array.isArray(computed.locations) ? computed.locations : [];
  const parsed = WatertightDataSchema.safeParse(entry.data);
  const saved = parsed.success ? parsed.data : null;
  const of = (size: string): WatertightSizeComputed | null => computed.sizes[size] ?? null;
  const { labels, issues } = entry;

  const holes = cellsBySize(context, (size) => {
    const own = of(size);
    if (!own) return EMPTY_CELL;
    return cellOf(countText(own.totalDefects, own.tested), {
      tone: toneOf(own.result === "fail", hasIssueAt(issues, ["sizes", size, "tested"])),
    });
  });

  const limits = cellsBySize(context, (size) => {
    const own = of(size);
    return own && own.accept !== null && own.reject !== null ? { text: `${own.accept} / ${own.reject}` } : EMPTY_CELL;
  });

  const where = cellsBySize(context, (size): SizeTableCell => {
    const own = of(size);
    if (!own) return EMPTY_CELL;
    const listed = new Map(locations.map((location) => [location.code, location.label]));
    const descriptions = otherDescriptions(saved, size, own.hands !== null);
    const found: string[] = [];
    const unlisted: string[] = [];
    for (const [code, count] of Object.entries(own.holes)) {
      if (count === 0) continue;
      const label = listed.get(code);
      if (label === undefined) {
        unlisted.push(countedItem(code, count));
        continue;
      }
      // "Other :" reads "Other", with where the inspector said: "Other: Near the thumb 1".
      const name = label.replace(/\s*:\s*$/, "");
      const detail = code === OTHER_LOCATION && descriptions.length > 0 ? `: ${descriptions.join(", ")}` : "";
      found.push(countedItem(`${name}${detail}`, count));
    }
    for (const hole of own.unmapped) unlisted.push(countedItem(hole.label, hole.count));
    // An "Other :" hole without saying where (hole_other_undescribed), on the size or a hand.
    const undescribed = hasIssueAt(issues, ["sizes", size, "otherDescription"], ["sizes", size, null, "otherDescription"]);
    return withWarning(foundCell(found, unlisted, { recorded: own.tested !== null }), undescribed);
  });

  return tableOf([
    { key: "holes", label: "Holes Found", cells: holes },
    {
      key: "defectLimit",
      label: labelFor(labels, "defectLimit"),
      spec: `${labelFor(labels, "accept")} / ${labelFor(labels, "reject")}`,
      cells: limits,
    },
    { key: "where", label: "Where", cells: where },
  ]);
};

/**
 * "5 / 315": the holes over the gloves tested, as the summary prints them;
 * "2 found" while the gloves tested are not entered; nothing yet (—).
 */
function countText(total: number, tested: number | null): string | null {
  if (tested !== null) return `${total} / ${tested}`;
  return total > 0 ? `${total} found` : null;
}

/** Where the "Other :" holes were, as described, on the size or on each hand: what the summary adds to "Other". */
function otherDescriptions(saved: WatertightData | null, size: string, split: boolean): string[] {
  const entry = saved?.sizes[size];
  if (!entry) return [];
  const records: WatertightHand[] = split
    ? HANDS.flatMap((hand) => {
        const record = entry[hand];
        return record ? [record] : [];
      })
    : [entry];
  return records.flatMap((record) => {
    const description = record.otherDescription?.trim() ?? "";
    return (record.holes[OTHER_LOCATION] ?? 0) > 0 && description !== "" ? [description] : [];
  });
}

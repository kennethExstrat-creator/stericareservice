// Visual Inspection, sizes across (modules/visual): for each class the
// template switches on, in report order, the defects found over the gloves
// inspected ("3 / 315") with the size's limit ("Limit 14 / 15", under the
// label when every size has the same one: critical's "Limit 0 / 1"), and,
// once any size found one, what was found, in the template's wording ("Skin
// Visual 1"), as the module's summary writes them. A class rejected for a
// size is red; a defect the template does not list (an inspector's one-off
// label, "Ring mark 2", or a code it lacks) is amber on the second line, and
// so are the gloves inspected the module warns about. A class the inspector
// left out of a size that has another class inspected reads Not Inspected,
// with no limit (Kenneth, 30 October 2026); a size with no class inspected
// yet shows nothing (—), as before.
import { NOT_INSPECTED_LABEL } from "@/lib/design/status";
import { classLabel, isInspectedClass, type VisualClassComputed, type VisualComputed } from "@/modules/visual/calc";
import { DEFECT_CLASSES } from "@/modules/visual/schema";
import type { SizeTableAdapter, SizeTableCell, SizeTableRow } from "../size-table";
import { cellsBySize, EMPTY_CELL } from "./cells";
import { cellOf, countedItem, foundCell, hasIssueAt, isRecord, rowWithLimits, tableOf, toneOf } from "./counts-format";

export const visualTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as VisualComputed;
  if (!isRecord(computed.sizes) || !isRecord(computed.classes)) return null;
  const rows: SizeTableRow[] = [];
  /** The size has a class inspected: one it does not is then left out, not still to come. */
  const inspectedSize = (size: string) => DEFECT_CLASSES.some((cls) => isInspectedClass(computed.sizes[size]?.[cls]));

  for (const cls of DEFECT_CLASSES) {
    const info = computed.classes[cls];
    if (!info?.include) continue;
    const name = classLabel(entry.labels, cls);
    const of = (size: string): VisualClassComputed | null => computed.sizes[size]?.[cls] ?? null;

    /** Left out of a size that has another class inspected. */
    const leftOut = (size: string) => {
      const own = of(size);
      return own !== null && !isInspectedClass(own) && inspectedSize(size);
    };

    const totals = cellsBySize(context, (size) => {
      const own = of(size);
      if (!own) return EMPTY_CELL;
      if (leftOut(size)) return cellOf(NOT_INSPECTED_LABEL);
      return cellOf(countText(own.total, own.inspected), {
        tone: toneOf(own.result === "fail", hasIssueAt(entry.issues, ["sizes", size, cls, "inspected"])),
      });
    });
    const limits = context.sizes.map((size) => {
      const own = of(size);
      return own && !leftOut(size) && own.accept !== null && own.reject !== null ? `Limit ${own.accept} / ${own.reject}` : null;
    });
    rows.push(rowWithLimits({ key: cls, label: name, cells: totals }, limits));

    if (context.sizes.some((size) => (of(size)?.total ?? 0) > 0)) {
      const names = new Map(info.defects.map((defect) => [defect.code, defect.label]));
      rows.push({
        key: `${cls}Found`,
        label: `${name} Found`,
        cells: cellsBySize(context, (size) => foundOf(of(size), names)),
      });
    }
  }
  return tableOf(rows);
};

/**
 * "3 / 315": the class's defects over the gloves inspected, as the summary
 * prints them; "1 found" while the gloves inspected are not entered (a
 * critical defect fails before then); nothing yet (—).
 */
function countText(total: number, inspected: number | null): string | null {
  if (inspected !== null) return `${total} / ${inspected}`;
  return total > 0 ? `${total} found` : null;
}

/** The defects a size found in a class, in the template's order and wording; those it does not list after them, amber. */
function foundOf(own: VisualClassComputed | null, names: ReadonlyMap<string, string>): SizeTableCell {
  if (!own) return EMPTY_CELL;
  const listed: string[] = [];
  const unlisted: string[] = [];
  for (const [code, count] of Object.entries(own.counts)) {
    if (count === 0) continue;
    const label = names.get(code);
    if (label === undefined) unlisted.push(countedItem(code, count));
    else listed.push(countedItem(label, count));
  }
  for (const defect of own.unmapped) unlisted.push(countedItem(defect.label, defect.count));
  return foundCell(listed, unlisted, { recorded: own.inspected !== null });
}

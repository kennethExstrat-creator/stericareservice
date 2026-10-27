// Glove Dispensing Inspection, sizes across (modules/dispensing_safedon): the
// boxes tested of those planned ("8 of 8"), the boxes with a defect, once any
// size found one the defects by kind in the template's wording ("Sticky
// Glove 11"), and the defect rate as the summary prints it ("11 / 1,000
// (1.1%)") against the template's maximum under the label ("Max. 5%"). A
// rate over the maximum is red. Amber for what the module warns about in the
// boxes: a box/carton number not sampled, defects counted in a box without
// one, a defect the template does not have. The rate of the boxes tested so
// far shows while a size is not done, and is not judged yet.
import { formatDecimal } from "@/lib/stats";
import { labelFor } from "@/modules/_framework";
import type { DispensingSafedonComputed, SafedonSizeComputed } from "@/modules/dispensing_safedon/calc";
import { DispensingSafedonConfigSchema } from "@/modules/dispensing_safedon/config";
import { formatSizeRate } from "@/modules/dispensing_safedon/text";
import type { SizeTableAdapter, SizeTableCell, SizeTableRow } from "../size-table";
import { cellsBySize, EMPTY_CELL } from "./cells";
import { cellOf, countedItem, foundCell, hasIssueAt, isRecord, tableOf, toneOf, withWarning } from "./counts-format";

export const dispensingSafedonTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as DispensingSafedonComputed;
  if (!isRecord(computed.sizes)) return null;
  const config = DispensingSafedonConfigSchema.safeParse(entry.config);
  if (!config.success) return null;
  const { defects, maxRatePct } = config.data;
  const { labels, issues } = entry;
  const of = (size: string): SafedonSizeComputed | null => computed.sizes[size] ?? null;
  const bySize = (cell: (own: SafedonSizeComputed, size: string) => SizeTableCell) =>
    cellsBySize(context, (size) => {
      const own = of(size);
      return own ? cell(own, size) : EMPTY_CELL;
    });
  // A defect the template does not have, counted in a box (defect_not_in_template): left out of the total.
  const notInTemplate = (size: string) => hasIssueAt(issues, ["sizes", size, "boxes", null, "counts"]);

  const rows: SizeTableRow[] = [
    {
      key: "boxesTested",
      label: labelFor(labels, "boxesTested"),
      cells: bySize((own, size) => {
        // Defects counted in a box with no box/carton number: not tested, and the summary names its No. in the list.
        const untested = own.boxes.findIndex((box) => box.boxNo === null && box.boxDefects > 0);
        return cellOf(`${own.boxesTested} of ${own.boxesExpected}`, {
          note: untested === -1 ? null : `${labelFor(labels, "boxNo")} missing in No. ${untested + 1}`,
          tone: toneOf(false, untested !== -1 || hasIssueAt(issues, ["sizes", size, "boxes", null, "boxNo"])),
        });
      }),
    },
    {
      key: "boxesFailed",
      label: labelFor(labels, "boxesFailed"),
      cells: bySize((own) => cellOf(own.boxesTested > 0 ? String(own.boxesFailed) : null)),
    },
  ];

  if (context.sizes.some((size) => (of(size)?.totalDefects ?? 0) > 0 || notInTemplate(size))) {
    rows.push({
      key: "defectCounts",
      label: labelFor(labels, "counts"),
      cells: bySize((own, size) => {
        // The defects of the boxes tested, by kind, in the template's order and wording.
        const found = defects.flatMap((defect) => {
          const count = own.defectCounts[defect.code] ?? 0;
          return count > 0 ? [countedItem(defect.label, count)] : [];
        });
        return withWarning(foundCell(found, [], { recorded: own.boxesTested > 0 }), notInTemplate(size));
      }),
    });
  }

  rows.push({
    key: "ratePct",
    label: labelFor(labels, "ratePct"),
    spec: `Max. ${formatDecimal(maxRatePct)}%`,
    cells: bySize((own) =>
      own.glovesInspected > 0
        ? cellOf(formatSizeRate(own.totalDefects, own.glovesInspected), { tone: toneOf(own.result === "fail", false) })
        : EMPTY_CELL,
    ),
  });
  return tableOf(rows);
};

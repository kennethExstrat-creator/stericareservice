// Packaging Labeling Inspection, sizes across (modules/labeling): a row per
// level the template inspects, in its wording ("Dispenser Box", "Carton
// Box"), with the defects found in the boxes inspected as the module's
// summary writes them ("0 defects in 3", "0 defects in 2 (plan 3)") and the
// checks that found them on the second line ("Wrong / No Lot Number 1").
// Any defect fails a level (the limit under the label: "Limit 0 / 1"): red.
// Amber for what the module warns about at a level: fewer boxes inspected
// than planned, a box/carton number not sampled or entered twice, a defect
// found before the boxes inspected are recorded.
import { checkLabel, includedLevels, levelLabel, type LabelingComputed, type LabelingLevelComputed } from "@/modules/labeling/calc";
import { LabelingConfigSchema } from "@/modules/labeling/config";
import { LabelingDataSchema } from "@/modules/labeling/schema";
import type { SizeTableAdapter, SizeTableRow } from "../size-table";
import { cellsBySize, EMPTY_CELL } from "./cells";
import { cellOf, countedItem, hasIssueAt, isRecord, sharedText, tableOf, toneOf } from "./counts-format";

export const labelingTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as LabelingComputed;
  if (!isRecord(computed.sizes)) return null;
  const parsedConfig = LabelingConfigSchema.safeParse(entry.config);
  if (!parsedConfig.success) return null;
  const config = parsedConfig.data;
  const parsed = LabelingDataSchema.safeParse(entry.data);
  const saved = parsed.success ? parsed.data : null;

  const rows = includedLevels(config).map((level): SizeTableRow => {
    const { checks, n: planned } = config.levels[level];
    const of = (size: string): LabelingLevelComputed | null => computed.sizes[size]?.[level] ?? null;
    const cells = cellsBySize(context, (size) => {
      const own = of(size);
      if (!own) return EMPTY_CELL;
      const recorded = saved?.sizes[size]?.[level] ?? null;
      // The checks that found defects, in the template's order and wording, as the summary lists them.
      const found = checks.flatMap((check) => {
        const count = recorded?.defects[check.code] ?? 0;
        return count > 0 ? [countedItem(checkLabel(entry.labels, level, check), count)] : [];
      });
      return cellOf(levelText(own, recorded?.inspected ?? null, planned), {
        note: found.join(", "),
        tone: toneOf(own.result === "fail", hasIssueAt(entry.issues, ["sizes", size, level])),
      });
    });
    // Accept 0 / Reject 1 at every level and size (BUILD_SPEC 7).
    const limit = sharedText(
      context.sizes.map((size) => {
        const own = of(size);
        return own ? `Limit ${own.accept} / ${own.reject}` : null;
      }),
    );
    return { key: level, label: levelLabel(entry.labels, level), ...(limit === null ? {} : { spec: limit }), cells };
  });
  return tableOf(rows);
};

/**
 * A level as the size's summary words it, without its name: "0 defects in
 * 3", "0 defects in 2 (plan 3)", "1 defect" found before the boxes
 * inspected are recorded, "No boxes inspected"; nothing recorded yet (—).
 */
function levelText(own: LabelingLevelComputed, inspected: number | null, planned: number): string | null {
  if (own.result === "not_done") return inspected === 0 ? "No boxes inspected" : null;
  const defects = `${own.total} ${own.total === 1 ? "defect" : "defects"}`;
  if (inspected === null) return defects;
  return `${defects} in ${inspected}${inspected < planned ? ` (plan ${planned})` : ""}`;
}

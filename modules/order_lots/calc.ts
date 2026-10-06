// Result "info" once every ordered size has its lot numbers (and its packing
// site when the template shows the column); "not done" until then (BUILD_SPEC
// 6.2 rule 5). A size is ordered when it has a quantity, and the ordered sizes
// are the only sizes any module shows (rule 4): this module gives them to the
// context. Totals are computed, never typed (rule 2): cartons from the
// quantities, gloves with the gloves per case that packing_config puts in the
// context.
import { normaliseSize, orderSizes, SIZE_HINT } from "@/lib/sizes";
import {
  errorIssue,
  labelFor,
  notDone,
  sizeLabel,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import type { PerSizeResult } from "@/lib/schemas";
import type { OrderLotsConfig } from "./config";
import type { OrderLine, OrderLotsData } from "./schema";

export type OrderLotsComputed = {
  /** Per ordered size: cases x gloves per case, the lot size the AQL plan starts from. Null until the packing is known. */
  lotSizeGloves: Record<string, number | null>;
  /** "Total # carton": the ordered cases added up. Null while no size is ordered. */
  totalCartons: number | null;
  /** "Total # gloves": total cartons x gloves per case. Null until both are known. */
  totalGloves: number | null;
};

/** One size's line, read from the key it is saved under. */
export type OrderRow = {
  /** Canonical size. */
  size: string;
  /** The key in `data.sizes`: the size, or another spelling of it in older data. */
  key: string;
  qtyCases: number | null;
  /** Trimmed, blanks left out. */
  lotNumbers: string[];
  packingSite: string | null;
};

export type OrderedRow = OrderRow & { qtyCases: number };

export type OrderReading = {
  /** One row per size saved, in the template's size order. */
  rows: OrderRow[];
  /** Keys that are not sizes at all. */
  invalid: string[];
  /** A second spelling of a size already saved ("m" beside "M"): ignored. */
  duplicates: { key: string; size: string }[];
};

/**
 * The saved lines by canonical size. When one size is saved under two
 * spellings, the canonical key wins, as it does in the context.
 */
export function readOrder(data: OrderLotsData, templateSizes: readonly { value: string }[] = []): OrderReading {
  const bySize = new Map<string, OrderRow>();
  const invalid: string[] = [];
  const duplicates: { key: string; size: string }[] = [];
  for (const [key, line] of Object.entries(data.sizes)) {
    const size = normaliseSize(key);
    if (size === null) {
      invalid.push(key);
      continue;
    }
    const current = bySize.get(size);
    if (current === undefined) {
      bySize.set(size, toRow(key, size, line));
    } else if (key === size) {
      duplicates.push({ key: current.key, size });
      bySize.set(size, toRow(key, size, line));
    } else {
      duplicates.push({ key, size });
    }
  }
  const order = orderSizes(
    bySize.keys(),
    templateSizes.map((size) => size.value),
  );
  return { rows: order.flatMap((size) => bySize.get(size) ?? []), invalid, duplicates };
}

export function isOrdered(row: OrderRow): row is OrderedRow {
  return row.qtyCases !== null && row.qtyCases > 0;
}

export function calcOrderLots({
  data,
  config,
  labels,
  context,
}: CalcInput<OrderLotsData, OrderLotsConfig>): CalcOutput<OrderLotsComputed> {
  const { rows, invalid, duplicates } = readOrder(data, context.templateSizes);
  const issues = [...keyIssues(invalid, duplicates), ...rows.flatMap((row) => rowIssues(row, data, context, labels))];

  const ordered = rows.filter(isOrdered);
  const perCase = context.packing.glovesPerCase;
  const totalCartons = ordered.length === 0 ? null : ordered.reduce((sum, row) => sum + row.qtyCases, 0);
  const computed: OrderLotsComputed = {
    lotSizeGloves: Object.fromEntries(ordered.map((row) => [row.size, perCase === null ? null : row.qtyCases * perCase])),
    totalCartons,
    totalGloves: totalCartons === null || perCase === null ? null : totalCartons * perCase,
  };
  const perSize: Record<string, PerSizeResult> = Object.fromEntries(
    ordered.map((row) => [row.size, rowResult(row, config, labels)]),
  );

  const missing = missingValues(rows, config, labels, context);
  if (ordered.length === 0 && missing.length === 0) {
    return {
      result: notDone(`No size ordered yet: enter the ${labelFor(labels, "qtyCases")} of each size in the order.`),
      computed,
      issues,
    };
  }
  if (missing.length > 0) {
    return { result: { ...notDone(sentence(`Missing: ${missing.join("; ")}`)), perSize }, computed, issues };
  }
  return { result: { status: "info", summary: summarise(ordered, computed, labels, context), perSize }, computed, issues };
}

/** The ordered sizes, with their quantities and lots, for every other module (6.2 rule 4). */
export function contributeOrderLots({ data }: ContributeInput<OrderLotsData, OrderLotsConfig>): ContextContribution {
  const ordered = readOrder(data).rows.filter(isOrdered);
  return {
    sizes: ordered.map((row) => row.size),
    order: Object.fromEntries(
      ordered.map((row) => [row.size, { qtyCases: row.qtyCases, lotNumbers: [...new Set(row.lotNumbers)] }]),
    ),
  };
}

function toRow(key: string, size: string, line: OrderLine): OrderRow {
  const site = line.packingSite?.trim() ?? "";
  return {
    size,
    key,
    qtyCases: line.qtyCases,
    lotNumbers: line.lotNumbers.map((lot) => lot.trim()).filter((lot) => lot !== ""),
    packingSite: site === "" ? null : site,
  };
}

function hasEntries(row: OrderRow): boolean {
  return row.qtyCases !== null || row.lotNumbers.length > 0 || row.packingSite !== null;
}

function keyIssues(invalid: readonly string[], duplicates: OrderReading["duplicates"]): CalcIssue[] {
  return [
    ...invalid.map((key) =>
      errorIssue("order_size_invalid", `"${key}" is not a size. ${SIZE_HINT}`, { path: ["sizes", key] }),
    ),
    ...duplicates.map(({ key, size }) =>
      errorIssue(
        "order_size_duplicate",
        `Size ${size} is entered twice, also as "${key}". The line under "${key}" is ignored.`,
        { size, path: ["sizes", key] },
      ),
    ),
  ];
}

function rowIssues(row: OrderRow, data: OrderLotsData, context: InspectionContext, labels: Labels): CalcIssue[] {
  const issues: CalcIssue[] = [];
  const offered = context.templateSizes.map((size) => size.value);
  if (offered.length > 0 && !offered.includes(row.size) && hasEntries(row)) {
    issues.push(
      errorIssue(
        "order_size_not_in_template",
        `Size ${row.size} is not one of this template's sizes (${offered.join(", ")}).`,
        { size: row.size, path: ["sizes", row.key] },
      ),
    );
  }
  const seen = new Set<string>();
  (data.sizes[row.key]?.lotNumbers ?? []).forEach((raw, index) => {
    const lot = raw.trim();
    if (lot === "") return;
    if (seen.has(lot)) {
      issues.push(
        warningIssue(
          "lot_number_duplicate",
          `${labelFor(labels, "lotNumbers")} ${lot} is entered twice for size ${sizeLabel(context, row.size)}.`,
          { size: row.size, path: ["sizes", row.key, "lotNumbers", index] },
        ),
      );
    }
    seen.add(lot);
  });
  return issues;
}

/** "Lot Number for size M", grouped by what is missing, in column order. */
function missingValues(
  rows: readonly OrderRow[],
  config: OrderLotsConfig,
  labels: Labels,
  context: InspectionContext,
): string[] {
  const sizesWithout = (field: "qtyCases" | "lotNumbers" | "packingSite", sizes: string[]) =>
    sizes.length === 0
      ? []
      : [
          `${labelFor(labels, field)} for size${sizes.length > 1 ? "s" : ""} ${sizes
            .map((size) => sizeLabel(context, size))
            .join(", ")}`,
        ];
  // A line with lots or a site but no quantity is a size the inspector meant to order.
  const noQuantity = rows.filter((row) => !isOrdered(row) && (row.lotNumbers.length > 0 || row.packingSite !== null));
  const ordered = rows.filter(isOrdered);
  return [
    ...sizesWithout(
      "qtyCases",
      noQuantity.map((row) => row.size),
    ),
    ...sizesWithout(
      "lotNumbers",
      ordered.filter((row) => row.lotNumbers.length === 0).map((row) => row.size),
    ),
    ...(config.fields.packingSite
      ? sizesWithout(
          "packingSite",
          ordered.filter((row) => row.packingSite === null).map((row) => row.size),
        )
      : []),
  ];
}

function rowResult(row: OrderedRow, config: OrderLotsConfig, labels: Labels): PerSizeResult {
  const missing = [
    ...(row.lotNumbers.length === 0 ? [labelFor(labels, "lotNumbers")] : []),
    ...(config.fields.packingSite && row.packingSite === null ? [labelFor(labels, "packingSite")] : []),
  ];
  if (missing.length > 0) return { status: "not_done", summary: sentence(`Missing: ${missing.join(", ")}`) };
  const parts = [
    `${labelFor(labels, "qtyCases")} ${formatCount(row.qtyCases)}`,
    `${labelFor(labels, "lotNumbers")} ${row.lotNumbers.join(", ")}`,
    ...(config.fields.packingSite && row.packingSite !== null ? [`${labelFor(labels, "packingSite")} ${row.packingSite}`] : []),
  ];
  return { status: "info", summary: sentence(parts.join("; ")) };
}

/** "Sizes XS, S, M, L. Total # carton 1,530; Total # gloves 3,060,000." */
function summarise(
  ordered: readonly OrderedRow[],
  computed: OrderLotsComputed,
  labels: Labels,
  context: InspectionContext,
): string {
  const sizes = `Size${ordered.length > 1 ? "s" : ""} ${ordered.map((row) => sizeLabel(context, row.size)).join(", ")}`;
  const cartons = `${labelFor(labels, "totalCartons")} ${formatCount(computed.totalCartons ?? 0)}`;
  const gloves =
    computed.totalGloves === null
      ? `${labelFor(labels, "totalGloves")}: waiting for the gloves per case`
      : `${labelFor(labels, "totalGloves")} ${formatCount(computed.totalGloves)}`;
  return `${sizes}. ${cartons}; ${gloves}.`;
}

/** 5800000 as "5,800,000". */
function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** One full stop at the end, also after a label or value that has its own ("Lot No.", "Sdn. Bhd."). */
function sentence(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

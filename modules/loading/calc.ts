// BUILD_SPEC 6.1 loading: a record (info) once every field the template shows
// is filled in; a warning when the cartons loaded differ from the order's total
// cartons (order_lots, through the context), or the container number fails its
// ISO 6346 check. Not done while a shown field is empty, or while the order
// total the cartons are compared with is unknown (6.2 rule 5).
import {
  isBlank,
  labelFor,
  notDone,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { LOADING_FIELDS, type LoadingConfig, type LoadingField } from "./config";
import { checkContainerNumber } from "./container-number";
import type { LoadingData } from "./schema";

export type LoadingComputed = {
  /** order_lots' total cartons: the ordered sizes' quantities added up. Null until every ordered size has one. */
  cartonsOrdered: number | null;
  /** Cartons loaded minus cartons ordered: below 0 is short. Null until both are known. */
  cartonsDifference: number | null;
};

/** The order's total cartons (order_lots.totalCartons), from the context. */
export function cartonsOrdered(context: InspectionContext): number | null {
  if (context.sizes.length === 0) return null;
  let total = 0;
  for (const size of context.sizes) {
    const cases = context.order[size]?.qtyCases ?? null;
    if (cases === null) return null;
    total += cases;
  }
  return total;
}

const COUNT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 2,900: thousands grouped as the reports print them. */
function count(value: number): string {
  return COUNT_FORMAT.format(value);
}

export function calcLoading({
  data,
  config,
  labels,
  context,
}: CalcInput<LoadingData, LoadingConfig>): CalcOutput<LoadingComputed> {
  const shown = LOADING_FIELDS.filter((field) => config.fields[field]);
  const ordered = cartonsOrdered(context);
  const loaded = config.fields.cartonsLoaded ? data.cartonsLoaded : null;
  const difference = loaded !== null && ordered !== null ? loaded - ordered : null;
  const computed: LoadingComputed = { cartonsOrdered: ordered, cartonsDifference: difference };
  const issues: CalcIssue[] = [];
  const label = (key: string) => labelFor(labels, key);

  if (difference !== null && difference !== 0) {
    issues.push(
      warningIssue(
        "loading_quantity_mismatch",
        `${label("cartonsLoaded")} (${count(loaded ?? 0)}) does not match ${label("cartonsOrdered")} (${count(ordered ?? 0)}): ${shortOrOver(difference)}.`,
        { path: ["cartonsLoaded"] },
      ),
    );
  }
  const container = config.fields.containerNo && !isBlank(data.containerNo) ? checkContainerNumber(data.containerNo ?? "") : null;
  if (container && !container.ok) {
    issues.push(
      container.reason === "check_digit"
        ? warningIssue(
            "container_no_check_digit",
            `${label("containerNo")} ${data.containerNo?.trim()}: the ISO 6346 check digit should be ${container.expected}. Check the number on the container.`,
            { path: ["containerNo"] },
          )
        : warningIssue(
            "container_no_format",
            `${label("containerNo")} ${data.containerNo?.trim()} is not an ISO 6346 container number (4 letters and 7 digits, e.g. CSQU 305438 3).`,
            { path: ["containerNo"] },
          ),
    );
  }

  if (shown.length === 0) {
    return { result: { status: "info", summary: "No fields are switched on." }, computed, issues };
  }
  const missing = shown.filter((field) => !isFilled(data, field)).map(label);
  const open = [
    ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}.`] : []),
    ...(loaded !== null && ordered === null
      ? [`${label("cartonsOrdered")}: not known until the order quantities are entered.`]
      : []),
  ];
  if (open.length > 0) return { result: notDone(open.join(" ")), computed, issues };

  const summary = summarise(data, config, labels, ordered, difference, container?.ok === false);
  return { result: { status: issues.length > 0 ? "warn" : "info", summary }, computed, issues };
}

function isFilled(data: LoadingData, field: LoadingField): boolean {
  return !isBlank(data[field]);
}

function shortOrOver(difference: number): string {
  return difference < 0 ? `${count(-difference)} short` : `${count(difference)} over`;
}

/** "Container No. CSQU3054383; Seal No. SL-0001; Cartons Loaded 2,900 of 2,900." */
function summarise(
  data: LoadingData,
  config: LoadingConfig,
  labels: Labels,
  ordered: number | null,
  difference: number | null,
  containerFlagged: boolean,
): string {
  const parts: string[] = [];
  if (config.fields.containerNo) {
    parts.push(`${labelFor(labels, "containerNo")} ${data.containerNo?.trim()}${containerFlagged ? " (check the number)" : ""}`);
  }
  if (config.fields.sealNo) parts.push(`${labelFor(labels, "sealNo")} ${data.sealNo?.trim()}`);
  if (config.fields.cartonsLoaded && data.cartonsLoaded !== null && ordered !== null) {
    const off = difference !== null && difference !== 0 ? ` (${shortOrOver(difference)})` : "";
    parts.push(`${labelFor(labels, "cartonsLoaded")} ${count(data.cartonsLoaded)} of ${count(ordered)}${off}`);
  }
  if (parts.length === 0) return `${labelFor(labels, "cartonCondition")} recorded.`;
  return `${parts.join("; ")}.`;
}

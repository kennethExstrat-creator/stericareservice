// Result "info" once every row the template shows is filled in; "not done"
// until then (BUILD_SPEC 6.2 rule 5). The client, the product code and the
// factory glove code may stay blank: the STD_EG example leaves the client and
// the glove code blank, and not every product has a code of its own. "warn"
// when the expiry date is not after the manufacturing date (6.1), or when the
// gloves were made after the inspection date. PO, product and dates reach
// every module and the export through the context (rule 10).
import {
  labelFor,
  notDone,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
  type HeaderValues,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { HEADER_FIELDS, type HeaderConfig, type HeaderField } from "./config";
import { datePart, formatDate, formatDay } from "./dates";
import { HEADER_DATE_FIELDS, type HeaderData } from "./schema";

/** The header as the report prints it, with what the inspection row and the app fill in. Exported. */
export type HeaderComputed = {
  /** The inspection's manufacturer, picked on /inspections/new. */
  manufacturer: string | null;
  /** The inspection's client; may be empty. */
  client: string | null;
  /** The logged-in inspector, always recorded (6.2 rule 11). */
  inspector: string | null;
  /** The header's date, else the inspection row's. */
  inspectionDate: string | null;
  /** At the template's precision: "2025-04-01", or "2025-04" for month and year. */
  mfgDate: string | null;
  expiryDate: string | null;
};

/** Each row's value: entered in the header, or taken from the inspection and the app. */
export type HeaderRows = Readonly<Record<HeaderField, string | null>>;

/** Rows that may stay blank once the header is done. */
export const OPTIONAL_HEADER_FIELDS: ReadonlySet<HeaderField> = new Set(["client", "productCode", "factoryGloveCode"]);

type SharedTextField = keyof HeaderValues & keyof HeaderData;

/** Text the rest of the inspection reads from the context (HeaderValues). */
const SHARED_TEXT_FIELDS = ["poNo", "productName", "productCode"] as const satisfies readonly SharedTextField[];

export function calcHeader({
  data,
  config,
  labels,
  context,
}: CalcInput<HeaderData, HeaderConfig>): CalcOutput<HeaderComputed> {
  const rows = headerRows(data, config, context);
  const precision = config.mfgExpiryPrecision;
  const computed: HeaderComputed = {
    manufacturer: rows.manufacturer,
    client: rows.client,
    inspector: rows.inspector,
    inspectionDate: rows.inspectionDate,
    mfgDate: rows.mfgDate === null ? null : datePart(rows.mfgDate, precision),
    expiryDate: rows.expiryDate === null ? null : datePart(rows.expiryDate, precision),
  };
  const issues = dateIssues(rows, config, labels);

  const shown = HEADER_FIELDS.filter((field) => config.fields[field]);
  if (shown.length === 0) {
    return { result: { status: "info", summary: "No fields are switched on." }, computed, issues };
  }
  const missing = shown.filter((field) => !OPTIONAL_HEADER_FIELDS.has(field) && rows[field] === null);
  if (missing.length > 0) {
    return {
      result: notDone(sentence(`Missing: ${missing.map((field) => labelFor(labels, field)).join(", ")}`)),
      computed,
      issues,
    };
  }
  if (issues.length > 0) {
    return { result: { status: "warn", summary: issues.map((issue) => issue.message).join(" ") }, computed, issues };
  }
  return { result: { status: "info", summary: summarise(rows, config, labels) }, computed, issues };
}

/**
 * PO, product name, product code and the dates the template shows. Blank
 * values are left out, so the context keeps the inspection row's date.
 */
export function contributeHeader({ data, config }: ContributeInput<HeaderData, HeaderConfig>): ContextContribution {
  const header: Partial<HeaderValues> = {};
  for (const field of SHARED_TEXT_FIELDS) {
    const value = text(data[field]);
    if (config.fields[field] && value !== null) header[field] = value;
  }
  for (const field of HEADER_DATE_FIELDS) {
    const value = data[field];
    if (config.fields[field] && value !== null) header[field] = value;
  }
  return { header };
}

/**
 * Every row as the report prints it. The manufacturer, the client and the
 * inspector come from the inspection, never typed (6.2 rules 10 and 11); a
 * blank inspection date is the inspection row's, as in the context.
 */
export function headerRows(data: HeaderData, config: HeaderConfig, context: InspectionContext): HeaderRows {
  return {
    manufacturer: text(context.header.manufacturer) ?? text(context.inspection.manufacturer?.name),
    factoryAddress: text(data.factoryAddress),
    poNo: text(data.poNo),
    productName: text(data.productName),
    productCode: text(data.productCode),
    client: text(context.header.client) ?? text(context.inspection.client?.name),
    factoryGloveCode: text(data.factoryGloveCode),
    inspectionDate: (config.fields.inspectionDate ? data.inspectionDate : null) ?? context.header.inspectionDate,
    mfgDate: data.mfgDate,
    expiryDate: data.expiryDate,
    inspector: text(context.inspection.inspector?.name),
  };
}

/** Compared as ISO text at the template's precision; worded as the app shows dates ("1 Apr 2025", "Apr 2025"). */
function dateIssues(rows: HeaderRows, config: HeaderConfig, labels: Labels): CalcIssue[] {
  const precision = config.mfgExpiryPrecision;
  const mfg = config.fields.mfgDate ? rows.mfgDate : null;
  const expiry = config.fields.expiryDate ? rows.expiryDate : null;
  const issues: CalcIssue[] = [];
  if (mfg !== null && expiry !== null && datePart(expiry, precision) <= datePart(mfg, precision)) {
    issues.push(
      warningIssue(
        "expiry_not_after_mfg",
        `${labelFor(labels, "expiryDate")} ${formatDate(expiry, precision)} is not after ${labelFor(labels, "mfgDate")} ${formatDate(mfg, precision)}.`,
        { path: ["expiryDate"] },
      ),
    );
  }
  // Pre-shipment gloves are made before they are inspected: a later date is a mistyped year or month.
  const inspected = rows.inspectionDate;
  if (mfg !== null && inspected !== null && datePart(mfg, precision) > datePart(inspected, precision)) {
    issues.push(
      warningIssue(
        "mfg_after_inspection",
        `${labelFor(labels, "mfgDate")} ${formatDate(mfg, precision)} is after ${labelFor(labels, "inspectionDate")} ${formatDay(inspected)}.`,
        { path: ["mfgDate"] },
      ),
    );
  }
  return issues;
}

/** "PO-0001 (SO-0001): Brand A PC-A01 Blue Nitrile; Manufacturer A; Inspection date 11 Apr 2025." */
function summarise(rows: HeaderRows, config: HeaderConfig, labels: Labels): string {
  const shown = (field: HeaderField) => (config.fields[field] ? rows[field] : null);
  const product = shown("productName")?.replace(/\s+/g, " ") ?? null;
  const order = [shown("poNo"), product].filter((part) => part !== null).join(": ");
  const date = shown("inspectionDate");
  const parts = [
    order,
    shown("manufacturer"),
    date === null ? null : `${labelFor(labels, "inspectionDate")} ${formatDay(date)}`,
  ];
  const text = parts.filter((part) => part !== null && part !== "").join("; ");
  return text === "" ? "Complete." : sentence(text);
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** One full stop at the end, also after a label or value that has its own ("Exp. Date.", "Sdn. Bhd."). */
function sentence(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

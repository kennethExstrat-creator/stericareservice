// BUILD_SPEC 6.1 documents: fail if a required item is not verified; warn if
// an item has expired (its expiry date is before the inspection date, from
// the context); pass otherwise. Not done while an item on the checklist has no
// status (6.2 rule 5). Items the template switches off are ignored.
import {
  labelFor,
  notDone,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type Labels,
} from "@/modules/_framework";
import { checklist, DOCUMENT_STATUSES, type DocumentItem, type DocumentsConfig, type DocumentStatus } from "./config";
import type { DocumentsData } from "./schema";

export type DocumentsComputed = {
  /**
   * Per item on the checklist: the expiry date is before the inspection date.
   * Null when the item is NA, or either date is missing.
   */
  expired: Record<string, boolean | null>;
  /** Items on the checklist per status; `open` have none yet. */
  counts: Record<DocumentStatus | "open", number>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` strings compare as dates. Null when either is missing. */
export function isExpired(expiryDate: string | null, inspectionDate: string | null): boolean | null {
  if (expiryDate === null || inspectionDate === null) return null;
  if (!ISO_DATE.test(expiryDate) || !ISO_DATE.test(inspectionDate)) return null;
  return expiryDate < inspectionDate;
}

export function calcDocuments({
  data,
  config,
  labels,
  context,
}: CalcInput<DocumentsData, DocumentsConfig>): CalcOutput<DocumentsComputed> {
  const items = checklist(config);
  const inspectionDate = context.header.inspectionDate;
  const issues: CalcIssue[] = [];
  const expired: Record<string, boolean | null> = {};
  const counts: DocumentsComputed["counts"] = { verified: 0, not_verified: 0, na: 0, open: 0 };

  for (const { key } of items) {
    const entry = data.items[key];
    counts[entry.status ?? "open"] += 1;
    expired[key] = entry.status === "na" ? null : isExpired(entry.expiryDate, inspectionDate);
    if (expired[key] === true) {
      issues.push(
        warningIssue(
          "document_expired",
          `${labelFor(labels, key)}: ${labelFor(labels, "expiryDate")} ${entry.expiryDate} is before the inspection date ${inspectionDate}.`,
          { path: ["items", key, "expiryDate"] },
        ),
      );
    }
  }

  const computed = { expired, counts };
  if (items.length === 0) {
    return { result: { status: "info", summary: "No documents are switched on." }, computed, issues };
  }

  const name = (key: DocumentItem) => labelFor(labels, key);
  const requiredNotVerified = items.filter(
    (item) => item.required && (data.items[item.key].status === "not_verified" || data.items[item.key].status === "na"),
  );
  const open = items.filter((item) => data.items[item.key].status === null);
  const lapsed = items.filter((item) => expired[item.key] === true);

  const parts: string[] = [];
  if (requiredNotVerified.length > 0) {
    parts.push(`Required, not verified: ${requiredNotVerified.map((item) => name(item.key)).join(", ")}.`);
  }
  if (open.length > 0) parts.push(`Missing: ${open.map((item) => name(item.key)).join(", ")}.`);
  if (lapsed.length > 0) {
    parts.push(`Expired: ${lapsed.map((item) => `${name(item.key)} (${data.items[item.key].expiryDate})`).join(", ")}.`);
  }
  if (requiredNotVerified.length === 0 && open.length === 0) parts.push(tally(counts, labels));
  const summary = parts.join(" ");

  if (requiredNotVerified.length > 0) return { result: { status: "fail", summary }, computed, issues };
  if (open.length > 0) return { result: notDone(summary), computed, issues };
  if (lapsed.length > 0) return { result: { status: "warn", summary }, computed, issues };
  return { result: { status: "pass", summary }, computed, issues };
}

/** "4 Verified, 1 Not verified, 1 NA." in the template's wording. */
function tally(counts: DocumentsComputed["counts"], labels: Labels): string {
  const parts = DOCUMENT_STATUSES.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${labelFor(labels, "status", status)}`,
  );
  return `${parts.join(", ")}.`;
}

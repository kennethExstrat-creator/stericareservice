// BUILD_SPEC 6.1 documents: fail if a required item is not verified; warn if
// an item has expired (its expiry date is before the inspection date, from
// the context); pass otherwise, but only with at least one item verified:
// with every item not verified or NA there is no verdict (info), as a pass
// would stand on nothing. Not done while an item on the checklist has no
// status (6.2 rule 5). Items the template switches off are ignored.
import type { ModuleStatus } from "@/lib/schemas/module-result";
import {
  labelFor,
  notDone,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type Labels,
} from "@/modules/_framework";
import {
  checklist,
  DOCUMENT_STATUSES,
  type DocumentItem,
  type DocumentItemConfig,
  type DocumentsConfig,
  type DocumentStatus,
} from "./config";
import type { DocumentEntry, DocumentsData } from "./schema";

export type DocumentsComputed = {
  /**
   * Per item on the checklist: the expiry date is before the inspection date.
   * Null when the item is NA, or either date is missing.
   */
  expired: Record<string, boolean | null>;
  /**
   * Per item on the checklist, what it means for the result (the chip on its
   * row): not done without a status; fail when required and not verified;
   * warn when expired; pass when verified; info when not verified or NA and
   * not required.
   */
  itemStatus: Record<string, ModuleStatus>;
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

function itemStatusOf(item: DocumentItemConfig, entry: DocumentEntry, expired: boolean | null): ModuleStatus {
  if (entry.status === null) return "not_done";
  if (item.required && entry.status !== "verified") return "fail";
  if (expired === true) return "warn";
  return entry.status === "verified" ? "pass" : "info";
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
  const itemStatus: Record<string, ModuleStatus> = {};
  const counts: DocumentsComputed["counts"] = { verified: 0, not_verified: 0, na: 0, open: 0 };

  for (const item of items) {
    const { key } = item;
    const entry = data.items[key];
    counts[entry.status ?? "open"] += 1;
    expired[key] = entry.status === "na" ? null : isExpired(entry.expiryDate, inspectionDate);
    itemStatus[key] = itemStatusOf(item, entry, expired[key]);
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

  const computed = { expired, itemStatus, counts };
  if (items.length === 0) {
    return { result: { status: "info", summary: "No documents are switched on." }, computed, issues };
  }

  const name = (key: DocumentItem) => labelFor(labels, key);
  const requiredNotVerified = items.filter((item) => itemStatus[item.key] === "fail");
  const open = items.filter((item) => itemStatus[item.key] === "not_done");
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
  if (counts.verified === 0) return { result: { status: "info", summary }, computed, issues };
  return { result: { status: "pass", summary }, computed, issues };
}

/** "4 Verified, 1 Not verified, 1 NA." in the template's wording. */
function tally(counts: DocumentsComputed["counts"], labels: Labels): string {
  const parts = DOCUMENT_STATUSES.filter((status) => counts[status] > 0).map(
    (status) => `${counts[status]} ${labelFor(labels, "status", status)}`,
  );
  return `${parts.join(", ")}.`;
}

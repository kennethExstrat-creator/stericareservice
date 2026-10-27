// The capture screen's Audit Log page (Kenneth, 26 October 2026: "The audit
// log should be kept in a special page, 'Audit Log', place under conclusion
// page"): every audit_log row of the inspection, newest first, in plain words.
// A P/F the inspector set by hand is a special action, shown with its
// comment, and so is a size's code letter reduced on the Sampling Plan, with
// its reason (Kenneth, 27 October 2026: "yes, reducing code letter go to
// Audit Log"); a spec changed for the inspection reads "Size M Finger
// Thickness spec changed from 0.18 ± 0.04 to NA". A size is named as the
// template labels it. Who acted is told as the viewer may know them
// (review/actor.ts): a row the service role wrote names them in its changes
// (`by`). Times are Malaysia's (review/format.ts), formatted on the server.
import { formatCount, formatSize, type SizeOption } from "@/lib/format";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import { actorOf, actorText, type KnownPeople } from "@/lib/inspections/review/actor";
import { humanise, type AuditRow } from "@/lib/inspections/review/audit";
import { formatDateTime } from "@/lib/inspections/review/format";
import { REOPEN_EVENT } from "@/lib/inspections/review/schemas";
import { InspectionStatusSchema } from "@/lib/schemas/common";
import { MEDIA_CATEGORIES } from "@/lib/inspections/source-documents";
import { SAMPLING_QUANTITY_LABELS } from "@/modules/sampling_plan/config";
import { PASS_FAIL_CHANGED, SPEC_CHANGED } from "./dimension-events";
import { CODE_LETTER_CHANGED } from "./sampling-events";

/** One line of the Audit Log. */
export type AuditLogEntry = {
  id: number;
  /** As recorded (ISO 8601), for the page's <time>. */
  at: string;
  /** Malaysia time, "26 Oct 2026, 20:36". */
  when: string;
  /** "Test Inspector", "An admin", "The system". */
  who: string;
  /** What happened, in Title Case. */
  title: string;
  /** The particulars in a sentence: the file, the step, the size and column, the comment. */
  detail: string | null;
  /** An action the inspector took by hand on a result: a P/F set by hand, a code letter reduced. */
  special: boolean;
};

type Words = {
  people: Partial<KnownPeople>;
  /** A module's title as this inspection's template words it. */
  moduleTitle: (key: string) => string;
  /** The template's sizes, whose own labels name a size ("Size Medium"); without them, the size ("Size M"). */
  sizes?: readonly SizeOption[];
};

/** The inspection's audit rows as the Audit Log shows them, newest first. */
export function auditLogEntries(rows: readonly AuditRow[], words: Words): AuditLogEntry[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id)
    .map((row) => {
      const changes = record(row.changes);
      // The service role writes some rows for the user (the app's own reads and fills): `by` names them.
      const actorId = row.actorId ?? (typeof changes.by === "string" ? changes.by : null);
      return {
        id: row.id,
        at: row.at,
        when: formatDateTime(row.at),
        who: actorText(actorOf(actorId, row.actorId ? row.actor : null, words.people), { start: true }),
        ...describe(row.action, changes, words),
      };
    });
}

function describe(action: string, changes: Record<string, unknown>, words: Words): Pick<AuditLogEntry, "title" | "detail" | "special"> {
  const event = (title: string, detail: string | null = null) => ({ title, detail, special: false });
  switch (action) {
    case "created":
      return event("Inspection Created", text(changes.ref_no));
    case "status_changed":
      return event(statusTitle(changes.from, changes.to));
    case REOPEN_EVENT:
      return event("Reason for Reopening", text(changes.reason));
    case PASS_FAIL_CHANGED:
      return { title: "P/F Changed by the Inspector", detail: passFailDetail(changes, words), special: true };
    case SPEC_CHANGED:
      return event("Spec Changed", specDetail(changes, words));
    case CODE_LETTER_CHANGED:
      return codeLetterEntry(changes, words);
    case "source_document_read": {
      const filled = list(changes.modules).map(words.moduleTitle);
      const file = text(changes.file);
      return event("Steri-AI Read a Source Document", joined([file, filled.length > 0 ? `filled ${filled.join(", ")}` : null]));
    }
    case "filled_from_document":
      return event("Filled From a Document", text(changes.file));
    case "media_sorted": {
      const photos = count(changes.photos, "photo");
      const videos = count(changes.videos, "video");
      return event("Steri-AI Sorted Photos and Videos", joined([photos, videos], " and "));
    }
    case "media_moved":
      return event("Photo or Video Moved", `From ${category(changes.from)} to ${category(changes.to)}`);
    case "module_override": {
      const step = typeof changes.module === "string" ? words.moduleTitle(changes.module) : "A step";
      return changes.include === false
        ? event("Step Switched Off", joined([step, text(changes.reason)], ": "))
        : event("Step Switched Back On", step);
    }
    case "template_chosen":
      return event("Template Chosen by an Admin", templateRef(changes.template));
    case "started_from_previous":
      return event("Started From an Earlier Inspection", text(record(changes.previous).refNo) ?? text(changes.ref_no));
    case "photo.deleted":
      return event("Photo Deleted");
    case "file.deleted":
      return event("File Deleted", text(changes.name));
    case "summary_drafted":
      return event("Steri-AI Summary Drafted");
    // Rows from before the Steri-AI Report was removed (27 October 2026) keep reading as they did.
    case "ai_report.sent":
      return event("Sent to Steri-AI Report");
    case "ai_review.requested":
      return event("Steri-AI Second Opinion Requested");
    default:
      return event(humanise(action), text(changes.reason) ?? text(changes.note) ?? text(changes.message));
  }
}

/** "Dimension, Size M, Width: set to Failed; the readings give Passed. Comment: Torn cuffs." */
function passFailDetail(changes: Record<string, unknown>, words: Words): string {
  const place = joined([text(changes.moduleTitle), sizeName(changes.size, words), text(changes.columnLabel)], ", ");
  const readings = `the readings give ${verdict(changes.calculated)}`;
  if (changes.to === null || changes.to === undefined) {
    return `${place}: back to the readings' result (${verdict(changes.calculated)}), was ${verdict(changes.from)}.`;
  }
  const what = changes.from === null || changes.from === undefined
    ? `set to ${verdict(changes.to)}`
    : `${verdict(changes.from)} changed to ${verdict(changes.to)}`;
  return `${place}: ${what}; ${readings}. Comment: ${text(changes.comment) ?? "none"}`;
}

/** "Size M Finger Thickness spec changed from 0.18 ± 0.04 to NA.", "… from NA back to the template's 0.18 ± 0.04." */
function specDetail(changes: Record<string, unknown>, words: Words): string {
  const place = joined([sizeName(changes.size, words), text(changes.columnLabel) ?? text(changes.column)], " ");
  const to = changes.change === "cleared" ? "back to the template's" : "to";
  return `${place ? `${place} spec` : "Spec"} changed from ${text(changes.fromText) ?? "no spec"} ${to} ${text(changes.toText) ?? "no spec"}.`;
}

/**
 * "Size S Code Letter reduced from N to M: # of Gloves Sample 500 → 315.
 * Reason: Consistent high-quality factory.", a special action by the
 * inspector; "Size S Code Letter raised from M to N: # of Gloves Sample 315
 * → 500."; "Size S Code Letter cleared."
 */
function codeLetterEntry(changes: Record<string, unknown>, words: Words): Pick<AuditLogEntry, "title" | "detail" | "special"> {
  const place = joined([sizeName(changes.size, words), "Code Letter"], " ");
  const to = text(changes.to);
  if (to === null) return { title: "Code Letter Cleared", detail: `${place} cleared.`, special: false };
  const from = text(changes.from);
  const gloves = glovesChange(changes.glovesFrom, changes.glovesTo);
  const sentence = (how: string) => `${place} ${how}${from ? ` from ${from}` : ""} to ${to}${gloves ? `: ${gloves}` : ""}.`;
  if (changes.direction === "reduced") {
    const reason = `Reason: ${text(changes.reason) ?? "none"}`;
    return { title: "Code Letter Reduced by the Inspector", detail: `${sentence("reduced")} ${reason}`, special: true };
  }
  if (changes.direction === "raised") return { title: "Code Letter Raised", detail: sentence("raised"), special: false };
  return { title: "Code Letter Changed", detail: sentence("changed"), special: false };
}

/** "# of Gloves Sample 500 → 315", or "# of Gloves Sample 315" without the count before; null without either. */
function glovesChange(from: unknown, to: unknown): string | null {
  const before = typeof from === "number" ? formatCount(from) : null;
  const after = typeof to === "number" ? formatCount(to) : null;
  if (before === null && after === null) return null;
  const counts = before === null ? after : `${before} → ${after ?? "none"}`;
  return `${SAMPLING_QUANTITY_LABELS.gloves} ${counts}`;
}

/** "Size M", or "Size Medium" where the template labels the size; null without one. */
function sizeName(size: unknown, words: Words): string | null {
  const value = text(size);
  return value ? formatSize(value, { sizes: words.sizes, prefix: true }) : null;
}

function verdict(value: unknown): string {
  if (value === "pass") return "Passed";
  if (value === "fail") return "Failed";
  if (value === "not_done") return "not done";
  return "unknown";
}

function statusTitle(from: unknown, to: unknown): string {
  const before = InspectionStatusSchema.safeParse(from);
  const after = InspectionStatusSchema.safeParse(to);
  if (after.success && after.data === "submitted") return before.success && before.data === "reopened" ? "Submitted Again" : "Submitted";
  if (after.success && after.data === "approved") return "Approved";
  if (after.success && after.data === "reopened") return "Reopened";
  const word = (status: typeof before) => (status.success ? INSPECTION_STATUS_LABEL[status.data] : "Unknown");
  return `Status Changed From ${word(before)} to ${word(after)}`;
}

function category(key: unknown): string {
  if (key === null || key === undefined) return "Other";
  return MEDIA_CATEGORIES.find((entry) => entry.key === key)?.title ?? (typeof key === "string" ? humanise(key) : "Other");
}

function templateRef(value: unknown): string | null {
  const ref = record(value);
  const code = text(ref.code);
  return code ? joined([code, ref.version ? `version ${text(ref.version)}` : null], " ") : null;
}

function count(value: unknown, noun: string): string | null {
  return typeof value === "number" && value > 0 ? `${value} ${noun}${value === 1 ? "" : "s"}` : null;
}

function joined(parts: readonly (string | null)[], separator = "; "): string | null {
  const kept = parts.filter((part): part is string => part !== null && part !== "");
  return kept.length > 0 ? kept.join(separator) : null;
}

function text(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// The inspection's history from audit_log (BUILD_SPEC 5): who created it,
// who changed its status and when, and the events server actions logged.
// The database writes `created` and every `status_changed` itself; the reopen
// action adds its reason as a separate `review.reopened` event, which is
// folded into the reopen it belongs to here. Who acted is told as the viewer
// may know it (./actor.ts).
import { staysLowerCase } from "@/lib/design/capitalisation";
import { INSPECTION_STATUS_LABEL } from "@/lib/inspections/format";
import { InspectionStatusSchema } from "@/lib/schemas/common";
import { actorOf, type Actor, type KnownPeople } from "./actor";
import { REOPEN_EVENT, reopenReasonOf } from "./schemas";

/** One audit_log row as the viewer reads it. */
export type AuditRow = {
  id: number;
  action: string;
  changes: unknown;
  at: string;
  actorId: string | null;
  /** The actor's profile, or null when there is none or row level security hides it. */
  actor: { full_name: string | null; email: string | null } | null;
};

export type AuditEntryKind = "created" | "submitted" | "resubmitted" | "approved" | "reopened" | "status" | "event";

export type AuditEntry = {
  id: number;
  at: string;
  kind: AuditEntryKind;
  /** What happened, e.g. "Approved". */
  title: string;
  actor: Actor;
  actorId: string | null;
  /** Why an admin reopened it, for a reopen. */
  reason: string | null;
  /** A reason or note logged with another event. */
  detail: string | null;
};

/**
 * Titles of events server actions log with log_inspection_event(). Others are
 * worded from their action. Titles in Title Case, as every title the app
 * writes (Kenneth, 8 October 2026).
 */
const EVENT_TITLES: Readonly<Record<string, string>> = {
  module_override: "Module Settings Changed for This Inspection",
  "ai_report.sent": "Sent to the AI Report",
  "ai_review.requested": "AI Second Opinion Requested",
  [REOPEN_EVENT]: "Reason for Reopening",
};

export function buildAuditTrail(rows: readonly AuditRow[], people: KnownPeople): AuditEntry[] {
  const sorted = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
  const entries: AuditEntry[] = [];

  for (const row of sorted) {
    const base = {
      id: row.id,
      at: row.at,
      actor: actorOf(row.actorId, row.actor, people),
      actorId: row.actorId,
      reason: null,
      detail: null,
    };

    if (row.action === REOPEN_EVENT) {
      const reason = reopenReasonOf(row.changes);
      // The reopen it explains: the latest one by the same admin still without a reason.
      const reopen = entries.findLast((entry) => entry.kind === "reopened" && entry.actorId === row.actorId);
      if (reopen && reopen.reason === null && reason !== null) {
        reopen.reason = reason;
        continue;
      }
      entries.push({ ...base, kind: "event", title: EVENT_TITLES[REOPEN_EVENT], reason });
      continue;
    }

    if (row.action === "created") {
      entries.push({ ...base, kind: "created", title: "Created" });
      continue;
    }

    if (row.action === "status_changed") {
      entries.push({ ...base, ...statusChange(row.changes) });
      continue;
    }

    entries.push({ ...base, kind: "event", title: EVENT_TITLES[row.action] ?? humanise(row.action), detail: detailOf(row.changes) });
  }
  return entries;
}

/** The latest reopen, with its reason: what the inspector is asked to change. */
export function latestReopen(entries: readonly AuditEntry[]): AuditEntry | null {
  return entries.findLast((entry) => entry.kind === "reopened") ?? null;
}

function statusChange(changes: unknown): Pick<AuditEntry, "kind" | "title"> {
  const record = asRecord(changes);
  const from = InspectionStatusSchema.safeParse(record.from);
  const to = InspectionStatusSchema.safeParse(record.to);
  if (to.success && to.data === "submitted") {
    return from.success && from.data === "reopened"
      ? { kind: "resubmitted", title: "Submitted Again" }
      : { kind: "submitted", title: "Submitted" };
  }
  if (to.success && to.data === "approved") return { kind: "approved", title: "Approved" };
  if (to.success && to.data === "reopened") return { kind: "reopened", title: "Reopened" };
  const word = (status: typeof from) => (status.success ? INSPECTION_STATUS_LABEL[status.data] : "Unknown");
  return { kind: "status", title: `Status Changed From ${word(from)} to ${word(to)}` };
}

/** A reason or note logged with an event, if it has one. */
function detailOf(changes: unknown): string | null {
  const record = asRecord(changes);
  for (const key of ["reason", "note", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** `ai_review.failed` as "AI Review Failed": a title, each word capitalised but the small ones. */
export function humanise(action: string): string {
  const words = action.split(/[._]+/).filter(Boolean);
  if (words.length === 0) return "Event";
  return words
    .map((word, index) => {
      if (word.toLowerCase() === "ai") return "AI";
      if (staysLowerCase(word, index, words.length)) return word.toLowerCase();
      // Each part of a hyphenated word: "Follow-Up".
      return word
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("-");
    })
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

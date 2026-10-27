// The audit trail (BUILD_SPEC 5): who created the inspection and changed it,
// and when, oldest first, one line per event (layout A, Kenneth, 27 October
// 2026). A run of the same event by the same actor (the system reading the
// source documents) is one line with its count, opened on demand. A
// reopen's reason and an event's note follow on its line. Times are
// Malaysia time, as everywhere in the app.
import { TriangleAlertIcon } from "lucide-react";
import { actorText } from "@/lib/inspections/review/actor";
import type { AuditEntry, AuditEntryKind } from "@/lib/inspections/review/audit";
import { formatDateTime } from "@/lib/inspections/review/format";
import { groupHistory } from "@/lib/inspections/review/history-groups";
import { cn } from "@/lib/utils";
import { CardSection } from "./review-section";

const TEXT = "text-base fine:text-sm";

/** The workflow's steps in brand blue, a reopen in amber, the rest slate. */
const DOT: Partial<Record<AuditEntryKind, string>> = {
  submitted: "bg-brand-500",
  resubmitted: "bg-brand-500",
  approved: "bg-brand-700",
  reopened: "bg-warn-solid",
};

function Dot({ kind }: { kind: AuditEntryKind }) {
  return <span aria-hidden className={cn("mt-[0.45rem] size-2 shrink-0 rounded-full", DOT[kind] ?? "bg-slate-400")} />;
}

function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatDateTime(iso)}</time>;
}

/** The end of a run: its time alone on the run's first day ("11:34"), else in full. */
function Until({ from, iso }: { from: string; iso: string }) {
  const [day, time] = formatDateTime(iso).split(", ");
  const sameDay = time !== undefined && formatDateTime(from).split(", ")[0] === day;
  return <time dateTime={iso}>{sameDay ? time : formatDateTime(iso)}</time>;
}

function EntryLine({ entry }: { entry: AuditEntry }) {
  const note = entry.reason ?? entry.detail;
  return (
    <li data-kind={entry.kind} className={cn("flex gap-3", TEXT)}>
      <Dot kind={entry.kind} />
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-semibold text-foreground">{entry.title}</span>{" "}
        <span className="text-muted-foreground">
          · {actorText(entry.actor)} · <When iso={entry.at} />
        </span>
        {note && (
          <>
            {" "}
            <span className="whitespace-pre-line text-foreground">
              · {entry.reason ? "Reason:" : "Note:"} {note}
            </span>
          </>
        )}
      </p>
    </li>
  );
}

export function History({ history }: { history: { entries: AuditEntry[]; failed: boolean } }) {
  const lines = groupHistory(history.entries);
  return (
    <CardSection
      id="history"
      title="History"
      aside={
        history.failed ? undefined : (
          <span className="text-sm text-muted-foreground">
            {history.entries.length === 0 ? "None" : history.entries.length}
          </span>
        )
      }
    >
      {history.failed ? (
        <p className={cn("flex gap-2 px-5 pb-4 text-warn", TEXT)}>
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          The history could not be loaded. Reload the page to try again.
        </p>
      ) : (
        lines.length > 0 && (
          <ol className="flex flex-col gap-2 px-5 pb-5">
            {lines.map((line) =>
              line.kind === "entry" ? (
                <EntryLine key={line.entry.id} entry={line.entry} />
              ) : (
                <li key={line.entries[0].id} data-kind="run" className={cn("flex gap-3", TEXT)}>
                  <Dot kind={line.entries[0].kind} />
                  <details className="group min-w-0">
                    <summary className="cursor-pointer list-none rounded-sm focus-ring [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold text-foreground">{line.title}</span>{" "}
                      <span className="inline-flex h-5 items-center rounded-full border border-slate-300 bg-slate-50 px-1.5 align-text-bottom text-xs font-semibold text-slate-700">
                        × {line.entries.length}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        · {actorText(line.actor)} · <When iso={line.entries[0].at} /> to{" "}
                        <Until from={line.entries[0].at} iso={line.entries[line.entries.length - 1].at} />
                      </span>
                    </summary>
                    <ol className="mt-1.5 flex flex-col gap-1 border-l border-border pl-3 text-muted-foreground">
                      {line.entries.map((entry) => (
                        <li key={entry.id}>
                          <When iso={entry.at} />
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ),
            )}
          </ol>
        )
      )}
    </CardSection>
  );
}

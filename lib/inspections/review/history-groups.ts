// The review's History, one line per event (layout A, Kenneth, 27 October
// 2026). A run of the same event by the same actor, such as the sixteen
// "Source Document Read" lines the system logs while Steri-AI reads the
// source documents, is one line with its count, opened on demand.
import { actorText } from "./actor";
import type { AuditEntry } from "./audit";

export type HistoryLine =
  | { kind: "entry"; entry: AuditEntry }
  | { kind: "run"; title: string; actor: AuditEntry["actor"]; entries: AuditEntry[] };

/** A run is this many alike events in a row, or more. */
export const RUN_FROM = 3;

/** Alike: the same event by the same actor, with no reason or note of its own. */
function alike(a: AuditEntry, b: AuditEntry): boolean {
  return (
    a.title === b.title &&
    actorText(a.actor) === actorText(b.actor) &&
    a.reason === null &&
    b.reason === null &&
    a.detail === null &&
    b.detail === null
  );
}

/** The entries in their order, each run of RUN_FROM or more alike events as one line. */
export function groupHistory(entries: readonly AuditEntry[]): HistoryLine[] {
  const lines: HistoryLine[] = [];
  let index = 0;
  while (index < entries.length) {
    let end = index + 1;
    while (end < entries.length && alike(entries[index], entries[end])) end += 1;
    const run = entries.slice(index, end);
    if (run.length >= RUN_FROM) lines.push({ kind: "run", title: run[0].title, actor: run[0].actor, entries: run });
    else for (const entry of run) lines.push({ kind: "entry", entry });
    index = end;
  }
  return lines;
}

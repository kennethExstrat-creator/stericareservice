"use client";

// The capture screen's Audit Log page (Kenneth, 26 October 2026: "The audit
// log should be kept in a special page, 'Audit Log', place under conclusion
// page"): after the Conclusion, never a step. What the inspection's audit
// log records, newest first: when (Malaysia time), who, and what in plain
// words (lib/inspections/capture/audit-log.ts). A P/F set by hand is a
// special action by the inspector, tinted and marked so, with its comment,
// and so is a size's code letter reduced on the Sampling Plan, with its
// reason (Kenneth, 27 October 2026).
// Read-only for everyone. Whatever is waiting is saved first, so a change
// just made is in the list; Refresh reads it again.
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AuditLogEntry } from "@/lib/inspections/capture/audit-log";
import { AUDIT_LOG_KEY, AUDIT_LOG_TITLE } from "@/lib/inspections/capture/sections";
import { cn } from "@/lib/utils";
import { loadAuditLog, type AuditLogResult } from "../audit-actions";
import { SectionFrame } from "./section-frame";
import { unreachable } from "./unreachable";

type AuditLogPageProps = {
  /** The panel id the section tabs point at. */
  id: string;
  /** Below 1280 px: the id of the page's tab, which names the panel. */
  tabLabelledBy?: string;
  titleRef: (key: string) => Ref<HTMLHeadingElement>;
  inspectionId: string;
  /** Saves what is waiting, so the list has the last change; its outcome does not matter here. */
  saveFirst?: () => Promise<unknown>;
};

type State = { status: "loading" } | AuditLogResult;

export function AuditLogPage({ id, tabLabelledBy, titleRef, inspectionId, saveFirst }: AuditLogPageProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [round, setRound] = useState(0);
  // The screen's flush, as it is now: a new one each render does not read the log again.
  const saveWaiting = useEffectEvent(() => saveFirst?.() ?? Promise.resolve());

  useEffect(() => {
    let live = true;
    const saved = saveWaiting().catch(() => {
      // Not saved: the list shows what is.
    });
    saved
      .then(() => loadAuditLog(inspectionId))
      .then(
        (result) => {
          if (live) setState(result);
        },
        (error: unknown) => {
          if (live) setState(unreachable(error));
        },
      );
    return () => {
      live = false;
    };
  }, [inspectionId, round]);

  const refresh = useCallback(() => {
    setState({ status: "loading" });
    setRound((value) => value + 1);
  }, []);

  return (
    <SectionFrame
      id={id}
      sectionKey={AUDIT_LOG_KEY}
      tabLabelledBy={tabLabelledBy}
      title={AUDIT_LOG_TITLE}
      summary="What was done on this inspection, newest first. Nobody can change it."
      headingRef={titleRef(AUDIT_LOG_KEY)}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={state.status === "loading"}>
          <RefreshCwIcon aria-hidden />
          Refresh
        </Button>
      }
    >
      <div aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground touch:text-base">
            <Spinner aria-hidden />
            Reading the audit log…
          </p>
        ) : state.status === "error" ? (
          <div role="alert" className="space-y-3 rounded-md border border-fail-border bg-fail-tint px-4 py-3 text-sm text-fail touch:text-base">
            <p>{state.message}</p>
            <Button type="button" variant="outline" size="sm" className="text-foreground" onClick={refresh}>
              Try Again
            </Button>
          </div>
        ) : state.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground touch:text-base">Nothing recorded yet.</p>
        ) : (
          <AuditLogList entries={state.entries} />
        )}
      </div>
    </SectionFrame>
  );
}

/** The entries, newest first: what, the particulars, then when and who. */
export function AuditLogList({ entries }: { entries: readonly AuditLogEntry[] }) {
  return (
    <ol aria-label="Audit log, newest first" data-slot="audit-log" className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          data-special={entry.special || undefined}
          className={cn(
            "space-y-1 rounded-lg border px-4 py-3 touch:py-3.5",
            entry.special ? "border-warn-border bg-warn-tint" : "border-border bg-card",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className={cn("font-semibold", entry.special ? "text-warn" : "text-foreground")}>{entry.title}</p>
            {entry.special && (
              <span className="rounded-full border border-warn-border bg-card px-2 text-xs font-semibold text-warn">
                Special Action by Inspector
              </span>
            )}
          </div>
          {entry.detail && <p className="text-sm text-foreground touch:text-base">{entry.detail}</p>}
          <p className="text-xs text-muted-foreground touch:text-sm">
            <time dateTime={entry.at}>{entry.when}</time> · {entry.who}
          </p>
        </li>
      ))}
    </ol>
  );
}

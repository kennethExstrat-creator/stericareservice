"use client";

// The Pending panel (BUILD_SPEC 6.2): every error and warning of the
// inspection as a task list, grouped by section in screen order. Calm on
// purpose (Kenneth: a task list, not warnings): each task is an empty
// checklist circle and its words, never red or amber. The ones submit needs
// (errors) come first, in a short group under a brand-blue "Needed to
// submit" tag, each with its section's name, in medium weight with a brand
// circle; the rest (warnings, which go into the report) follow as plain tasks
// under their sections. Each task is a link: it opens its section and moves
// focus to the value it is about. When submit is blocked the panel opens
// itself and says so; tasks the server found that this screen does not show
// (the inspection changed elsewhere) are listed apart, with Reload.
import { useRef } from "react";
import { ArrowRightIcon, CircleIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { describePending, issueKey, taskText, type IssueGroup } from "@/lib/inspections/capture/issues";
import type { ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";

type IssuesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly IssueGroup[];
  counts: { errors: number; warnings: number };
  /** Set when submit was refused: why. */
  blockedMessage: string | null;
  /** Errors the server found in the saved inspection that this screen does not show. */
  unseenErrors?: readonly ValidationIssue[];
  onGo: (issue: ValidationIssue) => void;
};

export function IssuesSheet({
  open,
  onOpenChange,
  groups,
  counts,
  blockedMessage,
  unseenErrors = [],
  onGo,
}: IssuesSheetProps) {
  // Leaving through a task: focus goes to that value, not back to the button that opened the panel.
  const leavingToIssue = useRef(false);
  const go = (issue: ValidationIssue) => {
    leavingToIssue.current = true;
    onGo(issue);
  };
  const needed = groups.flatMap((group) => group.errors.map((issue) => ({ issue, group })));
  const rest = groups.filter((group) => group.warnings.length > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={(event) => {
          if (leavingToIssue.current) event.preventDefault();
          leavingToIssue.current = false;
        }}
      >
        <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
          <SheetTitle className="text-lg font-bold">{blockedMessage ? "Before you submit" : "Pending"}</SheetTitle>
          <SheetDescription data-slot="pending-summary">{describePending(counts)}</SheetDescription>
          {blockedMessage && (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-brand-200 bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground touch:text-base"
            >
              {blockedMessage}
            </p>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {unseenErrors.length > 0 && (
            <section
              aria-labelledby="issues-unseen"
              data-slot="unseen-errors"
              className="space-y-2 rounded-lg border border-border bg-muted px-3 py-3 text-sm text-foreground touch:text-base"
            >
              <h3 id="issues-unseen" className="font-semibold">
                This inspection changed on another device. The saved copy has{" "}
                {unseenErrors.length === 1
                  ? "1 more item needed before you submit that this screen does not show: reload the page to see it."
                  : `${unseenErrors.length} more items needed before you submit that this screen does not show: reload the page to see them.`}
              </h3>
              <ul className="space-y-1">
                {unseenErrors.map((issue) => (
                  <li key={issueKey(issue)} className="flex items-start gap-2.5">
                    <CircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary touch:mt-1" />
                    <span className="min-w-0 flex-1">{issue.message}</span>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
                <RefreshCwIcon aria-hidden />
                Reload
              </Button>
            </section>
          )}
          {groups.length === 0 ? (
            unseenErrors.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground touch:text-base">Every section is done.</p>
            )
          ) : (
            <div className="space-y-5">
              {needed.length > 0 && (
                <section aria-labelledby="issues-needed" data-slot="needed-tasks" className="space-y-1.5">
                  <h3 id="issues-needed" className="px-2">
                    <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground touch:text-sm">
                      Needed to submit
                    </span>
                  </h3>
                  <ul className="space-y-0.5">
                    {needed.map(({ issue, group }) => (
                      <li key={issueKey(issue)}>
                        <TaskItem issue={issue} section={group} onGo={() => go(issue)} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {rest.map((group) => (
                <section key={group.key} aria-labelledby={`issues-${group.key}`} className="space-y-1.5">
                  <h3 id={`issues-${group.key}`} className="px-2 text-sm font-semibold text-foreground touch:text-base">
                    {group.title}
                    {!group.linkable && <span className="font-normal text-muted-foreground"> (switched off)</span>}
                  </h3>
                  <ul className="space-y-0.5">
                    {group.warnings.map((issue) => (
                      <li key={issueKey(issue)}>
                        <TaskItem issue={issue} section={group} onGo={() => go(issue)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * One task, read as "<Section>: <task>", with "Needed before you submit."
 * for the ones submit needs: a heading is not part of a button's name. Those
 * sit under the "Needed to submit" tag, away from their sections, so they
 * show their section's name too.
 */
export function TaskItem({
  issue,
  section,
  onGo,
}: {
  issue: ValidationIssue;
  section: Pick<IssueGroup, "title" | "linkable">;
  onGo: () => void;
}) {
  const needed = issue.level === "error";
  const content = (
    <>
      <CircleIcon
        aria-hidden
        className={cn("mt-0.5 size-4 shrink-0 touch:mt-1", needed ? "text-primary" : "text-control")}
      />
      <span className="min-w-0 flex-1">
        <span className="sr-only">{section.title}: </span>
        {needed && (
          <span aria-hidden className="block text-xs font-medium text-muted-foreground touch:text-sm">
            {section.title}
            {!section.linkable && " (switched off)"}
          </span>
        )}
        <span className={cn("block", needed && "font-medium")}>{taskText(issue, section.title)}</span>
        {needed && <span className="sr-only"> Needed before you submit.</span>}
      </span>
      {section.linkable && <ArrowRightIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground touch:mt-1" />}
    </>
  );
  const className =
    "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm text-foreground touch:min-h-11 touch:text-base";
  if (!section.linkable) {
    return (
      <p data-issue={issue.code} data-needed={needed || undefined} className={className}>
        {content}
      </p>
    );
  }
  return (
    <button
      type="button"
      data-issue={issue.code}
      data-needed={needed || undefined}
      onClick={onGo}
      className={cn(className, "outline-none hover:bg-muted focus-ring-inset")}
    >
      {content}
    </button>
  );
}

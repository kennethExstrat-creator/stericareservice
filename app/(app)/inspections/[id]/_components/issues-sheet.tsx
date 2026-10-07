"use client";

// The Pending panel (BUILD_SPEC 6.2): what is still open in the inspection,
// one short row per section (Kenneth: "too crowded and many words, make it
// cleaner and easy to read"). Each row is the section's title and one muted
// line under it ("4 sizes not done · XS S M L", "Final result and date"),
// worded by pendingTasks (lib/inspections/capture/issues.ts); the review and
// the export keep every message in full. Calm on purpose: an empty checklist
// circle, never red or amber. Sections with something submit needs (errors)
// come first under a brand-blue "Needed to submit" tag, with a brand circle;
// the rest follow in capture order. Each row is a link: it opens its section
// at its first open item. When submit is blocked the panel opens itself and
// says so; what the server found that this screen does not show (the
// inspection changed elsewhere) is listed apart, with Reload.
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
import { describePending, issueKey, taskName, type PendingTask } from "@/lib/inspections/capture/issues";
import type { ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";

type IssuesSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One per section with open items, what submit needs first (pendingTasks). */
  tasks: readonly PendingTask[];
  counts: { total: number; needed: number };
  /** Set when submit was refused: why. */
  blockedMessage: string | null;
  /** Errors the server found in the saved inspection that this screen does not show. */
  unseenErrors?: readonly ValidationIssue[];
  onGo: (issue: ValidationIssue) => void;
};

/** Size chips shown on a row; more read as "+2". */
const MAX_CHIPS = 5;

export function IssuesSheet({
  open,
  onOpenChange,
  tasks,
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
  const needed = tasks.filter((task) => task.needed);
  const rest = tasks.filter((task) => !task.needed);

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
          {tasks.length === 0 ? (
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
                  <TaskList tasks={needed} onGo={go} />
                </section>
              )}
              {rest.length > 0 && (
                <section
                  aria-labelledby={needed.length > 0 ? "issues-rest" : undefined}
                  aria-label={needed.length > 0 ? undefined : "To do"}
                  data-slot="other-tasks"
                  className="space-y-1.5"
                >
                  {needed.length > 0 && (
                    <h3 id="issues-rest" className="px-2 text-sm font-medium text-muted-foreground">
                      Still to do
                    </h3>
                  )}
                  <TaskList tasks={rest} onGo={go} />
                </section>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskList({ tasks, onGo }: { tasks: readonly PendingTask[]; onGo: (issue: ValidationIssue) => void }) {
  return (
    <ul className="space-y-0.5">
      {tasks.map((task) => (
        <li key={task.key}>
          <TaskItem task={task} onGo={() => onGo(task.first)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One section's row: its title, and one muted line with its status, the
 * sizes as chips and "· 1 more" for other kinds of open items. Named for
 * screen readers in full (taskName): "Weight (g): 4 sizes not done: XS, S, M
 * and L.", and "Needed before you submit." for what submit needs.
 */
export function TaskItem({ task, onGo }: { task: PendingTask; onGo: () => void }) {
  const chips = task.sizes.slice(0, MAX_CHIPS);
  const hidden = task.sizes.length - chips.length;
  const content = (
    <>
      <CircleIcon
        aria-hidden
        className={cn("mt-0.5 size-4 shrink-0 touch:mt-1", task.needed ? "text-primary" : "text-control")}
      />
      <span aria-hidden className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">
          {task.title}
          {!task.linkable && <span className="font-normal text-muted-foreground"> (switched off)</span>}
        </span>
        <span
          data-slot="task-status"
          className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-sm whitespace-nowrap text-muted-foreground"
        >
          <span className="truncate">{task.status}</span>
          {chips.length > 0 && (
            <span data-slot="task-sizes" className="flex shrink-0 items-center gap-1">
              {chips.map((size) => (
                <span
                  key={size}
                  className="rounded-sm bg-muted px-1.5 text-xs leading-5 font-medium text-slate-700 tabular-nums"
                >
                  {size}
                </span>
              ))}
              {hidden > 0 && <span className="text-xs leading-5 tabular-nums">+{hidden}</span>}
            </span>
          )}
          {task.more > 0 && <span className="shrink-0">· {task.more} more</span>}
        </span>
      </span>
      {task.linkable && <ArrowRightIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground touch:mt-1" />}
    </>
  );
  const className =
    "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm text-foreground touch:min-h-11 touch:text-base";
  if (!task.linkable) {
    return (
      <div
        role="group"
        data-task={task.key}
        data-needed={task.needed || undefined}
        aria-label={taskName({ ...task, title: `${task.title} (switched off)` })}
        className={className}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-task={task.key}
      data-needed={task.needed || undefined}
      aria-label={taskName(task)}
      onClick={onGo}
      className={cn(className, "outline-none hover:bg-muted focus-ring-inset")}
    >
      {content}
    </button>
  );
}

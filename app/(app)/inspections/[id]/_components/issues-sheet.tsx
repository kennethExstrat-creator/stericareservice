"use client";

// The issues panel (BUILD_SPEC 6.2): every error and warning of the
// inspection, grouped by section in screen order. Errors block submit;
// warnings are allowed and go into the export. Each issue is a link: it
// opens its section and moves focus to the value it is about. When submit
// is blocked the panel opens itself and says so; errors the server found
// that this screen does not show (the inspection changed elsewhere) are
// listed apart, with Reload.
import { useRef } from "react";
import { ArrowRightIcon, CircleXIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { describeIssueCounts, issueKey, type IssueGroup } from "@/lib/inspections/capture/issues";
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
  // Leaving through an issue link: focus goes to that value, not back to the button that opened the panel.
  const leavingToIssue = useRef(false);

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
          <SheetTitle className="text-lg font-bold">{blockedMessage ? "Before you submit" : "Issues"}</SheetTitle>
          <SheetDescription>
            {describeIssueCounts(counts)}. Errors stop the inspection being submitted; warnings go into the report.
          </SheetDescription>
          {blockedMessage && (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-fail-border bg-fail-tint px-3 py-2 text-sm font-semibold text-fail touch:text-base"
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
              className="space-y-2 rounded-lg border border-fail-border bg-fail-tint px-3 py-3 text-sm text-fail touch:text-base"
            >
              <h3 id="issues-unseen" className="font-semibold">
                This inspection changed elsewhere. The saved inspection has{" "}
                {unseenErrors.length === 1
                  ? "an error this screen does not show: reload the page to see it."
                  : `${unseenErrors.length} errors this screen does not show: reload the page to see them.`}
              </h3>
              <ul className="list-disc space-y-1 pl-5">
                {unseenErrors.map((issue) => (
                  <li key={issueKey(issue)}>{issue.message}</li>
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
              <p className="px-2 text-sm text-muted-foreground touch:text-base">Nothing to fix. Every section checks out.</p>
            )
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`issues-${group.key}`} className="space-y-1.5">
                  <h3 id={`issues-${group.key}`} className="px-2 text-sm font-semibold text-foreground">
                    {group.title}
                    {!group.linkable && <span className="font-normal text-muted-foreground"> (switched off)</span>}
                  </h3>
                  <ul className="space-y-1">
                    {[...group.errors, ...group.warnings].map((issue) => (
                      <li key={issueKey(issue)}>
                        <IssueItem
                          issue={issue}
                          linkable={group.linkable}
                          onGo={() => {
                            leavingToIssue.current = true;
                            onGo(issue);
                          }}
                        />
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

function IssueItem({ issue, linkable, onGo }: { issue: ValidationIssue; linkable: boolean; onGo: () => void }) {
  const error = issue.level === "error";
  const Icon = error ? CircleXIcon : TriangleAlertIcon;
  const content = (
    <>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", error ? "text-fail" : "text-warn")} />
      <span className="min-w-0 flex-1">
        <span className="sr-only">{error ? "Error: " : "Warning: "}</span>
        {issue.message}
      </span>
      {linkable && <ArrowRightIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm text-foreground touch:min-h-11 touch:text-base";
  if (!linkable) {
    return (
      <p data-issue={issue.code} className={className}>
        {content}
      </p>
    );
  }
  return (
    <button
      type="button"
      data-issue={issue.code}
      onClick={onGo}
      className={cn(className, "outline-none hover:bg-muted focus-ring-inset")}
    >
      {content}
    </button>
  );
}

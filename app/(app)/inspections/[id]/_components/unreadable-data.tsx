"use client";

// Saved values a module's schema no longer accepts: saved before a limit
// existed, such as a lot number over 200 characters (docs/MODULES.md 5). The
// section lists each one as the checks word it (invalid_data, which blocks
// submit) and offers one explicit, confirmed change: remove those values and
// keep everything else (readableData), saved as one change, so the form
// opens again and the inspector enters them afresh. The form never opens on
// what can be read alone: its first edit would save that, and the rejected
// values would be gone without anyone deciding so. Read-only, the list only.
import { useMemo, useRef, useState } from "react";
import { CircleAlertIcon, EraserIcon } from "lucide-react";
import { issueNoticeProps, useIssueFocus } from "@/components/qc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { IssuePath, ValidationIssue } from "@/lib/validation";
import { readableData, type AnyModuleDefinition, type ModuleEntry } from "@/modules/_framework";

type UnreadableDataProps = {
  definition: AnyModuleDefinition;
  /** The module's entry as stored (the comment apart). */
  entry: ModuleEntry;
  /** The module's invalid_data errors: one per value its schema rejects, in the module's words. */
  issues: readonly ValidationIssue[];
  /** zod's first complaint, for when the checks have not run yet. */
  fallback: { message: string; path: readonly PropertyKey[] } | undefined;
  focusPath: IssuePath | null;
  readOnly: boolean;
  /** Saves the module's data without the values that cannot be read. */
  onRemove: (next: unknown) => void;
  /**
   * Once they are removed and the confirmation has closed: the module's form
   * takes this list's place, the button that opened the confirmation with it,
   * so the focus cannot go back there. The screen puts it somewhere instead.
   */
  onRemoved?: () => void;
};

export function UnreadableData({
  definition,
  entry,
  issues,
  fallback,
  focusPath,
  readOnly,
  onRemove,
  onRemoved,
}: UnreadableDataProps) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const readable = useMemo(() => readableData(definition, entry), [definition, entry]);
  const [open, setOpen] = useState(false);
  // Set by the confirming button: the dialog then closes onto onRemoved, not onto its gone trigger.
  const removed = useRef(false);

  const listed =
    issues.length > 0
      ? issues.map((issue) => ({ key: `${JSON.stringify(issue.path)}|${issue.message}`, path: issue.path, message: issue.message }))
      : [{ key: "first", path: null, message: describeFallback(fallback) }];
  // As many as the list shows: one value the schema rejects may take its parent with it, but it is one problem.
  const count = readable === null ? null : listed.length;
  const what = count === null ? "everything saved for this section" : count === 1 ? "this value" : `these ${count} values`;

  return (
    <div
      ref={root}
      data-slot="unreadable-data"
      className="space-y-3 rounded-lg border border-fail-border bg-fail-tint px-4 py-3 text-sm text-fail touch:text-base"
    >
      <p className="flex items-start gap-2 font-semibold">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
        {readable === null
          ? "What is saved for this section cannot be read."
          : listed.length === 1
            ? "A value saved for this section cannot be read."
            : "Some values saved for this section cannot be read."}
      </p>
      <ul className="list-disc space-y-1 pl-10 font-medium">
        {listed.map((item) => (
          <li key={item.key} className="rounded-sm outline-none focus-ring" {...issueNoticeProps(item.path)}>
            {item.message}
          </li>
        ))}
      </ul>
      {readOnly ? (
        <p className="text-foreground">
          {readable === null
            ? "Nothing here can be shown until it is corrected."
            : "The rest of this section is kept; it shows again once these are corrected."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-foreground">
          <p className="min-w-0 flex-1 basis-72">
            {readable === null
              ? "To go on, clear this section and enter it again."
              : "To go on, remove what cannot be read and enter it again. Everything else here is kept."}
          </p>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              if (next) removed.current = false;
              setOpen(next);
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="bg-card" data-action="remove-unreadable">
                <EraserIcon aria-hidden />
                {readable === null ? "Clear this section" : "Remove the values that cannot be read"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                // Cancel: back to the button, as any dialog does.
                if (!removed.current || !onRemoved) return;
                event.preventDefault();
                onRemoved();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle className="text-lg font-bold">
                  {readable === null ? "Clear this section?" : `Remove ${what}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {readable === null
                    ? "Everything saved for this section is removed, as none of it can be read. The inspector comment stays. You then enter the section again."
                    : `${count === 1 ? "It is" : "They are"} removed from this section and the rest is saved as it is, the inspector comment included. You then enter ${count === 1 ? "it" : "them"} again.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    removed.current = true;
                    onRemove(readable === null ? definition.emptyData() : readable.data);
                  }}
                >
                  {readable === null ? "Clear this section" : count === 1 ? "Remove it" : `Remove ${count} values`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

/** zod's own complaint in plain words, for the moment before the checks have run. */
function describeFallback(issue: UnreadableDataProps["fallback"]): string {
  if (!issue) return "A saved value is not in a form this version of the app reads.";
  const where = issue.path.filter((segment) => typeof segment !== "symbol").map(String).join(" › ");
  return where ? `${where}: ${issue.message}` : issue.message;
}

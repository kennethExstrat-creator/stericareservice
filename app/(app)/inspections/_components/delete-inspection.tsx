"use client";

// Delete on a row of the list, and the one dialog that confirms it.
//
// The dialog belongs to the results, not to a row: the row goes once the
// inspection is deleted (the action re-renders the list in the same answer),
// and the dialog, the toast and keyboard focus must outlive it. A row's
// Delete button only asks InspectionResults to open the dialog.
//
// Focus (delete-focus.ts): Cancel puts it back on the Delete button. After a
// deletion it moves to the main action of the row that took the deleted
// one's place, or, when there is none, to the start of the results (the
// count above the table, or the heading of the state shown instead, such as
// "No inspections yet"), which reads out what is left. It moves once the
// dialog has gone and the list without the row is on screen, whichever comes
// last. If the inspection turned out to be gone or no longer a draft, the
// list is refreshed behind the message, and closing the dialog puts focus on
// that row's main action, or where the row was.
import { OctagonXIcon, Trash2Icon } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { createContext, use, useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { deleteInspection, type DeleteInspectionResult } from "../actions";
import { landingAfterCancel, landingAfterDelete, type DeletedRow, type FocusLanding } from "./delete-focus";
import { focusTargetSelector } from "./list-focus-target";

/**
 * The action never answered: the connection dropped (an iPad on factory
 * Wi-Fi) or a new deployment replaced it. Said in the dialog, never as an
 * error page.
 */
const UNREACHABLE = "The inspection was not deleted: the server could not be reached. Check the connection, then try again.";

async function askToDelete(inspectionId: string): Promise<DeleteInspectionResult> {
  try {
    return await deleteInspection({ inspectionId });
  } catch (error) {
    unstable_rethrow(error);
    // Handled: the dialog says so. A warning, so the dev overlay does not count it as a fault.
    console.warn("[inspections] Delete got no answer", error);
    return { status: "error", message: UNREACHABLE };
  }
}

/** One row's Delete, as the dialog needs it. */
export type DeleteRequest = DeletedRow & {
  refNo: string;
  /** Client and date, so the dialog shows which inspection this is. */
  about: string | null;
};

const OpenDeleteDialog = createContext<(request: DeleteRequest, opener: HTMLElement) => void>(() => {});

/** The rows on screen (inspection-table.tsx marks each with its id) and their main actions. */
const ROW_SELECTOR = "tbody tr[data-id]";
const PRIMARY_ACTION_SELECTOR = '[data-row-action="primary"]';

function rowsOf(scope: HTMLElement): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
}

function rowIdsOf(scope: HTMLElement): string[] {
  return rowsOf(scope).map((row) => row.dataset.id ?? "");
}

function focusLanding(scope: HTMLElement, landing: Exclude<FocusLanding, "wait">) {
  const row = landing === "results" ? null : rowsOf(scope).find((candidate) => candidate.dataset.id === landing.row);
  const target =
    row?.querySelector<HTMLElement>(PRIMARY_ACTION_SELECTOR) ??
    scope.querySelector<HTMLElement>(focusTargetSelector("results"));
  target?.focus();
}

/**
 * The results section of the list. `listKey` changes whenever the rows on
 * screen do (their ids and statuses), so a deletion's focus can wait for the
 * list without the row.
 */
export function InspectionResults({
  listKey,
  className,
  children,
}: {
  listKey: string;
  className?: string;
  children: ReactNode;
}) {
  const scope = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [request, setRequest] = useState<DeleteRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // After a deletion: the row that went, until focus has moved on.
  const deleted = useRef<{ row: DeletedRow; dialogGone: boolean } | null>(null);

  const openDialog = useCallback((next: DeleteRequest, from: HTMLElement) => {
    opener.current = from;
    deleted.current = null;
    setError(null);
    setRequest(next);
    setOpen(true);
  }, []);

  const moveFocusAfterDelete = useCallback(() => {
    const root = scope.current;
    const after = deleted.current;
    if (!root || !after?.dialogGone) return;
    const landing = landingAfterDelete(rowIdsOf(root), after.row);
    // The list without the row is not on screen yet: its render calls again.
    if (landing === "wait") return;
    deleted.current = null;
    focusLanding(root, landing);
  }, []);

  useEffect(() => {
    moveFocusAfterDelete();
  }, [listKey, moveFocusAfterDelete]);

  function confirm() {
    if (!request || pending) return;
    const target = request;
    startTransition(async () => {
      const result = await askToDelete(target.id);
      if (result.status === "deleted") {
        deleted.current = { row: target, dialogGone: false };
        setOpen(false);
        toast.success(`${target.refNo} deleted.`);
      } else {
        setError(result.message);
      }
    });
  }

  /** The dialog has gone: put focus somewhere useful instead of on <body>. */
  function onCloseAutoFocus(event: Event) {
    // Opened from code, so Radix has no trigger to go back to.
    event.preventDefault();
    if (deleted.current) {
      deleted.current.dialogGone = true;
      moveFocusAfterDelete();
      return;
    }
    if (opener.current?.isConnected) {
      opener.current.focus();
      return;
    }
    const root = scope.current;
    if (root && request) focusLanding(root, landingAfterCancel(rowIdsOf(root), request));
  }

  return (
    <OpenDeleteDialog value={openDialog}>
      <section ref={scope} aria-label="Inspections" className={className}>
        {children}
      </section>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !pending) setOpen(false);
        }}
      >
        {request && (
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {request.refNo}?</AlertDialogTitle>
              <AlertDialogDescription className="text-base fine:text-sm">
                {request.about && <span className="mb-1 block font-medium text-foreground">{request.about}</span>}
                The draft is deleted with all its photos and files. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* role="alert": read out as soon as it appears. */}
            {error && (
              <Alert variant="destructive">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{error}</AlertDescription>
              </Alert>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
                {pending && <Spinner aria-hidden />}
                {pending ? "Deleting…" : "Delete inspection"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </OpenDeleteDialog>
  );
}

/**
 * A row's Delete: a trash button named "Delete INS-2026-0001" (row-actions.ts),
 * 44 px on touch, compact with a mouse. It opens the results' confirmation.
 */
export function DeleteInspectionButton({ name, request }: { name: string; request: DeleteRequest }) {
  const openDialog = use(OpenDeleteDialog);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={name}
      title={name}
      data-row-action="delete"
      onClick={(event) => openDialog(request, event.currentTarget)}
      className="text-muted-foreground hover:bg-fail-tint hover:text-fail [&_svg:not([class*='size-'])]:size-4.5"
    >
      <Trash2Icon aria-hidden />
    </Button>
  );
}

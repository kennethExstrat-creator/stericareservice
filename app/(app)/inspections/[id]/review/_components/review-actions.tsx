"use client";

import { useActionState, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { CheckIcon, OctagonXIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/qc";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { approveInspection, reopenInspection, type ReviewActionResult } from "@/lib/inspections/review/actions";
import { RESULT_LABEL } from "@/lib/inspections/review/format";
import { REOPEN_REASON_MAX, REVIEW_MESSAGES } from "@/lib/inspections/review/schemas";
import type { InspectionResult } from "@/lib/schemas/common";
import { unreachable } from "./unreachable";

export type ReviewActionsProps = {
  inspectionId: string;
  refNo: string;
  /** `updated_at` as rendered: approving applies to this version only. */
  version: string;
  finalResult: InspectionResult | null;
  /** The app's suggestion; null when the results could not be worked out. */
  suggestedResult: InspectionResult | null;
  /** Validation errors in the results on screen. */
  errors: number;
};

const IDLE: ReviewActionResult = { status: "idle" };

/**
 * Approve and Reopen for an admin on a submitted inspection, each with its
 * confirmation. A success or a state that moved on (someone else acted
 * first) closes the dialog with a toast; the page refreshes with the new
 * status. An error stays in the dialog, next to what the admin was doing.
 */
export function ReviewActions(props: ReviewActionsProps) {
  const [open, setOpen] = useState<"approve" | "reopen" | null>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={reopenRef} variant="outline" onClick={() => setOpen("reopen")}>
        <RotateCcwIcon aria-hidden />
        Reopen
      </Button>
      <Button ref={approveRef} onClick={() => setOpen("approve")}>
        <CheckIcon aria-hidden />
        Approve
      </Button>

      {open === "approve" && <ApproveDialog {...props} onClose={() => setOpen(null)} returnFocusTo={approveRef} />}
      {open === "reopen" && <ReopenDialog {...props} onClose={() => setOpen(null)} returnFocusTo={reopenRef} />}
    </>
  );
}

type DialogProps = ReviewActionsProps & {
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
};

/** Toast and close on success or a warning; anything else stays in the dialog. */
function settle(result: ReviewActionResult, onClose: () => void): ReviewActionResult {
  if (result.status === "success") {
    toast.success(result.message);
    onClose();
  } else if (result.status === "warning") {
    toast.warning(result.message, { duration: 12_000 });
    onClose();
  }
  return result;
}

function ApproveDialog({
  inspectionId,
  refNo,
  version,
  finalResult,
  suggestedResult,
  errors,
  onClose,
  returnFocusTo,
}: DialogProps) {
  const [state, formAction, pending] = useActionState(
    async (previous: ReviewActionResult, formData: FormData) =>
      settle(await approveInspection(previous, formData).catch(unreachable), onClose),
    IDLE,
  );
  const differs = finalResult !== null && suggestedResult !== null && finalResult !== suggestedResult;

  return (
    <ReviewDialog pending={pending} onClose={onClose} returnFocusTo={returnFocusTo}>
      <form action={formAction} className="grid gap-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Approve {refNo}?</AlertDialogTitle>
          <AlertDialogDescription>
            An approved inspection is final: nobody can change its results, photos or files afterwards. Only the
            choice of report photos stays open.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid gap-2 rounded-lg border border-border bg-slate-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">Final result</dt>
            <dd>
              {finalResult ? (
                <StatusPill status={finalResult} variant="solid" size="sm" label={RESULT_LABEL[finalResult]} />
              ) : (
                <StatusPill status="not_done" size="sm" label="Not chosen" />
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">Suggested result</dt>
            <dd>
              {suggestedResult ? (
                <StatusPill status={suggestedResult} size="sm" label={RESULT_LABEL[suggestedResult]} />
              ) : (
                <span className="text-muted-foreground">Could not be worked out</span>
              )}
            </dd>
          </div>
        </dl>

        {(differs || errors > 0 || finalResult === null) && (
          <ul className="grid gap-2">
            {finalResult === null && <Caution>The inspector has not chosen a final result.</Caution>}
            {differs && <Caution>The final result differs from the suggested result.</Caution>}
            {errors > 0 && (
              <Caution>
                The checks found {errors === 1 ? "1 error" : `${errors} errors`}. Reopen it instead if the inspector
                should fix {errors === 1 ? "it" : "them"} first.
              </Caution>
            )}
          </ul>
        )}

        <input type="hidden" name="inspectionId" value={inspectionId} />
        <input type="hidden" name="version" value={version} />

        {state.status === "error" && <ActionError message={state.message} />}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner aria-hidden /> : <CheckIcon aria-hidden />}
            {pending ? "Approving…" : "Approve"}
          </Button>
        </AlertDialogFooter>
      </form>
    </ReviewDialog>
  );
}

function ReopenDialog({ inspectionId, refNo, onClose, returnFocusTo }: DialogProps) {
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Controlled, so a failed attempt keeps what the admin wrote.
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(async (previous: ReviewActionResult, formData: FormData) => {
    // An empty reason needs no round trip; the server checks everything again.
    const result: ReviewActionResult =
      String(formData.get("reason") ?? "").trim() === ""
        ? { status: "error", message: REVIEW_MESSAGES.reasonMissing, fieldErrors: { reason: REVIEW_MESSAGES.reasonMissing } }
        : await reopenInspection(previous, formData).catch(unreachable);
    const fieldError = result.status === "error" ? (result.fieldErrors?.reason ?? null) : null;
    setReasonError(fieldError);
    if (fieldError) reasonRef.current?.focus();
    return settle(result, onClose);
  }, IDLE);

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <ReviewDialog
      pending={pending}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      // Straight to the reason: it is the one thing to fill in.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        reasonRef.current?.focus();
      }}
    >
      <form action={formAction} noValidate className="grid gap-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">Reopen {refNo}?</AlertDialogTitle>
          <AlertDialogDescription>
            It goes back to the inspector, who can change it and must submit it again before it can be approved.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Field data-invalid={reasonError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-reason`}>What should the inspector change?</FieldLabel>
          <Textarea
            ref={reasonRef}
            id={`${id}-reason`}
            name="reason"
            rows={4}
            maxLength={REOPEN_REASON_MAX}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError(null);
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${errorId} ${hintId}` : hintId}
            className="min-h-24"
          />
          <FieldDescription id={hintId}>
            The inspector sees this on the inspection. Up to {REOPEN_REASON_MAX} characters.
          </FieldDescription>
          {reasonError && <FieldError id={errorId}>{reasonError}</FieldError>}
        </Field>

        <input type="hidden" name="inspectionId" value={inspectionId} />

        {formError && <ActionError message={formError} />}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner aria-hidden /> : <RotateCcwIcon aria-hidden />}
            {pending ? "Reopening…" : "Reopen"}
          </Button>
        </AlertDialogFooter>
      </form>
    </ReviewDialog>
  );
}

/** The confirmation frame: closes only when nothing is pending, and gives focus back to its button. */
function ReviewDialog({
  pending,
  onClose,
  returnFocusTo,
  onOpenAutoFocus,
  children,
}: {
  pending: boolean;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // After a success the page no longer shows the button: focus moves to the new status instead.
          if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {children}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Caution({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </li>
  );
}

/** role="alert" (Alert): read out as soon as it appears. */
function ActionError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <OctagonXIcon aria-hidden />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}
